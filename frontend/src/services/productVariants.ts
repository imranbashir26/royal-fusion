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

export function resolveCartItem(item: CartItem, products: Product[], testerPacks?: any[]) {
  if (item.kind === 'fixed_tester_pack') {
    const pack = testerPacks?.find((candidate: any) => candidate.id === item.packId || candidate.packId === item.packId)
    const validPackId = isVariantId(item.packId)
    const validRevision = typeof item.definitionRevision === 'string' && /^[1-9][0-9]{0,18}$/.test(item.definitionRevision)
    const validQuantity = Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 99

    let eligible = validPackId && validRevision && validQuantity
    let message = ''

    if (!validPackId || !validRevision) {
      eligible = false
      message = 'Unavailable — invalid tester pack identity.'
    } else if (testerPacks) {
      if (!pack) {
        eligible = false
        message = 'Unavailable — this tester pack is not in the current catalog.'
      } else if (pack.definitionRevision && String(pack.definitionRevision) !== String(item.definitionRevision)) {
        eligible = false
        message = 'Pack definition changed. Please remove and re-add.'
      } else if (pack.available === false) {
        eligible = false
        message = 'Tester pack is currently unavailable.'
      } else if (typeof pack.availablePackCount === 'number' && pack.availablePackCount < item.quantity) {
        eligible = false
        message = 'Requested quantity exceeds available pack stock.'
      }
    }

    const price = Number(pack?.salePrice ?? pack?.fixedSalePrice ?? pack?.fixedRegularPrice ?? 0)
    const unitPrice = eligible && price > 0 ? price : 0
    const lineAmount = eligible && unitPrice > 0 ? Math.round(unitPrice * 100) * item.quantity / 100 : null

    return {
      ...item,
      product: {
        id: item.productId,
        name: pack?.name ?? item.name ?? 'Tester Pack',
        slug: pack?.slug ?? '',
        image: pack?.image ?? item.image ?? '',
        category: 'Tester Packs',
      },
      variant: undefined,
      size: item.size ?? 'Tester pack',
      unitPrice,
      lineAmount,
      eligible,
      message,
    }
  }

  if (item.kind === 'configurable_tester_pack') {
    const pack = testerPacks?.find((candidate: any) => candidate.id === item.packId || candidate.packId === item.packId)
    const validPackId = isVariantId(item.packId)
    const validRevision = typeof item.definitionRevision === 'string' && /^[1-9][0-9]{0,18}$/.test(item.definitionRevision)
    const validQuantity = Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 99
    const validSelections = Array.isArray(item.selections) && item.selections.length >= 1 && item.selections.length <= 100
      && item.selections.every((s) => isVariantId(s.variantId) && Number.isInteger(s.quantityPerPack) && s.quantityPerPack >= 1)

    let eligible = validPackId && validRevision && validQuantity && validSelections
    let message = ''

    if (!validPackId || !validRevision || !validSelections) {
      eligible = false
      message = 'Unavailable — invalid custom tester pack selection.'
    } else if (testerPacks) {
      if (!pack) {
        eligible = false
        message = 'Unavailable — this tester pack is not in the current catalog.'
      } else if (pack.definitionRevision && String(pack.definitionRevision) !== String(item.definitionRevision)) {
        eligible = false
        message = 'Pack definition changed. Please reselect your testers.'
      } else if (pack.available === false) {
        eligible = false
        message = 'Tester pack is currently unavailable.'
      } else {
        const totalUnits = item.selections.reduce((sum, s) => sum + s.quantityPerPack, 0)
        if (pack.minimumUnits != null && totalUnits < pack.minimumUnits) {
          eligible = false
          message = `Check the tester quantity in your pack (minimum ${pack.minimumUnits}).`
        } else if (pack.maximumUnits != null && totalUnits > pack.maximumUnits) {
          eligible = false
          message = `Check the tester quantity in your pack (maximum ${pack.maximumUnits}).`
        } else if (Array.isArray(pack.allowedVariants) && pack.allowedVariants.length > 0) {
          for (const s of item.selections) {
            const allowed = pack.allowedVariants.find((v: any) => v.testerVariantId === s.variantId)
            if (!allowed || allowed.active === false || (typeof allowed.stockQuantity === 'number' && allowed.stockQuantity < s.quantityPerPack * item.quantity)) {
              eligible = false
              message = 'One or more selected testers are unavailable or exceed stock.'
              break
            }
          }
        }
      }
    }

    let calculatedUnitPrice = 0
    if (pack?.allowedVariants) {
      for (const s of item.selections) {
        const allowed = pack.allowedVariants.find((v: any) => v.testerVariantId === s.variantId)
        const vPrice = Number(allowed?.salePrice ?? allowed?.effectivePrice ?? allowed?.regularPrice ?? 0)
        calculatedUnitPrice += vPrice * s.quantityPerPack
      }
    }
    const unitPrice = eligible && calculatedUnitPrice > 0 ? calculatedUnitPrice : 0
    const lineAmount = eligible && unitPrice > 0 ? Math.round(unitPrice * 100) * item.quantity / 100 : null

    return {
      ...item,
      product: {
        id: item.productId,
        name: pack?.name ?? item.name ?? 'Custom Tester Pack',
        slug: pack?.slug ?? '',
        image: pack?.image ?? item.image ?? '',
        category: 'Tester Packs',
      },
      variant: undefined,
      size: item.size ?? 'Custom tester pack',
      unitPrice,
      lineAmount,
      eligible,
      message,
    }
  }

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
