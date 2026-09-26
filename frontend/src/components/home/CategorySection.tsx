import { motion, useReducedMotion } from 'framer-motion'
import { Link } from 'react-router-dom'
import forHim from '../../assets/categories/category-for-him.webp'
import forHer from '../../assets/categories/category-for-her.webp'
import unisex from '../../assets/categories/category-unisex.webp'
import attars from '../../assets/categories/category-attars.webp'
import giftSets from '../../assets/categories/category-gift-sets.webp'
import bestSellers from '../../assets/categories/category-best-sellers.webp'
import { SectionHeading } from '../common/SectionHeading'

const presentation: Record<string, { image: string; alt: string; label: string; to: string }> = {
  'for-him': {
    image: forHim,
    alt: 'Royal Fusion fragrance styled for him in a warm luxury setting',
    label: 'Shop fragrances for him',
    to: '/shop?gender=Men',
  },
  'for-her': {
    image: forHer,
    alt: 'Royal Fusion Bloom perfume surrounded by pink roses and soft silk',
    label: 'Shop fragrances for her',
    to: '/shop?gender=Women',
  },
  unisex: {
    image: unisex,
    alt: 'Royal Fusion unisex fragrance in an elegant editorial arrangement',
    label: 'Shop unisex fragrances',
    to: '/shop?gender=Unisex',
  },
  attars: {
    image: attars,
    alt: 'Royal Fusion concentrated perfume oils in a traditional attar setting',
    label: 'Shop attars',
    to: '/attars',
  },
  'gift-sets': {
    image: giftSets,
    alt: 'Three Royal Fusion perfumes presented in a burgundy gift box',
    label: 'Shop gift sets',
    to: '/shop?category=Gift%20Sets',
  },
  'best-sellers': {
    image: bestSellers,
    alt: 'A curated display of Royal Fusion signature perfume bottles',
    label: 'Shop best sellers',
    to: '/shop?best=true',
  },
}

// These are homepage shopping paths, not product-type categories.
const shoppingPaths = [
  { slug: 'for-him', name: 'For Him', description: 'Confident woods, oud, spice, and modern aromatic blends.' },
  { slug: 'for-her', name: 'For Her', description: 'Soft florals, luminous musks, and graceful sweet signatures.' },
  { slug: 'unisex', name: 'Unisex', description: 'Balanced luxury fragrances made for every royal mood.' },
  { slug: 'attars', name: 'Attars', description: 'Concentrated fragrance oils with traditional presence.' },
  { slug: 'gift-sets', name: 'Gift Sets', description: 'Explore available gift-ready pairings.' },
  { slug: 'best-sellers', name: 'Best Sellers', description: 'Browse fragrances marked as best sellers.' },
]

export function CategorySection() {
  const reduceMotion = useReducedMotion()

  return (
    <motion.section
      aria-label="Shop by Category"
      className="bg-marble/70 py-12 md:py-18"
      initial={reduceMotion ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: reduceMotion ? 0 : 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="container-lux">
        <SectionHeading
          description="Discover fragrances by style, occasion, and expression."
          eyebrow="Shop by Category"
          title="Find Your Signature"
        />
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {shoppingPaths.map((category) => {
            const card = presentation[category.slug]
            return (
              <Link
                aria-label={card.label}
                className="group relative isolate flex aspect-[16/10] items-end overflow-hidden rounded-2xl bg-espresso text-warm-ivory focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-royal-burgundy"
                key={category.slug}
                to={card.to}
              >
                <img
                  alt={card.alt}
                  className="absolute inset-0 -z-20 h-full w-full object-cover transition-transform duration-300 ease-out motion-safe:group-hover:scale-[1.02] motion-safe:group-focus-visible:scale-[1.02] motion-reduce:transition-none"
                  decoding="async"
                  loading="lazy"
                  src={card.image}
                />
                <div
                  aria-hidden="true"
                  className="absolute inset-0 -z-10 bg-espresso/20 transition-colors duration-300 ease-out group-hover:bg-espresso/75 group-focus-visible:bg-espresso/75 motion-reduce:transition-none"
                />
                <div
                  aria-hidden="true"
                  className="absolute inset-0 -z-10 bg-gradient-to-t from-espresso/60 via-espresso/15 to-transparent"
                />
                <div className="w-full p-5 text-left xl:p-6">
                  <h3 className="font-serif text-[28px] leading-tight font-semibold text-warm-ivory xl:text-[32px]">
                    {category.name}
                  </h3>
                  <p className="mt-2 max-w-[36ch] text-[13px] leading-5 text-warm-ivory/90 xl:text-sm">
                    {category.description}
                  </p>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </motion.section>
  )
}
