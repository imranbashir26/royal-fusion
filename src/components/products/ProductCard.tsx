import { motion } from 'framer-motion'
import { Eye, Heart, ShoppingBag, Zap } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../common/Button'
import { RatingStars } from '../common/RatingStars'
import { useCartStore } from '../../store/cartStore'
import { useWishlistStore } from '../../store/wishlistStore'
import type { Product } from '../../types'
import { buttonClasses } from '../../utils/buttonClasses'
import { cn } from '../../utils/cn'
import { formatCurrency } from '../../utils/format'
import { ProductBottle } from './ProductBottle'

interface ProductCardProps {
  product: Product
  compact?: boolean
}

export function ProductCard({ product, compact = false }: ProductCardProps) {
  const navigate = useNavigate()
  const addItem = useCartStore((state) => state.addItem)
  const toggleWishlist = useWishlistStore((state) => state.toggle)
  const isWishlisted = useWishlistStore((state) => state.has(product.id))

  const handleBuyNow = () => {
    addItem(product, product.sizeOptions[0]?.value)
    navigate('/checkout')
  }

  return (
    <motion.article
      className="group relative overflow-hidden rounded-lg border border-champagne/25 bg-ivory/86 shadow-sm transition duration-300 hover:border-champagne/55 hover:shadow-2xl hover:shadow-brownroyal/12"
      whileHover={{ y: -8 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
    >
      <div className="absolute left-3 top-3 z-10 rounded-full bg-burgundy px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-ivory">
        {product.badge}
      </div>
      <button
        aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
        className={cn(
          'absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full border border-champagne/40 bg-ivory/90 text-brownroyal shadow-sm transition hover:border-oldgold hover:text-burgundy',
          isWishlisted && 'border-burgundy bg-burgundy text-ivory hover:text-ivory',
        )}
        onClick={() => toggleWishlist(product.id)}
        type="button"
      >
        <Heart className={cn('h-5 w-5', isWishlisted && 'fill-current')} aria-hidden="true" />
      </button>

      <Link
        aria-label={`View ${product.name}`}
        className="relative block bg-gradient-to-br from-cream via-ivory to-[#f0ddc5] px-5 pb-2 pt-12"
        to={`/product/${product.slug}`}
      >
        <ProductBottle compact={compact} name={product.name} tone={product.image} />
        <div className="absolute inset-x-4 bottom-4 flex translate-y-3 items-center justify-center opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <span className="inline-flex items-center gap-2 rounded-full bg-brownroyal/90 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-ivory backdrop-blur">
            <Eye className="h-4 w-4" aria-hidden="true" />
            Quick View
          </span>
        </div>
      </Link>

      <div className="space-y-4 p-5">
        <div>
          <Link to={`/product/${product.slug}`}>
            <h3 className="font-serif text-2xl font-semibold text-burgundy transition hover:text-velvet">
              {product.name}
            </h3>
          </Link>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-brownroyal/70">
            {product.shortDescription}
          </p>
        </div>

        <RatingStars count={product.reviewCount} rating={product.rating} />

        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-lg font-extrabold text-brownroyal">
              {formatCurrency(product.price)}
            </p>
            {product.oldPrice && (
              <p className="text-sm text-brownroyal/45 line-through">
                {formatCurrency(product.oldPrice)}
              </p>
            )}
          </div>
          <span className="rounded-full bg-champagne/18 px-3 py-1 text-xs font-bold text-oldgold">
            {product.scentFamily}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            className="px-3"
            onClick={() => addItem(product, product.sizeOptions[0]?.value)}
            variant="outline"
          >
            <ShoppingBag className="h-4 w-4" aria-hidden="true" />
            Cart
          </Button>
          <button className={buttonClasses({ variant: 'primary', className: 'px-3' })} onClick={handleBuyNow} type="button">
            <Zap className="h-4 w-4" aria-hidden="true" />
            Buy
          </button>
        </div>
      </div>
    </motion.article>
  )
}
