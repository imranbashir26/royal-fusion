import { AlertTriangle, BadgePercent, Boxes, Package, Plus, ShoppingBag, Users, WalletCards } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/common/Button'
import { adminApi } from '../services/adminApi'
import type { AdminDashboardData } from '../types/admin'
import { formatCurrency } from '../utils/format'

const cardIcons = {
  totalOrders: ShoppingBag,
  totalSales: WalletCards,
  pendingOrders: AlertTriangle,
  lowStockProducts: Package,
  totalProducts: Package,
  totalCustomers: Users,
  newsletterSubscribers: Users,
}

export function AdminDashboardPage() {
  const [data, setData] = useState<AdminDashboardData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    adminApi.dashboard().then(setData).catch((err) => setError(err.message))
  }, [])

  if (error) return <AdminPanel title="Dashboard"><p className="text-burgundy">{error}</p></AdminPanel>
  if (!data) return <AdminPanel title="Dashboard"><p>Loading dashboard...</p></AdminPanel>

  return (
    <div className="space-y-6">
      {/* Header & Quick Action Bar */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-oldgold">Overview & Controls</p>
          <h1 className="mt-1 font-serif text-4xl font-semibold text-burgundy">Perfume Admin Dashboard</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/products">
            <Button size="sm">
              <Plus className="h-4 w-4" /> Add Perfume
            </Button>
          </Link>
          <Link to="/admin/orders">
            <Button size="sm" variant="outline">
              <ShoppingBag className="h-4 w-4" /> View Orders
            </Button>
          </Link>
          <Link to="/admin/coupons">
            <Button size="sm" variant="outline">
              <BadgePercent className="h-4 w-4" /> Add Coupon
            </Button>
          </Link>
          <Link to="/admin/settings">
            <Button size="sm" variant="ghost">
              <Boxes className="h-4 w-4" /> Settings
            </Button>
          </Link>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Object.entries(data.cards).map(([key, value]) => {
          const Icon = cardIcons[key as keyof typeof cardIcons] ?? Package
          const label = key.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) => letter.toUpperCase())
          const isWarning = key === 'pendingOrders' || key === 'lowStockProducts'
          return (
            <article className={`rounded-lg border bg-ivory p-5 shadow-sm ${isWarning && Number(value) > 0 ? 'border-amber-400 bg-amber-50/40' : 'border-champagne/25'}`} key={key}>
              <div className="mb-4 flex items-center justify-between">
                <div className={`grid h-11 w-11 place-items-center rounded-full ${isWarning && Number(value) > 0 ? 'bg-amber-100 text-amber-800' : 'bg-champagne/16 text-oldgold'}`}>
                  <Icon className="h-5 w-5" />
                </div>
                {isWarning && Number(value) > 0 && (
                  <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-extrabold text-amber-900">
                    Needs Attention
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-brownroyal/60">{label}</p>
              <p className="mt-2 text-3xl font-extrabold text-burgundy">
                {key === 'totalSales' ? formatCurrency(Number(value)) : value}
              </p>
            </article>
          )
        })}
      </div>

      {/* Overview Panels */}
      <div className="grid gap-6 xl:grid-cols-2">
        <AdminPanel title="Recent Fragrance Orders">
          <div className="space-y-3">
            {data.recentOrders.length === 0 ? (
              <p className="text-brownroyal/60">No recent orders yet.</p>
            ) : (
              data.recentOrders.map((order) => (
                <div className="flex items-center justify-between rounded-lg bg-marble p-4 transition hover:bg-champagne/10" key={order.id}>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-burgundy">{order.orderNumber}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${order.status === 'Pending' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                        {order.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-brownroyal/70">{order.customer.name} · {order.customer.phone || order.customer.email}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-extrabold text-burgundy">{formatCurrency(order.total)}</p>
                    <Link className="text-xs font-bold text-oldgold hover:underline" to="/admin/orders">
                      Manage Order &rarr;
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </AdminPanel>

        <AdminPanel title="Low Stock Bottles Alert">
          <div className="space-y-3">
            {data.lowStockProducts.length === 0 ? (
              <div className="rounded-lg bg-emerald-50/50 border border-emerald-200/60 p-4 text-emerald-800 text-sm font-semibold">
                ✓ All perfume bottle inventories are well stocked!
              </div>
            ) : (
              data.lowStockProducts.map((product) => (
                <div className="flex items-center justify-between rounded-lg bg-amber-50/60 border border-amber-200/80 p-4" key={product.id}>
                  <div>
                    <p className="font-bold text-burgundy">{product.name}</p>
                    <p className="text-xs text-amber-900/70">Category: {product.category || 'Perfumes'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-black text-amber-900">
                      {product.stock} bottle{product.stock === 1 ? '' : 's'} left
                    </span>
                    <Link className="text-xs font-bold text-burgundy underline hover:text-oldgold" to="/admin/products">
                      Update Stock
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </AdminPanel>
      </div>
    </div>
  )
}

export function AdminPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-champagne/25 bg-ivory p-5 shadow-sm">
      <h2 className="mb-4 font-serif text-2xl font-semibold text-burgundy">{title}</h2>
      {children}
    </section>
  )
}
