import { Router, json } from 'express'
import { createAdminIdentity, createOriginGuard, requireAuthenticatedCsrf, sendCode } from '../middleware/authSecurity.js'
import { AUTH_ERROR_CODES } from '../auth/contracts.js'
import { listSchema, emptyQuerySchema, idSchema, couponCreateSchema, couponUpdateSchema, seoKeySchema, seoUpdateSchema } from '../schemas/adminPhase3.js'
import { CustomersService, CouponsService, SeoService, Phase3Error } from '../services/adminPhase3Service.js'

const domains = { customers: ['customers.read', CustomersService], coupons: ['coupons.manage', CouponsService], seo: ['seo.manage', SeoService] }
const parse = (schema, value) => { const r = schema.safeParse(value); if (!r.success) throw new Phase3Error(400, 'INVALID_ADMIN_REQUEST', 'Please check the supplied information.'); return r.data }
const run = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next)
const actor = req => ({ userId: req.administrator.userId, requestId: req.requestId })
export function createAdminPhase3V1Router(runtime, resource, { client = runtime.repository.client, logger = console } = {}) {
  const [permission, Service] = domains[resource], service = new Service(client, logger), router = Router()
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.use(createAdminIdentity(runtime), (req, res, next) => {
    if (!req.administrator.permissions.includes('*') && !req.administrator.permissions.includes(permission)) return sendCode(res, AUTH_ERROR_CODES.PERMISSION_DENIED, req.requestId)
    next()
  })
  const secure = [createOriginGuard(runtime.config), requireAuthenticatedCsrf(runtime.config), json({ limit: '16kb' }), (req, _res, next) => {
    try { parse(emptyQuerySchema, req.query); next() } catch (error) { next(error) }
  }]
  router.get('/', run(async (req, res) => {
    if (resource === 'seo') parse(emptyQuerySchema, req.query)
    res.json({ data: resource === 'seo' ? await service.list() : await service.list(parse(listSchema, req.query)) })
  }))
  if (resource === 'customers') {
    router.get('/:id/orders', run(async (req, res) => {
      const keys = req.administrator.permissions
      if (!keys.includes('*') && !keys.includes('orders.read')) return sendCode(res, AUTH_ERROR_CODES.PERMISSION_DENIED, req.requestId)
      const filters = parse(listSchema, req.query)
      if (filters.search) throw new Phase3Error(400, 'INVALID_ADMIN_REQUEST', 'Order search is unavailable here.')
      res.json({ data: await service.orders(parse(idSchema, req.params.id), filters) })
    }))
  }
  if (resource !== 'seo') router.get('/:id', run(async (req, res) => {
    parse(emptyQuerySchema, req.query)
    res.json({ data: await service.detail(parse(idSchema, req.params.id)) })
  }))
  if (resource === 'coupons') {
    router.post('/', ...secure, run(async (req, res) => res.status(201).json({ data: await service.create(parse(couponCreateSchema, req.body), actor(req)) })))
    router.put('/:id', ...secure, run(async (req, res) => res.json({ data: await service.update(parse(idSchema, req.params.id), parse(couponUpdateSchema, req.body), actor(req)) })))
  }
  if (resource === 'seo') router.put('/:key', ...secure, run(async (req, res) => res.json({ data: await service.save(parse(seoKeySchema, req.params.key), parse(seoUpdateSchema, req.body), runtime.config, actor(req)) })))
  router.use((error, req, res, next) => {
    if (Object.values(AUTH_ERROR_CODES).includes(error?.code)) return next(error)
    if (error.type === 'entity.too.large') error = new Phase3Error(413, 'REQUEST_TOO_LARGE', 'Request is too large.')
    if (error.type === 'entity.parse.failed' || error.status === 415) error = new Phase3Error(400, 'INVALID_ADMIN_REQUEST', 'Please check the supplied information.')
    if (!(error instanceof Phase3Error)) error = new Phase3Error(503, 'ADMIN_RESOURCE_UNAVAILABLE', 'This request could not be completed. Please try again.')
    res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: req.requestId } })
  })
  return router
}
