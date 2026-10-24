import { Router } from 'express'
import { blogListInputSchema } from '../schemas/blogV1.js'
import { BlogApiError } from '../services/blogRepository.js'
import { blogErrorResponse } from '../services/blogV1Service.js'

/** Isolated factory; production index.js deliberately does not import or mount it.
 * @param {import('../services/blogV1Service.js').BlogV1Service} service */
export function createPublicBlogsV1Router(service) {
  const router = Router()
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next()
    res.set('Allow', 'GET, HEAD, OPTIONS')
    if (req.method === 'OPTIONS') return res.status(204).end()
    const { body } = blogErrorResponse(new BlogApiError('INVALID_BLOG_REQUEST'), req.requestId)
    return res.status(405).json(body)
  })
  router.get('/', async (req, res, next) => {
    try {
      const input = blogListInputSchema.safeParse(req.query)
      if (!input.success) throw new BlogApiError('INVALID_BLOG_REQUEST')
      res.json(await service.list(input.data))
    } catch (error) { next(error) }
  })
  router.get('/:slug', async (req, res, next) => {
    try {
      if (Object.keys(req.query).length) throw new BlogApiError('INVALID_BLOG_REQUEST')
      res.json(await service.getBySlug(req.params.slug))
    } catch (error) { next(error) }
  })
  router.use((_req, _res, next) => next(new BlogApiError('INVALID_BLOG_REQUEST')))
  router.use((error, req, res, _next) => {
    const { status, body } = blogErrorResponse(error instanceof URIError ? new BlogApiError('INVALID_BLOG_REQUEST') : error, req.requestId)
    res.status(status).json(body)
  })
  return router
}
