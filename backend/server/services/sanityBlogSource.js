import { createClient } from '@sanity/client'
import { createBlogSanityConfig } from '../config/blogSanity.js'
import { BLOG_MAX_PAGE, BLOG_MAX_PAGE_SIZE, BLOG_ORDER, blogSlugSchema, blogSourceListSchema, blogSourceSnapshotSchema } from '../schemas/blogV1.js'
import { BlogApiError, BlogRepository } from './blogRepository.js'
import { BlogV1Service } from './blogV1Service.js'
import { SANITY_BLOG_DETAIL_QUERY, SANITY_BLOG_LIST_QUERY, SANITY_BLOG_SNAPSHOT_QUERY } from './sanityBlogQueries.js'

/** @typedef {{fetch(query: string, params: Record<string, string | number>, options: {perspective: 'published', useCdn: false, signal: AbortSignal, stega: false, resultSourceMap: false}): Promise<unknown>}} BlogReadClient */

/** The public source exposes only reads; callers never receive the SDK instance.
 * @param {{client: BlogReadClient, timeoutMs?: number}} options
 * @returns {import('../../../shared/contracts/blogV1.js').BlogSource} */
export function createSanityBlogSource({ client, timeoutMs = 5000 }) {
  if (!client || typeof client.fetch !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 10000) {
    throw new TypeError('Blog source configuration is invalid.')
  }
  /** SDK timeout plus an independent deadline also bounds injected clients that ignore cancellation.
   * @param {string} query
   * @param {Record<string, string | number>} params */
  async function fetchPublished(query, params) {
    const controller = new AbortController()
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer
    try {
      return await Promise.race([
        Promise.resolve().then(() => client.fetch(query, params, {
          perspective: 'published', useCdn: false, signal: controller.signal,
          stega: false, resultSourceMap: false,
        })),
        new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new BlogApiError('BLOGS_UNAVAILABLE')) }, timeoutMs)
        }),
      ])
    } catch { throw new BlogApiError('BLOGS_UNAVAILABLE') }
    finally { clearTimeout(timer) }
  }
  return Object.freeze({
    async snapshotPublished() {
      try {
        return blogSourceSnapshotSchema.parse(await fetchPublished(SANITY_BLOG_SNAPSHOT_QUERY, {}))
      } catch { throw new BlogApiError('BLOGS_UNAVAILABLE') }
    },
    /** @param {Parameters<import('../../../shared/contracts/blogV1.js').BlogSource['listPublished']>[0]} input */
    async listPublished({ offset, limit, order }) {
      if (!Number.isInteger(offset) || offset < 0 || offset > (BLOG_MAX_PAGE - 1) * BLOG_MAX_PAGE_SIZE
        || !Number.isInteger(limit) || limit < 1 || limit > BLOG_MAX_PAGE_SIZE
        || !Array.isArray(order) || order.length !== 2 || order.some((field, index) => field !== BLOG_ORDER[index])) {
        throw new BlogApiError('INVALID_BLOG_REQUEST')
      }
      try {
        const result = blogSourceListSchema.parse(await fetchPublished(SANITY_BLOG_LIST_QUERY, { offset, end: offset + limit }))
        // Sanity slug validation is editorial, not a datastore uniqueness constraint.
        // Detect duplicates even when the conflicting document is on a different page.
        if (result.documents.some(value => !value || typeof value !== 'object'
          || !('_slugMatchCount' in value) || value._slugMatchCount !== 1)) throw new Error()
        return result
      } catch { throw new BlogApiError('BLOGS_UNAVAILABLE') }
    },
    /** @param {string} slug */
    async getPublishedBySlug(slug) {
      if (!blogSlugSchema.safeParse(slug).success) throw new BlogApiError('INVALID_BLOG_REQUEST')
      const matches = await fetchPublished(SANITY_BLOG_DETAIL_QUERY, { slug })
      if (!Array.isArray(matches) || matches.length > 1
        || (matches.length === 1 && (!matches[0] || typeof matches[0] !== 'object'))) throw new BlogApiError('BLOGS_UNAVAILABLE')
      return matches.length ? matches[0] : null
    },
  })
}

/** Explicit composition only: never called or mounted by the production entry point.
 * @param {{environment?: NodeJS.ProcessEnv, clientFactory?: (config: import('@sanity/client').ClientConfig) => BlogReadClient}} [options] */
export function createSanityBlogV1Service({ environment = process.env, clientFactory = createClient } = {}) {
  try {
    const config = createBlogSanityConfig(environment)
    const client = clientFactory({
      projectId: config.projectId, dataset: config.dataset, apiVersion: config.apiVersion,
      perspective: 'published', useCdn: false, timeout: config.timeoutMs, maxRetries: 0,
      stega: { enabled: false }, resultSourceMap: false,
    })
    const source = createSanityBlogSource({ client, timeoutMs: config.timeoutMs })
    return new BlogV1Service(new BlogRepository({ source, canonicalOrigin: config.canonicalOrigin }))
  } catch { throw new TypeError('Blog source configuration is invalid.') }
}
