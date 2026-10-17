import { AlertCircle, ChevronLeft, ChevronRight, Package, Receipt, Truck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { customerOrdersClient, type CustomerOrderSummary } from '../../services/customerOrdersClient'
import { formatCheckoutCurrency } from '../../utils/checkoutMoney'
import { cn } from '../../utils/cn'
import { Button } from '../common/Button'
import { CustomerOrderDetailModal } from './CustomerOrderDetailModal'

interface CustomerOrderHistoryProps {
  onExploreClick?: () => void
}

export function CustomerOrderHistory({ onExploreClick }: CustomerOrderHistoryProps) {
  const [orders, setOrders] = useState<CustomerOrderSummary[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalOrders, setTotalOrders] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)

  const loadOrders = useCallback(async (targetPage: number) => {
    setLoading(true)
    setError('')
    try {
      const data = await customerOrdersClient.listOrders(targetPage, 5)
      setOrders(data.items)
      setPage(data.page)
      setTotalPages(data.totalPages)
      setTotalOrders(data.total)
    } catch (err) {
      setOrders([])
      setError(err instanceof Error ? err.message : 'Unable to load orders.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOrders(1)
  }, [loadOrders])

  return (
    <div className="space-y-4">
      {/* Loading State */}
      {loading && (
        <div className="py-12 text-center" role="status">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-burgundy border-t-transparent" />
          <p className="mt-3 text-sm text-brownroyal/80">Retrieving your order history...</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center" role="alert">
          <AlertCircle className="mx-auto h-6 w-6 text-red-600" aria-hidden="true" />
          <p className="mt-2 text-sm text-red-800">{error}</p>
          <Button
            className="mt-3"
            onClick={() => void loadOrders(page)}
            size="sm"
            variant="outline"
          >
            Try Again
          </Button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && orders.length === 0 && (
        <div className="rounded-xl border border-dashed border-champagne/50 bg-marble/40 py-12 px-4 text-center">
          <Package className="mx-auto h-12 w-12 text-oldgold/70" aria-hidden="true" />
          <h4 className="mt-3 font-serif text-xl font-semibold text-burgundy">No Orders Yet</h4>
          <p className="mt-1.5 text-xs text-brownroyal/75 max-w-xs mx-auto">
            You haven't placed any orders yet. Discover our luxury perfumes and bespoke discovery sets.
          </p>
          {onExploreClick && (
            <Button
              className="mt-5"
              onClick={onExploreClick}
              size="sm"
            >
              Explore Fragrances
            </Button>
          )}
        </div>
      )}

      {/* Orders List */}
      {!loading && !error && orders.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-oldgold">
            Recent Orders ({totalOrders})
          </p>

          <ul aria-label="Customer orders list" className="space-y-3">
            {orders.map((order) => (
              <li
                key={order.id}
                className="overflow-hidden rounded-lg border border-champagne/35 bg-marble/60 transition hover:border-champagne/60 hover:bg-marble"
              >
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-serif text-sm font-bold text-burgundy">
                        {order.orderNumber}
                      </p>
                      <p className="text-[11px] text-brownroyal/60">
                        {new Date(order.createdAt).toLocaleDateString('en-PK', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                    </div>

                    <span
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-[11px] font-bold',
                        order.status === 'Delivered'
                          ? 'bg-emerald-100 text-emerald-800'
                          : order.status === 'Shipped' || order.status === 'Processing'
                          ? 'bg-blue-100 text-blue-800'
                          : order.status === 'Cancelled'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      )}
                    >
                      {order.status}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between border-t border-champagne/20 pt-2 text-xs">
                    <span className="text-brownroyal/80">
                      {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'} · {order.paymentMethod}
                    </span>
                    <span className="font-serif text-base font-bold text-burgundy">
                      {formatCheckoutCurrency(order.total)}
                    </span>
                  </div>

                  {order.courier && order.trackingNumber && (
                    <div className="flex items-center gap-1.5 rounded bg-blue-50/60 px-2 py-1 text-[11px] text-blue-900">
                      <Truck className="h-3 w-3 shrink-0 text-blue-700" aria-hidden="true" />
                      <span>
                        {order.courier}: <strong className="font-mono">{order.trackingNumber}</strong>
                      </span>
                    </div>
                  )}

                  <div className="pt-1">
                    <button
                      className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-burgundy hover:text-burgundy/80 transition"
                      onClick={() => setSelectedOrderId(order.id)}
                      type="button"
                    >
                      <Receipt className="h-3.5 w-3.5" aria-hidden="true" />
                      View Receipt & Items
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-champagne/30 pt-3">
              <button
                disabled={page <= 1}
                onClick={() => void loadOrders(page - 1)}
                className="inline-flex items-center gap-1 text-xs font-bold text-brownroyal disabled:opacity-40 disabled:cursor-not-allowed hover:text-burgundy"
                type="button"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Previous
              </button>
              <span className="text-xs text-brownroyal/70">
                Page {page} of {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => void loadOrders(page + 1)}
                className="inline-flex items-center gap-1 text-xs font-bold text-brownroyal disabled:opacity-40 disabled:cursor-not-allowed hover:text-burgundy"
                type="button"
              >
                Next
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Order Detail Modal */}
      <CustomerOrderDetailModal
        isOpen={Boolean(selectedOrderId)}
        onClose={() => setSelectedOrderId(null)}
        orderId={selectedOrderId}
      />
    </div>
  )
}
