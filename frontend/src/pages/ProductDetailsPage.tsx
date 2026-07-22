import { Heart, RotateCcw, ShieldCheck, ShoppingBag, Truck, Zap } from 'lucide-react'
import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../components/common/Button'
import { EmptyState } from '../components/common/EmptyState'
import { QuantityStepper } from '../components/common/QuantityStepper'
import { RatingStars } from '../components/common/RatingStars'
import { SectionHeading } from '../components/common/SectionHeading'
import { ProductBottle } from '../components/products/ProductBottle'
import { ProductGrid } from '../components/products/ProductGrid'
import { useCartStore } from '../store/cartStore'
import { useWishlistStore } from '../store/wishlistStore'
import { useStorefront } from '../storefront/StorefrontProvider'
import { buttonClasses } from '../utils/buttonClasses'
import { cn } from '../utils/cn'
import { formatCurrency } from '../utils/format'

export function ProductDetailsPage() {
  const { products, reviews } = useStorefront()
  const { slug } = useParams()
  const navigate = useNavigate()
  const product = products.find((item) => item.slug === slug)
  const addItem = useCartStore((state) => state.addItem)
  const toggleWishlist = useWishlistStore((state) => state.toggle)
  const isWishlisted = useWishlistStore((state) => (product ? state.has(product.id) : false))

  const [selectedTone, setSelectedTone] = useState(product?.gallery[0] ?? product?.image ?? '')
  const [selectedSize, setSelectedSize] = useState(product?.sizeOptions[0]?.value ?? '')
  const [quantity, setQuantity] = useState(1)

  const selectedSizeOption = product?.sizeOptions.find((option) => option.value === selectedSize)
  const price = selectedSizeOption?.price ?? product?.price ?? 0

  const relatedProducts = useMemo(() => {
    if (!product) return []
    return products
      .filter((item) => item.id !== product.id && item.scentFamily === product.scentFamily)
      .slice(0, 4)
  }, [product, products])

  if (!product) {
    return (
      <section className="container-lux py-16">
        <EmptyState
          description="The perfume you are looking for is not available in this prototype catalog."
          title="Fragrance not found"
        />
      </section>
    )
  }

  const handleAddToCart = () => addItem(product, selectedSize, quantity)
  const handleBuyNow = () => {
    addItem(product, selectedSize, quantity)
    navigate('/checkout')
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
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-oldgold">{product.collection}</p>
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
              {product.stock} in stock
            </span>
          </div>

          <div className="mt-7 flex items-end gap-3">
            <p className="text-3xl font-extrabold text-brownroyal">{formatCurrency(price)}</p>
            {product.oldPrice && (
              <p className="pb-1 text-base text-brownroyal/45 line-through">
                {formatCurrency(product.oldPrice)}
              </p>
            )}
          </div>

          <div className="mt-8">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-oldgold">Select Size</h2>
            <div className="flex flex-wrap gap-3">
              {product.sizeOptions.map((option) => (
                <button
                  className={cn(
                    'rounded-full border px-5 py-3 text-sm font-bold transition',
                    selectedSize === option.value
                      ? 'border-burgundy bg-burgundy text-ivory'
                      : 'border-champagne/35 bg-ivory text-brownroyal hover:border-oldgold',
                  )}
                  key={option.value}
                  onClick={() => setSelectedSize(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <QuantityStepper onChange={setQuantity} value={quantity} />
            <Button onClick={handleAddToCart} size="lg">
              <ShoppingBag className="h-5 w-5" aria-hidden="true" />
              Add to Cart
            </Button>
            <Button onClick={handleBuyNow} size="lg" variant="secondary">
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

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <InfoCard icon={<Truck />} title="Shipping" text="Bulk orders qualify for free shipping." />
            <InfoCard icon={<RotateCcw />} title="Returns" text="7-day return policy on eligible items." />
            <InfoCard icon={<ShieldCheck />} title="Payments" text="COD, bank transfer, and card placeholder." />
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
            description="Boutique feedback that matches the selected product family."
            eyebrow="Reviews"
            title="Customer Impressions"
          />
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {reviews.map((review) => (
              <article className="rounded-lg border border-champagne/25 bg-ivory p-5 shadow-sm" key={review.id}>
                <RatingStars rating={review.rating} />
                <p className="mt-4 text-sm leading-7 text-brownroyal/72">"{review.text}"</p>
                <p className="mt-4 font-serif text-xl font-semibold text-burgundy">{review.name}</p>
                <p className="text-sm text-brownroyal/55">{review.city}</p>
              </article>
            ))}
          </div>
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
