import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/common/PageHeader'
import { ProductBottle } from '../components/products/ProductBottle'
import { collections } from '../data/collections'
import { useStorefront } from '../storefront/StorefrontProvider'
import { buttonClasses } from '../utils/buttonClasses'
import { formatCurrency } from '../utils/format'

export function CollectionsPage() {
  const { products } = useStorefront()

  return (
    <>
      <PageHeader
        description="Curated fragrance wardrobes for royal evenings, polished daily wear, oud rituals, and gift moments."
        eyebrow="Collections"
        title="Royal Fusion Edits"
      />
      <section className="container-lux py-12 md:py-16">
        <div className="grid gap-6">
          {collections.map((collection, index) => {
            const product =
              products.find((item) => item.slug === collection.featuredProductSlug) ?? products[0]
            return (
              <article
                className="grid items-center gap-8 rounded-lg border border-champagne/25 bg-ivory/86 p-6 shadow-sm md:p-8 lg:grid-cols-[1fr_360px]"
                key={collection.id}
              >
                <div className={index % 2 === 1 ? 'lg:order-2' : undefined}>
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-oldgold">
                    {collection.slug.replaceAll('-', ' ')}
                  </p>
                  <h2 className="mt-3 font-serif text-4xl font-semibold text-burgundy md:text-5xl">
                    {collection.name}
                  </h2>
                  <p className="mt-4 max-w-2xl text-lg leading-8 text-brownroyal/72">
                    {collection.description}
                  </p>
                  <p className="mt-4 max-w-2xl leading-7 text-brownroyal/64">{collection.heroCopy}</p>
                  <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                    <Link
                      className={buttonClasses({})}
                      to={`/shop?category=${product.category}`}
                    >
                      Shop Edit
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                    <Link
                      className={buttonClasses({ variant: 'outline' })}
                      to={`/product/${product.slug}`}
                    >
                      View {product.name}
                    </Link>
                  </div>
                </div>
                <div className="rounded-lg bg-gradient-to-br from-cream to-marble p-6">
                  <ProductBottle floating name={product.name} tone={product.image} />
                  <div className="mt-4 text-center">
                    <h3 className="font-serif text-3xl font-semibold text-burgundy">{product.name}</h3>
                    <p className="font-bold text-brownroyal">{formatCurrency(product.price)}</p>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </>
  )
}
