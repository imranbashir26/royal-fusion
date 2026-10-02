import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { allowedOrderActions, createAdminOrderCommands } from '../src/services/adminOrderCommands.ts';
const id = '90000000-0000-4000-8000-000000000001';
const result = {
    id, revision: '1', status: 'Pending', paymentStatus: 'Unpaid', changed: true, replayed: false, refundRequired: false
};
const disk = () => {
    const map = new Map();
    return {
        map, getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k)
    };
};
test('launch actions enforce forward states, permissions, Bank Transfer and COD rules', () => {
    assert.deepEqual(allowedOrderActions('Pending', 'Cash on Delivery', 'Unpaid', true, false), ['Confirmed', 'cancel', 'note']);
    assert.equal(allowedOrderActions('Confirmed', 'Bank Transfer', 'Pending', true, true).includes('Processing'), false);
    assert.ok(allowedOrderActions('Confirmed', 'Bank Transfer', 'Paid', true, true).includes('Processing'));
    assert.ok(allowedOrderActions('Delivered', 'Cash on Delivery', 'Unpaid', false, true).includes('payment'));
    for (const status of ['Cancelled', 'Returned', 'Refunded'])
        assert.deepEqual(allowedOrderActions(status, 'Cash on Delivery', 'Unpaid', true, true), []);
    assert.deepEqual(allowedOrderActions('Pending', 'Bank Transfer', 'Pending', false, false), []);
    assert.equal(allowedOrderActions('Shipped', 'Cash on Delivery', 'Unpaid', true, true).includes('cancel'), false);
});
test('lost response and refresh reuse exact mutation, duplicate clicks and different action blocked', async () => {
    const storage = disk(), calls = [];
    let minted = 0, reject;
    const first = createAdminOrderCommands(id, storage, (action, body) => {
        calls.push({
            action, body
        });
        return new Promise((_, r) => {
            reject = r;
        });
    }, () => {
        minted++;
        return id;
    });
    const pending = first.submit('note', '0', {
        text: 'Private note'
    });
    await assert.rejects(first.submit('cancel', '0', {
        reason: 'Different'
    }));
    reject(new Error('Lost response'));
    await assert.rejects(pending);
    const restored = createAdminOrderCommands(id, storage, async (action, body) => {
        calls.push({
            action, body
        });
        return result;
    }, () => assert.fail('No replacement UUID'));
    await restored.retry();
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(minted, 1);
    assert.equal(restored.pending, null);
    assert.equal(storage.map.size, 0);
});
test('tracking correction retry retains exact human-readable reason and mutation identity', async () => {
    const storage = disk(), calls = [], reason = 'Corrected transposed tracking entry';
    const first = createAdminOrderCommands(id, storage, async (action, body) => {
        calls.push({ action, body });
        throw new Error('Lost correction response');
    }, () => id);
    await assert.rejects(first.submit('fulfillment', '5', { courier: 'Courier', trackingNumber: 'CORRECTED', reason }));
    const restored = createAdminOrderCommands(id, storage, async (action, body) => {
        calls.push({ action, body });
        return { ...result, revision: '6', status: 'Shipped', replayed: true };
    }, () => assert.fail('No replacement UUID'));
    await restored.retry();
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(calls[1].body.reason, reason);
    assert.equal(calls[1].body.expectedRevision, '5');
    assert.equal(storage.map.size, 0);
});
test('unverified successful response retains command for exact replay', async () => {
    const storage = disk();
    let calls = 0;
    const c = createAdminOrderCommands(id, storage, async () => {
        calls++;
        return {
            id, revision: '1'
        };
    }, () => id);
    await assert.rejects(c.submit('note', '0', {
        text: 'Review'
    }));
    assert.ok(c.pending);
    await assert.rejects(c.retry());
    assert.equal(calls, 2);
    assert.equal(c.pending.body.mutationId, id);
});
test('auth and rate-limit failures after an unknown response never discard replay identity', async () => {
    const storage = disk();
    let status = 503;
    const calls = [];
    const c = createAdminOrderCommands(id, storage, async (action, body) => {
        calls.push(body);
        throw Object.assign(new Error('Unavailable'), {
            status, code: status === 403 ? 'PERMISSION_DENIED' : 'ADMIN_ORDER_RATE_LIMITED'
        });
    }, () => id);
    await assert.rejects(c.submit('note', '0', {
        text: 'Potentially committed'
    }));
    for (const code of [401, 403, 429]) {
        status = code;
        await assert.rejects(c.retry());
        assert.equal(c.pending.body.mutationId, id);
    }
    assert.ok(calls.every(body => body.mutationId === id));
    assert.equal(storage.map.size, 1);
});
test('stale conflict releases command for refreshed revision; unknown server failure retains it', async () => {
    const storage = disk(), c = createAdminOrderCommands(id, storage, async () => {
        throw Object.assign(new Error('Stale'), {
            status: 409, code: 'ORDER_STALE'
        });
    }, () => id);
    await assert.rejects(c.submit('status', '1', {
        status: 'Confirmed'
    }));
    assert.equal(c.pending, null);
    const unknown = createAdminOrderCommands(id, storage, async () => {
        throw Object.assign(new Error('Unknown'), {
            status: 503
        });
    }, () => id);
    await assert.rejects(unknown.submit('cancel', '2', {
        reason: 'Cancel'
    }));
    assert.ok(unknown.pending);
});
test('corrupt command and unavailable storage block new UUID/order transport', async () => {
    for (const raw of ['null', 'false', '0', '""', '{bad', '{}']) {
        const storage = disk();
        storage.setItem(`royal-fusion-admin-order:${id}`, raw);
        const c = createAdminOrderCommands(id, storage, () => assert.fail('No transport'), () => assert.fail('No UUID'));
        await assert.rejects(c.submit('note', '0', {
            text: 'Test'
        }));
        assert.equal(c.blocked, true);
    }
    const c = createAdminOrderCommands(id, {
        getItem() {
            throw Error('Unavailable');
        }, setItem() {
        }, removeItem() {
        }
    }, () => assert.fail(), () => assert.fail());
    assert.equal(c.blocked, true);
});
test('relational Orders and dashboard contain no prototype calls and cancellation carries no stock payload', () => {
    for (const name of ['AdminOrdersPage.tsx', 'AdminOrderDetailsPage.tsx', 'AdminOrderActions.tsx', 'AdminDashboardPage.tsx']) {
        const source = readFileSync(new URL(`../src/admin/${name}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /adminApi\.|resources\/orders|updateOrderStatus|stockQuantity|restockQuantity/);
    }
    const api = readFileSync(new URL('../src/services/adminOrdersApi.ts', import.meta.url), 'utf8');
    assert.match(api, /protectedRequest/);
    assert.match(api, /\/v1\/admin\/orders/);
});
