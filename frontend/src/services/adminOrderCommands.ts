import type { AdminOrderAction, AdminOrderError, AdminOrderMutationResult } from '../types/adminOrders.ts';
export interface AdminOrderCommand {
    action: AdminOrderAction;
    body: Record<string, string> & {
        mutationId: string;
        expectedRevision: string;
    };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields: Record<AdminOrderAction, string[]> = {
    status: ['status', 'courier', 'trackingNumber', 'reason'], fulfillment: ['courier', 'trackingNumber', 'reason'], payment: ['reference', 'reason'], cancel: ['reason'], note: ['text']
};
// These RPC rejections occur after durable replay lookup. Auth/rate-limit failures
// cannot prove that an earlier lost response did not commit and retain the command.
const definitiveRejections = new Set(['ORDER_NOT_FOUND', 'ORDER_STALE', 'INVALID_ORDER_TRANSITION', 'CANCELLATION_NOT_ALLOWED', 'PAID_CANCELLATION_BLOCKED', 'ORDER_LEDGER_INCONSISTENT', 'PAYMENT_NOT_FOUND', 'PAYMENT_INCONSISTENT', 'PAYMENT_CONFIRMATION_CONFLICT', 'FULFILLMENT_REQUIRED', 'INVALID_TRACKING']);
export function allowedOrderActions(status: string, paymentMethod: string, paymentStatus: string, canManage: boolean, canPay: boolean) {
    const actions: string[] = [];
    if (canManage) {
        if (status === 'Pending')
            actions.push('Confirmed');
        if (status === 'Confirmed' && (paymentMethod !== 'Bank Transfer' || paymentStatus === 'Paid'))
            actions.push('Processing');
        if (status === 'Processing')
            actions.push('Shipped', 'fulfillment');
        if (status === 'Shipped')
            actions.push('Delivered', 'fulfillment');
        if (['Pending', 'Confirmed', 'Processing'].includes(status) && paymentStatus !== 'Paid')
            actions.push('cancel');
        if (['Pending', 'Confirmed', 'Processing', 'Shipped'].includes(status))
            actions.push('note');
    }
    if (canPay && ((paymentMethod === 'Bank Transfer' && paymentStatus === 'Pending' && ['Pending', 'Confirmed'].includes(status)) || (paymentMethod === 'Cash on Delivery' && paymentStatus === 'Unpaid' && status === 'Delivered')))
        actions.push('payment');
    return actions;
}
function valid(value: unknown): value is AdminOrderCommand {
    if (!value || typeof value !== 'object')
        return false;
    const v = value as AdminOrderCommand;
    return Object.keys(v).length === 2 && Object.hasOwn(fields, v.action) && Boolean(v.body) && typeof v.body === 'object' && uuid.test(v.body.mutationId) && /^(0|[1-9][0-9]{0,18})$/.test(v.body.expectedRevision) && Object.entries(v.body).every(([k, n]) => [...fields[v.action], 'mutationId', 'expectedRevision'].includes(k) && typeof n === 'string' && n.length <= 2000);
}
// The saved command survives refresh/lost responses. Never substitute a new UUID on retry.
export function createAdminOrderCommands(id: string, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, send: (action: AdminOrderAction, body: AdminOrderCommand['body']) => Promise<AdminOrderMutationResult>, newUUID = () => crypto.randomUUID()) {
    const key = `royal-fusion-admin-order:${id}`;
    let pending: AdminOrderCommand | null = null, blocked = false, running = false;
    try {
        const raw = storage.getItem(key);
        if (raw !== null) {
            const parsed: unknown = JSON.parse(raw);
            if (!valid(parsed))
                blocked = true;
            else
                pending = parsed;
        }
    }
    catch {
        blocked = true;
    }
    async function execute() {
        if (blocked || !pending)
            throw new Error('Saved admin command requires recovery.');
        if (running)
            throw new Error('A command is already running.');
        running = true;
        try {
            const result = await send(pending.action, pending.body);
            if (!result || result.id !== id || typeof result.revision !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(result.revision) || !['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned', 'Refunded'].includes(result.status) || !['Unpaid', 'Pending', 'Paid', 'Failed', 'Refunded'].includes(result.paymentStatus) || typeof result.changed !== 'boolean' || typeof result.replayed !== 'boolean' || typeof result.refundRequired !== 'boolean')
                throw new Error('The action result could not be verified. Retry its saved request.');
            storage.removeItem(key);
            pending = null;
            return result;
        }
        catch (error) {
            const failure = error as AdminOrderError;
            if (failure.status && failure.status >= 400 && failure.status < 500 && definitiveRejections.has(failure.code ?? '')) {
                storage.removeItem(key);
                pending = null;
            }
            throw error;
        }
        finally {
            running = false;
        }
    }
    return {
        get pending() {
            return pending;
        }, get blocked() {
            return blocked;
        }, retry: execute, async submit(action: AdminOrderAction, revision: string, payload: Record<string, string>) {
            if (blocked || pending || running)
                throw new Error('Retry the saved command before starting another action.');
            const candidate = {
                action, body: {
                    ...payload, mutationId: newUUID(), expectedRevision: revision
                }
            };
            if (!valid(candidate))
                throw new Error('Invalid admin command.');
            storage.setItem(key, JSON.stringify(candidate));
            pending = candidate;
            return execute();
        }
    };
}
