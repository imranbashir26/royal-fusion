import { configurablePackLimit, minimumPackUnits, testerCatalogPrice } from '../../services/testerPackShopping'
import { getConfigurablePackLineId } from '../../store/cartPersistence'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Minus,
  Package,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Trash2,
  Truck,
  X,
  Zap,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PublicTesterOption, PublicTesterPack } from '../../services/publicTesterPacksApi'
import { useCartStore } from '../../store/cartStore'
import { buttonClasses } from '../../utils/buttonClasses'
import { formatCheckoutCurrency } from '../../utils/checkoutMoney'
import { cn } from '../../utils/cn'

interface ConfigurablePackBuilderProps {
  pack: PublicTesterPack
  onAddToCartSuccess?: () => void
}

export function ConfigurablePackBuilder({
  pack,
  onAddToCartSuccess,
}: ConfigurablePackBuilderProps) {
  const navigate = useNavigate()
  const addConfigurablePack = useCartStore((state) => state.addConfigurablePack)

  // Selection state: Map variantId -> quantity in pack
  const [selections, setSelections] = useState<Record<string, number>>({})
  const [packQuantity, setPackQuantity] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)

  const cartItems = useCartStore(state => state.items)
  const minUnits = minimumPackUnits(pack)
  const maxUnits = pack.maximumUnits

  // Calculate total units selected
  const totalUnits = useMemo(() => {
    return Object.values(selections).reduce((sum, qty) => sum + qty, 0)
  }, [selections])

  const isMinMet = totalUnits >= minUnits
  const isMaxMet = maxUnits !== null && totalUnits >= maxUnits
  const canAddMore = maxUnits === null || totalUnits < maxUnits
  const selectionLines = Object.entries(selections).map(([variantId, quantityPerPack]) => ({ variantId, quantityPerPack }))
  const availablePacks = configurablePackLimit(pack, selectionLines)
  const lineId = getConfigurablePackLineId(pack.id, pack.definitionRevision, selectionLines)
  const alreadyInCart = cartItems.find(item => item.lineId === lineId)?.quantity ?? 0
  const maxPackQuantity = Math.max(0, availablePacks - alreadyInCart)
  const isValidPack = isMinMet && (!maxUnits || totalUnits <= maxUnits) && pack.available === true && packQuantity <= maxPackQuantity

  // Calculate total price of current custom pack
  const calculatedUnitPrice = useMemo(() => {
    let sum = 0
    for (const [variantId, qty] of Object.entries(selections)) {
      if (qty <= 0) continue
      const variant = pack.allowedVariants.find((v) => v.testerVariantId === variantId)
      if (variant) {
        const price = Number(testerCatalogPrice(variant) ?? 0)
        sum += Math.round(price * 100) * qty
      }
    }
    return sum / 100
  }, [selections, pack.allowedVariants])

  // Get list of selected variant objects with quantities
  const selectedItems = useMemo(() => {
    return Object.entries(selections)
      .filter(([, qty]) => qty > 0)
      .map(([variantId, qty]) => {
        const variant = pack.allowedVariants.find((v) => v.testerVariantId === variantId)!
        const price = Number(variant ? testerCatalogPrice(variant) ?? 0 : 0)
        return {
          variant,
          quantity: qty,
          unitPrice: price,
          totalPrice: price * qty,
        }
      })
      .filter((item) => item.variant)
  }, [selections, pack.allowedVariants])

  // Filter allowed variants by search
  const filteredVariants = useMemo(() => {
    return pack.allowedVariants.filter((variant) => {
      if (variant.active === false) return false
      const query = searchQuery.trim().toLowerCase()
      if (!query) return true
      return (
        variant.name.toLowerCase().includes(query) ||
        variant.sku.toLowerCase().includes(query)
      )
    })
  }, [pack.allowedVariants, searchQuery])

  // Handlers for adjusting variant count in pack
  const handleIncrement = (variant: PublicTesterOption) => {
    const current = selections[variant.testerVariantId] ?? 0
    if (!canAddMore || !pack.available) return
    if ((current + 1) * packQuantity > variant.stockQuantity) return
    if (variant.stockQuantity <= 0 || variant.active === false) return

    setSelections((prev) => ({
      ...prev,
      [variant.testerVariantId]: current + 1,
    }))
    setFeedback(null)
  }

  const handleDecrement = (variant: PublicTesterOption) => {
    const current = selections[variant.testerVariantId] ?? 0
    if (current <= 0) return

    setSelections((prev) => {
      const next = { ...prev }
      if (current === 1) {
        delete next[variant.testerVariantId]
      } else {
        next[variant.testerVariantId] = current - 1
      }
      return next
    })
    setFeedback(null)
  }

  const handleRemove = (variantId: string) => {
    setSelections((prev) => {
      const next = { ...prev }
      delete next[variantId]
      return next
    })
    setFeedback(null)
  }

  const handleAddToCart = () => {
    if (!isValidPack) {
      if (!isMinMet) {
        setFeedback(`Please select at least ${minUnits} tester units to complete your pack.`)
      } else if (maxUnits && totalUnits > maxUnits) {
        setFeedback(`Your pack contains more than the maximum allowed (${maxUnits}) tester units.`)
      } else {
        setFeedback('This discovery pack is currently unavailable.')
      }
      return false
    }

    const payloadSelections = selectedItems.map((item) => ({
      variantId: item.variant.testerVariantId,
      quantityPerPack: item.quantity,
      testerName: item.variant.name,
    }))

    const success = addConfigurablePack(pack, payloadSelections, packQuantity)
    if (success) {
      setFeedback('Your bespoke discovery pack has been added to your cart!')
      onAddToCartSuccess?.()
      return true
    } else {
      setFeedback('Unable to add custom pack to cart. Please check your selections and inventory.')
      return false
    }
  }

  const handleBuyNow = () => {
    if (handleAddToCart()) {
      navigate('/checkout')
    }
  }

  // Progress percentage
  const progressPercent = maxUnits
    ? Math.min(100, Math.round((totalUnits / maxUnits) * 100))
    : isMinMet
      ? 100
      : Math.round((totalUnits / minUnits) * 100)

  return (
    <div className="space-y-8 pb-24 lg:pb-0">
      {/* Top Pack Header & Description */}
      <div className="border-b border-soft-border/80 pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-royal-burgundy/20 bg-royal-burgundy/10 px-3 py-1 text-xs font-medium text-royal-burgundy">
            <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5 text-champagne" />
            Interactive Pack Builder
          </span>
          <span className="eyebrow-label text-xs text-muted-taupe">
            {pack.scentFamily || 'Discovery Collection'}
          </span>
        </div>
        <h1 className="mt-3 font-serif text-3xl font-bold text-royal-burgundy md:text-4xl">
          {pack.name}
        </h1>
        <p className="mt-2 max-w-3xl text-base leading-relaxed text-muted-taupe">
          {pack.description ||
            pack.shortDescription ||
            'Craft your personalized discovery set. Choose your favorite artisanal 5 ml fragrances below.'}
        </p>
      </div>

      {/* Progress & Slots Tracking Banner */}
      <div className="rounded-2xl border border-champagne/40 bg-gradient-to-r from-warm-ivory via-soft-cream/70 to-warm-ivory p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="eyebrow-label text-xs">Pack Configuration Status</span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-serif text-2xl font-bold text-royal-burgundy">
                {totalUnits}
                {maxUnits ? ` of ${maxUnits}` : ''} Testers Selected
              </span>
              <span className="text-sm font-medium text-muted-taupe">
                (Min {minUnits}
                {maxUnits ? `, Max ${maxUnits}` : ''})
              </span>
            </div>
          </div>

          {/* Status Badge */}
          <div>
            {totalUnits === 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-champagne/20 px-3.5 py-1.5 text-xs font-semibold text-royal-burgundy">
                Select your first fragrance
              </span>
            ) : !isMinMet ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3.5 py-1.5 text-xs font-semibold text-amber-900">
                <AlertCircle className="h-4 w-4 text-amber-700" />
                Add {minUnits - totalUnits} more to reach minimum
              </span>
            ) : isMaxMet ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3.5 py-1.5 text-xs font-semibold text-emerald-900">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                Pack Complete ({maxUnits} max reached)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3.5 py-1.5 text-xs font-semibold text-emerald-900">
                <Check className="h-4 w-4 text-emerald-700" />
                {maxUnits === null ? 'Pack Ready (minimum reached)' : `Pack Ready (can add up to ${maxUnits - totalUnits} more)`}
              </span>
            )}
          </div>
        </div>

        {/* Visual Progress Bar */}
        <div className="mt-4">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-soft-border/80">
            <div
              className={cn(
                'h-full transition-all duration-300',
                isMinMet ? 'bg-emerald-600' : 'bg-champagne',
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Slot tracker bubbles if maxUnits is small (e.g. <= 10) */}
        {maxUnits && maxUnits <= 10 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {Array.from({ length: maxUnits }).map((_, index) => {
              const isFilled = index < totalUnits
              return (
                <div
                  key={index}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all',
                    isFilled
                      ? 'border border-emerald-600 bg-emerald-600 text-white shadow-2xs'
                      : 'border border-dashed border-champagne/60 bg-warm-ivory text-muted-taupe',
                  )}
                  title={`Slot ${index + 1}${isFilled ? ' (Filled)' : ' (Empty)'}`}
                >
                  {isFilled ? <Check className="h-4 w-4" /> : index + 1}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid gap-8 lg:grid-cols-[1fr_380px] lg:items-start">
        {/* Left Column: Allowed Fragrances Selection Grid */}
        <div className="space-y-6">
          {/* Search bar */}
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-taupe"
            />
            <input
              aria-label="Search available fragrance testers"
              className="h-11 w-full rounded-xl border border-soft-border/90 bg-pure-white pl-11 pr-4 text-sm text-espresso placeholder:text-muted-taupe/60 focus:border-royal-burgundy focus:outline-none focus:ring-1 focus:ring-royal-burgundy"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by fragrance name or SKU..."
              type="text"
              value={searchQuery}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-taupe hover:text-royal-burgundy"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Fragrance Cards Grid */}
          <div className="grid gap-4 sm:grid-cols-2">
            {filteredVariants.map((variant) => {
              const countInPack = selections[variant.testerVariantId] ?? 0
              const unitPrice = Number(
                testerCatalogPrice(variant) ?? 0,
              )
              const isOutOfStock = variant.stockQuantity <= 0 || variant.active === false
              const canIncrement =
                canAddMore && pack.available && !isOutOfStock && (countInPack + 1) * packQuantity <= variant.stockQuantity

              return (
                <div
                  key={variant.testerVariantId}
                  className={cn(
                    'flex flex-col justify-between rounded-xl border p-4 transition-all duration-200',
                    countInPack > 0
                      ? 'border-royal-burgundy/40 bg-warm-ivory/50 shadow-2xs'
                      : 'border-soft-border/80 bg-pure-white hover:border-champagne/60',
                    isOutOfStock && 'opacity-60 bg-soft-cream/30',
                  )}
                >
                  <div className="flex gap-3">
                    {/* Bottle/Tester visual */}
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-soft-border/60 bg-warm-ivory/80">
                      {variant.image ? (
                        <img
                          alt={variant.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          src={variant.image}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-champagne">
                          <Package className="h-7 w-7" />
                        </div>
                      )}
                      <span className="absolute bottom-1 right-1 rounded-sm bg-royal-burgundy/80 px-1 py-0.2 text-[9px] font-semibold text-white">
                        5 ml
                      </span>
                    </div>

                    {/* Details */}
                    <div className="min-w-0 flex-1">
                      <p className="font-serif text-base font-semibold leading-snug text-royal-burgundy">
                        {variant.name}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-taupe">5 ml Spray Atomizer</p>
                      <p className="mt-1 font-semibold text-espresso">
                        {formatCheckoutCurrency(unitPrice)}
                      </p>

                      {/* Stock availability */}
                      <p className="mt-1 text-[11px]">
                        {isOutOfStock ? (
                          <span className="font-medium text-rose-700">Out of Stock</span>
                        ) : variant.stockQuantity <= 5 ? (
                          <span className="font-medium text-amber-800">
                            Only {variant.stockQuantity} left
                          </span>
                        ) : (
                          <span className="text-muted-taupe">In Stock</span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Quantity Stepper for this variant */}
                  <div className="mt-4 flex items-center justify-between border-t border-soft-border/50 pt-3">
                    <span className="text-xs text-muted-taupe">Quantity in pack:</span>
                    <div className="flex items-center gap-1.5 rounded-lg border border-soft-border/80 bg-pure-white p-1 shadow-2xs">
                      <button
                        type="button"
                        aria-label={`Decrease ${variant.name} quantity in pack, currently ${countInPack}`}
                        disabled={countInPack <= 0}
                        onClick={() => handleDecrement(variant)}
                        className={cn(
                          'grid h-8 w-8 place-items-center rounded-md text-espresso transition',
                          countInPack > 0
                            ? 'hover:bg-champagne/15 text-royal-burgundy'
                            : 'cursor-not-allowed opacity-30',
                        )}
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="min-w-7 text-center font-bold text-royal-burgundy">
                        {countInPack}
                      </span>
                      <button
                        type="button"
                        aria-label={`Increase ${variant.name} quantity in pack, currently ${countInPack}`}
                        disabled={!canIncrement}
                        onClick={() => handleIncrement(variant)}
                        className={cn(
                          'grid h-8 w-8 place-items-center rounded-md text-espresso transition',
                          canIncrement
                            ? 'hover:bg-champagne/15 text-royal-burgundy'
                            : 'cursor-not-allowed opacity-30',
                        )}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {filteredVariants.length === 0 && (
            <div className="rounded-xl border border-soft-border bg-warm-ivory/40 p-8 text-center text-muted-taupe">
              <p className="font-medium">{pack.allowedVariants.length === 0 ? 'No testers are currently available for this pack.' : 'No fragrances match your search.'}</p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="mt-2 text-xs font-semibold text-royal-burgundy underline"
              >
                Clear search filter
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Sticky Summary & Add to Cart Sidebar */}
        <aside className="sticky top-24 space-y-5 rounded-2xl border border-champagne/30 bg-pure-white p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-soft-border/80 pb-4">
            <h2 className="font-serif text-xl font-bold text-royal-burgundy">Pack Summary</h2>
            <span className="rounded-full bg-champagne/15 px-2.5 py-0.5 text-xs font-semibold text-royal-burgundy">
              {totalUnits} tester unit{totalUnits !== 1 ? 's' : ''}
            </span>
          </div>

          <p role="status" className="text-sm text-royal-burgundy">{!pack.available ? 'This discovery pack is currently unavailable.' : isMinMet && packQuantity > maxPackQuantity ? 'Your pack quantity exceeds the available stock. Reduce the quantity or revise your selection.' : 'Select tester units, including repeats of the same fragrance. Final prices and delivery are confirmed by the checkout quote.'}</p>
          {/* Feedback alert */}
          {feedback && (
            <div
              className={cn(
                'rounded-lg p-3 text-xs font-medium',
                feedback.includes('added')
                  ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                  : 'bg-rose-50 text-rose-900 border border-rose-200',
              )}
              role="status"
            >
              {feedback}
            </div>
          )}

          {/* Selected Items Breakdown */}
          <div className="max-h-64 space-y-2.5 overflow-y-auto luxury-scrollbar pr-1">
            {selectedItems.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-taupe">
                No fragrances selected yet. Click + on any fragrance to begin building your custom
                pack.
              </p>
            ) : (
              selectedItems.map(({ variant, quantity, unitPrice, totalPrice }) => (
                <div
                  key={variant.testerVariantId}
                  className="flex items-center justify-between rounded-lg border border-soft-border/60 bg-warm-ivory/30 p-2.5 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-royal-burgundy">{variant.name}</p>
                    <p className="text-[11px] text-muted-taupe">
                      {quantity}x {formatCheckoutCurrency(unitPrice)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-espresso">
                      {formatCheckoutCurrency(totalPrice)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${variant.name} from pack`}
                      onClick={() => handleRemove(variant.testerVariantId)}
                      className="grid h-6 w-6 place-items-center rounded-full text-muted-taupe hover:bg-rose-50 hover:text-rose-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Pack Totals */}
          <div className="border-t border-soft-border/80 pt-4 space-y-2">
            <div className="flex justify-between text-xs text-muted-taupe">
              <span>Selected testers:</span>
              <span className="font-medium text-espresso">{totalUnits} units</span>
            </div>
            <div className="flex justify-between items-baseline pt-1">
              <span className="font-serif text-lg font-bold text-royal-burgundy">Catalog estimate:</span>
              <span className="font-serif text-2xl font-bold text-royal-burgundy">
                {formatCheckoutCurrency(calculatedUnitPrice)}
              </span>
            </div>
          </div>

          {/* Pack Quantity Stepper */}
          <div className="flex items-center justify-between border-t border-soft-border/80 pt-4">
            <span className="text-xs font-medium text-muted-taupe">Quantity of this pack:</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={packQuantity <= 1}
                onClick={() => setPackQuantity((q) => Math.max(1, q - 1))}
                aria-label="Decrease pack quantity"
                className="grid h-7 w-7 place-items-center rounded border border-soft-border bg-warm-ivory text-xs font-bold text-royal-burgundy disabled:opacity-40"
              >
                -
              </button>
              <span className="w-6 text-center text-sm font-bold text-royal-burgundy">
                {packQuantity}
              </span>
              <button
                type="button"
                disabled={packQuantity >= maxPackQuantity || !pack.available}
                onClick={() => setPackQuantity((q) => Math.min(maxPackQuantity, q + 1))}
                aria-label="Increase pack quantity"
                className="grid h-7 w-7 place-items-center rounded border border-soft-border bg-warm-ivory text-xs font-bold text-royal-burgundy disabled:opacity-40"
              >
                +
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2.5 pt-2">
            <button
              type="button"
              disabled={!isValidPack}
              onClick={handleAddToCart}
              className={buttonClasses({
                size: 'lg',
                className: 'w-full gap-2',
              })}
            >
              <ShoppingBag aria-hidden="true" className="h-5 w-5" />
              <span>
                {!isMinMet
                  ? `Select at least ${minUnits} testers`
                  : maxUnits && totalUnits > maxUnits
                    ? `Max ${maxUnits} testers exceeded`
                    : 'Add Custom Pack to Cart'}
              </span>
            </button>

            {isValidPack && (
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
                <span>Buy Custom Pack Now</span>
              </button>
            )}
          </div>

          {/* Value Highlights */}
          <div className="space-y-2 border-t border-soft-border/80 pt-4 text-[11px] text-muted-taupe">
            <div className="flex items-center gap-2">
              <Truck aria-hidden="true" className="h-3.5 w-3.5 text-champagne shrink-0" />
              <span>Delivery charges are confirmed at checkout</span>
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5 text-champagne shrink-0" />
              <span>Authentic formulations in luxury 5 ml atomizers</span>
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile Fixed Bottom Checkout Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-between border-t border-champagne/40 bg-pure-white/95 px-4 py-3 shadow-2xl backdrop-blur-md lg:hidden">
        <div>
          <p className="text-[11px] text-muted-taupe">
            {totalUnits} tester units selected {maxUnits ? `(maximum ${maxUnits})` : `(minimum ${minUnits})`}
          </p>
          <p className="font-serif text-lg font-bold text-royal-burgundy">
            Estimate: {formatCheckoutCurrency(calculatedUnitPrice)}
          </p>
        </div>
        <button
          type="button"
          disabled={!isValidPack}
          onClick={handleAddToCart}
          className={buttonClasses({
            size: 'sm',
            className: 'gap-1.5',
          })}
        >
          <ShoppingBag className="h-4 w-4" />
          <span>{isMinMet ? 'Add to Cart' : `Min ${minUnits} needed`}</span>
        </button>
      </div>
    </div>
  )
}
