import { z } from 'zod'

export const BLOG_MAX_PAGE_SIZE = 50
export const BLOG_MAX_PAGE = 1000
// One complete query-sized collection. Larger collections fail, never truncate.
export const BLOG_SITEMAP_MAX_ARTICLES = BLOG_MAX_PAGE_SIZE
export const BLOG_SITEMAP_MAX_SOURCE_BYTES = 8 * 1024 * 1024
/** @type {readonly ['publishedAt desc', '_id asc']} */
export const BLOG_ORDER = Object.freeze(['publishedAt desc', '_id asc'])
export const blogSlugSchema = z.string().min(1).max(96).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
/** @param {number} max */
const integer = max => z.union([z.number(), z.string().regex(/^[1-9]\d*$/).transform(Number)])
  .pipe(z.number().int().min(1).max(max))
export const blogListInputSchema = z.strictObject({
  page: integer(BLOG_MAX_PAGE).default(1),
  pageSize: integer(BLOG_MAX_PAGE_SIZE).default(20),
})

// Dotted IDs include native drafts/release versions and are never public blog identities.
const publishedId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const key = z.string().min(1).max(128)
/** @param {number} max */
const text = max => z.string().trim().min(1).max(max)
const date = z.iso.datetime({ offset: true })
const fraction = z.number().min(0).max(1)
const crop = z.object({ top: fraction, bottom: fraction, left: fraction, right: fraction })
  .refine(value => value.top + value.bottom < 1 && value.left + value.right < 1)
const hotspot = z.object({ x: fraction, y: fraction, width: fraction.positive(), height: fraction.positive() })
  .refine(value => value.x - value.width / 2 >= 0 && value.x + value.width / 2 <= 1
    && value.y - value.height / 2 >= 0 && value.y + value.height / 2 <= 1)
const imageUrl = z.url().max(2048).refine(value => {
  const url = new URL(value)
  return url.protocol === 'https:' && url.hostname === 'cdn.sanity.io' && !url.port
    && !url.username && !url.password && !url.search && !url.hash && url.pathname.startsWith('/images/')
})
const link = z.string().min(1).max(2048).refine(value => {
  if (/[\s<>\\]/.test(value)) return false
  if (value.startsWith('/') && !value.startsWith('//')) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch { return false }
})
const sourceImage = z.object({
  _type: z.literal('image'),
  asset: z.object({
    _id: publishedId.regex(/^image-/), _type: z.literal('sanity.imageAsset'), url: imageUrl,
    metadata: z.object({ dimensions: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }) }),
  }),
  alt: text(160).optional(),
  crop: crop.nullish(), hotspot: hotspot.nullish(), caption: z.string().max(300).nullish(),
})
const block = z.object({
  _type: z.literal('block'), _key: key,
  style: z.enum(['normal', 'h2', 'h3', 'blockquote']).default('normal'),
  children: z.array(z.object({
    _type: z.literal('span'), _key: key, text: z.string().max(10000), marks: z.array(key).max(30).default([]),
  })).min(1).max(1000),
  markDefs: z.array(z.object({ _type: z.literal('link'), _key: key, href: link })).max(100).default([]),
  listItem: z.enum(['bullet', 'number']).optional(), level: z.number().int().min(1).max(10).optional(),
}).superRefine((value, context) => {
  const definitions = value.markDefs.map(mark => mark._key)
  const keys = value.children.map(child => child._key)
  if (new Set(definitions).size !== definitions.length || new Set(keys).size !== keys.length
    || value.children.some(child => child.marks.some(mark => !['strong', 'em', 'code', 'underline', 'strike-through'].includes(mark) && !definitions.includes(mark)))
    || (value.level !== undefined && value.listItem === undefined)) {
    context.addIssue({ code: 'custom', message: 'Invalid Portable Text structure.' })
  }
})
const body = z.array(z.union([block, sourceImage.extend({ _key: key, alt: text(160) })])).min(1).max(1000)
  .refine(value => new Set(value.map(node => node._key)).size === value.length)
const canonical = z.url().max(2048).refine(value => {
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
})

// Allowlisted resolved source projections; unknown fields are stripped at every object boundary.
export const blogSourceSummarySchema = z.object({
  _id: publishedId, _type: z.literal('blogPost'), title: text(120), slug: z.object({ current: blogSlugSchema }),
  excerpt: text(240), publishedAt: date, _updatedAt: date,
  author: z.object({ _id: publishedId, _type: z.literal('author'), name: text(100), bio: z.string().max(1000).nullish() }),
  category: z.object({ _id: publishedId, _type: z.literal('blogCategory'), title: text(80), slug: z.object({ current: blogSlugSchema }), description: z.string().max(1000).nullish() }),
  featuredImage: sourceImage, imageAlt: text(160).optional(),
  tags: z.array(text(80)).max(30).nullish(),
  seoTitle: z.string().max(70).nullish(), seoDescription: z.string().max(160).nullish(),
  canonicalUrl: canonical.nullish(), noIndex: z.boolean().optional(), ogImage: sourceImage.nullish(),
}).refine(value => Boolean(value.featuredImage.alt || value.imageAlt))
export const blogSourceArticleSchema = blogSourceSummarySchema.safeExtend({ body })
export const blogSourceListSchema = z.object({ documents: z.array(z.unknown()).max(BLOG_MAX_PAGE_SIZE), total: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) })
export const blogSourceSnapshotSchema = z.object({
  documents: z.array(z.unknown()).max(BLOG_SITEMAP_MAX_ARTICLES),
  total: z.number().int().min(0).max(BLOG_SITEMAP_MAX_ARTICLES),
}).refine(value => value.documents.length === value.total)
