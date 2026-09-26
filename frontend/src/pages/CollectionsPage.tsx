import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/common/PageHeader'
import { ProductBottle } from '../components/products/ProductBottle'
import { resolveCollectionSlug, selectCollectionProduct } from '../services/productionMappers'
import { useStorefront } from '../storefront/StorefrontProvider'
import { buttonClasses } from '../utils/buttonClasses'
import { formatCurrency } from '../utils/format'

export function CollectionsPage() {
  const { products, collections = [], isLoading } = useStorefront()

  return (
    <>
      <PageHeader
        description="Curated fragrance wardrobes for royal evenings, polished daily wear, oud rituals, and gift moments."
        eyebrow="Collections"
        title="Royal Fusion Edits"
      />
      <section className="container-lux py-12 md:py-16">
        {collections.length === 0 && (
          <p className="rounded-lg border border-champagne/25 bg-ivory p-8 text-center text-brownroyal/70">
            {isLoading ? 'Loading collections...' : 'No collections are available right now.'}
          </p>
        )}
        <div className="grid gap-6">
          {collections.map((collection, index) => {
            const canonicalSlug = resolveCollectionSlug(collection.slug)
            const product = selectCollectionProduct(collection, products)

            const productName = product?.name ?? ''

            return (
              <article
                className="grid items-center gap-8 rounded-lg border border-champagne/25 bg-ivory/86 p-6 shadow-sm md:p-8 lg:grid-cols-[1fr_360px]"
                key={collection.id}
              >
                <div className={index % 2 === 1 ? 'lg:order-2' : undefined}>
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-oldgold">
                    {canonicalSlug.replaceAll('-', ' ')}
                  </p>
                  <h2 className="mt-3 font-serif text-4xl font-semibold text-burgundy md:text-5xl">
                    {collection.name}
                  </h2>
                  <p className="mt-4 max-w-2xl text-lg leading-8 text-brownroyal/72">
                    {collection.description}
                  </p>
                  {collection.heroCopy && (
                    <p className="mt-4 max-w-2xl leading-7 text-brownroyal/64">{collection.heroCopy}</p>
                  )}
                  {product ? (
                    <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                      <Link
                        className={buttonClasses({})}
                        to={`/shop?collection=${encodeURIComponent(canonicalSlug)}`}
                      >
                        Shop Edit
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                      <Link
                        className={buttonClasses({ variant: 'outline' })}
                        to={`/product/${product.slug}`}
                      >
                        View {productName}
                      </Link>
                    </div>
                  ) : (
                    <p className="mt-7 text-sm text-brownroyal/65">No products are assigned to this collection yet.</p>
                  )}
                </div>
                <div className="rounded-lg bg-gradient-to-br from-cream to-marble p-6">
                  {product ? (
                    <>
                      <ProductBottle floating name={productName} tone={product.image} />
                      <div className="mt-4 text-center">
                        <h3 className="font-serif text-3xl font-semibold text-burgundy">{productName}</h3>
                        <p className="font-bold text-brownroyal">{formatCurrency(product.price)}</p>
                      </div>
                    </>
                  ) : (
                    <div className="grid min-h-72 place-items-center text-center text-sm text-brownroyal/55">
                      No product to feature
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </>
  )
}
