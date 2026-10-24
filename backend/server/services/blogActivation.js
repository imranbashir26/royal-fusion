import { createPublicBlogsV1Router } from '../routes/blogsV1.js'
import { blogSlugSchema } from '../schemas/blogV1.js'
import { BlogApiError } from './blogRepository.js'
import { BlogV1Service } from './blogV1Service.js'
import { createBlogSanityConfig } from '../config/blogSanity.js'
import { createInjectedBlogDelivery } from './blogDelivery.js'

function unavailableService() {
  return new BlogV1Service({
    async list() { throw new BlogApiError('BLOGS_UNAVAILABLE') },
    async getBySlug(slug) {
      if (!blogSlugSchema.safeParse(slug).success) throw new BlogApiError('INVALID_BLOG_REQUEST')
      throw new BlogApiError('BLOGS_UNAVAILABLE')
    },
    async snapshotArticles() { throw new BlogApiError('BLOGS_UNAVAILABLE') },
  })
}

// Only used when the document router cannot be constructed (including an invalid
// canonical origin). No guessed origin, provider error or partial document/XML.
function unavailableDocument(req, res) {
  const upgrade = /(?:^|;)\s*upgrade-insecure-requests(?:;|$)/.test(String(res.get('Content-Security-Policy') || ''))
  res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
      + (upgrade ? '; upgrade-insecure-requests' : '') })
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.set('Allow', 'GET, HEAD, OPTIONS')
    if (req.method === 'OPTIONS') return res.status(204).end()
    return res.status(405).type('text').end('Method not allowed.\n')
  }
  const body = 'Blog delivery is temporarily unavailable.\n'
  res.status(503).type('text').set({ 'Retry-After': '60', 'Content-Length': String(Buffer.byteLength(body)) })
  res.end(req.method === 'HEAD' ? undefined : body)
}

/** Mount only after the existing security middleware and before body parsing.
 * Disabled configuration never imports the Sanity-dependent service module chain.
 * @param {import('express').Express} app
 * @param {{environment?: NodeJS.ProcessEnv, clientFactory?: NonNullable<Parameters<typeof import('./sanityBlogSource.js').createSanityBlogV1Service>[0]>['clientFactory'], logger?: Pick<Console, 'warn'>}} [options]
 */
export async function mountSanityBlogApi(app, { environment = process.env, clientFactory, logger = console } = {}) {
  const jsonApi = environment.ENABLE_SANITY_BLOG_API === 'true'
  const documentMode = environment.ENABLE_BLOG_HTML === 'true'
  const sitemapMode = environment.ENABLE_BLOG_SITEMAP === 'true'
  if (!jsonApi && !documentMode && !sitemapMode) return Object.freeze({ status: 'disabled' })
  let service, canonicalOrigin, status = 'configured'
  const diagnose = event => {
    // Diagnostics are fixed metadata only; even a failing logger must not interrupt other APIs.
    try { logger.warn({ event, status: 503 }) } catch { /* Diagnostic transport only. */ }
  }
  let initializationEvent = 'blog.configuration.invalid'
  try {
    canonicalOrigin = createBlogSanityConfig(environment).canonicalOrigin
    initializationEvent = 'blog.module.unavailable'
    const { createSanityBlogV1Service } = await import('./sanityBlogSource.js')
    initializationEvent = 'blog.configuration.invalid'
    service = createSanityBlogV1Service({ environment, clientFactory })
  }
  catch {
    status = 'unavailable'
    diagnose(initializationEvent)
    service = unavailableService()
  }
  const read = async operation => {
    try { return await operation() }
    catch (error) {
      if (!(error instanceof BlogApiError) || error.status === 503) diagnose('blog.request.unavailable')
      throw error
    }
  }
  let delivery
  try {
    delivery = await createInjectedBlogDelivery({ service: {
      repository: service.repository,
      list: input => read(() => service.list(input)),
      getBySlug: slug => read(() => service.getBySlug(slug)),
      snapshotArticles: () => read(() => service.snapshotArticles()),
    }, canonicalOrigin, jsonApi, documentMode, sitemapMode, logger })
  } catch {
    if (status !== 'unavailable') diagnose('blog.module.unavailable')
    status = 'unavailable'
    // Register only requested scopes, even when module/configuration loading fails.
    delivery = { apiRouter: jsonApi ? createPublicBlogsV1Router(unavailableService()) : undefined,
      htmlRouter: documentMode ? unavailableDocument : undefined,
      sitemapRouter: sitemapMode ? unavailableDocument : undefined }
  }
  if (delivery.apiRouter) app.use('/api/v1/public/blogs', delivery.apiRouter)
  if (delivery.htmlRouter) app.use('/blogs', delivery.htmlRouter)
  if (delivery.sitemapRouter) app.use('/blog-sitemap.xml', delivery.sitemapRouter)
  return Object.freeze({ status })
}
