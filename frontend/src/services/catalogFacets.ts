import type { Product } from '../types'

export function catalogRouteCategory(value: string | null): string {
  if (value === 'Attars') return 'Attar'
  if (value === 'Gift Sets') return 'Gift Set'
  return value ?? 'All'
}

export function matchesCatalogFacets(product: Product, options: {
  category: string
  gender: string
  bestOnly: boolean
  newOnly: boolean
  attarsOnly: boolean
}): boolean {
  return (options.category === 'All' || product.category === options.category)
    && (options.gender === 'All' || product.gender === options.gender)
    && (!options.bestOnly || product.isBestSeller)
    && (!options.newOnly || product.isNewArrival === true)
    && (!options.attarsOnly || product.isAttar)
}

export function compareNewArrivals(a: Product, b: Product): number {
  return Number(b.isNewArrival === true) - Number(a.isNewArrival === true) || b.id.localeCompare(a.id)
}
