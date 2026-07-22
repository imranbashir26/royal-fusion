import type { BlogPost, Category, Product, Review } from '../types'
import type { Banner, StorefrontData, Testimonial, WebsiteSettings } from '../types/admin'

type JsonRecord = Record<string, unknown>

export interface SupabaseProductRow {
  id: string
  name: string
  slug: string
  sku?: string
  category_name?: string
  collection?: string
  gender?: Product['gender']
  price: number
  sale_price?: number | null
  old_price?: number | null
  main_image_url: string
  gallery_urls?: string[] | null
  badge?: string
  description?: string
  short_description?: string
  top_notes?: string[] | null
  middle_notes?: string[] | null
  base_notes?: string[] | null
  scent_family?: Product['scentFamily'] | string
  longevity?: string
  sillage?: string
  occasion?: string[] | null
  size_options?: Product['sizeOptions'] | null
  stock_quantity?: number
  is_best_seller?: boolean
  is_featured?: boolean
  is_attar?: boolean
}

export interface SupabaseCategoryRow {
  id: string
  name: string
  slug: string
  description?: string
  image_url?: string
}

export interface SupabaseReviewRow {
  id: string
  name: string
  city?: string
  rating: number
  product?: string
  text: string
}

export interface SupabaseSettingsRow {
  settings?: Partial<WebsiteSettings>
  shipping?: JsonRecord
  payments?: Array<Record<string, unknown>>
  homepage?: JsonRecord
  seo?: Array<Record<string, unknown>>
}

export function mapProduct(row: SupabaseProductRow): Product {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category_name || 'Best Sellers',
    collection: row.collection || 'Royal Fusion',
    gender: row.gender || 'Unisex',
    price: Number(row.sale_price || row.price),
    oldPrice: Number(row.old_price || row.price),
    rating: 4.8,
    reviewCount: 0,
    image: row.main_image_url,
    gallery: row.gallery_urls?.length ? row.gallery_urls : [row.main_image_url],
    badge: row.badge || 'Featured',
    description: row.description || '',
    shortDescription: row.short_description || '',
    notes: {
      top: row.top_notes ?? [],
      middle: row.middle_notes ?? [],
      base: row.base_notes ?? [],
    },
    scentFamily: normalizeScentFamily(row.scent_family),
    longevity: row.longevity || '',
    sillage: row.sillage || '',
    occasion: row.occasion ?? [],
    sizeOptions: row.size_options?.length
      ? row.size_options
      : [{ label: '50ml', value: '50ml', price: Number(row.price) }],
    stock: Number(row.stock_quantity ?? 0),
    isBestSeller: Boolean(row.is_best_seller),
    isFeatured: Boolean(row.is_featured),
    isAttar: Boolean(row.is_attar),
  }
}

export function mapCategory(row: SupabaseCategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description || '',
    icon: row.image_url || 'Crown',
  }
}

export function mapReview(row: SupabaseReviewRow): Review {
  return {
    id: row.id,
    name: row.name,
    city: row.city || '',
    rating: Number(row.rating),
    product: row.product || '',
    text: row.text,
  }
}

export function mapTestimonial(row: SupabaseReviewRow): Testimonial {
  return {
    ...mapReview(row),
    featured: true,
    status: 'Approved',
  }
}

export function mergeStorefrontData(
  fallback: StorefrontData,
  data: Partial<StorefrontData>,
): StorefrontData {
  return {
    ...fallback,
    ...data,
    settings: {
      ...fallback.settings,
      ...(data.settings ?? {}),
    },
    homepage: {
      ...fallback.homepage,
      ...(data.homepage ?? {}),
    },
    shipping: {
      ...fallback.shipping,
      ...(data.shipping ?? {}),
    },
    payments: data.payments?.length ? data.payments : fallback.payments,
    seo: data.seo?.length ? data.seo : fallback.seo,
  }
}

export function mapSanityBlog(document: Record<string, unknown>): BlogPost {
  return {
    id: String(document._id ?? document.id ?? ''),
    slug: String(document.slug ?? ''),
    title: String(document.title ?? ''),
    excerpt: String(document.excerpt ?? ''),
    content: Array.isArray(document.content)
      ? document.content.map(String)
      : Array.isArray(document.body)
        ? document.body.map((block) => blockToPlainText(block)).filter(Boolean)
        : [],
    category: String(document.category ?? ''),
    readTime: String(document.readTime ?? '4 min read'),
    publishedAt: String(document.publishedAt ?? ''),
    image: String(document.image ?? ''),
  }
}

export function mapSanityBanner(document: Record<string, unknown>): Banner {
  return {
    id: String(document._id ?? document.id ?? ''),
    title: String(document.title ?? ''),
    subtitle: String(document.subtitle ?? ''),
    image: String(document.image ?? ''),
    ctaText: String(document.ctaText ?? ''),
    ctaLink: String(document.ctaLink ?? ''),
    position: String(document.position ?? ''),
    enabled: true,
    startDate: String(document.startDate ?? ''),
    endDate: String(document.endDate ?? ''),
  }
}

function normalizeScentFamily(value: unknown): Product['scentFamily'] {
  const allowed: Product['scentFamily'][] = ['Oriental', 'Floral', 'Citrus', 'Woody', 'Oud', 'Fresh', 'Spicy', 'Sweet']
  return allowed.includes(value as Product['scentFamily']) ? value as Product['scentFamily'] : 'Fresh'
}

function blockToPlainText(block: unknown) {
  if (!block || typeof block !== 'object') return ''
  const children = (block as { children?: Array<{ text?: string }> }).children
  return Array.isArray(children) ? children.map((child) => child.text ?? '').join('') : ''
}
