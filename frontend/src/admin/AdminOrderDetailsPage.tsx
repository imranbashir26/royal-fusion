import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminOrdersApi } from '../services/adminOrdersApi';
import type { AdminOrderDetail } from '../types/adminOrders';
import { useAdminAuth } from './AdminAuthProvider';
import { AdminOrderActions } from './AdminOrderActions';
import { AdminOrderHistory } from './AdminOrderHistory';
import { formatCurrency } from '../utils/format';
export function AdminOrderDetailsPage() {
    const { id } = useParams(), { can } = useAdminAuth(), allowed = can('orders.read'), [order, setOrder] = useState<AdminOrderDetail | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
    const generation = useRef(0);
    const invalidate = useCallback(() => {
        generation.current++;
    }, []);
    const refresh = useCallback(async () => {
        if (!id || !allowed)
            return;
        const current = ++generation.current;
        setLoading(true);
        try {
            const next = await adminOrdersApi.get(id);
            if (current === generation.current) {
                setOrder(next);
                setError('');
            }
        }
        catch (e) {
            if (current === generation.current) {
                setOrder(null);
                setError(e instanceof Error ? e.message : 'Unable to load order.');
            }
        }
        finally {
            if (current === generation.current)
                setLoading(false);
        }
    }, [id, allowed]);
    useEffect(() => {
        setOrder(null);
        setError('');
        void refresh();
        return invalidate;
    }, [refresh, invalidate]);
    if (!allowed)
        return <p role="alert">You do not have permission to read orders.</p>;
    return <section className="space-y-5"><Link to="/admin/orders">← Orders</Link>{loading && <p role="status">Loading order...</p>}{error && <p role="alert">{error}</p>}{order && <><h1 className="font-serif text-4xl text-burgundy">{order.orderNumber}</h1><p>{order.status} · {order.paymentMethod} · {order.paymentStatus}</p><p>Created {new Date(order.createdAt).toLocaleString()} · Updated {new Date(order.updatedAt).toLocaleString()}</p>
    <div className="grid gap-5 lg:grid-cols-2"><section className="rounded-lg border bg-ivory p-5"><h2 className="font-serif text-2xl">Customer / Shipping</h2><p>{order.customer.name}</p><p>{order.customer.email}</p><p>{order.customer.phone}</p><p>{order.shipping.address}, {order.shipping.city}, {order.shipping.province}</p><p>Customer notes: {order.shipping.customerNotes || 'None'}</p><p>Courier: {order.courier || 'Not assigned'} · Tracking: {order.trackingNumber || 'Not assigned'}</p></section><AdminOrderActions key={order.id} order={order} refresh={refresh}/></div>
    <section className="rounded-lg border bg-ivory p-5"><h2 className="font-serif text-2xl">Items</h2>{order.items.map(i => <div className="border-t py-3" key={i.id}><strong>{i.name}</strong><p>{i.size} · SKU {i.sku} · {i.quantity} × {formatCurrency(i.unitPrice)} = {formatCurrency(i.lineTotal)}</p><small>Variant {i.variantId ?? 'Historical item'}</small></div>)}<p>Subtotal {formatCurrency(order.subtotal)} · Discount {formatCurrency(order.discount)} · Shipping {formatCurrency(order.shippingFee)} · Total {formatCurrency(order.total)} {order.currency}</p></section>
    {order.paymentsVisible && <section className="rounded-lg border bg-ivory p-5"><h2 className="font-serif text-2xl">Payments</h2>{!order.canonicalPaymentId && <p role="alert">Canonical payment requires review.</p>}{order.payments.map(p => <p key={p.id}>{p.id === order.canonicalPaymentId ? 'Checkout payment: ' : ''}{p.provider} · {p.status} · {formatCurrency(p.amount)} {p.currency} · Reference {p.reference || 'None'} · Processed {p.processedAt ? new Date(p.processedAt).toLocaleString() : 'Not processed'}</p>)}</section>}
    <section className="rounded-lg border bg-ivory p-5"><h2 className="font-serif text-2xl">Private Notes</h2>{order.notes.map(n => <p key={n.id}>{n.text} · {new Date(n.createdAt).toLocaleString()} · {n.actor ?? 'System'}</p>)}</section>
    <AdminOrderHistory order={order}/><section className="rounded-lg border bg-ivory p-5"><h2 className="font-serif text-2xl">Inventory Movements</h2>{order.inventory.map(m => <p key={m.id}>{m.variantId} · {m.quantityDelta > 0 ? '+' : ''}{m.quantityDelta} · Balance {m.balanceAfter} · {m.reason} · {new Date(m.createdAt).toLocaleString()}</p>)}</section>
  </>}</section>;
}
