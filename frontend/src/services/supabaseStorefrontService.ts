import type { Product, Category, Review } from '../types'
import type { StorefrontData } from '../types/admin'
import {
  mapCategory,
  mapProduct,
  mapReview,
  mapTestimonial,
  type SupabaseCategoryRow,
  type SupabaseProductRow,
  type SupabaseReviewRow,
  type SupabaseSettingsRow,
} from './productionMappers'
import { getSupabaseClient } from './supabaseClient'

export const supabaseStorefrontService = {
  async getProducts(): Promise<Product[] | null> {
    const client = getSupabaseClient()
    if (!client) return null

    const { data, error } = await client
      .from('products')
      .select('*')
      .eq('status', 'Published')
      .order('created_at', { ascending: false })

    if (error) throw error
    return (data as SupabaseProductRow[]).map(mapProduct)
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

  async getReviews(): Promise<Review[] | null> {
    const client = getSupabaseClient()
    if (!client) return null

    const { data, error } = await client
      .from('reviews')
      .select('*')
      .eq('status', 'Approved')
      .order('created_at', { ascending: false })

    if (error) throw error
    return (data as SupabaseReviewRow[]).map(mapReview)
  },

  async getSettings(): Promise<Partial<StorefrontData> | null> {
    const client = getSupabaseClient()
    if (!client) return null

    const { data, error } = await client
      .from('site_settings')
      .select('*')
      .eq('id', 'site')
      .maybeSingle()

    if (error) throw error
    const settings = data as SupabaseSettingsRow | null
    if (!settings) return null

    return {
      settings: settings.settings as StorefrontData['settings'],
      homepage: settings.homepage ?? {},
      shipping: settings.shipping ?? {},
      payments: settings.payments ?? [],
      seo: settings.seo ?? [],
    }
  },

  async getStorefrontData(): Promise<Partial<StorefrontData> | null> {
    const client = getSupabaseClient()
    if (!client) return null

    const [products, categories, reviews, settings] = await Promise.all([
      this.getProducts(),
      this.getCategories(),
      this.getReviews(),
      this.getSettings(),
    ])

    return {
      products: products ?? [],
      categories: categories ?? [],
      reviews: reviews ?? [],
      testimonials: (reviews ?? []).map(mapTestimonial),
      ...(settings ?? {}),
    }
  },
}
