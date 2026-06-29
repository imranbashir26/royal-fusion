import { Award, Crown, Droplets, Gem, Gift, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { categories } from '../../data/categories'
import { AnimatedSection } from '../common/AnimatedSection'
import { SectionHeading } from '../common/SectionHeading'

const iconMap = {
  Crown,
  Gem,
  Sparkles,
  Droplets,
  Gift,
  Award,
}

export function CategorySection() {
  return (
    <AnimatedSection className="bg-marble/70">
      <div className="container-lux">
        <SectionHeading
          description="Shop by lifestyle, gender preference, concentration, or gift occasion."
          eyebrow="Shop by Category"
          title="Boutique Navigation"
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => {
            const Icon = iconMap[category.icon as keyof typeof iconMap] ?? Sparkles
            return (
              <Link
                className="group rounded-lg border border-champagne/25 bg-ivory/90 p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-champagne/55 hover:shadow-xl hover:shadow-brownroyal/10"
                key={category.id}
                to={category.slug === 'attars' ? '/attars' : `/shop?category=${category.name}`}
              >
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-champagne/18 text-oldgold transition group-hover:bg-burgundy group-hover:text-ivory">
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </div>
                <h3 className="font-serif text-3xl font-semibold text-burgundy">{category.name}</h3>
                <p className="mt-2 text-sm leading-6 text-brownroyal/68">{category.description}</p>
              </Link>
            )
          })}
        </div>
      </div>
    </AnimatedSection>
  )
}
