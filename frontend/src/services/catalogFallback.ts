import type { Product } from '../types'
import { normalizeProductType } from './productionMappers.ts'

export function catalogFallback<T>(isProduction: boolean, bundled: T[]): T[] {
  return isProduction ? [] : bundled
}

export function normalizePrototypeProducts(items: Product[] | undefined): Product[] | undefined {
  return items?.map((product) => {
    const concentration = (product as Product & { concentration?: string }).concentration
    const category = normalizeProductType(product.category, concentration)
    return {
      ...product,
      category,
      isAttar: category === 'Attar' || (category === 'Uncategorized' && product.isAttar),
    }
  })
}

export function prototypeCatalogFallback<T>(isProduction: boolean, prototype: T[] | undefined, bundled: T[]): T[] {
  return isProduction ? [] : prototype ?? bundled
}
