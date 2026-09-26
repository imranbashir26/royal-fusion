import { Router } from 'express'
import { AUTH_ERROR_CODES } from '../auth/contracts.js'
import { createAdminIdentity, createOriginGuard, requireAuthenticatedCsrf, sendCode } from '../middleware/authSecurity.js'
import { settingsSectionSchema, validateSettingsPatch } from '../schemas/settingsV1.js'
import { SettingsApiError, SettingsV1Service } from '../services/settingsV1Service.js'

export function createAdminSettingsV1Router(runtime, { client = runtime.repository.client, logger = console } = {}) {
  const router = Router()
  const service = new SettingsV1Service(client, logger)
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.use(createAdminIdentity(runtime))
  router.use((req, res, next) => {
    const keys = req.administrator.permissions
    if (!keys.includes('*') && !keys.includes('settings.manage')) {
      return sendCode(res, AUTH_ERROR_CODES.PERMISSION_DENIED, req.requestId)
    }
    next()
  })
  router.get('/', route(async (_req, res) => res.json({ data: await service.get() })))
  router.put('/:section', createOriginGuard(runtime.config), requireAuthenticatedCsrf(runtime.config), route(async (req, res) => {
    const sectionResult = settingsSectionSchema.safeParse(req.params.section)
    if (!sectionResult.success) throw invalid()
    const patchResult = validateSettingsPatch(sectionResult.data, req.body)
    if (!patchResult.success) throw invalid()
    const data = await service.update(sectionResult.data, patchResult.data, {
      userId: req.administrator.userId, requestId: req.requestId,
    })
    res.json({ data })
  }))
  router.use((error, req, res, next) => {
    if (!(error instanceof SettingsApiError)) return next(error)
    res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: req.requestId } })
  })
  return router
}

function invalid() { return new SettingsApiError(400, 'INVALID_SETTINGS_REQUEST', 'Settings request is invalid.') }
function route(handler) { return (req, res, next) => Promise.resolve(handler(req, res)).catch(next) }
