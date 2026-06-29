import { ShoppingBag, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/common/EmptyState'
import { PageHeader } from '../components/common/PageHeader'
import { QuantityStepper } from '../components/common/QuantityStepper'
import { ProductBottle } from '../components/products/ProductBottle'
import { products } from '../data/products'
import { useCartStore } from '../store/cartStore'
import { buttonClasses } from '../utils/buttonClasses'
import { formatCurrency } from '../utils/format'

export function CartPage() {
  const { items, removeItem, updateQuantity } = useCartStore()
  const enrichedItems = items
    .map((item) => {
      const product = products.find((candidate) => candidate.id === item.productId)
      const size = product?.sizeOptions.find((option) => option.value === item.size)
      return product ? { ...item, product, unitPrice: size?.price ?? product.price } : null
    })
    .filter(Boolean)

  const subtotal = enrichedItems.reduce(
    (total, item) => total + item!.unitPrice * item!.quantity,
    0,
  )

  if (enrichedItems.length === 0) {
    return (
      <>
        <PageHeader
          description="Your selected perfumes, attars, and gift sets will appear here."
          eyebrow="Cart"
          title="Royal Cart"
        />
        <section className="container-lux py-12">
          <EmptyState
            description="Your cart is waiting for its first Royal Fusion fragrance."
            title="No items in cart"
          />
        </section>
      </>
    )
  }

  return (
    <>
      <PageHeader
        description="Review your selected fragrance sizes and quantities before checkout."
        eyebrow="Cart"
        title="Royal Cart"
      />
      <section className="container-lux grid gap-8 py-12 md:py-16 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {enrichedItems.map((item) => (
            <article
              className="rounded-lg border border-champagne/25 bg-ivory/88 p-4 shadow-sm"
              key={`${item!.productId}-${item!.size}`}
            >
              <div className="grid gap-5 md:grid-cols-[130px_1fr_auto] md:items-center">
                <div className="rounded-lg bg-cream">
                  <ProductBottle compact className="h-32 w-full" name={item!.product.name} tone={item!.product.image} />
                </div>
                <div>
                  <Link to={`/product/${item!.product.slug}`}>
                    <h2 className="font-serif text-3xl font-semibold text-burgundy">{item!.product.name}</h2>
                  </Link>
                  <p className="mt-1 text-sm text-brownroyal/60">{item!.size}</p>
                  <p className="mt-3 font-bold text-brownroyal">{formatCurrency(item!.unitPrice)}</p>
                </div>
                <div className="flex items-center justify-between gap-4 md:flex-col md:items-end">
                  <QuantityStepper
                    onChange={(value) => updateQuantity(item!.productId, item!.size, value)}
                    value={item!.quantity}
                  />
                  <button
                    className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold text-burgundy transition hover:bg-burgundy/8"
                    onClick={() => removeItem(item!.productId, item!.size)}
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Remove
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
        <aside className="h-fit rounded-lg border border-champagne/25 bg-ivory/90 p-6 shadow-xl shadow-brownroyal/10 lg:sticky lg:top-24">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-full bg-champagne/18 text-oldgold">
              <ShoppingBag className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="font-serif text-3xl font-semibold text-burgundy">Order Summary</h2>
          </div>
          <div className="space-y-3 border-y border-champagne/25 py-4 text-sm text-brownroyal/70">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Shipping</span>
              <span>Calculated at checkout</span>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-between">
            <span className="font-bold text-brownroyal">Total</span>
            <span className="text-2xl font-extrabold text-burgundy">{formatCurrency(subtotal)}</span>
          </div>
          <Link className={buttonClasses({ className: 'mt-6 w-full' })} to="/checkout">
            Proceed to Checkout
          </Link>
        </aside>
      </section>
    </>
  )
}
