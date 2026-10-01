import type { BlogPost, Category, Collection, Product, ProductVariant, Review } from '../types'
import type { Banner, StorefrontData, Testimonial } from '../types/admin'

export interface SupabaseProductRow {
  id: string
  name: string
  slug: string
  sku?: string
  category_name?: string
  concentration?: string
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
  is_new_arrival?: boolean
  is_premium?: boolean
  card_image_url?: string
  card_hover_image_url?: string
  card_background_color?: string
}

export interface SupabaseVariantRow {
  id: string
  product_id: string
  option_name: string
  option_value: string
  sku: string
  regular_price: number | string
  sale_price: number | string | null
  stock_quantity: number
  active: boolean
  available: boolean
  display_order: number
}

export function mapProductVariant(row: SupabaseVariantRow): ProductVariant {
  return {
    id: row.id, productId: row.product_id, optionName: row.option_name,
    optionValue: row.option_value, sku: row.sku, regularPrice: Number(row.regular_price),
    salePrice: row.sale_price === null ? null : Number(row.sale_price),
    stockQuantity: Number(row.stock_quantity), active: row.active, available: row.available,
    displayOrder: Number(row.display_order),
  }
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

export interface SupabaseCollectionRow {
  id: string
  name: string
  slug: string
  description?: string
  active?: boolean
  display_order?: number
  featured?: boolean
  banner_cloudinary_public_id?: string
  banner_secure_url?: string
  banner_alt_text?: string
  seo_title?: string
  seo_description?: string
}

const COLLECTION_HERO_COPY: Record<string, string> = {
  'royal-fusion-originals': 'A palace-inspired edit for weddings, formal evenings, and unforgettable entrances.',
  'royal-collection': 'A palace-inspired edit for weddings, formal evenings, and unforgettable entrances.',
  'crystal-edit': 'Built for polished daily wear with elegant projection and soft trails.',
  'oud-heritage': 'A tribute to classic perfumery for those who prefer presence over noise.',
}

const COLLECTION_FEATURED_PRODUCT_SLUGS: Record<string, string> = {
  'royal-fusion-originals': 'shaheen',
  'royal-collection': 'shaheen',
  'crystal-edit': 'crimson-crystal',
  'oud-heritage': 'oud-ul-abyaz',
}

export function resolveCollectionSlug(slug: string): string {
  if (slug === 'royal-collection') return 'royal-fusion-originals'
  return slug
}

export function mapCollection(row: SupabaseCollectionRow): Collection {
  const slug = row.slug || ''
  return {
    id: row.id,
    name: row.name,
    slug,
    description: row.description ?? '',
    heroCopy: COLLECTION_HERO_COPY[slug] ?? 'Curated fragrances crafted for confidence, character, and moments worth remembering.',
    featuredProductSlug: COLLECTION_FEATURED_PRODUCT_SLUGS[slug] ?? '',
    bannerImage: row.banner_secure_url || '',
    displayOrder: row.display_order ?? 0,
    featured: Boolean(row.featured),
    active: row.active ?? true,
    productIds: [],
  }
}

export function attachCollectionMembership(
  collections: Collection[],
  links: Array<{ collection_id: string; product_id: string }>,
): Collection[] {
  const productsByCollection = new Map<string, string[]>()
  for (const link of links) {
    const productIds = productsByCollection.get(link.collection_id) ?? []
    if (!productIds.includes(link.product_id)) productIds.push(link.product_id)
    productsByCollection.set(link.collection_id, productIds)
  }
  return collections.map((collection) => ({
    ...collection,
    productIds: productsByCollection.get(collection.id) ?? [],
  }))
}

export function selectCollectionProduct(collection: Collection, products: Product[]): Product | null {
  const assigned = products.filter((product) => collection.productIds?.includes(product.id))
  return assigned.find((product) => product.slug === collection.featuredProductSlug) ?? assigned[0] ?? null
}

export function collectionProductIdsForSlug(collections: Collection[], slug: string): Set<string> {
  const canonicalSlug = resolveCollectionSlug(slug)
  const collection = collections.find((item) => resolveCollectionSlug(item.slug) === canonicalSlug)
  return new Set(collection?.productIds ?? [])
}

export function collectionNamesForProduct(collections: Collection[], productId: string): string[] {
  return collections
    .filter((collection) => collection.productIds?.includes(productId))
    .map((collection) => collection.name)
}

export function isAttarCategory(name?: string): boolean {
  return /^\s*attars?\s*$/i.test(name ?? '')
}

export function normalizeProductType(categoryName?: string, concentration?: string): string {
  const category = categoryName?.trim().toLowerCase() ?? ''
  if (category === 'attar' || category === 'attars') return 'Attar'
  if (category === 'gift set' || category === 'gift sets') return 'Gift Set'
  if (category === 'eau de parfum') return 'Eau de Parfum'
  if (category === 'extrait de parfum') return 'Extrait de Parfum'
  const verifiedConcentration = concentration?.trim().toLowerCase()
  if (verifiedConcentration === 'eau de parfum') return 'Eau de Parfum'
  if (verifiedConcentration === 'extrait de parfum') return 'Extrait de Parfum'
  return 'Uncategorized'
}

export function mapProduct(row: SupabaseProductRow): Product {
  const categoryName = normalizeProductType(row.category_name, row.concentration)
  const isAttar = isAttarCategory(categoryName)
    || (categoryName === 'Uncategorized' && Boolean(row.is_attar))

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: categoryName,
    collection: '',
    gender: row.gender || 'Unisex',
    price: Number(row.sale_price || row.price),
    oldPrice: Number(row.old_price || row.price),
    rating: null,
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
    sizeOptions: row.size_options ?? [],
    stock: Number(row.stock_quantity ?? 0),
    isBestSeller: Boolean(row.is_best_seller),
    isFeatured: Boolean(row.is_featured),
    isAttar,
    isNewArrival: Boolean(row.is_new_arrival),
    isPremium: Boolean(row.is_premium),
    cardImage: row.card_image_url || '',
    cardHoverImage: row.card_hover_image_url || '',
    cardBackgroundColor: row.card_background_color || '#E7C78F',
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
    collections: data.collections ?? fallback.collections ?? [],
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
    payments: data.payments ?? fallback.payments,
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
    imageAlt: String(document.imageAlt ?? ''),
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
