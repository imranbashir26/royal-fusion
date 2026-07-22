import { AlertTriangle, Package, ShoppingBag, Users, WalletCards } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
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
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-oldgold">Overview</p>
        <h1 className="mt-2 font-serif text-4xl font-semibold text-burgundy">Admin Dashboard</h1>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Object.entries(data.cards).map(([key, value]) => {
          const Icon = cardIcons[key as keyof typeof cardIcons] ?? Package
          const label = key.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) => letter.toUpperCase())
          return (
            <article className="rounded-lg border border-champagne/25 bg-ivory p-5 shadow-sm" key={key}>
              <div className="mb-4 grid h-11 w-11 place-items-center rounded-full bg-champagne/16 text-oldgold">
                <Icon className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-brownroyal/60">{label}</p>
              <p className="mt-2 text-3xl font-extrabold text-burgundy">
                {key === 'totalSales' ? formatCurrency(Number(value)) : value}
              </p>
            </article>
          )
        })}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <AdminPanel title="Recent Orders">
          <div className="space-y-3">
            {data.recentOrders.map((order) => (
              <div className="flex items-center justify-between rounded-lg bg-marble p-4" key={order.id}>
                <div>
                  <p className="font-bold text-burgundy">{order.orderNumber}</p>
                  <p className="text-sm text-brownroyal/60">{order.customer.name} · {order.status}</p>
                </div>
                <p className="font-extrabold">{formatCurrency(order.total)}</p>
              </div>
            ))}
          </div>
        </AdminPanel>
        <AdminPanel title="Low Stock Products">
          <div className="space-y-3">
            {data.lowStockProducts.length === 0 ? (
              <p className="text-brownroyal/60">No low-stock products.</p>
            ) : (
              data.lowStockProducts.map((product) => (
                <div className="flex items-center justify-between rounded-lg bg-marble p-4" key={product.id}>
                  <p className="font-bold text-burgundy">{product.name}</p>
                  <p className="font-extrabold">{product.stock} left</p>
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
      <h2 className="mb-4 font-serif text-3xl font-semibold text-burgundy">{title}</h2>
      {children}
    </section>
  )
}
