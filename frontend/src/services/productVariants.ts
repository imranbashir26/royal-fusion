import { configurablePackLimit, testerCatalogPrice, type ShoppingPack } from './testerPackShopping.ts'
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

export function resolveCartItem(item: CartItem, products: Product[], testerPacks?: ShoppingPack[]) {
  if (item.kind === 'fixed_tester_pack' || item.kind === 'configurable_tester_pack') {
    const pack = testerPacks?.find(candidate => candidate.id.toLowerCase() === item.packId.toLowerCase())
    const validIdentity = isVariantId(item.packId) && typeof item.definitionRevision === 'string'
      && /^[1-9][0-9]{0,18}$/.test(item.definitionRevision) && BigInt(item.definitionRevision) <= 9223372036854775807n
    const validQuantity = Number.isSafeInteger(item.quantity) && item.quantity > 0 && item.quantity <= 99
    const validSelections = item.kind !== 'configurable_tester_pack' || Array.isArray(item.selections)
      && item.selections.every(s => isVariantId(s.variantId))
    let message = ''
    let maxQuantity = 0
    if (!validIdentity || !validSelections) message = 'Unavailable — invalid tester pack identity or selection.'
    else if (!testerPacks) message = 'Refresh the discovery catalog to check this saved pack.'
    else if (!pack) message = 'Unavailable — this tester pack is not in the current catalog.'
    else if (pack.definitionRevision !== item.definitionRevision) message = 'Pack definition changed. Please remove and re-add your pack.'
    else if (pack.mode !== (item.kind === 'fixed_tester_pack' ? 'fixed' : 'configurable')) message = 'Pack definition changed. Please reselect your pack.'
    else if (pack.available !== true || pack.active === false || (pack.status !== undefined && pack.status !== 'Published')) message = 'Tester pack is currently unavailable.'
    else {
      maxQuantity = item.kind === 'fixed_tester_pack'
        ? Math.max(0, Math.min(99, pack.availablePackCount ?? 0))
        : configurablePackLimit(pack, item.selections)
      if (!maxQuantity) message = 'Check the tester quantity in your pack. One or more selected testers are unavailable or exceed stock or pack limits.'
      else if (!validQuantity || item.quantity > maxQuantity) message = 'Requested quantity exceeds available pack stock. Please reduce the quantity.'
    }
    const eligible = !message && validQuantity
    let estimate: number | null = null
    if (pack && item.kind === 'fixed_tester_pack') {
      estimate = testerCatalogPrice({ ...pack, regularPrice: pack.fixedRegularPrice ?? pack.regularPrice ?? undefined })
    } else if (pack && item.kind === 'configurable_tester_pack') {
      let cents = 0
      for (const selection of item.selections) {
        const option = pack.allowedVariants?.find(v => v.testerVariantId.toLowerCase() === selection.variantId.toLowerCase())
        const price = option ? testerCatalogPrice(option) : null
        if (price === null || !Number.isFinite(price)) { cents = NaN; break }
        cents += Math.round(price * 100) * selection.quantityPerPack
      }
      estimate = Number.isFinite(cents) ? cents / 100 : null
    }
    const unitPrice = eligible && estimate !== null && estimate >= 0 ? estimate : 0
    return {
      ...item,
      product: { id: item.productId, name: pack?.name ?? item.name ?? 'Tester Pack', slug: pack?.slug ?? '', image: pack?.image ?? item.image ?? '', category: 'Tester Packs' },
      variant: undefined,
      size: item.size,
      unitPrice,
      lineAmount: eligible && estimate !== null ? Math.round(unitPrice * 100) * item.quantity / 100 : null,
      eligible, message, maxQuantity,
    }
  }

  const product = products.find((candidate) => candidate.id === item.productId)
  const canonical = isVariantId(item.variantId) && item.identity !== 'legacy' && item.identity !== 'corrupt'
  const variant = canonical ? product?.variants?.find((candidate) =>
    candidate.id === item.variantId && candidate.productId === product.id) : undefined
  const eligible = isVariantEligible(variant, item.quantity)
  return {
    ...item, product: product ?? { id: item.productId, name: 'Unavailable product', slug: '', image: '', category: '' },
    variant, size: variant?.optionValue ?? item.size, maxQuantity: variant ? Math.min(99, variant.stockQuantity) : 0,
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
