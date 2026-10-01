import { Heart, RotateCcw, ShieldCheck, ShoppingBag, Truck, Zap } from 'lucide-react'
import type { ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../components/common/Button'
import { EmptyState } from '../components/common/EmptyState'
import { QuantityStepper } from '../components/common/QuantityStepper'
import { RatingStars } from '../components/common/RatingStars'
import { SectionHeading } from '../components/common/SectionHeading'
import { ProductBottle } from '../components/products/ProductBottle'
import { ProductGrid } from '../components/products/ProductGrid'
import { ProductReviewForm } from '../components/products/ProductReviewForm'
import { collectionNamesForProduct } from '../services/productionMappers'
import { defaultVariant, isVariantEligible, selectedProductVariant, variantPrice } from '../services/productVariants'
import { useCartStore } from '../store/cartStore'
import { useWishlistStore } from '../store/wishlistStore'
import { useStorefront } from '../storefront/StorefrontProvider'
import { buttonClasses } from '../utils/buttonClasses'
import { cn } from '../utils/cn'
import { formatCurrency } from '../utils/format'

export function ProductDetailsPage() {
  const { products, reviews, collections = [], isLoading, catalogError } = useStorefront()
  const { slug } = useParams()
  const navigate = useNavigate()
  const product = products.find((item) => item.slug === slug)
  const addItem = useCartStore((state) => state.addItem)
  const toggleWishlist = useWishlistStore((state) => state.toggle)
  const isWishlisted = useWishlistStore((state) => (product ? state.has(product.id) : false))

  const [selectedTone, setSelectedTone] = useState(product?.gallery[0] ?? product?.image ?? '')
  const [selectedVariantId, setSelectedVariantId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [cartMessage, setCartMessage] = useState('')
  const previousIdentity = useRef('')
  const cartItems = useCartStore((state) => state.items)

  const selectedVariant = selectedProductVariant(product, selectedVariantId)
  const price = selectedVariant ? variantPrice(selectedVariant) : product?.price ?? 0
  const alreadyInCart = cartItems.filter((item) => item.variantId === selectedVariant?.id)
    .reduce((total, item) => total + item.quantity, 0)
  const maxQuantity = Math.max(0, Math.min(99, (selectedVariant?.stockQuantity ?? 0) - alreadyInCart))
  const canAdd = isVariantEligible(selectedVariant, quantity) && quantity <= maxQuantity

  useEffect(() => {
    const identity = JSON.stringify([slug, product?.id])
    const changed = previousIdentity.current !== identity
    previousIdentity.current = identity
    setSelectedVariantId((current) => changed
      ? product ? defaultVariant(product)?.id ?? '' : ''
      : selectedProductVariant(product, current)?.id ?? '')
    setSelectedTone((current) => !changed && product && [product.image, ...product.gallery].includes(current)
      ? current : product?.gallery[0] ?? product?.image ?? '')
    if (changed) {
      setQuantity(1)
      setCartMessage('')
    }
  }, [product, slug])

  useEffect(() => {
    setQuantity((current) => Math.max(1, Math.min(current, maxQuantity)))
  }, [selectedVariant?.id, maxQuantity])
  const collectionNames = product ? collectionNamesForProduct(collections, product.id) : []
  const productReviews = product ? reviews.filter((review) => review.productId === product.id) : []

  const relatedProducts = useMemo(() => {
    if (!product) return []
    return products
      .filter((item) => item.id !== product.id && item.scentFamily === product.scentFamily)
      .slice(0, 4)
  }, [product, products])

  if (isLoading && !product) {
    return <section className="container-lux py-16" role="status">Loading fragrance...</section>
  }

  if (!product) {
    return (
      <section className="container-lux py-16">
        <EmptyState
          description={catalogError ?? 'The fragrance you are looking for is not currently available.'}
          title="Fragrance not found"
        />
      </section>
    )
  }

  const handleAddToCart = () => {
    if (!selectedVariant || !canAdd || !addItem(product, selectedVariant.id, quantity)) {
      setCartMessage('This size or quantity is unavailable. Please check your cart.')
      return false
    }
    setCartMessage('')
    return true
  }
  const handleBuyNow = () => {
    if (handleAddToCart()) navigate('/checkout')
  }

  return (
    <>
      <section className="container-lux grid gap-10 py-10 md:py-14 lg:grid-cols-[1fr_0.95fr]">
        <div>
          <div className="sticky top-24">
            <div className="rounded-lg border border-champagne/30 bg-gradient-to-br from-cream via-ivory to-[#ecd4af] p-8 shadow-xl shadow-brownroyal/10">
              <ProductBottle floating name={product.name} tone={selectedTone} />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {product.gallery.map((tone, index) => (
                <button
                  aria-label={`View ${product.name} gallery ${index + 1}`}
                  className={cn(
                    'rounded-lg border bg-ivory p-2 transition',
                    selectedTone === tone ? 'border-burgundy' : 'border-champagne/25 hover:border-oldgold',
                  )}
                  key={tone}
                  onClick={() => setSelectedTone(tone)}
                  type="button"
                >
                  <ProductBottle compact className="h-28 w-full" name={product.name} tone={tone} />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          {collectionNames.length > 0 && (
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-oldgold">{collectionNames.join(' · ')}</p>
          )}
          <h1 className="mt-3 font-serif text-5xl font-bold leading-none text-burgundy md:text-7xl">
            {product.name}
          </h1>
          <p className="mt-5 text-lg leading-8 text-brownroyal/74">{product.description}</p>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <RatingStars count={product.reviewCount} rating={product.rating} />
            <span className="rounded-full bg-champagne/18 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-oldgold">
              {product.badge}
            </span>
            <span className="rounded-full bg-burgundy/8 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-burgundy">
              {selectedVariant?.stockQuantity ?? 0} in stock
            </span>
          </div>

          <div className="mt-7 flex items-end gap-3">
            <p className="text-3xl font-extrabold text-brownroyal">{formatCurrency(price)}</p>
            {selectedVariant && selectedVariant.regularPrice > price && (
              <p className="pb-1 text-base text-brownroyal/45 line-through">
                {formatCurrency(selectedVariant.regularPrice)}
              </p>
            )}
          </div>

          <div className="mt-8">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-oldgold">Select Size</h2>
            <div className="flex flex-wrap gap-3">
              {(product.variants ?? []).map((option) => (
                <button
                  className={cn(
                    'rounded-full border px-5 py-3 text-sm font-bold transition',
                    selectedVariant?.id === option.id
                      ? 'border-burgundy bg-burgundy text-ivory'
                      : 'border-champagne/35 bg-ivory text-brownroyal hover:border-oldgold',
                  )}
                  key={option.id}
                  disabled={!isVariantEligible(option)}
                  onClick={() => { setSelectedVariantId(option.id); setQuantity(1); setCartMessage('') }}
                  type="button"
                >
                  {option.optionValue}
                </button>
              ))}
            </div>
            {!selectedVariant && <p className="mt-3 text-sm text-burgundy" role="status">This fragrance is currently unavailable.</p>}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <QuantityStepper onChange={setQuantity} value={quantity} max={maxQuantity} disabled={maxQuantity < 1} />
            <Button disabled={!canAdd} onClick={handleAddToCart} size="lg">
              <ShoppingBag className="h-5 w-5" aria-hidden="true" />
              Add to Cart
            </Button>
            <Button disabled={!canAdd} onClick={handleBuyNow} size="lg" variant="secondary">
              <Zap className="h-5 w-5" aria-hidden="true" />
              Buy Now
            </Button>
            <button
              className={buttonClasses({ variant: isWishlisted ? 'primary' : 'outline', size: 'lg' })}
              onClick={() => toggleWishlist(product.id)}
              type="button"
            >
              <Heart className={cn('h-5 w-5', isWishlisted && 'fill-current')} aria-hidden="true" />
              Wishlist
            </button>
          </div>

          {cartMessage && <p className="mt-3 text-sm text-burgundy" role="alert">{cartMessage}</p>}

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <InfoCard icon={<Truck />} title="Shipping" text="Bulk orders qualify for free shipping." />
            <InfoCard icon={<RotateCcw />} title="Returns" text="7-day return policy on eligible items." />
            <InfoCard icon={<ShieldCheck />} title="Payments" text="Cash on Delivery and bank transfer." />
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <Spec title="Longevity" value={product.longevity} />
            <Spec title="Sillage" value={product.sillage} />
            <Spec title="Occasion" value={product.occasion.join(', ')} />
          </div>

          <div className="mt-10 rounded-lg border border-champagne/25 bg-ivory/88 p-6">
            <h2 className="font-serif text-3xl font-semibold text-burgundy">Fragrance Notes</h2>
            <div className="mt-5 grid gap-5 md:grid-cols-3">
              <NoteList title="Top" notes={product.notes.top} />
              <NoteList title="Middle" notes={product.notes.middle} />
              <NoteList title="Base" notes={product.notes.base} />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-marble/75 py-14">
        <div className="container-lux">
          <SectionHeading
            description="Customer feedback for this fragrance."
            eyebrow="Reviews"
            title="Customer Impressions"
          />
          {productReviews.length === 0 ? <p className="mt-6 text-brownroyal/65">No reviews yet for this fragrance.</p> : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {productReviews.map((review) => (
              <article className="rounded-lg border border-champagne/25 bg-ivory p-5 shadow-sm" key={review.id}>
                <RatingStars rating={review.rating} />
                <p className="mt-4 text-sm leading-7 text-brownroyal/72">"{review.text}"</p>
                <p className="mt-4 font-serif text-xl font-semibold text-burgundy">{review.name}</p>
                <p className="text-sm text-brownroyal/55">{review.city}</p>
              </article>
            ))}
          </div>
          )}
          <ProductReviewForm key={product.id} productId={product.id} />
        </div>
      </section>

      {relatedProducts.length > 0 && (
        <section className="container-lux py-14">
          <SectionHeading
            description={`More ${product.scentFamily.toLowerCase()} fragrances from the Royal Fusion catalog.`}
            eyebrow="Related Products"
            title="Complete the Ritual"
          />
          <ProductGrid products={relatedProducts} />
        </section>
      )}
    </>
  )
}

function InfoCard({ icon, title, text }: { icon: ReactElement; title: string; text: string }) {
  return (
    <div className="rounded-lg border border-champagne/25 bg-ivory/86 p-4">
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-champagne/16 text-oldgold">
        {icon}
      </div>
      <h3 className="font-serif text-2xl font-semibold text-burgundy">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-brownroyal/65">{text}</p>
    </div>
  )
}

function Spec({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-champagne/25 bg-marble/75 p-4">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-oldgold">{title}</p>
      <p className="mt-2 font-semibold text-brownroyal">{value}</p>
    </div>
  )
}

function NoteList({ title, notes }: { title: string; notes: string[] }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-oldgold">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm text-brownroyal/72">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  )
}
