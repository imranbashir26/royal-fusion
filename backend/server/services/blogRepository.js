import { BLOG_ORDER, BLOG_SITEMAP_MAX_SOURCE_BYTES, blogListInputSchema, blogSlugSchema, blogSourceArticleSchema, blogSourceListSchema, blogSourceSnapshotSchema, blogSourceSummarySchema } from '../schemas/blogV1.js'

/** @typedef {import('zod').infer<typeof blogSourceSummarySchema>} SourceSummary */

const errors = Object.freeze({
  INVALID_BLOG_REQUEST: { status: 400, message: 'Blog request is invalid.' },
  BLOG_NOT_FOUND: { status: 404, message: 'Article not found.' },
  BLOGS_UNAVAILABLE: { status: 503, message: 'Articles are temporarily unavailable.' },
})
export class BlogApiError extends Error {
  /** @param {unknown} code */
  constructor(code) {
    const safeCode = /** @type {keyof typeof errors} */ (typeof code === 'string' && Object.hasOwn(errors, code) ? code : 'BLOGS_UNAVAILABLE')
    super(errors[safeCode].message)
    this.status = errors[safeCode].status
    this.code = safeCode
  }
}

/** Isolated repository: no client initialization, environment access, cache or persistence. */
export class BlogRepository {
  /** @param {{source?: import('../../../shared/contracts/blogV1.js').BlogSource, canonicalOrigin: string}} options */
  constructor({ source, canonicalOrigin }) {
    const origin = new URL(canonicalOrigin)
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
      throw new TypeError('An exact HTTPS storefront origin is required.')
    }
    this.source = source
    this.canonicalOrigin = origin.origin
  }

  /** @param {unknown} [input]
   * @returns {Promise<import('../../../shared/contracts/blogV1.js').BlogListResult>} */
  async list(input = {}) {
    const { page, pageSize } = parseInput(blogListInputSchema, input)
    const offset = (page - 1) * pageSize
    try {
      if (!this.source) throw new Error()
      const result = blogSourceListSchema.parse(await this.source.listPublished({ offset, limit: pageSize, order: BLOG_ORDER }))
      if (result.documents.length !== Math.min(pageSize, Math.max(0, result.total - offset))) throw new Error()
      const documents = result.documents.map(document => blogSourceSummarySchema.parse(document))
      if (new Set(documents.map(document => document._id)).size !== documents.length
        || new Set(documents.map(document => document.slug.current)).size !== documents.length
        || documents.some((document, index) => index > 0 && compareArticles(documents[index - 1], document) > 0)) throw new Error()
      return {
        items: documents.map(document => this.#summary(document)),
        pagination: { page, pageSize, total: result.total, totalPages: Math.ceil(result.total / pageSize) },
      }
    } catch { throw new BlogApiError('BLOGS_UNAVAILABLE') }
  }

  /** @param {string} slug
   * @returns {Promise<import('../../../shared/contracts/blogV1.js').BlogArticle | null>} */
  async getBySlug(slug) {
    parseInput(blogSlugSchema, slug)
    try {
      if (!this.source) throw new Error()
      const value = await this.source.getPublishedBySlug(slug)
      if (value === null) return null
      const document = blogSourceArticleSchema.parse(value)
      if (document.slug.current !== slug) throw new Error()
      return this.#article(document)
    } catch { throw new BlogApiError('BLOGS_UNAVAILABLE') }
  }

  /** No listing/detail fan-out: validate one complete published snapshot.
   * @returns {Promise<import('../../../shared/contracts/blogV1.js').BlogArticle[]>} */
  async snapshotArticles() {
    try {
      if (!this.source?.snapshotPublished) throw new Error()
      const raw = await this.source.snapshotPublished()
      if (Buffer.byteLength(JSON.stringify(raw)) > BLOG_SITEMAP_MAX_SOURCE_BYTES) throw new Error()
      const snapshot = blogSourceSnapshotSchema.parse(raw)
      const documents = snapshot.documents.map(value => blogSourceArticleSchema.parse(value))
      if (new Set(documents.map(row => row._id)).size !== documents.length
        || new Set(documents.map(row => row.slug.current)).size !== documents.length
        || documents.some((row, index) => index > 0 && compareArticles(documents[index - 1], row) > 0)) throw new Error()
      return documents.map(document => this.#article(document))
    } catch { throw new BlogApiError('BLOGS_UNAVAILABLE') }
  }

  /** @param {import('zod').infer<typeof blogSourceArticleSchema>} document
   * @returns {import('../../../shared/contracts/blogV1.js').BlogArticle} */
  #article(document) {
    return { ...this.#summary(document), body: document.body.map(node => node._type === 'image'
      ? { _type: 'image', _key: node._key, ...image(node) } : node) }
  }

  /** @param {SourceSummary} document
   * @returns {import('../../../shared/contracts/blogV1.js').BlogSummary} */
  #summary(document) {
    const path = `/blogs/${document.slug.current}`
    const canonicalUrl = document.canonicalUrl || new URL(path, this.canonicalOrigin).href
    const canonical = new URL(canonicalUrl)
    if (canonical.origin !== this.canonicalOrigin || canonical.pathname !== path) throw new Error()
    return {
      id: document._id, slug: document.slug.current, title: document.title, excerpt: document.excerpt,
      publishedAt: new Date(document.publishedAt).toISOString(), updatedAt: new Date(document._updatedAt).toISOString(),
      author: { id: document.author._id, name: document.author.name, bio: document.author.bio ?? null },
      category: { id: document.category._id, title: document.category.title, slug: document.category.slug.current, description: document.category.description ?? null },
      featuredImage: image(document.featuredImage, document.imageAlt), tags: document.tags ?? [],
      seo: {
        title: document.seoTitle || null, description: document.seoDescription || null,
        canonicalUrl, noIndex: document.noIndex ?? false,
        ogImage: document.ogImage ? image(document.ogImage, document.imageAlt) : null,
      },
    }
  }
}

/** @param {SourceSummary['featuredImage']} value
 * @param {string} [fallbackAlt]
 * @returns {import('../../../shared/contracts/blogV1.js').BlogImage} */
function image(value, fallbackAlt = undefined) {
  return {
    asset: { _type: 'reference', _ref: value.asset._id, url: value.asset.url, ...value.asset.metadata.dimensions },
    alt: value.alt || fallbackAlt || '', crop: value.crop ?? null, hotspot: value.hotspot ?? null, caption: value.caption ?? null,
  }
}
/** @template {import('zod').ZodType} T
 * @param {T} schema
 * @param {unknown} input
 * @returns {import('zod').infer<T>} */
function parseInput(schema, input) {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new BlogApiError('INVALID_BLOG_REQUEST')
  return /** @type {import('zod').infer<T>} */ (parsed.data)
}
/** @param {{publishedAt: string, _id: string}} left
 * @param {{publishedAt: string, _id: string}} right */
export function compareArticles(left, right) {
  const time = Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
  return time || (left._id < right._id ? -1 : left._id > right._id ? 1 : 0)
}
