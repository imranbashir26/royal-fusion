import { AnimatePresence, motion } from 'framer-motion'
import { ShoppingBag, Trash2, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCartStore } from '../../store/cartStore'
import { useStorefront } from '../../storefront/StorefrontProvider'
import { buttonClasses } from '../../utils/buttonClasses'
import { formatCurrency } from '../../utils/format'
import { QuantityStepper } from '../common/QuantityStepper'
import { ProductBottle } from '../products/ProductBottle'

export function CartDrawer() {
  const { products } = useStorefront()
  const {
    isCartOpen,
    closeCart,
    items,
    selectedLineIds,
    removeItem,
    setAllItemsSelected,
    toggleItemSelection,
    updateQuantity,
  } = useCartStore()
  const selectedLineIdSet = new Set(selectedLineIds)

  const enrichedItems = items
    .map((item) => {
      const product = products.find((candidate) => candidate.id === item.productId)
      const size = product?.sizeOptions.find((option) => option.value === item.size)
      return product ? { ...item, product, unitPrice: size?.price ?? product.price } : null
    })
    .filter(Boolean)

  const selectedItems = enrichedItems.filter((item) => selectedLineIdSet.has(item!.lineId))
  const subtotal = selectedItems.reduce(
    (total, item) => total + item!.unitPrice * item!.quantity,
    0,
  )
  const allSelected =
    enrichedItems.length > 0 && enrichedItems.every((item) => selectedLineIdSet.has(item!.lineId))

  return (
    <AnimatePresence>
      {isCartOpen && (
        <motion.aside
          aria-label="Cart drawer"
          className="fixed inset-0 z-50 bg-brownroyal/45 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={closeCart}
        >
          <motion.div
            className="ml-auto flex h-full w-full max-w-md flex-col bg-ivory shadow-2xl"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-champagne/25 px-5 py-4">
              <div>
                <p className="font-serif text-2xl font-semibold text-burgundy">Royal Cart</p>
                <p className="text-sm text-brownroyal/60">
                  {selectedItems.length} of {enrichedItems.length} items selected
                </p>
              </div>
              <button
                aria-label="Close cart"
                className="grid h-10 w-10 place-items-center rounded-full bg-champagne/12 text-brownroyal"
                onClick={closeCart}
                type="button"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="luxury-scrollbar flex-1 overflow-y-auto p-5">
              {enrichedItems.length === 0 ? (
                <div className="grid h-full place-items-center text-center">
                  <div>
                    <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-champagne/18 text-oldgold">
                      <ShoppingBag className="h-7 w-7" aria-hidden="true" />
                    </div>
                    <p className="font-serif text-3xl font-semibold text-burgundy">Your cart is empty</p>
                    <p className="mt-2 text-brownroyal/65">Add a royal fragrance to begin checkout.</p>
                    <Link className={buttonClasses({ className: 'mt-6' })} onClick={closeCart} to="/shop">
                      Shop Collection
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-champagne/25 bg-marble/70 px-4 py-3 font-semibold text-brownroyal">
                    <input
                      checked={allSelected}
                      className="h-5 w-5 accent-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oldgold focus-visible:ring-offset-2"
                      onChange={(event) => setAllItemsSelected(event.target.checked)}
                      type="checkbox"
                    />
                    Select All
                  </label>
                  {enrichedItems.map((item) => (
                    <div
                      className="rounded-lg border border-champagne/25 bg-marble/70 p-4"
                      key={`${item!.productId}-${item!.size}`}
                    >
                      <div className="flex gap-3">
                        <label className="flex shrink-0 cursor-pointer items-start pt-2">
                          <input
                            checked={selectedLineIdSet.has(item!.lineId)}
                            className="h-5 w-5 accent-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oldgold focus-visible:ring-offset-2"
                            onChange={() => toggleItemSelection(item!.lineId)}
                            type="checkbox"
                          />
                          <span className="sr-only">Select {item!.product.name}, {item!.size}</span>
                        </label>
                        <div className="w-24 shrink-0 rounded-lg bg-cream">
                          <ProductBottle
                            compact
                            className="h-28 w-24"
                            name={item!.product.name}
                            tone={item!.product.image}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between gap-3">
                            <div>
                              <p className="font-serif text-xl font-semibold text-burgundy">
                                {item!.product.name}
                              </p>
                              <p className="text-sm text-brownroyal/60">{item!.size}</p>
                            </div>
                            <button
                              aria-label={`Remove ${item!.product.name}`}
                              className="grid h-9 w-9 place-items-center rounded-full text-brownroyal/60 transition hover:bg-burgundy/8 hover:text-burgundy"
                              onClick={() => removeItem(item!.productId, item!.size)}
                              type="button"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                          <div className="mt-4 flex items-center justify-between gap-3">
                            <QuantityStepper
                              onChange={(value) => updateQuantity(item!.productId, item!.size, value)}
                              value={item!.quantity}
                            />
                            <p className="font-extrabold text-brownroyal">
                              {formatCurrency(item!.unitPrice * item!.quantity)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {enrichedItems.length > 0 && (
              <div className="border-t border-champagne/25 bg-marble p-5">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-brownroyal/70">Selected subtotal</span>
                  <span className="text-xl font-extrabold text-burgundy">{formatCurrency(subtotal)}</span>
                </div>
                {selectedItems.length === 0 && (
                  <p className="mb-4 text-sm font-semibold text-burgundy" role="status">
                    Select at least one product to continue.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Link
                    className={buttonClasses({ variant: 'outline' })}
                    onClick={closeCart}
                    to="/cart"
                  >
                    View Cart
                  </Link>
                  {selectedItems.length > 0 ? (
                    <Link className={buttonClasses({})} onClick={closeCart} to="/checkout">
                      Checkout
                    </Link>
                  ) : (
                    <button className={buttonClasses({})} disabled type="button">
                      Checkout
                    </button>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
