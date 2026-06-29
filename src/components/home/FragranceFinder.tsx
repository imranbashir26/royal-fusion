import { Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { products } from '../../data/products'
import type { ScentFamily } from '../../types'
import { AnimatedSection } from '../common/AnimatedSection'
import { Button } from '../common/Button'
import { SectionHeading } from '../common/SectionHeading'
import { ProductCard } from '../products/ProductCard'

const quizOptions: ScentFamily[] = ['Fresh', 'Sweet', 'Woody', 'Oud', 'Spicy', 'Floral']

const scentFallback: Record<ScentFamily, string> = {
  Fresh: 'icon',
  Sweet: 'crimson-crystal',
  Woody: 'pitch-black',
  Oud: 'oud-ul-abyaz',
  Spicy: 'royal-spice',
  Floral: 'bloom',
  Oriental: 'royal-spice',
  Citrus: 'icon',
}

export function FragranceFinder() {
  const [selected, setSelected] = useState<ScentFamily>('Fresh')

  const recommendation = useMemo(() => {
    return (
      products.find((product) => product.scentFamily === selected) ??
      products.find((product) => product.slug === scentFallback[selected]) ??
      products[0]
    )
  }, [selected])

  return (
    <AnimatedSection>
      <div className="container-lux">
        <div className="marble-panel grid gap-8 rounded-lg p-6 md:p-8 lg:grid-cols-[1fr_360px] lg:items-center">
          <div>
            <SectionHeading
              align="left"
              className="mb-7"
              description="Select the mood you want to wear today and receive a boutique-style recommendation."
              eyebrow="Fragrance Finder"
              title="Your Scent Concierge"
            />
            <div className="flex flex-wrap gap-3">
              {quizOptions.map((option) => (
                <Button
                  key={option}
                  onClick={() => setSelected(option)}
                  variant={selected === option ? 'primary' : 'outline'}
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  {option}
                </Button>
              ))}
            </div>
            <div className="mt-7 rounded-lg border border-champagne/30 bg-ivory/70 p-5">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-oldgold">
                Mock Recommendation
              </p>
              <h3 className="mt-2 font-serif text-3xl font-semibold text-burgundy">
                {recommendation.name}
              </h3>
              <p className="mt-2 leading-7 text-brownroyal/72">{recommendation.shortDescription}</p>
            </div>
          </div>
          <ProductCard compact product={recommendation} />
        </div>
      </div>
    </AnimatedSection>
  )
}
