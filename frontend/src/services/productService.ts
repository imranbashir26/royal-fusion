import { products } from '../data/products'
import type { Product } from '../types'
import { apiClient } from './apiClient'
import { supabaseStorefrontService } from './supabaseStorefrontService'

async function getProductionProducts() {
  try {
    return await supabaseStorefrontService.getProducts()
  } catch (error) {
    console.warn('Supabase products unavailable. Falling back to local products.', error)
    return null
  }
}

export const productService = {
  async getProducts() {
    return await getProductionProducts() ?? apiClient.get<Product[]>(products)
  },
  async getBestSellers() {
    const items = await this.getProducts()
    return items.filter((product) => product.isBestSeller)
  },
  async getFeatured() {
    const items = await this.getProducts()
    return items.filter((product) => product.isFeatured)
  },
  async getAttars() {
    const items = await this.getProducts()
    return items.filter((product) => product.isAttar)
  },
  async getBySlug(slug: string) {
    const items = await this.getProducts()
    return items.find((product) => product.slug === slug)
  },
  async search(query: string) {
    const items = await this.getProducts()
    return items.filter((product) => {
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
      })
  },
}
