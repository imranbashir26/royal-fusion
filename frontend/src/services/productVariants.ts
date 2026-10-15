import type { CartItem, Product, ProductVariant } from '../types/index.ts'

export const isVariantId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

export function variantPrice(variant: ProductVariant): number {
  return variant.effectivePrice ?? variant.salePrice ?? variant.regularPrice
}

export function isVariantEligible(variant: ProductVariant | undefined, quantity = 1): variant is ProductVariant {
  return Boolean(variant && !variant.pricingStale && isVariantId(variant.id) && variant.active && variant.available
    && Number.isInteger(quantity) && quantity > 0 && quantity <= 99
    && Number.isInteger(variant.stockQuantity) && variant.stockQuantity >= quantity
    && Number.isFinite(variant.regularPrice) && variant.regularPrice >= 0
    && Number.isFinite(variantPrice(variant)) && variantPrice(variant) >= 0
    && (variant.salePrice === null || variant.salePrice < variant.regularPrice))
}

export function defaultVariant(product: Product): ProductVariant | undefined {
  return [...(product.variants ?? [])]
    .filter((variant) => variant.productId === product.id && isVariantEligible(variant))
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id))[0]
}

export function selectedProductVariant(product: Product | undefined, variantId: string): ProductVariant | undefined {
  return product?.variants?.find((variant) => variant.id === variantId && variant.productId === product.id && isVariantEligible(variant))
    ?? (product ? defaultVariant(product) : undefined)
}

export function normalizeSize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

/** Trusted label diagnostics only; never authorizes a storefront cart migration. */
export function legacyVariant(product: Product, size: string): ProductVariant | undefined {
  // Public RLS hides inactive/unavailable identities; one visible match is not proof.
  if (product.variantIdentityScope !== 'complete') return undefined
  const matches = (product.variants ?? []).filter((variant) =>
    variant.productId === product.id && variant.optionName.toLowerCase() === 'size'
    && isVariantId(variant.id) && normalizeSize(variant.optionValue) === normalizeSize(size))
  return matches.length === 1 ? matches[0] : undefined
}

export function resolveCartItem(item: CartItem, products: Product[]) {
  const product = products.find((candidate) => candidate.id === item.productId)
  const canonical = isVariantId(item.variantId) && item.identity !== 'legacy' && item.identity !== 'corrupt'
  const variant = canonical ? product?.variants?.find((candidate) =>
    candidate.id === item.variantId && candidate.productId === product.id) : undefined
  const eligible = isVariantEligible(variant, item.quantity)
  return {
    ...item, product: product ?? { id: item.productId, name: 'Unavailable product', slug: '', image: '', category: '' },
    variant, size: variant?.optionValue ?? item.size,
    unitPrice: eligible ? variantPrice(variant) : 0,
    lineAmount: eligible ? Math.round(variantPrice(variant) * 100) * item.quantity / 100 : null, eligible,
    message: item.identity === 'legacy'
      ? 'Requires reselection — remove this saved size and re-add the fragrance from its product page.'
      : !canonical ? 'Unavailable — this saved variant identity is invalid. Remove it and re-add the fragrance.'
      : !variant ? 'Unavailable — this variant is not in the current catalog. You can remove this item.'
      : variant.pricingStale ? 'Pricing needs refresh. Your saved item is unchanged.'
      : !eligible ? 'Unavailable or quantity exceeds current stock. Please adjust or remove.' : '',
  }
}

/** The same representative variant drives cards, sorting, and price filters. */
export function productPricing(product: Product, selected?: ProductVariant) {
  const variant = selected?.productId === product.id ? selected : defaultVariant(product)
    ?? [...(product.variants ?? [])].sort((a,b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id))[0]
  const stale = Boolean(variant?.pricingStale)
  const price = stale ? null : variant ? variantPrice(variant) : product.variantIdentityScope === 'public' ? null : product.price
  const regular = variant?.regularPrice ?? price
  const discount = price !== null && regular !== null && regular > price && Boolean(variant && (variant.saleActive ?? variant.salePrice !== null))
  return {price, regular, stale, discount, percent: discount ? Math.round((regular! - price!) / regular! * 100) : 0}
}

export const productDisplayPrice = (product: Product) => productPricing(product).price

export const CHECKOUT_UNAVAILABLE = 'Ordering is temporarily unavailable. Your cart has been saved.'

/** Also block unresolved legacy lines: they cannot safely use the JSON catalog. */
export function canSubmitLegacyCart(items: CartItem[]): boolean {
  return items.length === 0
}
