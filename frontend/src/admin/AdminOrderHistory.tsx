import type { AdminOrderDetail } from '../types/adminOrders';
export function AdminOrderHistory({ order }: {
    order: AdminOrderDetail;
}) {
    return <section className="rounded-lg border bg-ivory p-5"><h2 className="font-serif text-2xl">History / Audit</h2><ol>{[...order.history.map(h => ({
            id: h.id, createdAt: h.createdAt, text: `${h.from ?? 'Created'} → ${h.to}. ${h.text}`, actor: h.actor, correction: null
        })), ...order.audit.map(a => ({
            id: a.id, createdAt: a.createdAt, text: `${a.action} · ${a.requestId}`, actor: a.actor, correction: a.trackingCorrection
        }))].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map(e => <li className="border-t py-3" key={e.id}><p>{e.text}</p>{e.correction && <div><p>Tracking correction</p><p>Courier: {e.correction.previous.courier || 'None'} → {e.correction.next.courier}</p><p>Tracking: {e.correction.previous.trackingNumber || 'None'} → {e.correction.next.trackingNumber}</p><p>Reason: {e.correction.reason}</p></div>}<small>{new Date(e.createdAt).toLocaleString()} · {e.actor ?? 'System'}</small></li>)}</ol></section>;
}
