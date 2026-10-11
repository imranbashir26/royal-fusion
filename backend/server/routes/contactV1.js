import { Router, json } from 'express'
import rateLimit from 'express-rate-limit'
import { createHash } from 'node:crypto'
import { AUTH_ERROR_CODES } from '../auth/contracts.js'
import { createAdminIdentity, createOriginGuard, requireAuthenticatedCsrf, sendCode } from '../middleware/authSecurity.js'
import { contactIdSchema, contactListSchema, contactStatusSchema, publicContactSchema } from '../schemas/contactV1.js'
import { ContactApiError, ContactV1Service } from '../services/contactV1Service.js'

const noStore = (_req, res, next) => { res.set('Cache-Control', 'no-store'); next() }
const parse = (schema, value) => {
  const result = schema.safeParse(value)
  if (!result.success) throw new ContactApiError(400, 'INVALID_CONTACT_REQUEST', 'Please check your contact information.')
  return result.data
}
const route = handler => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next)
const limiter = (options = {}) => rateLimit({
  windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: {
    code: 'CONTACT_RATE_LIMITED', message: 'Please wait before sending another message.', requestId: req.requestId,
  } }), ...options,
})

// Mounted before the shared JSON parser/sanitizer to validate the original request.
export function createPublicContactV1Router(runtime, { client = runtime.repository.client, logger = console } = {}) {
  const router = Router(), service = new ContactV1Service(client, logger)
  router.use(noStore)
  router.post('/', createOriginGuard(runtime.config), limiter(), json({ limit: '16kb' }), (req, res, next) => {
    try { req.contactInput = parse(publicContactSchema, req.body); next() } catch (error) { next(error) }
  }, limiter({ keyGenerator: req => createHash('sha256').update(req.contactInput.email).digest('hex') }), route(async (req, res) => {
    res.status(201).json({ data: await service.submit(req.contactInput), meta: { requestId: req.requestId } })
  }))
  router.use(errorHandler)
  return router
}
export function createAdminContactV1Router(runtime, { client = runtime.repository.client, logger = console } = {}) {
  const router = Router(), service = new ContactV1Service(client, logger)
  router.use(noStore, createAdminIdentity(runtime))
  router.use((req, res, next) => {
    const permissions = req.administrator.permissions
    if (!permissions.includes('*') && !permissions.includes('contact_messages.manage')) {
      return sendCode(res, AUTH_ERROR_CODES.PERMISSION_DENIED, req.requestId)
    }
    next()
  })
  router.get('/', route(async (req, res) => res.json({ data: await service.list(parse(contactListSchema, req.query)) })))
  router.get('/:id', route(async (req, res) => res.json({ data: await service.get(parse(contactIdSchema, req.params.id)) })))
  router.patch('/:id/status', createOriginGuard(runtime.config), requireAuthenticatedCsrf(runtime.config),
    json({ limit: '1kb' }), route(async (req, res) => {
      const { status } = parse(contactStatusSchema, req.body)
      res.json({ data: await service.setStatus(parse(contactIdSchema, req.params.id), status,
        { userId: req.administrator.userId, requestId: req.requestId }) })
    }))
  router.use(errorHandler)
  return router
}
function errorHandler(error, req, res, next) {
  if (Object.values(AUTH_ERROR_CODES).includes(error?.code)) return next(error)
  if (error.type === 'entity.too.large') error = new ContactApiError(413, 'CONTACT_TOO_LARGE', 'Contact request is too large.')
  if (error.type === 'entity.parse.failed' || error.status === 415) error = new ContactApiError(400, 'INVALID_CONTACT_REQUEST', 'Please check your contact information.')
  if (!(error instanceof ContactApiError)) error = new ContactApiError(500, 'CONTACT_ERROR', 'Contact request could not be completed.')
  res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: req.requestId } })
}
