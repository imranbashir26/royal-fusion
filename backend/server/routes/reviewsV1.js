import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { AUTH_ERROR_CODES } from '../auth/contracts.js'
import {
  createAdminIdentity,
  createOriginGuard,
  requireAuthenticatedCsrf,
  sendCode,
} from '../middleware/authSecurity.js'
import {
  adminReviewListSchema,
  adminReviewUpdateSchema,
  publicReviewSchema,
  reviewIdSchema,
} from '../schemas/reviewsV1.js'
import { ReviewApiError, ReviewsV1Service } from '../services/reviewsV1Service.js'

export function createPublicReviewsV1Router(runtime, { client = runtime.repository.client, logger = console } = {}) {
  const router = Router()
  const service = new ReviewsV1Service(client, logger)
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.get('/', route(async (_req, res) => res.json({ data: await service.publicList() })))
  router.post('/', rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'REVIEW_RATE_LIMITED', message: 'Please wait before submitting another review.' } },
  }), createOriginGuard(runtime.config), (req, _res, next) => {
    if (Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8') > 4096) {
      return next(new ReviewApiError(413, 'REVIEW_TOO_LARGE', 'Review request is too large.'))
    }
    next()
  }, route(async (req, res) => {
    const input = parse(publicReviewSchema, req.body)
    res.status(201).json({ data: await service.submit(input) })
  }))
  router.use(errorHandler)
  return router
}

export function createAdminReviewsV1Router(runtime, { client = runtime.repository.client, logger = console } = {}) {
  const router = Router()
  const service = new ReviewsV1Service(client, logger)
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.use(createAdminIdentity(runtime))
  router.use((req, res, next) => {
    const keys = req.administrator.permissions
    if (!keys.includes('*') && !keys.includes('reviews.manage')) {
      return sendCode(res, AUTH_ERROR_CODES.PERMISSION_DENIED, req.requestId)
    }
    next()
  })
  const secure = [createOriginGuard(runtime.config), requireAuthenticatedCsrf(runtime.config)]
  router.get('/', route(async (req, res) => {
    res.json({ data: await service.list(parse(adminReviewListSchema, req.query)) })
  }))
  router.get('/products', route(async (_req, res) => {
    res.json({ data: await service.filterProducts() })
  }))
  router.get('/:id', route(async (req, res) => {
    res.json({ data: await service.get(parse(reviewIdSchema, req.params.id)) })
  }))
  router.put('/:id', ...secure, route(async (req, res) => {
    const id = parse(reviewIdSchema, req.params.id)
    const input = parse(adminReviewUpdateSchema, req.body)
    res.json({ data: await service.update(id, input, actor(req)) })
  }))
  router.delete('/:id', ...secure, route(async (req, res) => {
    res.json({ data: await service.remove(parse(reviewIdSchema, req.params.id), actor(req)) })
  }))
  router.use(errorHandler)
  return router
}

function parse(schema, value) {
  const result = schema.safeParse(value)
  if (!result.success) throw new ReviewApiError(400, 'INVALID_REVIEW_REQUEST', 'Review request is invalid.')
  return result.data
}
function actor(req) { return { userId: req.administrator.userId, requestId: req.requestId } }
function route(handler) { return (req, res, next) => Promise.resolve(handler(req, res)).catch(next) }
function errorHandler(error, req, res, next) {
  if (!(error instanceof ReviewApiError)) return next(error)
  res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: req.requestId } })
}
