import { Heart, ShoppingBag, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../components/common/Button'
import { EmptyState } from '../components/common/EmptyState'
import { PageHeader } from '../components/common/PageHeader'
import { RatingStars } from '../components/common/RatingStars'
import { ProductBottle } from '../components/products/ProductBottle'
import { useCartStore } from '../store/cartStore'
import { useWishlistStore } from '../store/wishlistStore'
import { useStorefront } from '../storefront/StorefrontProvider'
import { buttonClasses } from '../utils/buttonClasses'
import { formatCurrency } from '../utils/format'

export function WishlistPage() {
  const { products } = useStorefront()
  const productIds = useWishlistStore((state) => state.productIds)
  const remove = useWishlistStore((state) => state.remove)
  const addItem = useCartStore((state) => state.addItem)
  const wishlistProducts = products.filter((product) => productIds.includes(product.id))

  if (wishlistProducts.length === 0) {
    return (
      <>
        <PageHeader
          description="Save your favorite perfumes and move them to cart whenever the moment feels right."
          eyebrow="Wishlist"
          title="Saved Fragrances"
        />
        <section className="container-lux py-12">
          <EmptyState
            actionLabel="Browse Perfumes"
            actionTo="/shop"
            description="Tap the heart on any product to build your Royal Fusion wishlist."
            title="No saved fragrances"
          />
        </section>
      </>
    )
  }

  return (
    <>
      <PageHeader
        description="Your saved Royal Fusion perfumes, attars, and gift ideas."
        eyebrow="Wishlist"
        title="Saved Fragrances"
      />
      <section className="container-lux grid gap-5 py-12 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {wishlistProducts.map((product) => (
          <article className="rounded-lg border border-champagne/25 bg-ivory/88 shadow-sm" key={product.id}>
            <Link className="block bg-gradient-to-br from-cream to-marble p-5" to={`/product/${product.slug}`}>
              <ProductBottle compact name={product.name} tone={product.image} />
            </Link>
            <div className="p-5">
              <h2 className="font-serif text-3xl font-semibold text-burgundy">{product.name}</h2>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-brownroyal/68">
                {product.shortDescription}
              </p>
              <div className="mt-3">
                <RatingStars count={product.reviewCount} rating={product.rating} />
              </div>
              <p className="mt-3 text-lg font-extrabold text-brownroyal">{formatCurrency(product.price)}</p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <Button onClick={() => addItem(product, product.sizeOptions[0]?.value)} variant="outline">
                  <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                  Move
                </Button>
                <button
                  className={buttonClasses({ variant: 'ghost' })}
                  onClick={() => remove(product.id)}
                  type="button"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Remove
                </button>
              </div>
            </div>
          </article>
        ))}
      </section>
      <div className="sr-only">
        <Heart aria-hidden="true" />
      </div>
    </>
  )
}
