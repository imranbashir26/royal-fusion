import { Router } from 'express'
import { AUTH_ERROR_CODES } from '../auth/contracts.js'
import {
  createAdminIdentity,
  createOriginGuard,
  requireAuthenticatedCsrf,
  sendCode,
} from '../middleware/authSecurity.js'
import { CategoryAdminService, CategoryApiError } from '../services/categoryAdminService.js'
import {
  categoryIdSchema,
  createCategorySchema,
  listCategoriesSchema,
  updateCategorySchema,
} from '../schemas/categoryAdmin.js'

export function createAdminCategoriesV1Router(runtime, { client = runtime.repository.client, logger = console } = {}) {
  const router = Router()
  const service = new CategoryAdminService(client, logger)
  const originGuard = createOriginGuard(runtime.config)
  const csrf = requireAuthenticatedCsrf(runtime.config)

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  router.use(createAdminIdentity(runtime))

  function permit(permissions) {
    const list = Array.isArray(permissions) ? permissions : [permissions]
    return (req, res, next) => {
      const keys = req.administrator.permissions
      if (!keys.includes('*') && !list.some((p) => keys.includes(p))) {
        return sendCode(res, AUTH_ERROR_CODES.PERMISSION_DENIED, req.requestId)
      }
      next()
    }
  }

  router.get('/', permit(['categories.manage', 'catalog.read', 'products.read']), route(async (req, res) => {
    const filters = parse(listCategoriesSchema, req.query)
    res.json({ data: await service.list(filters), meta: { requestId: req.requestId } })
  }))

  router.get('/:id', permit(['categories.manage', 'catalog.read', 'products.read']), route(async (req, res) => {
    const id = parse(categoryIdSchema, req.params.id)
    res.json({ data: await service.get(id), meta: { requestId: req.requestId } })
  }))

  router.post('/', permit('categories.manage'), originGuard, csrf, route(async (req, res) => {
    const input = parse(createCategorySchema, req.body)
    const category = await service.create(input, actor(req))
    res.status(201).json({ data: category, meta: { requestId: req.requestId } })
  }))

  router.put('/:id', permit('categories.manage'), originGuard, csrf, route(async (req, res) => {
    const id = parse(categoryIdSchema, req.params.id)
    const input = parse(updateCategorySchema, req.body)
    res.json({ data: await service.update(id, input, actor(req)), meta: { requestId: req.requestId } })
  }))

  router.delete('/:id', permit('categories.manage'), originGuard, csrf, route(async (req, res) => {
    const id = parse(categoryIdSchema, req.params.id)
    res.json({ data: await service.delete(id, actor(req)), meta: { requestId: req.requestId } })
  }))

  router.use((error, req, res, next) => {
    if (!(error instanceof CategoryApiError)) return next(error)
    res.status(error.status).json({
      error: { code: error.code, message: error.message, requestId: req.requestId },
    })
  })
  return router
}

function parse(schema, value) {
  const result = schema.safeParse(value)
  if (!result.success) throw new CategoryApiError(400, 'INVALID_REQUEST', 'Category request is invalid.')
  return result.data
}

function actor(req) {
  return { userId: req.administrator.userId, requestId: req.requestId }
}

function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res)).catch(next)
}
