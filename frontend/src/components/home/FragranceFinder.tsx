import {
  ArrowRight,
  Candy,
  Droplets,
  Flame,
  Flower2,
  Sparkles,
  TreePine,
} from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { resolveFinderRecommendation } from '../../services/finderRecommendation'
import { useStorefront } from '../../storefront/StorefrontProvider'
import type { FinderPreferenceKey } from '../../types'
import { AnimatedSection } from '../common/AnimatedSection'
import { ProductCard } from '../products/ProductCard'

interface PreferenceConfig {
  id: FinderPreferenceKey
  label: string
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>
  descriptors: string
  copy: string
}

const PREFERENCES: PreferenceConfig[] = [
  {
    id: 'fresh',
    label: 'Fresh',
    icon: Sparkles,
    descriptors: 'Fresh • Aromatic • Refined',
    copy: 'A bright, polished fragrance selected for effortless everyday confidence.',
  },
  {
    id: 'sweet',
    label: 'Sweet',
    icon: Candy,
    descriptors: 'Sweet • Amber • Radiant',
    copy: 'A luxurious, glowing oriental composition with sweet amber warmth and radiant crystalline depth.',
  },
  {
    id: 'woody',
    label: 'Woody',
    icon: TreePine,
    descriptors: 'Woody • Smoky • Intense',
    copy: 'A commanding, dark woods fragrance layered with deep amber and polished evening charisma.',
  },
  {
    id: 'oud',
    label: 'Oud',
    icon: Droplets,
    descriptors: 'Resinous • Smoky • Bold',
    copy: 'A bold, distinguished profile shaped by rich balsamic woods and commanding royal depth.',
  },
  {
    id: 'spicy',
    label: 'Spicy',
    icon: Flame,
    descriptors: 'Warm Spicy • Amber • Sophisticated',
    copy: 'An evocative signature blend balancing vibrant spice with velvety amber warmth and modern presence.',
  },
  {
    id: 'floral',
    label: 'Floral',
    icon: Flower2,
    descriptors: 'Floral • Delicate • Luminous',
    copy: 'An exquisite bouquet of blooming florals elevated by soft citrus brightness and velvet musk.',
  },
]

