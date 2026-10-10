import type { Product, Category, Collection } from '../types'
import type { StorefrontData } from '../types/admin'
import {
  attachCollectionMembership,
  mapCategory,
  mapCollection,
  mapProduct,
  type SupabaseCategoryRow,
  type SupabaseCollectionRow,
} from './productionMappers'
import { mapPublicSettingsRows, type PublicSettingsRow } from './publicSettingsMapper'
import { getSupabaseClient } from './supabaseClient'
import { loadNormalProductRows } from './normalCatalog'
import { loadPublicVariants } from './storefrontVariants'
import { mapPublicSeoRows, staticSeoPaths } from './storefrontSeo'

export const supabaseStorefrontService = {
  async getSeo() {
    const client = getSupabaseClient()
    if (!client) return []
    const { data, error } = await client.from('seo_settings')
      .select('route_path,title,description,canonical_url,robots,og_title,og_description,og_image_secure_url,active')
      .eq('active', true).in('route_path', staticSeoPaths).order('route_path', { ascending: true }).range(0, 19)
    if (error) throw new Error('Public metadata unavailable.')
    return mapPublicSeoRows(data ?? [])
  },
  async getProducts(): Promise<Product[] | null> {
    const client = getSupabaseClient()
    if (!client) return null

    const products = (await loadNormalProductRows(client)).map(mapProduct)
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
