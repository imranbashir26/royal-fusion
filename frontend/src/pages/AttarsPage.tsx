import { Droplets } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/common/PageHeader'
import { SectionHeading } from '../components/common/SectionHeading'
import { ProductGrid } from '../components/products/ProductGrid'
import { useStorefront } from '../storefront/StorefrontProvider'
import { buttonClasses } from '../utils/buttonClasses'

export function AttarsPage() {
  const { products } = useStorefront()
  const attars = products.filter((product) => product.isAttar)

  return (
    <>
      <PageHeader
        description="Alcohol-free concentrated perfume oils with oud, amber, musk, spice, and elegant traditional depth."
        eyebrow="Attars in Pakistan"
        title="Royal Attar Rituals"
      >
        <Link className={buttonClasses({ className: 'mt-7', variant: 'secondary' })} to="/shop?category=Attars">
          <Droplets className="h-4 w-4" aria-hidden="true" />
          Explore Attars
        </Link>
      </PageHeader>
      <section className="container-lux py-12 md:py-16">
        <SectionHeading
          align="left"
          description="Long-lasting oils for formal wear, prayer, gifting, and refined daily fragrance."
          eyebrow="Alcohol-Free"
          title="Oud, Amber & Musk Oils"
        />
        <ProductGrid products={attars} />
      </section>
      <section className="bg-burgundy py-14 text-ivory">
        <div className="container-lux grid gap-6 md:grid-cols-3">
          {['Apply lightly on pulse points', 'Layer with matching sprays', 'Carry a refined intimate trail'].map(
            (text) => (
              <div className="rounded-lg border border-champagne/25 bg-ivory/8 p-6" key={text}>
                <Droplets className="mb-4 h-7 w-7 text-champagne" aria-hidden="true" />
                <h2 className="font-serif text-3xl font-semibold">{text}</h2>
              </div>
            ),
          )}
        </div>
      </section>
    </>
  )
}
