import { ArrowRight, Gift } from 'lucide-react'
import { Link } from 'react-router-dom'
import { products } from '../../data/products'
import { buttonClasses } from '../../utils/buttonClasses'
import { AnimatedSection } from '../common/AnimatedSection'
import { ProductBottle } from '../products/ProductBottle'

export function RoyalCollectionSection() {
  const featured = products.find((product) => product.slug === 'royal-spice') ?? products[0]

  return (
    <AnimatedSection className="bg-burgundy text-ivory">
      <div className="container-lux grid items-center gap-10 lg:grid-cols-[1fr_0.9fr]">
        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-champagne">
            The Royal Collection
          </p>
          <h2 className="font-serif text-5xl font-semibold leading-none md:text-6xl">
            Fragrance for a Grand Entrance
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-ivory/74">
            Built around amber warmth, velvet spice, and polished woods, The Royal
            Collection is a storytelling edit for weddings, evenings, and signature
            moments that should feel remembered.
          </p>
          <Link className={buttonClasses({ variant: 'secondary', size: 'lg', className: 'mt-8' })} to="/collections">
            Explore Royal Collection
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </Link>
        </div>
        <div className="relative min-h-80">
          <div className="absolute inset-0 rounded-full bg-champagne/14 blur-3xl" />
          <ProductBottle floating name={featured.name} tone={featured.image} />
        </div>
      </div>
    </AnimatedSection>
  )
}

export function GiftPackagingSection() {
  return (
    <AnimatedSection>
      <div className="container-lux grid items-center gap-10 lg:grid-cols-[0.9fr_1fr]">
        <div className="relative grid min-h-80 place-items-center rounded-lg border border-champagne/30 bg-gradient-to-br from-cream via-ivory to-[#ead0ab] p-8 shadow-xl shadow-brownroyal/10">
          <div className="absolute left-8 top-8 grid h-16 w-16 place-items-center rounded-lg bg-burgundy text-champagne shadow-lg">
            <Gift className="h-8 w-8" aria-hidden="true" />
          </div>
          <div className="h-48 w-64 rounded-lg border border-champagne/55 bg-burgundy p-4 shadow-2xl shadow-brownroyal/24">
            <div className="h-full rounded-lg border border-champagne/65 bg-gradient-to-br from-[#7c1b39] to-[#4c0d22] p-5 text-center text-champagne">
              <p className="font-serif text-4xl font-bold">Royal</p>
              <p className="mt-1 text-xs font-bold uppercase tracking-[0.22em]">Gift Box</p>
              <div className="mx-auto mt-6 h-1 w-28 bg-champagne" />
            </div>
          </div>
        </div>
        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-oldgold">
            Gift Packaging
          </p>
          <h2 className="font-serif text-5xl font-semibold leading-none text-burgundy md:text-6xl">
            Gift Royalty in Every Bottle
          </h2>
          <p className="mt-6 text-lg leading-8 text-brownroyal/74">
            Create a premium gifting moment with elegant boxes, curated perfume sets,
            and a presentation that feels considered before the fragrance is even worn.
          </p>
          <Link className={buttonClasses({ size: 'lg', className: 'mt-8' })} to="/shop?category=Gift Sets">
            Shop Gift Sets
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </AnimatedSection>
  )
}
