import { BlogApiError } from './blogRepository.js'

/** Future GET contracts only. This module creates and mounts no Express routes. */
export class BlogV1Service {
  /** @param {import('../../../shared/contracts/blogV1.js').BlogRepository} repository */
  constructor(repository) { this.repository = repository }

  /** Complete published collection for isolated sitemap generation only.
   * @returns {Promise<import('../../../shared/contracts/blogV1.js').BlogArticle[]>} */
  async snapshotArticles() {
    try {
      if (!this.repository.snapshotArticles) throw new BlogApiError('BLOGS_UNAVAILABLE')
      return await this.repository.snapshotArticles()
    } catch (error) { throw safeError(error) }
  }

  /** @param {import('../../../shared/contracts/blogV1.js').BlogListInput} [input]
   * @returns {Promise<import('../../../shared/contracts/blogV1.js').BlogListResponse>} */
  async list(input = {}) {
    try {
      const { items, pagination } = await this.repository.list(input)
      return { data: items, pagination }
    } catch (error) { throw safeError(error) }
  }

  /** @param {string} slug
   * @returns {Promise<import('../../../shared/contracts/blogV1.js').BlogDetailResponse>} */
  async getBySlug(slug) {
    try {
      const article = await this.repository.getBySlug(slug)
      if (!article) throw new BlogApiError('BLOG_NOT_FOUND')
      return { data: article }
    } catch (error) { throw safeError(error) }
  }
}

/** @param {unknown} error
 * @param {unknown} [requestId]
 * @returns {{status: number, body: import('../../../shared/contracts/blogV1.js').BlogErrorResponse}} */
export function blogErrorResponse(error, requestId) {
  const safe = safeError(error)
  return { status: safe.status, body: { error: {
    code: safe.code, message: safe.message,
    ...(typeof requestId === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId) ? { requestId } : {}),
  } } }
}
/** @param {unknown} error */
function safeError(error) {
  return new BlogApiError(error instanceof BlogApiError ? error.code : 'BLOGS_UNAVAILABLE')
}
