import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { products } from '../../data/products'
import { buttonClasses } from '../../utils/buttonClasses'
import { AnimatedSection } from '../common/AnimatedSection'
import { SectionHeading } from '../common/SectionHeading'
import { ProductGrid } from '../products/ProductGrid'

export function BestSellersSection() {
  const bestSellers = products.filter((product) => product.isBestSeller).slice(0, 8)

  return (
    <AnimatedSection>
      <div className="container-lux">
        <SectionHeading
          action={
            <Link className={buttonClasses({ variant: 'outline' })} to="/shop?best=true">
              View All
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          }
          align="left"
          description="The Royal Fusion fragrances customers return to most often."
          eyebrow="Best Sellers"
          title="Loved Across Pakistan"
        />
        <ProductGrid products={bestSellers} />
      </div>
    </AnimatedSection>
  )
}
