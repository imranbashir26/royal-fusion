import type { Collection, Product } from '../types'
import { collectionNamesForProduct } from './productionMappers.ts'

export function productMatchesSearch(product: Product, collections: Collection[], normalizedQuery: string): boolean {
  return [
    product.name,
    product.scentFamily,
    product.category,
    product.gender,
    ...collectionNamesForProduct(collections, product.id),
  ]
    .join(' ')
    .toLowerCase()
    .includes(normalizedQuery)
}
