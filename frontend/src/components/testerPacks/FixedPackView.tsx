import { Package, ShieldCheck, ShoppingBag, Sparkles, Truck, Zap } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PublicTesterPack } from '../../services/publicTesterPacksApi'
import { getFixedPackLineId, useCartStore } from '../../store/cartStore'
import { buttonClasses } from '../../utils/buttonClasses'
import { formatCheckoutCurrency } from '../../utils/checkoutMoney'
import { cn } from '../../utils/cn'
import { QuantityStepper } from '../common/QuantityStepper'

interface FixedPackViewProps {
  pack: PublicTesterPack
  onAddToCartSuccess?: () => void
}

export function FixedPackView({ pack, onAddToCartSuccess }: FixedPackViewProps) {
  const navigate = useNavigate()
  const addFixedPack = useCartStore((state) => state.addFixedPack)
  const cartItems = useCartStore((state) => state.items)

  const [quantity, setQuantity] = useState(1)
  const [selectedImage, setSelectedImage] = useState(pack.image || pack.gallery[0] || '')
  const [feedback, setFeedback] = useState<string | null>(null)

  const lineId = getFixedPackLineId(pack.id, pack.definitionRevision)
  const alreadyInCart = cartItems.find((item) => item.lineId === lineId)?.quantity ?? 0
  const maxAvailable = typeof pack.availablePackCount === 'number'
    ? Math.max(0, Math.min(99, pack.availablePackCount - alreadyInCart))
    : 99
  const isAvailable = pack.available !== false && maxAvailable > 0

  const handleAddToCart = () => {
    if (!isAvailable) {
      setFeedback('This discovery set is currently unavailable.')
      return false
    }
    const success = addFixedPack(pack, quantity)
    if (success) {
      setFeedback('Curated discovery set added to your cart!')
      onAddToCartSuccess?.()
      return true
    } else {
      setFeedback('Could not add this set to cart. Please check your cart quantities.')
      return false
    }
  }

  const handleBuyNow = () => {
    if (handleAddToCart()) {
      navigate('/checkout')
    }
  }

  const allImages = [pack.image, ...(pack.gallery || [])].filter(Boolean)

  return (
    <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
      {/* Visual Gallery */}
      <div className="space-y-4">
        <div className="relative aspect-square overflow-hidden rounded-2xl border border-soft-border/80 bg-warm-ivory/60 shadow-sm">
          {selectedImage ? (
            <img
              alt={pack.name}
              className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
              src={selectedImage}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center p-8 text-center text-muted-taupe">
              <Package aria-hidden="true" className="mb-3 h-16 w-16 text-champagne/60" />
              <span className="font-serif text-lg font-medium text-royal-burgundy">
                Royal Fusion
              </span>
              <span className="text-xs uppercase tracking-widest text-champagne">
                Discovery Collection
              </span>
            </div>
          )}
          {pack.saleActive && pack.fixedSalePrice != null && (
            <span className="absolute left-4 top-4 rounded-full bg-emerald-800 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white shadow-xs">
              Special Price
            </span>
          )}
        </div>

        {allImages.length > 1 && (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {allImages.map((img, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setSelectedImage(img)}
                aria-label={`View set image ${idx + 1}`}
                className={cn(
                  'relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition',
                  selectedImage === img
                    ? 'border-royal-burgundy ring-2 ring-champagne/40'
                    : 'border-soft-border hover:border-champagne/60',
                )}
              >
                <img alt="" className="h-full w-full object-cover" src={img} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Set Details and Action Controls */}
      <div className="space-y-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-champagne/40 bg-champagne/15 px-3 py-1 text-xs font-medium text-royal-burgundy">
              <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-champagne" />
              Curated Discovery Set
            </span>
            {pack.scentFamily && (
              <span className="eyebrow-label text-xs text-muted-taupe">
                {pack.scentFamily}
              </span>
            )}
          </div>
          <h1 className="mt-3 font-serif text-3xl font-bold text-royal-burgundy md:text-4xl">
            {pack.name}
          </h1>

          {/* Pricing */}
          <div className="mt-4 flex items-baseline gap-3">
            {pack.saleActive && pack.fixedSalePrice != null ? (
              <>
                <span className="font-serif text-3xl font-bold text-royal-burgundy">
                  {formatCheckoutCurrency(pack.fixedSalePrice)}
                </span>
                {pack.fixedRegularPrice != null && (
                  <span className="text-lg text-muted-taupe line-through">
                    {formatCheckoutCurrency(pack.fixedRegularPrice)}
                  </span>
                )}
                <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                  Save {Math.round(((pack.fixedRegularPrice! - pack.fixedSalePrice) / pack.fixedRegularPrice!) * 100)}%
                </span>
              </>
            ) : (
              <span className="font-serif text-3xl font-bold text-royal-burgundy">
                {pack.fixedRegularPrice != null ? formatCheckoutCurrency(pack.fixedRegularPrice) : 'PKR 0.00'}
              </span>
            )}
          </div>

          {/* Stock Availability */}
          <div className="mt-3">
            {!pack.available ? (
              <span className="text-sm font-semibold text-rose-800">
                Currently Out of Stock
              </span>
            ) : pack.availablePackCount != null ? (
              <span className="text-sm font-medium text-emerald-900">
                In Stock ({pack.availablePackCount} sets available)
              </span>
            ) : (
              <span className="text-sm font-medium text-emerald-900">
                In Stock & Ready to Ship
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-base leading-relaxed text-muted-taupe">
          {pack.description || pack.shortDescription}
        </p>

        {/* Included Fragrances Component List */}
        <div className="rounded-xl border border-soft-border/80 bg-warm-ivory/50 p-5">
          <h2 className="font-serif text-lg font-semibold text-royal-burgundy">
            Included in This Discovery Set
          </h2>
          <p className="mt-1 text-xs text-muted-taupe">
            Each fragrance is filled in a deluxe 5 ml glass spray atomizer with protective luxury cap.
          </p>

          <div className="mt-4 space-y-3">
            {pack.components.map((comp) => (
              <div
                key={comp.testerVariantId}
                className="flex items-center justify-between rounded-lg border border-soft-border/60 bg-pure-white p-3 shadow-2xs"
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-warm-ivory text-royal-burgundy">
                    <Package aria-hidden="true" className="h-5 w-5 text-champagne" />
                  </div>
                  <div>
                    <p className="font-medium text-royal-burgundy">{comp.name}</p>
                    <p className="text-xs text-muted-taupe">5 ml Eau de Parfum / Extrait</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="inline-block rounded-full bg-champagne/15 px-2.5 py-0.5 text-xs font-semibold text-royal-burgundy">
                    {comp.quantityPerPack ?? 1}x 5 ml
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Stepper and Add To Cart */}
        <div className="space-y-4 pt-2">
          {feedback && (
            <div
              className={cn(
                'rounded-lg p-3 text-sm font-medium',
                feedback.includes('added')
                  ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                  : 'bg-rose-50 text-rose-900 border border-rose-200',
              )}
              role="status"
            >
              {feedback}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <div className="w-36">
              <QuantityStepper
                disabled={!isAvailable}
                max={maxAvailable}
                onChange={setQuantity}
                value={quantity}
              />
            </div>
            <button
              type="button"
              disabled={!isAvailable}
              onClick={handleAddToCart}
              className={buttonClasses({
                size: 'lg',
                className: 'flex-1 gap-2',
              })}
            >
              <ShoppingBag aria-hidden="true" className="h-5 w-5" />
              <span>{isAvailable ? 'Add Set to Cart' : 'Sold Out'}</span>
            </button>
          </div>

          {isAvailable && (
            <button
              type="button"
              onClick={handleBuyNow}
              className={buttonClasses({
                variant: 'outline',
                size: 'lg',
                className: 'w-full gap-2',
              })}
            >
              <Zap aria-hidden="true" className="h-4 w-4 text-champagne" />
              <span>Buy Now</span>
            </button>
          )}
        </div>

        {/* Assurance Highlights */}
        <div className="grid grid-cols-2 gap-4 border-t border-soft-border/80 pt-6 text-xs text-muted-taupe">
          <div className="flex items-start gap-2.5">
            <Truck aria-hidden="true" className="h-4 w-4 shrink-0 text-champagne" />
            <span>Complimentary nationwide delivery on orders above PKR 5,000.</span>
          </div>
          <div className="flex items-start gap-2.5">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-champagne" />
            <span>Guaranteed authentic formula atomizers direct from Royal Fusion.</span>
          </div>
        </div>
      </div>
    </div>
  )
}
