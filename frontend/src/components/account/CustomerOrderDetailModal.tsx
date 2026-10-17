import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, CheckCircle2, Clock, Package, Truck, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { customerOrdersClient, type CustomerOrderDetail } from '../../services/customerOrdersClient'
import { formatCheckoutCurrency } from '../../utils/checkoutMoney'
import { cn } from '../../utils/cn'

interface CustomerOrderDetailModalProps {
  orderId: string | null
  isOpen: boolean
  onClose: () => void
}

export function CustomerOrderDetailModal({
  orderId,
  isOpen,
  onClose,
}: CustomerOrderDetailModalProps) {
  const [order, setOrder] = useState<CustomerOrderDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const triggerRef = useRef<HTMLElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  const loadOrder = useCallback(async () => {
    if (!orderId) return
    setLoading(true)
    setError('')
    try {
      const data = await customerOrdersClient.getOrder(orderId)
      setOrder(data)
    } catch (err) {
      setOrder(null)
      setError(err instanceof Error ? err.message : 'Unable to load order details.')
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    if (isOpen && orderId) {
      void loadOrder()
    } else {
      setOrder(null)
      setError('')
    }
  }, [isOpen, orderId, loadOrder])

  useEffect(() => {
    if (!isOpen) return

    // Capture the trigger element that initiated the dialog opening
    triggerRef.current = document.activeElement as HTMLElement | null

    // Place initial focus on the close button for immediate keyboard accessibility
    const frameId = requestAnimationFrame(() => {
      closeButtonRef.current?.focus()
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }

      // Focus containment within active modal dialog
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0)

        if (focusable.length === 0) {
          event.preventDefault()
          return
        }

        const firstElement = focusable[0]
        const lastElement = focusable[focusable.length - 1]

        if (event.shiftKey) {
          if (document.activeElement === firstElement || document.activeElement === dialogRef.current) {
            event.preventDefault()
            lastElement.focus()
          }
        } else {
          if (document.activeElement === lastElement) {
            event.preventDefault()
            firstElement.focus()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('keydown', handleKeyDown)
      // Return focus to the trigger control or accessible fallback
      if (triggerRef.current && document.contains(triggerRef.current)) {
        triggerRef.current.focus()
      } else {
        const fallback = document.querySelector<HTMLElement>(
          'aside[aria-label="Customer account"] [role="tab"][aria-selected="true"], aside[aria-label="Customer account"] button'
        )
        if (fallback && document.contains(fallback)) {
          fallback.focus()
        }
      }
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-brownroyal/60 p-4 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        role="presentation"
      >
        <motion.div
          ref={dialogRef}
          aria-label="Order Receipt"
          aria-modal="true"
          tabIndex={-1}
          className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-champagne/40 bg-ivory shadow-2xl outline-none"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
        >
          {/* Header */}
          <div className="flex items-start justify-between border-b border-champagne/30 bg-marble px-6 py-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-oldgold">Order Receipt</p>
              <h3 className="mt-0.5 font-serif text-2xl font-semibold text-burgundy">
                {order ? order.orderNumber : 'Loading Order...'}
              </h3>
              {order && (
                <p className="text-xs text-brownroyal/70">
                  Placed on {new Date(order.createdAt).toLocaleDateString('en-PK', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              )}
            </div>
            <button
              ref={closeButtonRef}
              aria-label="Close order details"
              className="grid h-9 w-9 place-items-center rounded-full border border-champagne/40 text-brownroyal transition hover:bg-champagne/20"
              onClick={onClose}
              type="button"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {loading && (
              <div className="py-12 text-center" role="status">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-burgundy border-t-transparent" />
                <p className="mt-3 text-sm text-brownroyal/80">Loading your order receipt...</p>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center" role="alert">
                <AlertCircle className="mx-auto h-6 w-6 text-red-600" aria-hidden="true" />
                <p className="mt-2 text-sm text-red-800">{error}</p>
                <button
                  className="mt-3 text-xs font-bold uppercase tracking-wider text-burgundy underline hover:text-burgundy/80"
                  onClick={() => void loadOrder()}
                  type="button"
                >
                  Retry Loading
                </button>
              </div>
            )}

            {order && !loading && (
              <>
                {/* Status Badges */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-champagne/30 bg-marble/60 p-3 text-center">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-brownroyal/60">Status</p>
                    <span
                      className={cn(
                        'mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold',
                        order.status === 'Delivered'
                          ? 'bg-emerald-100 text-emerald-800'
                          : order.status === 'Shipped' || order.status === 'Processing'
                          ? 'bg-blue-100 text-blue-800'
                          : order.status === 'Cancelled'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      )}
                    >
                      {order.status === 'Delivered' ? (
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <Clock className="h-3 w-3" aria-hidden="true" />
                      )}
                      {order.status}
                    </span>
                  </div>

                  <div className="rounded-lg border border-champagne/30 bg-marble/60 p-3 text-center">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-brownroyal/60">Payment</p>
                    <span
                      className={cn(
                        'mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold',
                        order.paymentStatus === 'Paid'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      )}
                    >
                      {order.paymentStatus}
                    </span>
                  </div>

                  <div className="col-span-2 rounded-lg border border-champagne/30 bg-marble/60 p-3 text-center sm:col-span-1">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-brownroyal/60">Method</p>
                    <p className="mt-1 text-xs font-semibold text-brownroyal">{order.paymentMethod}</p>
                  </div>
                </div>

                {/* Tracking & Courier Info (if available) */}
                {(order.courier || order.trackingNumber) && (
                  <div className="rounded-lg border border-blue-200/80 bg-blue-50/50 p-4">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-900">
                      <Truck className="h-4 w-4" aria-hidden="true" />
                      Fulfillment & Tracking
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                      {order.courier && (
                        <div>
                          <span className="text-xs text-brownroyal/70">Courier:</span>
                          <p className="font-semibold text-brownroyal">{order.courier}</p>
                        </div>
                      )}
                      {order.trackingNumber && (
                        <div>
                          <span className="text-xs text-brownroyal/70">Tracking #:</span>
                          <p className="font-mono font-semibold text-brownroyal">{order.trackingNumber}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Line Items */}
                <div className="space-y-3">
                  <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.15em] text-oldgold">
                    <Package className="h-3.5 w-3.5" aria-hidden="true" />
                    Purchased Items ({order.items.reduce((sum, item) => sum + item.quantity, 0)})
                  </h4>

                  <ul aria-label="Order line items" className="divide-y divide-champagne/25 rounded-lg border border-champagne/35 bg-marble/40">
                    {order.items.map((item) => (
                      <li key={item.id} className="p-3.5 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-serif text-sm font-semibold text-burgundy">{item.name}</p>
                            <p className="text-xs text-brownroyal/70">
                              {item.size} {item.sku ? `· SKU: ${item.sku}` : ''}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-brownroyal">
                              {formatCheckoutCurrency(item.lineTotal)}
                            </p>
                            <p className="text-xs text-brownroyal/60">
                              {item.quantity} × {formatCheckoutCurrency(item.unitPrice)}
                            </p>
                          </div>
                        </div>

                        {/* Components for tester packs */}
                        {item.components && item.components.length > 0 && (
                          <div className="rounded-md border border-champagne/30 bg-ivory/80 p-2.5">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-oldgold">
                              Included 5ml Discovery Testers:
                            </p>
                            <ul className="mt-1.5 space-y-1">
                              {item.components.map((comp) => (
                                <li key={comp.id} className="flex justify-between text-xs text-brownroyal">
                                  <span>
                                    • {comp.name} ({comp.size})
                                  </span>
                                  <span className="font-semibold text-brownroyal/80">
                                    qty: {comp.quantityPerPack}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Shipping Details */}
                <div className="rounded-lg border border-champagne/30 bg-marble/30 p-4 space-y-1.5">
                  <h4 className="text-xs font-bold uppercase tracking-[0.15em] text-oldgold">Shipping Address</h4>
                  <p className="text-sm font-semibold text-brownroyal">{order.shipping.name}</p>
                  <p className="text-xs text-brownroyal/80">{order.shipping.address}</p>
                  <p className="text-xs text-brownroyal/80">
                    {order.shipping.city}
                    {order.shipping.province ? `, ${order.shipping.province}` : ''}
                  </p>
                  {order.shipping.orderNotes && (
                    <p className="mt-1 text-xs italic text-brownroyal/70">
                      Notes: {order.shipping.orderNotes}
                    </p>
                  )}
                </div>

                {/* Financial Summary */}
                <div className="rounded-lg border border-champagne/40 bg-marble p-4 space-y-2">
                  <div className="flex justify-between text-xs text-brownroyal">
                    <span>Subtotal</span>
                    <span className="font-semibold">{formatCheckoutCurrency(order.subtotal)}</span>
                  </div>
                  {order.discount > 0 && (
                    <div className="flex justify-between text-xs text-emerald-800">
                      <span>Discount</span>
                      <span className="font-semibold">-{formatCheckoutCurrency(order.discount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs text-brownroyal">
                    <span>Delivery Charge</span>
                    <span className="font-semibold">{formatCheckoutCurrency(order.shippingFee)}</span>
                  </div>
                  <div className="border-t border-champagne/40 pt-2 flex justify-between items-baseline">
                    <span className="font-serif text-sm font-bold text-burgundy">Order Total</span>
                    <span className="font-serif text-lg font-bold text-burgundy">
                      {formatCheckoutCurrency(order.total)}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