export function FragranceFinder() {
  const [selected, setSelected] = useState<FinderPreferenceKey>('fresh')
  const reduceMotion = useReducedMotion()
  const { products, finderPreferences } = useStorefront()

  const activePreference = PREFERENCES.find((preference) => preference.id === selected) ?? PREFERENCES[0]
  const configuredPreference = finderPreferences.find((preference) => preference.key === selected)
  const recommendation = resolveFinderRecommendation(selected, finderPreferences, products)

  return (
    <AnimatedSection>
      <div
        id="fragrance-finder"
        aria-labelledby="fragrance-finder-heading"
        className="container-lux"
      >
        <div className="rounded-[18px] border border-soft-border/80 bg-warm-ivory/60 p-6 shadow-[0_4px_24px_rgba(48,35,30,0.04)] sm:rounded-2xl sm:p-9 lg:p-12 xl:p-14">
          <div className="grid items-center gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:gap-12 xl:gap-16">
            {/* Left consultation column (~58-60% desktop) */}
            <div className="flex flex-col">
              {/* Eyebrow & Heading */}
              <div>
                <p className="eyebrow-label mb-2 text-xs font-semibold tracking-[0.24em] text-champagne sm:text-[13px]">
                  FRAGRANCE FINDER
                </p>
                <h2
                  id="fragrance-finder-heading"
                  className="font-serif text-[clamp(2.125rem,3.2vw,3.25rem)] font-semibold leading-[1.1] text-royal-burgundy"
                >
                  Your Scent Concierge
                </h2>
                <p className="mt-3.5 max-w-[34rem] text-base leading-[1.65] text-muted-taupe sm:text-[17px]">
                  Tell us what you&apos;re drawn to today, and we&apos;ll guide you toward a fragrance that fits the mood.
                </p>
              </div>

              {/* Preference Buttons (3 cols x 2 rows on sm+, 2 cols x 3 rows on compact mobile) */}
              <div
                aria-label="Fragrance scent preferences"
                className="mt-7 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3"
                role="group"
              >
                {PREFERENCES.map((pref) => {
                  const Icon = pref.icon
                  const isSelected = selected === pref.id

                  return (
                    <button
                      key={pref.id}
                      aria-pressed={isSelected}
                      className={`inline-flex min-h-11 items-center justify-center gap-2.5 rounded-[10px] border px-4 py-2.5 text-sm font-medium transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-champagne sm:min-h-12 ${
                        isSelected
                          ? 'border-royal-burgundy bg-royal-burgundy text-warm-ivory shadow-xs'
                          : 'border-soft-border/80 bg-white/90 text-espresso hover:border-champagne hover:bg-warm-ivory'
                      }`}
                      onClick={() => setSelected(pref.id)}
                      type="button"
                    >
                      <Icon
                        aria-hidden="true"
                        className={`h-4 w-4 shrink-0 transition-colors ${
                          isSelected ? 'text-champagne' : 'text-espresso/70'
                        }`}
                      />
                      <span>{pref.label}</span>
                    </button>
                  )
                })}
              </div>

              {/* Recommendation Detail Area */}
              <div
                aria-atomic="true"
                aria-live="polite"
                className="mt-8 border-t border-soft-border/70 pt-7"
              >
                <motion.div
                  key={activePreference.id}
                  animate={{ opacity: 1, y: 0 }}
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  transition={{ duration: reduceMotion ? 0 : 0.28, ease: 'easeOut' }}
                >
                  <p className="text-xs font-semibold tracking-[0.22em] text-champagne uppercase">
                    YOUR MATCH
                  </p>
                  <h3 className="mt-1 font-serif text-2xl font-semibold leading-tight text-royal-burgundy sm:text-[28px] lg:text-[32px]">
                    {recommendation?.name ?? 'Recommendation unavailable'}
                  </h3>
                  <p className="mt-1.5 text-xs font-medium tracking-wide text-espresso/75 sm:text-sm">
                    {configuredPreference?.descriptors ?? activePreference.descriptors}
                  </p>
                  <p className="mt-3 max-w-[30rem] text-[15px] leading-[1.65] text-muted-taupe sm:text-base">
                    {recommendation
                      ? configuredPreference?.copy ?? activePreference.copy
                      : 'A fragrance has not been assigned to this preference yet. Please try another scent.'}
                  </p>
                  {recommendation && <div className="mt-5">
                    <Link
                      className="group inline-flex items-center gap-2 text-sm font-semibold text-royal-burgundy underline decoration-champagne/40 underline-offset-4 transition-colors hover:text-deep-wine hover:decoration-champagne focus-visible:rounded-xs focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-champagne"
                      to={`/product/${recommendation.slug}`}
                    >
                      <span>View Fragrance</span>
                      <ArrowRight
                        aria-hidden="true"
                        className="h-4 w-4 transition-transform duration-200 motion-safe:group-hover:translate-x-1"
                      />
                    </Link>
                  </div>}
                </motion.div>
              </div>
            </div>

            {/* Right Recommended ProductCard column (~40-42% desktop) */}
            <div className="flex items-center justify-center lg:justify-end">
              <motion.div
                key={recommendation?.id ?? selected}
                animate={{ opacity: 1 }}
                className="w-full max-w-[340px] sm:max-w-[360px] lg:max-w-[370px]"
                initial={reduceMotion ? false : { opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.25, ease: 'easeOut' }}
              >
                {recommendation ? (
                  <ProductCard product={recommendation} />
                ) : (
                  <p className="rounded-[10px] border border-soft-border/80 bg-white/75 p-8 text-center text-muted-taupe">
                    No fragrance is available for this preference right now.
                  </p>
                )}
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </AnimatedSection>
  )
}
