import { Router } from 'express'
import { blogListInputSchema, blogSlugSchema } from '../schemas/blogV1.js'
import { BlogApiError } from '../services/blogRepository.js'
import { createBlogHtmlRenderer } from '../services/blogHtmlRenderer.js'

/** Isolated factory, intended to be mounted at /blogs only in disposable fixtures.
 * No SDK construction, environment access, application startup or HTTP API loopback.
 * @param {{service: import('../services/blogV1Service.js').BlogV1Service, canonicalOrigin: string, limits?: object, logger?: Pick<Console, 'warn'>}} options */
export function createPublicBlogHtmlRouter({ service, canonicalOrigin, limits, logger = console }) {
  if (!service || typeof service.list !== 'function' || typeof service.getBySlug !== 'function') throw new TypeError('Blog HTML configuration is invalid.')
  const renderer = createBlogHtmlRenderer({ canonicalOrigin, limits }), router = Router()
  const send = (req, res, status, document) => {
    // end() avoids Express's automatic ETag/conditional-200 conversion. No global setting changes.
    // Restrict this script-free document; only the approved editorial image path needs remote access.
    const inheritedPolicy = String(res.get('Content-Security-Policy') || '')
    const policy = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'none'; script-src-attr 'none'; style-src 'self'; img-src https://cdn.sanity.io/images/6n1y88j4/production/; object-src 'none'"
      + (/(?:^|;)\s*upgrade-insecure-requests(?:;|$)/.test(inheritedPolicy) ? '; upgrade-insecure-requests' : '')
    res.status(status).type('html').set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': document.robots,
      'Content-Length': String(Buffer.byteLength(document.html)), 'Content-Security-Policy': policy })
    if (status === 503) res.set('Retry-After', '60')
    res.end(req.method === 'HEAD' ? undefined : document.html)
  }
  router.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next()
    res.set({ Allow: 'GET, HEAD, OPTIONS', 'Cache-Control': 'no-store' })
    if (req.method === 'OPTIONS') return res.status(204).end()
    return send(req, res, 405, renderer.renderError(405))
  })
  router.get('/', async (req, res, next) => {
    try {
      const input = blogListInputSchema.safeParse(req.query)
      if (!input.success) throw new BlogApiError('INVALID_BLOG_REQUEST')
      const result = await service.list(input.data)
      send(req, res, 200, renderer.renderListing(result, input.data))
    } catch (error) { next(error) }
  })
  router.get('/:slug', async (req, res, next) => {
    try {
      if (Object.keys(req.query).length || !blogSlugSchema.safeParse(req.params.slug).success) throw new BlogApiError('INVALID_BLOG_REQUEST')
      const result = await service.getBySlug(req.params.slug)
      // Validate the injected service's response belongs to the requested route.
      if (result?.data?.slug !== req.params.slug) throw new BlogApiError('BLOGS_UNAVAILABLE')
      send(req, res, 200, renderer.renderArticle(result))
    } catch (error) { next(error) }
  })
  router.use((_req, _res, next) => next(new BlogApiError('INVALID_BLOG_REQUEST')))
  router.use((error, req, res, _next) => {
    const status = error instanceof URIError ? 400 : error instanceof BlogApiError ? error.status : 503
    if (status === 503) {
      try { logger.warn({ event: 'blog.html.unavailable', status: 503 }) } catch { /* Diagnostics never interrupt the response. */ }
    }
    send(req, res, status, renderer.renderError(status))
  })
  return router
}
