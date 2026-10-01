import type { StorefrontData } from '../types/admin.ts'

export type CatalogLoad = { status: 'success' } | { status: 'failed'; error: string }
export type StorefrontLoad = StorefrontData & { catalogLoad: CatalogLoad }

/** Content fallbacks are independent of whether the canonical catalog loaded. */
export function applyCatalogRefresh(previous: StorefrontData, next: StorefrontLoad): StorefrontData {
  if (next.catalogLoad.status === 'failed') return { ...next, products: previous.products }
  return next
}
