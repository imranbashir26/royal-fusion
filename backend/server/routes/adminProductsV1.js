import { Router } from 'express'
import { AUTH_ERROR_CODES } from '../auth/contracts.js'
import {
  createAdminIdentity,
  createOriginGuard,
  requireAuthenticatedCsrf,
  sendCode,
} from '../middleware/authSecurity.js'
import { ProductAdminService, ProductApiError } from '../services/productAdminService.js'
import {
  createProductSchema,
  listProductsSchema,
  productIdSchema,
  updateProductSchema,
} from '../schemas/productAdmin.js'

export function createAdminProductsV1Router(runtime, { client = runtime.repository.client, logger = console } = {}) {
  const router = Router()
  const service = new ProductAdminService(client, logger)
  const originGuard = createOriginGuard(runtime.config)
  const csrf = requireAuthenticatedCsrf(runtime.config)

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  router.use(createAdminIdentity(runtime))

  function permit(permission) {
    return (req, res, next) => {
      const keys = req.administrator.permissions
      if (!keys.includes('*') && !keys.includes(permission)) {
        return sendCode(res, AUTH_ERROR_CODES.PERMISSION_DENIED, req.requestId)
      }
      next()
    }
  }

  router.get('/', permit('products.read'), route(async (req, res) => {
    const filters = parse(listProductsSchema, req.query)
    res.json({ data: await service.list(filters), meta: { requestId: req.requestId } })
  }))
  router.get('/:id', permit('products.read'), route(async (req, res) => {
    const id = parse(productIdSchema, req.params.id)
    res.json({ data: await service.get(id), meta: { requestId: req.requestId } })
  }))
  router.post('/', permit('products.manage'), originGuard, csrf, route(async (req, res) => {
    const input = parse(createProductSchema, req.body)
    const product = await service.create(input, actor(req))
    res.status(201).json({ data: product, meta: { requestId: req.requestId } })
  }))
  router.put('/:id', permit('products.manage'), originGuard, csrf, route(async (req, res) => {
    const id = parse(productIdSchema, req.params.id)
    const input = parse(updateProductSchema, req.body)
    res.json({ data: await service.update(id, input, actor(req)), meta: { requestId: req.requestId } })
  }))
  router.delete('/:id', permit('products.manage'), originGuard, csrf, route(async (req, res) => {
    const id = parse(productIdSchema, req.params.id)
    res.json({ data: await service.archive(id, actor(req)), meta: { requestId: req.requestId } })
  }))

  router.use((error, req, res, next) => {
    if (!(error instanceof ProductApiError)) return next(error)
    res.status(error.status).json({
      error: { code: error.code, message: error.message, requestId: req.requestId },
    })
  })
  return router
}

function parse(schema, value) {
  const result = schema.safeParse(value)
  if (!result.success) throw new ProductApiError(400, 'INVALID_REQUEST', 'Product request is invalid.')
  return result.data
}

function actor(req) {
  return { userId: req.administrator.userId, requestId: req.requestId }
}

function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res)).catch(next)
}
