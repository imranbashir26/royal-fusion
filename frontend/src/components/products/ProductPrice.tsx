import type {Product, ProductVariant} from '../../types'
import {productPricing} from '../../services/productVariants'
import {formatCheckoutCurrency as formatCurrency} from '../../utils/checkoutMoney'

export function ProductPrice({product, variant}: {product: Product; variant?: ProductVariant}) {
  const pricing = productPricing(product, variant)
  if (pricing.price === null) return <span role="status">{pricing.stale ? 'Pricing needs refresh' : 'Price unavailable'}</span>
  return <span className="inline-flex flex-wrap items-baseline gap-2">
    <span>{formatCurrency(pricing.price)}</span>
    {pricing.discount && <><del className="text-sm font-normal text-muted-taupe">{formatCurrency(pricing.regular!)}</del><span className="text-xs font-semibold">{pricing.percent}% off</span></>}
  </span>
}
