import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createAuthConfig } from '../auth/config.js';
import { getAuthCookieNames, getSessionCsrfToken } from '../auth/cookies.js';
import { requestContext, authErrorHandler } from '../middleware/authSecurity.js';
import { AdminAuthorizationService } from '../services/adminAuthorizationService.js';
import { createAdminOrdersV1Router } from '../routes/adminOrdersV1.js';
import { fulfillmentDatabase, sqlClient, seedActor, seedOrder } from './support/fulfillmentDatabase.js';
test('relational API: real authorization, list/detail, strict writes, replay and safe errors', async (t) => {
    const db = await fulfillmentDatabase();
    t.after(() => db.close());
    const owner = await seedActor(db, 'owner'), operator = await seedActor(db, 'order_manager'), manager = await seedActor(db, 'manager'), editor = await seedActor(db, 'content_editor'), writer = await seedActor(db, 'blog_writer'), customer = randomUUID(), first = await seedOrder(db);
    for (let i = 0; i < 26; i++)
        await seedOrder(db);
    const origin = 'http://localhost:5173', config = createAuthConfig({
        NODE_ENV: 'test', CLIENT_ORIGIN: origin, AUTH_CSRF_SECRET: 'fulfillment-fixture-secret-at-least-32'
    }), names = getAuthCookieNames(config), client = sqlClient(db), logs = [];
    const runtime = {
        config, repository: {
            client
        }, adminAuthorization: new AdminAuthorizationService(client), sessionService: {
            async restore(cookies) {
                return {
                    identity: {
                        id: cookies.sessionHandle
                    }, record: {
                        sessionClass: cookies.sessionHandle === customer ? 'customer' : 'administrator'
                    }
                };
            }
        }
    };
    const app = express();
    app.use(requestContext, express.json(), cookieParser());
    app.use('/api/v1/admin/orders', createAdminOrdersV1Router(runtime, {
        logger: {
            warn: e => logs.push(e)
        }, writeLimit: 1000
    }));
    app.use(authErrorHandler(config));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    t.after(() => new Promise(r => server.close(r)));
    async function request(path = '', { method = 'GET', actor = owner, body, csrf = true, originValue = origin } = {}) {
        const headers = {
            'Content-Type': 'application/json', 'X-Request-ID': 'req_api_fulfillment'
        };
        if (originValue)
            headers.Origin = originValue;
        if (actor) {
            const token = getSessionCsrfToken(actor, config), jwt = `e30.${Buffer.from(JSON.stringify({
                exp: Math.floor(Date.now() / 1000) + 3600
            })).toString('base64url')}.sig`;
            headers.Cookie = `${names.access}=${jwt}; ${names.refresh}=fixture; ${names.session}=${actor}; ${names.csrf}=${token}`;
            if (csrf)
                headers['X-RF-CSRF'] = token;
        }
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/admin/orders${path}`, {
            method, headers, ...(body ? {
                body: JSON.stringify(body)
            } : {})
        });
        return {
            status: response.status, cache: response.headers.get('cache-control'), body: await response.json()
        };
    }
    await t.test('owner/operator allowed; manager/editor/writer/customer/anonymous/disabled denied', async () => {
        for (const actor of [owner, operator])
            assert.equal((await request('', {
                actor
            })).status, 200);
        for (const actor of [manager, editor, writer, customer, null])
            assert.notEqual((await request('', {
                actor
            })).status, 200);
        await db.query('update public.user_roles set active=false where user_id=$1', [operator]);
        assert.equal((await request('', {
            actor: operator
        })).status, 403);
        await db.query('update public.user_roles set active=true where user_id=$1', [operator]);
    });
    await t.test('pagination filters literal special search and exact DTO', async () => {
        const list = await request();
        assert.equal(list.status, 200);
        assert.equal(list.cache, 'no-store');
        assert.equal(list.body.data.items.length, 25);
        assert.equal(list.body.data.total, 27);
        assert.equal((await request('?page=2')).body.data.items.length, 2);
        assert.equal((await request('?pageSize=101')).status, 400);
        assert.equal((await request('?status=Pending&paymentStatus=Unpaid&paymentMethod=Cash%20on%20Delivery')).body.data.total, 27);
        await db.query('update public.orders set customer_name=$1 where id=$2', ['Comma, quote" and % literal', first.id]);
        const search = await request('?search=' + encodeURIComponent('quote" and %'));
        assert.equal(search.status, 200);
        assert.equal(search.body.data.total, 1);
        assert.equal((await request('?search=' + encodeURIComponent('x),status.eq.Delivered'))).body.data.total, 0);
        const detail = (await request('/' + first.id)).body.data;
        assert.equal(detail.items[0].variantId, first.variant);
        assert.equal(detail.customer.name, 'Comma, quote" and % literal');
        assert.equal('idempotency_key' in detail, false);
        assert.equal('metadata' in detail.payments[0], false);
        assert.equal((await request('/bad')).status, 400);
        assert.equal((await request('/' + randomUUID())).status, 404);
    });
    await t.test('expired/revoked assignments and mixed content role cannot read or mutate orders', async () => {
        const expired = await seedActor(db, 'order_manager');
        await db.query("update public.user_roles set expires_at='2000-01-01T00:00:00Z' where user_id=$1", [expired]);
        for (const mixed of [false, true]) {
            if (mixed) await db.query("insert into public.user_roles(user_id,role_id) select $1,id from public.roles where key='content_editor'", [expired]);
            assert.equal((await request('', { actor: expired })).status, 403);
            for (const [action, fields] of [['status', { status: 'Confirmed' }], ['payment', { reference: '', reason: 'No authority' }]])
                assert.equal((await request('/' + first.id + '/' + action, { method: 'PATCH', actor: expired, body: { mutationId: randomUUID(), expectedRevision: '0', ...fields } })).status, 403);
        }
        const future = await seedActor(db, 'order_manager');
        await db.query("update public.user_roles set expires_at='2099-01-01T00:00:00Z' where user_id=$1", [future]);
        assert.equal((await request('', { actor: future })).status, 200);
        await db.query("update public.user_roles set active=false,revoked_at='2000-01-01T00:00:00Z' where user_id=$1", [future]);
        assert.equal((await request('', { actor: future })).status, 403);
    });
    await t.test('admin correction DTO exposes controlled reason and before/after only', async () => {
        const o = await seedOrder(db);
        async function write(action, fields, mutationId = randomUUID(), expectedRevision) {
            const revision = expectedRevision ?? (await request('/' + o.id)).body.data.revision;
            return request('/' + o.id + '/' + action, { method: 'PATCH', body: { mutationId, expectedRevision: revision, ...fields } });
        }
        for (const status of ['Confirmed', 'Processing']) assert.equal((await write('status', { status })).status, 200);
        assert.equal((await write('status', { status: 'Shipped', courier: 'Before courier', trackingNumber: 'BEFORE' })).status, 200);
        for (const reason of [undefined, '', ' ', '     ', '\t', '\n', '\r', '\t\n\r', ' \t \n \r ', 'x'.repeat(1001)]) {
            const invalid = await write('fulfillment', { courier: 'After courier', trackingNumber: 'AFTER', ...(reason === undefined ? {} : { reason }) });
            assert.ok([400, 409].includes(invalid.status));
        }
        const mutationId = randomUUID(), revision = (await request('/' + o.id)).body.data.revision;
        const reason = 'Operator corrected courier record', fields = { courier: 'After courier', trackingNumber: 'AFTER', reason };
        assert.equal((await write('fulfillment', { ...fields, reason: '\t  ' + reason + '  \n' }, mutationId, revision)).status, 200);
        assert.equal((await write('fulfillment', fields, mutationId, revision)).body.data.replayed, true);
        assert.equal((await write('fulfillment', { ...fields, reason: ' ' + reason + ' ' }, mutationId, revision)).body.data.replayed, true);
        assert.equal((await write('fulfillment', { ...fields, reason: 'Changed reason' }, mutationId, revision)).body.error.code, 'MUTATION_CONFLICT');
        const response = await request('/' + o.id), audit = response.body.data.audit.filter(a => a.trackingCorrection);
        assert.equal(audit.length, 1);
        assert.deepEqual(audit[0].trackingCorrection, { kind: 'tracking_correction', reason, previous: { courier: 'Before courier', trackingNumber: 'BEFORE' }, next: { courier: 'After courier', trackingNumber: 'AFTER' } });
        assert.equal(audit[0].actor, owner);
        assert.equal(audit[0].requestId, 'req_api_fulfillment');
        assert.doesNotMatch(JSON.stringify(response.body), /fingerprint|"metadata"|"payload"/);
        assert.equal((await request('/' + o.id, { actor: customer })).status, 403);
        assert.equal((await request('/' + o.id, { actor: null })).status, 403);
    });
    await t.test('CSRF origin schema actor/stock injection, status replay and stale conflict', async () => {
        const body = {
            mutationId: randomUUID(), expectedRevision: (await request('/' + first.id)).body.data.revision, status: 'Confirmed'
        };
        assert.equal((await request('/' + first.id + '/status', {
            method: 'PATCH', body, csrf: false
        })).status, 403);
        assert.equal((await request('/' + first.id + '/status', {
            method: 'PATCH', body, originValue: 'https://evil.invalid'
        })).status, 403);
        for (const extra of [{
                actorId: owner
            }, {
                quantity: 999
            }, {
                status: 'Cancelled'
            }, {
                total: 1
            }])
            assert.equal((await request('/' + first.id + '/status', {
                method: 'PATCH', body: {
                    ...body, ...extra
                }
            })).status, 400);
        const result = await request('/' + first.id + '/status', {
            method: 'PATCH', body
        });
        assert.equal(result.status, 200);
        assert.equal((await request('/' + first.id + '/status', {
            method: 'PATCH', body
        })).body.data.replayed, true);
        const stale = await request('/' + first.id + '/cancel', {
            method: 'POST', body: {
                mutationId: randomUUID(), expectedRevision: body.expectedRevision, reason: 'Stale'
            }
        });
        assert.equal(stale.body.error.code, 'ORDER_STALE');
        assert.equal(stale.body.error.requestId, 'req_api_fulfillment');
        assert.doesNotMatch(JSON.stringify(stale.body), /SELECT|stack|Authorization/);
        assert.ok(logs.some(l => l.requestId === 'req_api_fulfillment' && l.subsystem === 'admin_orders'));
    });
});
