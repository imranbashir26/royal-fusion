import type { Product, Category, Collection } from '../types'
import type { StorefrontData } from '../types/admin'
import {
  attachCollectionMembership,
  mapCategory,
  mapCollection,
  mapProduct,
  type SupabaseCategoryRow,
  type SupabaseCollectionRow,
  type SupabaseProductRow,
} from './productionMappers'
import { mapPublicSettingsRows, type PublicSettingsRow } from './publicSettingsMapper'
import { getSupabaseClient } from './supabaseClient'
import { loadPublicVariants } from './storefrontVariants'

export const supabaseStorefrontService = {
  async getProducts(): Promise<Product[] | null> {
    const client = getSupabaseClient()
    if (!client) return null

    const { data, error } = await client
      .from('products')
      .select('*')
      .eq('status', 'Published')
      .eq('active', true)
      .order('created_at', { ascending: false })

    if (error) throw error
    const products = (data as SupabaseProductRow[]).map(mapProduct)
    const variants = await loadPublicVariants(client, products.map((product) => product.id))
    const byProduct = new Map<string, typeof variants>()
    for (const variant of variants) {
      const list = byProduct.get(variant.productId) ?? []
      list.push(variant)
      byProduct.set(variant.productId, list)
    }
    return products.map((product) => ({ ...product, variants: byProduct.get(product.id) ?? [],
      variantIdentityScope: 'public' as const }))
  },

  async getCategories(): Promise<Category[] | null> {
    const client = getSupabaseClient()
    if (!client) return null

    const { data, error } = await client
      .from('categories')
      .select('*')
      .eq('status', 'Published')
      .order('display_order', { ascending: true })

    if (error) throw error
    return (data as SupabaseCategoryRow[]).map(mapCategory)
  },

  async getCollections(): Promise<Collection[] | null> {
    const client = getSupabaseClient()
    if (!client) return null

    const { data, error } = await client
      .from('collections')
      .select('*')
      .eq('active', true)
      .order('display_order', { ascending: true })

    if (error) throw error
    const collections = (data as SupabaseCollectionRow[]).map(mapCollection)
    if (collections.length === 0) return []

    const { data: links, error: membershipError } = await client
      .from('product_collections')
      .select('collection_id,product_id,display_order')
      .in('collection_id', collections.map((collection) => collection.id))
      .order('display_order', { ascending: true })

    if (membershipError) throw membershipError
    return attachCollectionMembership(collections, links as Array<{ collection_id: string; product_id: string }>)
  },

  async getSettings(): Promise<Partial<StorefrontData> | null> {
    const client = getSupabaseClient()
    if (!client) return null

    const { data, error } = await client
      .from('public_site_settings')
      .select('key,value')
      .in('key', ['branding', 'contact', 'commerce', 'settings', 'shipping', 'payments', 'homepage'])
      .eq('active', true)

    if (error) throw error
    return mapPublicSettingsRows(data as PublicSettingsRow[])
  },

  async getStorefrontData(): Promise<Partial<StorefrontData> | null> {
    const client = getSupabaseClient()
    if (!client) return null

    const [products, categories, collections] = await Promise.all([
      this.getProducts(),
      this.getCategories(),
      this.getCollections(),
    ])

    return {
      products: products ?? [],
      categories: categories ?? [],
      collections: collections ?? [],
    }
  },
}
