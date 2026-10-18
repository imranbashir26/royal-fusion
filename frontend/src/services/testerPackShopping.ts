import type { ConfigurablePackSelection } from '../types/index.ts'
import type { PublicTesterPack } from './publicTesterPacksApi.ts'

export type ShoppingPack = Pick<PublicTesterPack, 'id' | 'definitionRevision'> & Partial<PublicTesterPack>
const units = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0 && Number(n) <= 2147483647
export const minimumPackUnits = (pack: ShoppingPack) => Math.max(2, pack.minimumUnits ?? 2)
export const testerCatalogPrice = (option: { effectivePrice?: number; saleActive?: boolean; salePrice?: number | null; regularPrice?: number }) =>
  option.effectivePrice ?? (option.saleActive === true ? option.salePrice : null) ?? option.regularPrice ?? null

/** Usability checks only. Checkout quotes revalidate inventory and all prices on the server. */
export function configurablePackLimit(pack: ShoppingPack, selections: ConfigurablePackSelection[]): number {
  if (!Array.isArray(selections) || !selections.length || selections.length > 100 || !Array.isArray(pack.allowedVariants)) return 0
  const grouped = new Map<string, number>()
  for (const s of selections) {
    if (typeof s?.variantId !== 'string' || !units(s.quantityPerPack)) return 0
    const id = s.variantId.toLowerCase()
    const quantity = (grouped.get(id) ?? 0) + s.quantityPerPack
    if (!units(quantity)) return 0
    grouped.set(id, quantity)
  }
  const total = [...grouped.values()].reduce((sum, n) => sum + n, 0)
  if (!units(total) || total < minimumPackUnits(pack) || (pack.maximumUnits != null && total > pack.maximumUnits)) return 0
  let limit = 99
  for (const [id, quantity] of grouped) {
    const option = pack.allowedVariants.find(v => v.testerVariantId.toLowerCase() === id)
    if (!option || option.active === false || !units(option.stockQuantity)) return 0
    limit = Math.min(limit, Math.floor(option.stockQuantity / quantity))
  }
  return limit
}
