import { Router } from 'express'
import { createBlogSitemap } from '../services/blogSitemap.js'

/** Isolated exact endpoint, proposed /blog-sitemap.xml. Never mounted in production.
 * @param {Parameters<typeof createBlogSitemap>[0] & {logger?: Pick<Console, 'warn'>}} options */
export function createPublicBlogSitemapRouter({ service, canonicalOrigin, logger = console }) {
  const sitemap = createBlogSitemap({ service, canonicalOrigin }), router = Router()
  const send = (req, res, status, body, xml = false) => {
    res.status(status).type(xml ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8').set({ 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Length': String(Buffer.byteLength(body)) })
    if (status === 503) res.set('Retry-After', '60')
    // end() preserves status under conditional headers and avoids automatic ETags.
    res.end(req.method === 'HEAD' ? undefined : body)
  }
  router.use((req, res, next) => {
    if (['GET', 'HEAD'].includes(req.method)) return next()
    res.set({ Allow: 'GET, HEAD, OPTIONS', 'Cache-Control': 'no-store' })
    if (req.method === 'OPTIONS') return res.status(204).end()
    send(req, res, 405, 'Method not allowed.\n')
  })
  router.get('/', async (req, res) => {
    if (Object.keys(req.query).length) return send(req, res, 400, 'Sitemap request is invalid.\n')
    try { send(req, res, 200, await sitemap.generate(), true) }
    catch {
      try { logger.warn({ event: 'blog.sitemap.unavailable', status: 503 }) } catch { /* Diagnostics cannot interrupt responses. */ }
      send(req, res, 503, 'Sitemap is temporarily unavailable.\n')
    }
  })
  router.use((req, res) => send(req, res, 400, 'Sitemap request is invalid.\n'))
  return router
}
