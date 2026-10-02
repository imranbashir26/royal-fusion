import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fulfillmentDatabase, seedActor, seedOrder, sqlClient, revision } from './support/fulfillmentDatabase.js';
import { AdminOrdersV1Service } from '../services/adminOrdersV1Service.js';
import { AdminAuthorizationService } from '../services/adminAuthorizationService.js';
import { OrdersV1Service } from '../services/ordersV1Service.js';
test('disposable SQL: real canonical authorization, fulfillment transactions and catalog revisions', async (t) => {
    const db = await fulfillmentDatabase();
    t.after(() => db.close());
    const client = sqlClient(db), service = new AdminOrdersV1Service(client, {
        warn() {
        }
    }), auth = new AdminAuthorizationService(client), owner = await seedActor(db, 'owner'), operator = await seedActor(db, 'order_manager');
    const mutate = async (o, action, payload, options = {}) => service.mutate(o.id, action, {
        mutationId: options.mutationId ?? randomUUID(), expectedRevision: options.rev ?? await revision(db, o.id), ...payload
    }, {
        userId: options.actor ?? owner, requestId: 'req_fulfillment_fixture'
    });
    await t.test('real role bundles, legacy rejection and disabled assignments', async () => {
        assert.deepEqual((await auth.resolve(owner)).permissions, ['*']);
        const keys = (await auth.resolve(operator)).permissions;
        for (const p of ['orders.read', 'orders.manage', 'payments.read', 'payments.manage'])
            assert.ok(keys.includes(p));
        for (const key of ['manager', 'content_editor', 'blog_writer']) {
            const actor = await seedActor(db, key), a = await auth.resolve(actor);
            assert.ok(a);
            assert.equal(a.permissions.includes('orders.manage'), false);
            const o = await seedOrder(db);
            await assert.rejects(mutate(o, 'status', {
                status: 'Confirmed'
            }, {
                actor
            }), {
                code: 'PERMISSION_DENIED'
            });
        }
        for (const key of ['owner_admin', 'shop_manager'])
            assert.equal(await auth.resolve(await seedActor(db, key)), null);
        await db.query('update public.user_roles set active=false where user_id=$1', [operator]);
        assert.equal(await auth.resolve(operator), null);
        await db.query('update public.user_roles set active=true where user_id=$1', [operator]);
    });
    await t.test('assignment lifecycle: resolver and RPC ignore expired/revoked/disabled authority', async () => {
        const expired = await seedActor(db, 'order_manager'), revoked = await seedActor(db, 'order_manager'), disabled = await seedActor(db, 'order_manager');
        await db.query("update public.user_roles set expires_at='2000-01-01T00:00:00Z' where user_id=$1", [expired]);
        await db.query("update public.user_roles set active=false,revoked_at='2000-01-01T00:00:00Z' where user_id=$1", [revoked]);
        await db.query('update public.user_roles set active=false where user_id=$1', [disabled]);
        for (const actor of [expired, revoked, disabled]) {
            assert.equal(await auth.resolve(actor), null);
            const o = await seedOrder(db), before = await revision(db, o.id);
            for (const [action, payload] of [['status', { status: 'Confirmed' }], ['cancel', { reason: 'Must not restock' }], ['payment', { reference: '', reason: 'Must not confirm' }]])
                await assert.rejects(mutate(o, action, payload, { actor }), { code: 'PERMISSION_DENIED' });
            assert.equal(await revision(db, o.id), before);
            assert.equal((await db.query('select status,payment_status from public.orders where id=$1', [o.id])).rows[0].status, 'Pending');
            assert.equal((await db.query('select stock_quantity from public.product_variants where id=$1', [o.variant])).rows[0].stock_quantity, 10);
            assert.equal((await db.query("select count(*)::int n from public.admin_audit_logs where resource='orders' and resource_id=$1", [o.id])).rows[0].n, 0);
        }
        // Canonical owner guard forbids expiring owner rows. Simulate a stale legacy row ONLY
        // in this disposable fixture, restoring the guard before exercising real authorization.
        const expiredOwner = await seedActor(db, 'owner');
        await assert.rejects(db.query("update public.user_roles set expires_at='2000-01-01T00:00:00Z' where user_id=$1", [expiredOwner]), /RF_OWNER_ASSIGNMENT_MUST_NOT_EXPIRE/);
        await db.exec('alter table public.user_roles disable trigger user_roles_protect_owner');
        try {
            await db.query("update public.user_roles set expires_at='2000-01-01T00:00:00Z' where user_id=$1", [expiredOwner]);
        } finally {
            await db.exec('alter table public.user_roles enable trigger user_roles_protect_owner');
        }
        assert.equal(await auth.resolve(expiredOwner), null);
        await assert.rejects(mutate(await seedOrder(db), 'note', { text: 'No expired wildcard' }, { actor: expiredOwner }), { code: 'PERMISSION_DENIED' });
        assert.deepEqual((await auth.resolve(owner)).permissions, ['*']);

        const editor = await seedActor(db, 'content_editor');
        await db.query("insert into public.user_roles(user_id,role_id,expires_at) select $1,id,'2000-01-01T00:00:00Z' from public.roles where key='order_manager'", [editor]);
        const editorPermissions = (await auth.resolve(editor)).permissions;
        assert.ok(editorPermissions.includes('promotions.manage'));
        for (const permission of ['orders.read', 'orders.manage', 'payments.read', 'payments.manage', '*'])
            assert.equal(editorPermissions.includes(permission), false);
        await assert.rejects(mutate(await seedOrder(db), 'note', { text: 'No inherited order authority' }, { actor: editor }), { code: 'PERMISSION_DENIED' });

        const mixed = await seedActor(db, 'order_manager'), future = await seedActor(db, 'order_manager');
        await db.query("insert into public.user_roles(user_id,role_id,expires_at) select $1,id,'2000-01-01T00:00:00Z' from public.roles where key='content_editor'", [mixed]);
        await db.query("update public.user_roles set expires_at='2099-01-01T00:00:00Z' where user_id=$1", [future]);
        for (const actor of [operator, mixed, future]) {
            assert.deepEqual((await auth.resolve(actor)).permissions, (await auth.resolve(operator)).permissions);
            await mutate(await seedOrder(db), 'status', { status: 'Confirmed' }, { actor });
        }
        await db.query('update public.user_roles set expires_at=now() where user_id=$1', [future]);
        assert.equal(await auth.resolve(future), null);
        await assert.rejects(mutate(await seedOrder(db), 'note', { text: 'Expired at boundary' }, { actor: future }), { code: 'PERMISSION_DENIED' });
    });
    await t.test('tracking correction reason is bounded, immutable, replay-safe and admin-only', async () => {
        const o = await seedOrder(db);
        await mutate(o, 'status', { status: 'Confirmed' });
        await mutate(o, 'status', { status: 'Processing' });
        await mutate(o, 'status', { status: 'Shipped', courier: 'Old courier', trackingNumber: 'OLD-TRACK' });
        const rev = await revision(db, o.id), mutationId = randomUUID();
        for (const payload of [
            { courier: 'New courier', trackingNumber: 'NEW-TRACK' },
            { courier: 'New courier', trackingNumber: 'NEW-TRACK', reason: '   ' },
            { courier: 'New courier', trackingNumber: 'NEW-TRACK', reason: 'x'.repeat(1001) }
        ]) await assert.rejects(mutate(o, 'fulfillment', payload), { code: payload.reason?.length > 1000 ? 'INVALID_ADMIN_ORDER_REQUEST' : 'INVALID_TRACKING' });
        assert.equal(await revision(db, o.id), rev);
        const reason = 'Corrected transposed tracking entry', payload = { courier: 'New courier', trackingNumber: 'NEW-TRACK', reason };
        const first = await mutate(o, 'fulfillment', payload, { mutationId, rev });
        assert.equal(first.changed, true);
        assert.equal((await mutate(o, 'fulfillment', payload, { mutationId, rev })).replayed, true);
        await assert.rejects(mutate(o, 'fulfillment', { ...payload, reason: 'Different explanation' }, { mutationId, rev }), { code: 'MUTATION_CONFLICT' });
        const rows = (await db.query("select * from public.admin_audit_logs where resource='orders' and metadata->>'mutationId'=$1", [mutationId])).rows;
        assert.equal(rows.length, 1);
        const audit = rows[0], correction = { kind: 'tracking_correction', reason, previous: { courier: 'Old courier', trackingNumber: 'OLD-TRACK' }, next: { courier: 'New courier', trackingNumber: 'NEW-TRACK' } };
        assert.deepEqual(audit.metadata.trackingCorrection, correction);
        assert.equal(audit.admin_id, owner);
        assert.equal(audit.request_id, 'req_fulfillment_fixture');
        assert.equal(audit.action, 'order.fulfillment');
        assert.equal(audit.metadata.mutationId, mutationId);
        assert.ok(audit.created_at);
        const detail = await service.detail(o.id, ['orders.read'], 'req_detail_fixture');
        assert.deepEqual(detail.audit.find(a => a.id === audit.id).trackingCorrection, correction);
        assert.doesNotMatch(JSON.stringify(detail), /fingerprint|"metadata"|"payload"/);
        const publicReceipt = await new OrdersV1Service(client, { logger: { warn() {} } }).create({
            idempotencyKey: o.key.slice('checkout:'.length), items: [{ variantId: o.variant, quantity: 2 }],
            contact: { name: 'Fixture', email: 'fixture@example.invalid', phone: '00000000000' },
            shipping: { address: 'Fictional Address', city: 'Karachi', province: 'Sindh', notes: 'Customer note' }, paymentMethod: 'Cash on Delivery'
        });
        assert.equal(JSON.stringify(publicReceipt).includes(reason), false);
        assert.equal('audit' in publicReceipt, false);
        assert.equal(detail.shipping.customerNotes, 'Customer note');
        assert.equal((await db.query('select internal_notes from public.orders where id=$1', [o.id])).rows[0].internal_notes.includes(reason), false);
        // Authenticated users have SELECT gated by the existing audit.read RLS policy.
        const auditAcl = (await db.query("select has_table_privilege('anon','public.admin_audit_logs','select') a,has_table_privilege('authenticated','public.admin_audit_logs','select') b")).rows[0];
        assert.deepEqual(auditAcl, { a: false, b: true });
        await db.exec('set role authenticated');
        try {
            assert.equal((await db.query('select current_user actor')).rows[0].actor, 'authenticated');
            assert.deepEqual((await db.query('select metadata from public.admin_audit_logs where id=$1', [audit.id])).rows, []);
        } finally { await db.exec('reset role'); }
        // Audit failure must roll back the tracking update and revision as well.
        await db.exec("create function public.fail_tracking_audit() returns trigger language plpgsql as $$ begin raise exception 'PRIVATE SQL'; end $$; create trigger fail_tracking_audit before insert on public.admin_audit_logs for each row execute function public.fail_tracking_audit();");
        try { await assert.rejects(mutate(o, 'fulfillment', { ...payload, trackingNumber: 'MUST-ROLLBACK' }), { code: 'ADMIN_ORDER_UNAVAILABLE' }); }
        finally { await db.exec('drop trigger fail_tracking_audit on public.admin_audit_logs; drop function public.fail_tracking_audit()'); }
        assert.equal(await revision(db, o.id), first.revision);
        assert.equal((await db.query('select tracking_number from public.orders where id=$1', [o.id])).rows[0].tracking_number, 'NEW-TRACK');
    });
    await t.test('actual fulfillment RPC normalizes boundary whitespace for validation, audit and command identity', async () => {
        const o = await seedOrder(db);
        await mutate(o, 'status', { status: 'Confirmed' });
        await mutate(o, 'status', { status: 'Processing' });
        await mutate(o, 'status', { status: 'Shipped', courier: 'Fixture courier', trackingNumber: 'INITIAL' });
        const beforeRevision = await revision(db, o.id);
        const beforeCount = Number((await db.query("select count(*) n from public.admin_audit_logs where resource='orders' and resource_id=$1", [o.id])).rows[0].n);
        for (const reason of ['', ' ', '     ', '\t', '\n', '\r', '\t\n\r', ' \t \n \r ']) {
            await assert.rejects(mutate(o, 'fulfillment', { courier: 'Fixture courier', trackingNumber: 'REJECTED', reason }), { code: 'INVALID_TRACKING' });
        }
        for (const reason of ['x'.repeat(1001), '\t  ' + 'x'.repeat(1001) + '  \n']) {
            await assert.rejects(mutate(o, 'fulfillment', { courier: 'Fixture courier', trackingNumber: 'REJECTED', reason }), { code: 'INVALID_ADMIN_ORDER_REQUEST' });
        }
        assert.equal(await revision(db, o.id), beforeRevision);
        assert.equal(Number((await db.query("select count(*) n from public.admin_audit_logs where resource='orders' and resource_id=$1", [o.id])).rows[0].n), beforeCount);
        const cases = [
            ['Customer provided wrong tracking number', 'Customer provided wrong tracking number'],
            ['   Customer provided wrong tracking number   ', 'Customer provided wrong tracking number'],
            ['\tCustomer provided wrong tracking number\n', 'Customer provided wrong tracking number'],
            ['\n Updated courier after dispatch \r', 'Updated courier after dispatch'],
            ['\t  Wrong tracking number entered  \n', 'Wrong tracking number entered'],
            ['\t Updated courier reference \n', 'Updated courier reference'],
            [' \tWrong tracking\nnumber\r ', 'Wrong tracking\nnumber'],
            ['\tx\n', 'x'],
            ['\t  ' + 'x'.repeat(1000) + '  \n', 'x'.repeat(1000)],
            ['\t42\n', '42'],
        ];
        for (const [index, [raw, normalized]] of cases.entries()) {
            const mutationId = randomUUID(), rev = await revision(db, o.id);
            const payload = { courier: 'Fixture courier', trackingNumber: `NORMALIZED-${index}`, reason: raw };
            const first = await mutate(o, 'fulfillment', payload, { mutationId, rev });
            for (const reason of [normalized, ' \t' + normalized + '\r\n ']) {
                const replay = await mutate(o, 'fulfillment', { ...payload, reason }, { mutationId, rev });
                assert.equal(replay.replayed, true);
                assert.equal(replay.revision, first.revision);
            }
            await assert.rejects(mutate(o, 'fulfillment', { ...payload, reason: 'Genuinely changed explanation' }, { mutationId, rev }), { code: 'MUTATION_CONFLICT' });
            await assert.rejects(mutate(o, 'fulfillment', { ...payload, trackingNumber: 'CHANGED' }, { mutationId, rev }), { code: 'MUTATION_CONFLICT' });
            if (normalized === '42') {
                // Type validation must precede canonicalization/replay, never turn a number into authority.
                await assert.rejects(mutate(o, 'fulfillment', { ...payload, reason: 42 }, { mutationId, rev }), { code: 'INVALID_ADMIN_ORDER_REQUEST' });
            }
            const rows = (await db.query("select * from public.admin_audit_logs where resource='orders' and metadata->>'mutationId'=$1", [mutationId])).rows;
            assert.equal(rows.length, 1);
            assert.equal(rows[0].metadata.trackingCorrection.reason, normalized);
            assert.equal(rows[0].metadata.trackingCorrection.next.trackingNumber, payload.trackingNumber);
            assert.equal(rows[0].admin_id, owner);
            assert.equal(rows[0].request_id, 'req_fulfillment_fixture');
            assert.equal(await revision(db, o.id), first.revision);
        }
    });
    await t.test('cancel exact UUID/quantity, aggregate, history/audit, replay and independent duplicate', async () => {
        const o = await seedOrder(db), mutationId = randomUUID(), rev = await revision(db, o.id);
        const first = await mutate(o, 'cancel', {
            reason: 'Customer requested cancellation'
        }, {
            mutationId, rev
        });
        assert.equal(first.status, 'Cancelled');
        assert.equal((await mutate(o, 'cancel', {
            reason: 'Customer requested cancellation'
        }, {
            mutationId, rev
        })).replayed, true);
        await mutate(o, 'cancel', {
            reason: 'Repeated request'
        });
        for (const table of ['products', 'product_variants'])
            assert.equal((await db.query(`select stock_quantity from public.${table} where id=$1`, [table === 'products' ? o.product : o.variant])).rows[0].stock_quantity, 12);
        const moves = (await db.query("select * from public.inventory_movements where reference_id=$1 and reason='Order cancelled'", [o.id])).rows;
        assert.equal(moves.length, 1);
        assert.equal(moves[0].variant_id, o.variant);
        assert.equal(moves[0].quantity_delta, 2);
        assert.equal(moves[0].created_by, owner);
        assert.equal((await db.query('select count(*)::int n from public.order_status_history where order_id=$1', [o.id])).rows[0].n, 2);
        await assert.rejects(mutate(o, 'note', {
            text: 'Changed command'
        }, {
            mutationId, rev
        }), {
            code: 'MUTATION_CONFLICT'
        });
    });
    await t.test('ledger corruption fails closed; audit failure rolls back every cancellation effect', async () => {
        const o = await seedOrder(db);
        await db.query("update public.inventory_movements set quantity_delta=-1 where reference_id=$1", [o.id]);
        await assert.rejects(mutate(o, 'cancel', {
            reason: 'Cancel'
        }), {
            code: 'ORDER_LEDGER_INCONSISTENT'
        });
        const clean = await seedOrder(db);
        await db.exec("create function public.fail_fulfillment_audit() returns trigger language plpgsql as $$ begin raise exception 'PRIVATE SQL'; end $$;create trigger fail_fulfillment_audit before insert on public.admin_audit_logs for each row execute function public.fail_fulfillment_audit();");
        await assert.rejects(mutate(clean, 'cancel', {
            reason: 'Cancel'
        }), {
            code: 'ADMIN_ORDER_UNAVAILABLE'
        });
        await db.exec('drop trigger fail_fulfillment_audit on public.admin_audit_logs;drop function public.fail_fulfillment_audit()');
        assert.equal((await db.query('select status from public.orders where id=$1', [clean.id])).rows[0].status, 'Pending');
        assert.equal((await db.query('select stock_quantity from public.product_variants where id=$1', [clean.variant])).rows[0].stock_quantity, 10);
        assert.equal((await db.query("select count(*)::int n from public.inventory_movements where reference_id=$1 and reason='Order cancelled'", [clean.id])).rows[0].n, 0);
    });
    await t.test('Bank Transfer Paid once, conflict reference and paid cancellation blocked', async () => {
        const o = await seedOrder(db, 'Bank Transfer');
        await mutate(o, 'status', {
            status: 'Confirmed'
        });
        await assert.rejects(mutate(o, 'status', {
            status: 'Processing'
        }), {
            code: 'PAYMENT_INCONSISTENT'
        });
        await mutate(o, 'payment', {
            reference: 'BANK-FIXTURE', reason: 'Funds verified'
        }, {
            actor: operator
        });
        const before = (await db.query('select processed_at from public.payments where order_id=$1', [o.id])).rows[0].processed_at;
        await mutate(o, 'payment', {
            reference: 'BANK-FIXTURE', reason: 'Recheck'
        });
        assert.deepEqual((await db.query('select processed_at from public.payments where order_id=$1', [o.id])).rows[0].processed_at, before);
        await assert.rejects(mutate(o, 'payment', {
            reference: 'DIFFERENT', reason: 'Recheck'
        }), {
            code: 'PAYMENT_CONFIRMATION_CONFLICT'
        });
        await assert.rejects(mutate(o, 'cancel', {
            reason: 'Cancel paid order'
        }), {
            code: 'PAID_CANCELLATION_BLOCKED'
        });
        await mutate(o, 'status', {
            status: 'Processing'
        });
    });
    await t.test('COD forward workflow, shipping atomicity/correction and explicit collection after delivery', async () => {
        const o = await seedOrder(db);
        await assert.rejects(mutate(o, 'payment', {
            reference: '', reason: 'Verified'
        }), {
            code: 'PAYMENT_INCONSISTENT'
        });
        await mutate(o, 'status', {
            status: 'Confirmed'
        });
        const old = await revision(db, o.id);
        await mutate(o, 'status', {
            status: 'Processing'
        });
        await assert.rejects(mutate(o, 'cancel', {
            reason: 'Stale cancel'
        }, {
            rev: old
        }), {
            code: 'ORDER_STALE'
        });
        await assert.rejects(mutate(o, 'status', {
            status: 'Shipped'
        }), {
            code: 'FULFILLMENT_REQUIRED'
        });
        await mutate(o, 'status', {
            status: 'Shipped', courier: 'Fixture courier', trackingNumber: 'TRACK-1'
        });
        await assert.rejects(mutate(o, 'cancel', {
            reason: 'Too late'
        }), {
            code: 'CANCELLATION_NOT_ALLOWED'
        });
        await assert.rejects(mutate(o, 'fulfillment', {
            courier: 'Fixture courier', trackingNumber: 'TRACK-2', reason: ''
        }), {
            code: 'INVALID_TRACKING'
        });
        await mutate(o, 'fulfillment', {
            courier: 'Fixture courier', trackingNumber: 'TRACK-2', reason: 'Corrected entry'
        });
        await mutate(o, 'status', {
            status: 'Delivered'
        });
        assert.equal((await db.query('select payment_status from public.orders where id=$1', [o.id])).rows[0].payment_status, 'Unpaid');
        await mutate(o, 'payment', {
            reference: 'COD-FIXTURE', reason: 'Remittance verified'
        });
        assert.equal((await db.query('select payment_status from public.orders where id=$1', [o.id])).rows[0].payment_status, 'Paid');
    });
    await t.test('all transition pairs, harmless same state and terminal restrictions', async () => {
        const states = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned', 'Refunded'];
        for (const from of states)
            for (const to of ['Confirmed', 'Processing', 'Shipped', 'Delivered']) {
                const o = await seedOrder(db);
                await db.query('update public.orders set status=$1 where id=$2', [from, o.id]);
                const valid = from === to || ({
                    Pending: 'Confirmed', Confirmed: 'Processing', Processing: 'Shipped', Shipped: 'Delivered'
                })[from] === to;
                const payload = {
                    status: to, ...(to === 'Shipped' ? {
                        courier: 'Courier', trackingNumber: 'Track'
                    } : {})
                };
                if (from === to && to === 'Shipped') {
                    await db.query("update public.orders set courier_name='Courier',tracking_number='Track' where id=$1", [o.id]);
                }
                if (valid)
                    await mutate(o, 'status', payload);
                else
                    await assert.rejects(mutate(o, 'status', payload), {
                        code: 'INVALID_ORDER_TRANSITION'
                    });
            }
    });
    await t.test('note replay remains private, exact canonical payment selection and inconsistent amount fail', async () => {
        const o = await seedOrder(db), mutationId = randomUUID(), rev = await revision(db, o.id);
        await mutate(o, 'note', {
            text: 'Private dispatch note'
        }, {
            mutationId, rev
        });
        await mutate(o, 'note', {
            text: 'Private dispatch note'
        }, {
            mutationId, rev
        });
        assert.equal((await db.query('select count(*)::int n from public.order_notes where order_id=$1', [o.id])).rows[0].n, 1);
        await db.query("insert into public.payments(order_id,provider,amount,status) values($1,'Unrelated',0,'Paid')", [o.id]);
        const detail = await service.detail(o.id, ['*'], 'req_detail_fixture');
        assert.equal(detail.items[0].variantId, o.variant);
        assert.equal(detail.notes[0].text, 'Private dispatch note');
        assert.equal(detail.shipping.customerNotes, 'Customer note');
        assert.equal(detail.inventory[0].variantId, o.variant);
        assert.ok(detail.canonicalPaymentId);
        assert.equal((await service.detail(o.id, ['orders.read'], 'req_detail_fixture')).payments.length, 0);
        const bank = await seedOrder(db, 'Bank Transfer');
        await db.query('update public.payments set amount=1 where order_id=$1', [bank.id]);
        await assert.rejects(mutate(bank, 'payment', {
            reference: '', reason: 'Verified'
        }), {
            code: 'PAYMENT_INCONSISTENT'
        });
    });
    await t.test('catalog stale absolute stock cannot overwrite checkout or cancellation, fresh version preserves UUID', async () => {
        const o = await seedOrder(db);
        const stale = String((await db.query('select catalog_revision from public.products where id=$1', [o.product])).rows[0].catalog_revision);
        await mutate(o, 'cancel', {
            reason: 'Cancel'
        });
        const save = (rev) => db.query('select public.save_catalog_product($1,$2::jsonb,null,$3)', [o.product, JSON.stringify({
                stock_quantity: 7
            }), rev]);
        await assert.rejects(save(stale), /CATALOG_STALE/);
        await assert.rejects(save(null), /CATALOG_STALE/);
        const fresh = String((await db.query('select catalog_revision from public.products where id=$1', [o.product])).rows[0].catalog_revision);
        await save(fresh);
        assert.equal((await db.query('select stock_quantity from public.product_variants where id=$1', [o.variant])).rows[0].stock_quantity, 7);
    });
    await t.test('canonical payment provider, currency, status and missing payment fail closed', async () => {
        for (const [column, value] of [['provider', 'Different'], ['currency', 'USD'], ['status', 'Failed']]) {
            const o = await seedOrder(db, 'Bank Transfer');
            await db.query(`update public.payments set ${column}=$1 where order_id=$2`, [value, o.id]);
            await assert.rejects(mutate(o, 'payment', {
                reference: '', reason: 'Verify'
            }), {
                code: 'PAYMENT_INCONSISTENT'
            });
            assert.equal((await db.query('select payment_status from public.orders where id=$1', [o.id])).rows[0].payment_status, 'Pending');
        }
        const o = await seedOrder(db);
        await db.query('delete from public.payments where order_id=$1', [o.id]);
        await assert.rejects(mutate(o, 'cancel', {
            reason: 'Cancel'
        }), {
            code: 'PAYMENT_NOT_FOUND'
        });
        assert.equal((await db.query('select stock_quantity from public.product_variants where id=$1', [o.variant])).rows[0].stock_quantity, 10);
    });
    await t.test('Confirmed/Processing cancellation preserves hidden merchandising flags and same-status creates no history', async () => {
        for (const state of ['Confirmed', 'Processing']) {
            const o = await seedOrder(db);
            await mutate(o, 'status', {
                status: 'Confirmed'
            });
            if (state === 'Processing')
                await mutate(o, 'status', {
                    status: 'Processing'
                });
            const count = Number((await db.query('select count(*) n from public.order_status_history where order_id=$1', [o.id])).rows[0].n);
            await mutate(o, 'status', {
                status: state
            });
            assert.equal(Number((await db.query('select count(*) n from public.order_status_history where order_id=$1', [o.id])).rows[0].n), count);
            await db.query('update public.product_variants set active=false,available=false where id=$1', [o.variant]);
            await mutate(o, 'cancel', {
                reason: 'Cancel hidden original UUID'
            });
            const v = (await db.query('select stock_quantity,active,available from public.product_variants where id=$1', [o.variant])).rows[0];
            assert.deepEqual(v, {
                stock_quantity: 12, active: false, available: false
            });
            assert.equal((await db.query('select stock_quantity from public.products where id=$1', [o.product])).rows[0].stock_quantity, 0);
        }
    });
    await t.test('service-only ACL, immutable audit and deterministic lock structure', async () => {
        const acl = (await db.query("select has_function_privilege('anon','public.apply_admin_order_action(uuid,uuid,text,uuid,text,jsonb,text)','execute') a,has_function_privilege('authenticated','public.apply_admin_order_action(uuid,uuid,text,uuid,text,jsonb,text)','execute') b")).rows[0];
        assert.deepEqual(acl, {
            a: false, b: false
        });
        await assert.rejects(db.exec('delete from public.admin_audit_logs'), /RF_AUDIT_LOG_IMMUTABLE/);
        const sql = await readFile(new URL('../../supabase/migrations/011_admin_order_fulfillment.sql', import.meta.url), 'utf8');
        assert.ok(sql.indexOf('for update of siblings') < sql.indexOf('for update of parents'));
        const deniedOrder = await seedOrder(db);
        await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");
        await assert.rejects(mutate(deniedOrder, 'note', {
            text: 'Forbidden'
        }));
        await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
    });
});
