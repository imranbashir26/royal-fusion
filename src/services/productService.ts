import { products } from '../data/products'
import type { Product } from '../types'
import { apiClient } from './apiClient'

export const productService = {
  getProducts: () => apiClient.get<Product[]>(products),
  getBestSellers: () => apiClient.get<Product[]>(products.filter((product) => product.isBestSeller)),
  getFeatured: () => apiClient.get<Product[]>(products.filter((product) => product.isFeatured)),
  getAttars: () => apiClient.get<Product[]>(products.filter((product) => product.isAttar)),
  getBySlug: (slug: string) =>
    apiClient.get<Product | undefined>(products.find((product) => product.slug === slug)),
  search: (query: string) =>
    apiClient.get<Product[]>(
      products.filter((product) => {
        const haystack = [
          product.name,
          product.category,
          product.collection,
          product.scentFamily,
          product.shortDescription,
          product.gender,
        ]
          .join(' ')
          .toLowerCase()

        return haystack.includes(query.toLowerCase())
      }),
    ),
}
