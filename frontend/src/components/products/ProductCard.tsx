import { Heart, ShoppingBag } from 'lucide-react'
import type { MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { RatingStars } from '../common/RatingStars'
import { useCartStore } from '../../store/cartStore'
import { useWishlistStore } from '../../store/wishlistStore'
import type { Product } from '../../types'
import { cn } from '../../utils/cn'
import { formatCurrency } from '../../utils/format'

interface ProductCardProps {
  product: Product
  compact?: boolean
  className?: string
}

export function ProductCard({ product, className }: ProductCardProps) {
  const addItem = useCartStore((state) => state.addItem)
  const toggleWishlist = useWishlistStore((state) => state.toggle)
  const isWishlisted = useWishlistStore((state) => state.productIds.includes(product.id))

  const handleWishlistToggle = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    toggleWishlist(product.id)
  }

  const handleAddToCart = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const defaultSize = product.sizeOptions?.[0]?.value || '50ml'
    addItem(product, defaultSize)
  }

  const defaultImage = product.cardImage || product.image
  const hoverImage = product.cardHoverImage
  const hasHoverImage = Boolean(hoverImage && hoverImage.trim() !== '' && hoverImage !== defaultImage)
  const backgroundColor = product.cardBackgroundColor || '#E7C78F'
  const hasDiscount = Boolean(product.oldPrice && product.oldPrice > product.price)

  return (
    <article
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-[14px] border border-soft-border/80 bg-white shadow-[0_4px_16px_rgba(48,35,30,0.04)] transition-all duration-300 hover:border-champagne/60 hover:shadow-[0_10px_24px_rgba(48,35,30,0.08)]',
        className,
      )}
    >
      {/* Media area */}
      <div
        className="relative aspect-[4/5] w-full overflow-hidden"
        style={{ backgroundColor }}
      >
        {/* Product Badge */}
        {product.badge && (
          <div className="absolute left-3 top-3 z-10 rounded-full border border-champagne/30 bg-royal-burgundy px-2.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-white shadow-xs sm:text-[11px]">
            {product.badge}
          </div>
        )}

        {/* Wishlist Button */}
        <button
          aria-label={isWishlisted ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
          className={cn(
            'absolute right-2.5 top-2.5 z-10 grid h-8 w-8 place-items-center rounded-full border border-soft-border/80 bg-white/90 text-espresso shadow-xs transition hover:border-champagne hover:text-royal-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-burgundy sm:right-3 sm:top-3 sm:h-9 sm:w-9',
            isWishlisted && 'border-royal-burgundy bg-royal-burgundy text-white hover:border-royal-burgundy hover:text-white',
          )}
          onClick={handleWishlistToggle}
          type="button"
        >
          <Heart className={cn('h-3.5 w-3.5 sm:h-4 sm:w-4', isWishlisted && 'fill-current')} aria-hidden="true" />
        </button>

        {/* Product Media Link */}
        <Link
          aria-label={`View ${product.name}`}
          className="relative flex h-full w-full items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-burgundy focus-visible:ring-inset"
          to={`/product/${product.slug}`}
        >
          {/* Default Product Card PNG */}
          <img
            alt={product.name}
            className={cn(
              'relative z-0 h-[82%] w-auto max-w-[82%] object-contain transition-opacity duration-400 ease-out will-change-opacity motion-reduce:transition-none',
              hasHoverImage && 'group-hover:opacity-0',
            )}
            decoding="async"
            loading="lazy"
            src={defaultImage}
          />

          {/* Hover Photoshoot/Lifestyle Image */}
          {hasHoverImage && (
            <img
              alt={`${product.name} lifestyle presentation`}
              className="absolute inset-0 z-0 h-full w-full object-cover opacity-0 transition-opacity duration-400 ease-out will-change-opacity motion-reduce:transition-none group-hover:opacity-100"
              decoding="async"
              loading="lazy"
              src={hoverImage}
            />
          )}
        </Link>
      </div>

      {/* Content under media */}
      <div className="flex flex-1 flex-col justify-between p-3.5 sm:p-4.5 lg:p-5">
        <div className="space-y-1.5 sm:space-y-2">
          {/* Product Name */}
          <Link
            className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-burgundy rounded-xs"
            to={`/product/${product.slug}`}
          >
            <h3 className="line-clamp-2 font-serif text-base font-semibold leading-tight text-royal-burgundy transition hover:text-deep-wine sm:text-lg lg:text-[22px]">
              {product.name}
            </h3>
          </Link>

          {/* Rating */}
          <div className="flex items-center">
            <RatingStars count={product.reviewCount} rating={product.rating} />
          </div>

          {/* Price Row: current price, old price, scent-family pill */}
          <div className="flex flex-wrap items-baseline justify-between gap-1.5 pt-1">
            <div className="flex items-baseline gap-1.5 sm:gap-2">
              <span className="font-sans text-sm font-bold text-espresso sm:text-base lg:text-[19px]">
                {formatCurrency(product.price)}
              </span>
              {hasDiscount && (
                <span className="font-sans text-[11px] text-muted-taupe line-through sm:text-xs">
                  {formatCurrency(product.oldPrice!)}
                </span>
              )}
            </div>
            {product.scentFamily && (
              <span className="rounded-full border border-soft-border/70 bg-soft-cream/80 px-2 py-0.5 font-sans text-[9px] font-medium text-espresso/80 sm:text-[11px]">
                {product.scentFamily}
              </span>
            )}
          </div>
        </div>

        {/* Primary CTA: Add to Cart */}
        <div className="pt-3 sm:pt-4">
          <button
            aria-label={`Add ${product.name} to cart`}
            className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[10px] bg-royal-burgundy font-sans text-xs font-semibold text-white shadow-xs transition hover:bg-deep-wine active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-burgundy focus-visible:ring-offset-2 sm:h-11 sm:gap-2 sm:text-sm lg:h-12"
            onClick={handleAddToCart}
            type="button"
          >
            <ShoppingBag className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
            <span>Add to Cart</span>
          </button>
        </div>
      </div>
    </article>
  )
}
