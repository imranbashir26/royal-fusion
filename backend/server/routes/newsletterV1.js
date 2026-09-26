import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { AUTH_ERROR_CODES } from '../auth/contracts.js'
import { createAdminIdentity, createOriginGuard, requireAuthenticatedCsrf, sendCode } from '../middleware/authSecurity.js'
import { newsletterEmailSchema, newsletterListSchema, subscriberIdSchema } from '../schemas/newsletterV1.js'
import { NewsletterApiError, NewsletterV1Service } from '../services/newsletterV1Service.js'

export function createPublicNewsletterV1Router(runtime, { client = runtime.repository.client, logger = console } = {}) {
  const router = Router()
  const service = new NewsletterV1Service(client, logger)
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.post('/', rateLimit({
    windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false,
    message: { error: { code: 'NEWSLETTER_RATE_LIMITED', message: 'Please wait before trying again.' } },
  }), createOriginGuard(runtime.config), (req, _res, next) => {
    if (Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8') > 1024) {
      return next(new NewsletterApiError(413, 'NEWSLETTER_TOO_LARGE', 'Subscription request is too large.'))
    }
    next()
  }, route(async (req, res) => {
    const { email } = parse(newsletterEmailSchema, req.body)
    res.json({ data: await service.subscribe(email) })
  }))
  router.use(errorHandler)
  return router
}

export function createAdminNewsletterV1Router(runtime, { client = runtime.repository.client, logger = console } = {}) {
  const router = Router()
  const service = new NewsletterV1Service(client, logger)
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.use(createAdminIdentity(runtime))
  router.use((req, res, next) => {
    const keys = req.administrator.permissions
    if (!keys.includes('*') && !keys.includes('newsletter.manage')) {
      return sendCode(res, AUTH_ERROR_CODES.PERMISSION_DENIED, req.requestId)
    }
    next()
  })
  const secure = [createOriginGuard(runtime.config), requireAuthenticatedCsrf(runtime.config)]
  router.get('/', route(async (req, res) => res.json({ data: await service.list(parse(newsletterListSchema, req.query)) })))
  router.get('/export', route(async (req, res) => {
    const csv = await service.exportCsv(actor(req))
    res.set('Content-Type', 'text/csv; charset=utf-8')
    res.set('Content-Disposition', 'attachment; filename="royal-fusion-newsletter.csv"')
    res.send(csv)
  }))
  router.get('/:id', route(async (req, res) => res.json({ data: await service.get(parse(subscriberIdSchema, req.params.id)) })))
  router.post('/', ...secure, route(async (req, res) => {
    const { email } = parse(newsletterEmailSchema, req.body)
    res.status(201).json({ data: await service.subscribe(email, { manual: true, actor: actor(req) }) })
  }))
  router.delete('/:id', ...secure, route(async (req, res) => {
    res.json({ data: await service.remove(parse(subscriberIdSchema, req.params.id), actor(req)) })
  }))
  router.use(errorHandler)
  return router
}

function parse(schema, value) {
  const result = schema.safeParse(value)
  if (!result.success) throw new NewsletterApiError(400, 'INVALID_NEWSLETTER_REQUEST', 'Newsletter request is invalid.')
  return result.data
}
function actor(req) { return { userId: req.administrator.userId, requestId: req.requestId } }
function route(handler) { return (req, res, next) => Promise.resolve(handler(req, res)).catch(next) }
function errorHandler(error, req, res, next) {
  if (!(error instanceof NewsletterApiError)) return next(error)
  res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: req.requestId } })
}
