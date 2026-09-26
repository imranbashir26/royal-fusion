import { Router } from 'express'
import { AUTH_ERROR_CODES } from '../auth/contracts.js'
import {
  createAdminIdentity,
  createOriginGuard,
  requireAuthenticatedCsrf,
  sendCode,
} from '../middleware/authSecurity.js'
import { finderPreferenceKeySchema, updateFinderPreferenceSchema } from '../schemas/fragranceFinderAdmin.js'
import { FinderApiError, FragranceFinderService } from '../services/fragranceFinderService.js'

export function createAdminFragranceFinderV1Router(runtime, { client = runtime.repository.client, logger = console } = {}) {
  const router = Router()
  const service = new FragranceFinderService(client, logger)
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.use(createAdminIdentity(runtime))
  router.use((req, res, next) => {
    const keys = req.administrator.permissions
    if (!keys.includes('*') && !keys.includes('homepage.manage')) {
      return sendCode(res, AUTH_ERROR_CODES.PERMISSION_DENIED, req.requestId)
    }
    next()
  })

  router.get('/', route(async (_req, res) => {
    res.json({ data: await service.listAdmin() })
  }))
  router.get('/products', route(async (_req, res) => {
    res.json({ data: await service.eligibleProducts() })
  }))
  router.put('/:key', createOriginGuard(runtime.config), requireAuthenticatedCsrf(runtime.config), route(async (req, res) => {
    const key = parse(finderPreferenceKeySchema, req.params.key)
    const input = parse(updateFinderPreferenceSchema, req.body)
    const data = await service.update(key, input, {
      userId: req.administrator.userId,
      requestId: req.requestId,
    })
    res.json({ data, meta: { requestId: req.requestId } })
  }))
  router.use(errorHandler)
  return router
}

export function createPublicFragranceFinderV1Router(runtime, { client = runtime.repository.client, logger = console } = {}) {
  const router = Router()
  const service = new FragranceFinderService(client, logger)
  router.get('/', route(async (_req, res) => {
    res.set('Cache-Control', 'no-store')
    res.json({ data: await service.listPublic() })
  }))
  router.use(errorHandler)
  return router
}

function parse(schema, value) {
  const result = schema.safeParse(value)
  if (!result.success) throw new FinderApiError(400, 'INVALID_REQUEST', 'Finder request is invalid.')
  return result.data
}

function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res)).catch(next)
}

function errorHandler(error, req, res, next) {
  if (!(error instanceof FinderApiError)) return next(error)
  res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: req.requestId } })
}
