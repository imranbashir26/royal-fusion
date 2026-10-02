import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminOrdersApi } from '../services/adminOrdersApi';
import { useAdminAuth } from './AdminAuthProvider';
import type { AdminOrderListResponse } from '../types/adminOrders';
import { formatCurrency } from '../utils/format';
export function AdminOrdersPage() {
    const { can } = useAdminAuth(), allowed = can('orders.read');
    const [page, setPage] = useState(1), [search, setSearch] = useState(''), [status, setStatus] = useState('All'), [paymentStatus, setPaymentStatus] = useState('All'), [paymentMethod, setPaymentMethod] = useState('All'), [data, setData] = useState<AdminOrderListResponse | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
    useEffect(() => {
        if (!allowed)
            return;
        let active = true;
        setLoading(true);
        setError('');
        const timer = window.setTimeout(() => {
            adminOrdersApi.list({
                page, pageSize: 25, search, status, paymentStatus, paymentMethod
            }).then(result => {
                if (active)
                    setData(result);
            }).catch(e => {
                if (active) {
                    setData(null);
                    setError(e instanceof Error ? e.message : 'Unable to load orders.');
                }
            }).finally(() => {
                if (active)
                    setLoading(false);
            });
        }, 250);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [allowed, page, search, status, paymentStatus, paymentMethod]);
    if (!allowed)
        return <p role="alert">You do not have permission to read orders.</p>;
    const filter = (setter: (v: string) => void) => (value: string) => {
        setter(value);
        setPage(1);
    };
    return <section className="space-y-5"><h1 className="font-serif text-4xl text-burgundy">Orders</h1><div className="grid gap-3 md:grid-cols-4"><label>Search orders<input className="block w-full border p-3" value={search} onChange={e => filter(setSearch)(e.target.value)} maxLength={120}/></label>
    <Filter label="Order status" value={status} options={['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned', 'Refunded']} change={filter(setStatus)}/><Filter label="Payment status" value={paymentStatus} options={['Unpaid', 'Pending', 'Paid', 'Failed', 'Refunded']} change={filter(setPaymentStatus)}/><Filter label="Payment method" value={paymentMethod} options={['Cash on Delivery', 'Bank Transfer']} change={filter(setPaymentMethod)}/></div>
    {error && <p role="alert">{error}</p>}{loading && <p role="status">Loading orders...</p>}
    {!loading && data && <><div className="overflow-x-auto rounded-lg border bg-ivory"><table className="w-full text-left text-sm"><thead><tr>{['Order / date', 'Customer', 'Destination', 'Payment', 'Status', 'Items', 'Total', 'Fulfillment'].map(t => <th className="p-3" key={t}>{t}</th>)}</tr></thead><tbody>{data.items.map(o => <tr key={o.id} className="border-t"><td className="p-3"><Link className="font-bold text-burgundy underline" to={`/admin/orders/${o.id}`}>{o.orderNumber}</Link><p>{new Date(o.createdAt).toLocaleString()}</p></td><td>{o.customerName}<p>{o.phone}</p><p>{o.email}</p></td><td>{o.city}, {o.province}</td><td>{o.paymentMethod}<p>{o.paymentStatus}</p></td><td>{o.status}</td><td>{o.purchasedQuantity} units / {o.lineCount} lines</td><td>{formatCurrency(o.total)} {o.currency}</td><td>{o.courier}<p>{o.trackingNumber}</p></td></tr>)}</tbody></table></div>{data.items.length === 0 && <p>No orders matched.</p>}<div className="flex gap-4"><button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page} of {Math.max(1, data.totalPages)} · {data.total} orders</span><button disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)}>Next</button></div></>}
  </section>;
}
function Filter({ label, value, options, change }: {
    label: string;
    value: string;
    options: string[];
    change: (v: string) => void;
}) {
    return <label>{label}<select aria-label={label} className="block w-full border p-3" value={value} onChange={e => change(e.target.value)}>{['All', ...options].map(v => <option key={v}>{v}</option>)}</select></label>;
}
