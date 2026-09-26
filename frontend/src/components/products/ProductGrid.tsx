import type { Product } from '../../types'
import { cn } from '../../utils/cn'
import { ProductCard } from './ProductCard'

interface ProductGridProps {
  products: Product[]
  className?: string
}

export function ProductGrid({ products, className }: ProductGridProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-3.5 sm:gap-5 lg:grid-cols-4', className)}>
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  )
}
