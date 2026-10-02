import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAdminAuth } from './AdminAuthProvider';
export function AdminDashboardPage() {
    const { can } = useAdminAuth();
    return <AdminPanel title="Dashboard"><p>Manage orders, deliveries, and products from the screens below.</p><div className="mt-5 flex gap-5">{can('orders.read') && <Link to="/admin/orders">Orders & Deliveries</Link>}{can('products.read') && <Link to="/admin/products">Products</Link>}</div></AdminPanel>;
}
export function AdminPanel({ title, children }: {
    title: string;
    children: ReactNode;
}) {
    return <section className="rounded-lg border border-champagne/25 bg-ivory p-5"><h2 className="mb-4 font-serif text-2xl text-burgundy">{title}</h2>{children}</section>;
}
