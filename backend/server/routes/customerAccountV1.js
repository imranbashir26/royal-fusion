import { Router } from 'express'
import { z } from 'zod'
import { createOptionalIdentity, createOriginGuard, requireCustomerIdentity, requireAuthenticatedCsrf, sendCode } from '../middleware/authSecurity.js'
import { AUTH_ERROR_CODES } from '../auth/contracts.js'
import { validateAuthBody } from '../auth/schemas.js'

const patch = z.object({ name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).regex(/^$|^\+?[0-9\s().-]{7,40}$/) }).strict()

export function createCustomerAccountV1Router(runtime, { client = runtime.repository.client } = {}) {
  const router = Router()
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.use(createOriginGuard(runtime.config), createOptionalIdentity(runtime), requireCustomerIdentity)
  router.use((req, res, next) => req.auth.identity.emailVerified ? next() : sendCode(res, AUTH_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED, req.requestId))
  const run = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next)
  async function read(req) {
    const { data, error } = await client.from('profiles').select('id,full_name,phone,status').eq('id', req.auth.identity.id).maybeSingle()
    if (error) throw Object.assign(new Error('Customer account unavailable.'), { code: AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE })
    return data?.status === 'Active' ? data : null
  }
  const dto = (row, identity) => ({ id: identity.id, name: row.full_name ?? '', email: identity.email,
    phone: row.phone ?? '', address: '', city: '', province: '' })
  router.get('/profile', run(async (req, res) => {
    const row = await read(req)
    if (!row) return sendCode(res, AUTH_ERROR_CODES.PERMISSION_DENIED, req.requestId)
    res.json({ data: dto(row, req.auth.identity), meta: { requestId: req.requestId } })
  }))
  router.patch('/profile', requireAuthenticatedCsrf(runtime.config), validateAuthBody(patch), run(async (req, res) => {
    if (!await read(req)) return sendCode(res, AUTH_ERROR_CODES.PERMISSION_DENIED, req.requestId)
    const { data, error } = await client.from('profiles').update({ full_name: req.body.name, phone: req.body.phone || null })
      .eq('id', req.auth.identity.id).eq('status', 'Active').select('id,full_name,phone,status').maybeSingle()
    if (error) throw Object.assign(new Error('Customer account unavailable.'), { code: AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE })
    if (!data) return sendCode(res, AUTH_ERROR_CODES.PERMISSION_DENIED, req.requestId)
    res.json({ data: dto(data, req.auth.identity), meta: { requestId: req.requestId } })
  }))
  return router
}
