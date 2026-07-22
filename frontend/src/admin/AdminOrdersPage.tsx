import { MessageCircle, Printer, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '../components/common/Button'
import { adminApi } from '../services/adminApi'
import type { AdminOrder } from '../types/admin'
import { formatCurrency } from '../utils/format'

const orderStatuses = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned', 'Refunded']

export function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('All')
  const [paymentMethod, setPaymentMethod] = useState('All')
  const [selectedOrder, setSelectedOrder] = useState<AdminOrder | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      setOrders(await adminApi.list<AdminOrder>('orders'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load orders.')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesQuery = !query || JSON.stringify(order).toLowerCase().includes(query.toLowerCase())
      const matchesStatus = status === 'All' || order.status === status
      const matchesPayment = paymentMethod === 'All' || order.paymentMethod === paymentMethod
      return matchesQuery && matchesStatus && matchesPayment
    })
  }, [orders, paymentMethod, query, status])

  const updateStatus = async (order: AdminOrder, nextStatus: string) => {
    await adminApi.updateOrderStatus(order.id, nextStatus)
    await load()
    setSelectedOrder((current) => current && { ...current, status: nextStatus })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-oldgold">Order Management</p>
          <h1 className="mt-2 font-serif text-4xl font-semibold text-burgundy">Orders</h1>
        </div>
        <button
          className="inline-flex h-11 items-center justify-center rounded-full border border-champagne/35 bg-ivory px-5 text-sm font-bold text-brownroyal"
          onClick={() => void adminApi.exportResource('orders')}
          type="button"
        >
          Export Orders
        </button>
      </div>

      <div className="grid gap-3 rounded-lg border border-champagne/25 bg-ivory p-4 md:grid-cols-[1fr_180px_220px]">
        <label className="flex h-11 items-center gap-3 rounded-full border border-champagne/35 bg-marble px-4">
          <Search className="h-4 w-4 text-oldgold" />
          <input
            className="min-w-0 flex-1 bg-transparent outline-none"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search order, customer, phone, tracking..."
            value={query}
          />
        </label>
        <select className="h-11 rounded-full border border-champagne/35 bg-marble px-4" onChange={(event) => setStatus(event.target.value)} value={status}>
          <option>All</option>
          {orderStatuses.map((option) => <option key={option}>{option}</option>)}
        </select>
        <select className="h-11 rounded-full border border-champagne/35 bg-marble px-4" onChange={(event) => setPaymentMethod(event.target.value)} value={paymentMethod}>
          <option>All</option>
          <option>Cash on Delivery</option>
          <option>Bank Transfer</option>
          <option>JazzCash</option>
          <option>Easypaisa</option>
          <option>Card</option>
        </select>
      </div>

      {error && <p className="rounded-lg border border-burgundy/20 bg-burgundy/8 p-4 text-burgundy">{error}</p>}

      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="overflow-hidden rounded-lg border border-champagne/25 bg-ivory shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-marble text-xs uppercase tracking-[0.16em] text-oldgold">
                <tr>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-champagne/20">
                {filteredOrders.map((order) => (
                  <tr
                    className="cursor-pointer hover:bg-marble/65"
                    key={order.id}
                    onClick={() => setSelectedOrder(order)}
                  >
                    <td className="px-4 py-4 font-bold text-burgundy">{order.orderNumber}</td>
                    <td className="px-4 py-4">
                      <p className="font-semibold">{order.customer.name}</p>
                      <a className="text-burgundy" href={`tel:${order.customer.phone}`}>{order.customer.phone}</a>
                    </td>
                    <td className="px-4 py-4">{order.paymentMethod}</td>
                    <td className="px-4 py-4">{order.status}</td>
                    <td className="px-4 py-4 font-extrabold">{formatCurrency(order.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredOrders.length === 0 && <div className="p-8 text-center text-brownroyal/65">No orders matched.</div>}
        </div>

        <OrderDetailsPanel
          onReload={load}
          onStatusChange={updateStatus}
          order={selectedOrder}
        />
      </div>
    </div>
  )
}

function OrderDetailsPanel({
  order,
  onStatusChange,
  onReload,
}: {
  order: AdminOrder | null
  onStatusChange: (order: AdminOrder, status: string) => Promise<void>
  onReload: () => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [courierName, setCourierName] = useState(order?.courierName ?? '')
  const [trackingNumber, setTrackingNumber] = useState(order?.trackingNumber ?? '')

  useEffect(() => {
    setCourierName(order?.courierName ?? '')
    setTrackingNumber(order?.trackingNumber ?? '')
  }, [order])

  if (!order) {
    return (
      <aside className="rounded-lg border border-champagne/25 bg-ivory p-6 text-center text-brownroyal/65">
        Select an order to view details.
      </aside>
    )
  }

  const whatsappMessage = encodeURIComponent(
    `Hello ${order.customer.name}, your Royal Fusion order ${order.orderNumber} is ${order.status}. Total: ${formatCurrency(order.total)}.`,
  )

  const saveNote = async () => {
    if (!note.trim()) return
    await adminApi.addOrderNote(order.id, note)
    setNote('')
    await onReload()
  }

  const saveTracking = async () => {
    await adminApi.updateTracking(order.id, courierName, trackingNumber)
    await onReload()
  }

  return (
    <aside className="h-fit rounded-lg border border-champagne/25 bg-ivory p-5 shadow-sm xl:sticky xl:top-24">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-3xl font-semibold text-burgundy">{order.orderNumber}</h2>
          <p className="text-sm text-brownroyal/60">{new Date(order.createdAt).toLocaleString()}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Invoice
        </Button>
      </div>

      <div className="mt-5 grid gap-3">
        <label>
          <span className="mb-2 block text-sm font-bold">Order status</span>
          <select
            className="h-11 w-full rounded-full border border-champagne/35 bg-marble px-4"
            onChange={(event) => void onStatusChange(order, event.target.value)}
            value={order.status}
          >
            {orderStatuses.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
        <Button size="sm" variant="secondary" onClick={() => void onStatusChange(order, 'Delivered')}>
          Mark Completed
        </Button>
        <Button size="sm" variant="outline" onClick={() => void onStatusChange(order, 'Cancelled')}>
          Cancel Order
        </Button>
      </div>

      <div className="mt-5 rounded-lg bg-marble p-4">
        <h3 className="font-serif text-2xl font-semibold text-burgundy">Customer</h3>
        <p className="mt-2 font-bold">{order.customer.name}</p>
        <a className="block text-burgundy" href={`tel:${order.customer.phone}`}>{order.customer.phone}</a>
        <a className="block text-burgundy" href={`mailto:${order.customer.email}`}>{order.customer.email}</a>
        <p className="mt-3 text-sm text-brownroyal/70">
          {order.shipping.address}, {order.shipping.city}, {order.shipping.province}
        </p>
        <a
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#2f8f5b] px-4 py-2 text-sm font-bold text-white"
          href={`https://wa.me/${order.customer.phone.replace(/\D/g, '')}?text=${whatsappMessage}`}
          target="_blank"
          rel="noreferrer"
        >
          <MessageCircle className="h-4 w-4" />
          WhatsApp Confirmation
        </a>
      </div>

      <div className="mt-5">
        <h3 className="font-serif text-2xl font-semibold text-burgundy">Products</h3>
        <div className="mt-3 space-y-3">
          {order.items.map((item) => (
            <div className="flex justify-between rounded-lg bg-marble p-3" key={`${item.productId}-${item.size}`}>
              <div>
                <p className="font-bold">{item.name}</p>
                <p className="text-sm text-brownroyal/60">{item.size} x {item.quantity}</p>
              </div>
              <p className="font-extrabold">{formatCurrency(item.unitPrice * item.quantity)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 space-y-2 border-t border-champagne/25 pt-4 text-sm">
        <SummaryLine label="Subtotal" value={formatCurrency(order.subtotal)} />
        <SummaryLine label="Discount" value={formatCurrency(order.discount)} />
        <SummaryLine label="Shipping" value={formatCurrency(order.shippingFee)} />
        <SummaryLine label="Total" value={formatCurrency(order.total)} strong />
      </div>

      <div className="mt-5 grid gap-3">
        <input className="h-11 rounded-full border border-champagne/35 bg-marble px-4" placeholder="Courier name" onChange={(event) => setCourierName(event.target.value)} value={courierName} />
        <input className="h-11 rounded-full border border-champagne/35 bg-marble px-4" placeholder="Tracking number" onChange={(event) => setTrackingNumber(event.target.value)} value={trackingNumber} />
        <Button size="sm" variant="outline" onClick={() => void saveTracking()}>Save Tracking</Button>
      </div>

      <div className="mt-5">
        <textarea className="min-h-20 w-full rounded-lg border border-champagne/35 bg-marble px-4 py-3" placeholder="Internal note" onChange={(event) => setNote(event.target.value)} value={note} />
        <Button className="mt-2" size="sm" onClick={() => void saveNote()}>Add Internal Note</Button>
      </div>
    </aside>
  )
}

function SummaryLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? 'flex justify-between text-lg font-extrabold text-burgundy' : 'flex justify-between'}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
