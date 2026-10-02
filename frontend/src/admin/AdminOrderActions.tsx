import { useEffect, useRef, useState } from 'react';
import type { AdminOrderDetail, AdminOrderAction, AdminOrderError } from '../types/adminOrders';
import { useAdminAuth } from './AdminAuthProvider';
import { adminOrdersApi } from '../services/adminOrdersApi';
import { allowedOrderActions, createAdminOrderCommands } from '../services/adminOrderCommands';
export function AdminOrderActions({ order, refresh }: {
    order: AdminOrderDetail;
    refresh: () => Promise<void>;
}) {
    const { can } = useAdminAuth(), [courier, setCourier] = useState(order.courier), [tracking, setTracking] = useState(order.trackingNumber), [reason, setReason] = useState(''), [reference, setReference] = useState(''), [note, setNote] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [, render] = useState(0);
    const controller = useRef<ReturnType<typeof createAdminOrderCommands> | null>(null), inFlight = useRef(false);
    useEffect(() => {
        try {
            controller.current = createAdminOrderCommands(order.id, sessionStorage, (a, b) => adminOrdersApi.mutate(order.id, a, b));
        }
        catch {
            setError('Admin command storage is unavailable.');
        }
        render(n => n + 1);
    }, [order.id]);
    useEffect(() => {
        setCourier(order.courier);
        setTracking(order.trackingNumber);
    }, [order.courier, order.trackingNumber]);
    const permitted = allowedOrderActions(order.status, order.paymentMethod, order.paymentStatus, can('orders.manage'), can('payments.manage'));
    async function run(action?: AdminOrderAction, payload: Record<string, string> = {}) {
        if (inFlight.current || !controller.current)
            return;
        if (action && ['cancel', 'payment'].includes(action) && !window.confirm(action === 'cancel' ? 'Cancel this order and restore its original inventory?' : 'Confirm that the funds have actually been verified?'))
            return;
        inFlight.current = true;
        setBusy(true);
        setError('');
        try {
            if (action)
                await controller.current.submit(action, order.revision, payload);
            else
                await controller.current.retry();
            setNote('');
            await refresh();
        }
        catch (e) {
            const failure = e as AdminOrderError;
            setError(failure.message || 'Unable to confirm the result. Retry the saved action.');
            if (failure.status && failure.status >= 400 && failure.status < 500)
                await refresh();
        }
        finally {
            inFlight.current = false;
            setBusy(false);
            render(n => n + 1);
        }
    }
    const pending = controller.current?.pending, blocked = controller.current?.blocked ?? !controller.current;
    return <section className="space-y-3 rounded-lg border bg-ivory p-5"><h2 className="font-serif text-2xl">Actions</h2>{error && <p role="alert">{error}</p>}
    {blocked && <p role="status">Saved command requires recovery; new actions are blocked.</p>}
    {pending && <div role="status">An action may already have succeeded. Retry its exact saved request.<button disabled={busy || !can(pending.action === 'payment' ? 'payments.manage' : 'orders.manage')} onClick={() => void run()}>Retry saved action</button></div>}
    <fieldset disabled={busy || blocked || Boolean(pending)} className="space-y-3">
      {permitted.some(a => ['cancel', 'payment', 'fulfillment'].includes(a)) && <label className="block">Reason / verification note<textarea className="block w-full border p-3" value={reason} maxLength={1000} onChange={e => setReason(e.target.value)}/></label>}
      {permitted.includes('fulfillment') && <><label className="block">Courier<input className="block border p-3" value={courier} maxLength={100} onChange={e => setCourier(e.target.value)}/></label><label className="block">Tracking number<input className="block border p-3" value={tracking} maxLength={120} onChange={e => setTracking(e.target.value)}/></label><button disabled={!courier.trim() || !tracking.trim() || (order.status === 'Shipped' && !reason.trim())} onClick={() => void run('fulfillment', {
        courier, trackingNumber: tracking, reason
    })}>{order.status === 'Shipped' ? 'Correct Tracking' : 'Save Courier / Tracking'}</button></>}
      <div className="flex flex-wrap gap-3">{permitted.filter(a => ['Confirmed', 'Processing', 'Shipped', 'Delivered'].includes(a)).map(status => <button key={status} disabled={status === 'Shipped' && (!courier.trim() || !tracking.trim())} onClick={() => {
        if (status === 'Delivered' && !window.confirm('Confirm this order has been delivered?'))
            return;
        void run('status', {
            status, reason, ...(status === 'Shipped' ? {
                courier, trackingNumber: tracking
            } : {})
        });
    }}>{({
        Confirmed: 'Confirm', Processing: 'Start Processing', Shipped: 'Mark Shipped', Delivered: 'Mark Delivered'
    } as Record<string, string>)[status]}</button>)}</div>
      {permitted.includes('cancel') && <button disabled={!reason.trim()} onClick={() => void run('cancel', {
        reason
    })}>Cancel Order</button>}
      {permitted.includes('payment') && order.canonicalPaymentId && <><label className="block">Payment reference<input className="block border p-3" value={reference} maxLength={120} onChange={e => setReference(e.target.value)}/></label><button disabled={!reason.trim()} onClick={() => void run('payment', {
        reference, reason
    })}>{order.paymentMethod === 'Bank Transfer' ? 'Verify Bank Transfer' : 'Confirm COD Collection'}</button></>}
      {permitted.includes('note') && <><label className="block">Private note<textarea className="block w-full border p-3" value={note} maxLength={2000} onChange={e => setNote(e.target.value)}/></label><button disabled={!note.trim()} onClick={() => void run('note', {
        text: note
    })}>Add Private Note</button></>}
      {!permitted.length && <p>This order is read-only for your role and its current state.</p>}
    </fieldset>
  </section>;
}
