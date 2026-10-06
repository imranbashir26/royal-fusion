import type { Product } from '../types'
import { normalizeProductType } from './productionMappers.ts'

export function catalogFallback<T>(isProduction: boolean, bundled: T[]): T[] {
  return isProduction ? [] : bundled
}

export function normalizePrototypeProducts(items: Product[] | undefined): Product[] | undefined {
  return items?.filter(product => ['standard','tester'].includes(Object.hasOwn(product, 'commerceKind') ? product.commerceKind! : Object.hasOwn(product, 'commerce_kind') ? (product as Product & { commerce_kind: string }).commerce_kind : 'standard') && product.price != null && Number.isFinite(Number(product.price)) && Number(product.price)>0).map((product) => {
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
