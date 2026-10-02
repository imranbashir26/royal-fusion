import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { createOptionalIdentity, createOriginGuard, requireAuthenticatedCsrf, sendCode } from '../middleware/authSecurity.js'
import { AUTH_ERROR_CODES } from '../auth/contracts.js'
import { parseCheckout, orderRequestSchema, quoteRequestSchema } from '../schemas/ordersV1.js'
import { CheckoutApiError, CheckoutQuoteService, unavailable } from '../services/checkoutQuoteService.js'
import { OrdersV1Service } from '../services/ordersV1Service.js'

export function createOrdersV1Router(runtime, { client = runtime.repository.client, logger = console, orderLimit = 20, quoteLimit = 60 } = {}) {
  const router = Router(), quote = new CheckoutQuoteService(client, { logger }), orders = new OrdersV1Service(client, { logger, quoteService: quote })
  const limiter = (limit, windowMs) => rateLimit({ limit, windowMs, standardHeaders: true, legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: { code: 'CHECKOUT_RATE_LIMITED', message: 'Please wait before trying checkout again.', requestId: req.requestId } }) })
  const secure = [createOriginGuard(runtime.config), createOptionalIdentity(runtime), (req, res, next) => {
    if (req.auth?.record.sessionClass !== undefined && req.auth.record.sessionClass !== 'customer') return sendCode(res, AUTH_ERROR_CODES.PERMISSION_DENIED, req.requestId)
    if (req.auth) return requireAuthenticatedCsrf(runtime.config)(req, res, next)
    next()
  }, (req, _res, next) => {
    if (!req.is('application/json') || Buffer.byteLength(JSON.stringify(req.body ?? {})) > 32768) return next(new CheckoutApiError(400, 'INVALID_CHECKOUT_REQUEST', 'Checkout request is invalid.'))
    next()
  }]
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.post('/orders', limiter(orderLimit, 15 * 60 * 1000), ...secure, route(async (req, res) => {
    // Launch gate: relational fulfillment is not implemented. Never enable production purchasing implicitly.
    if (runtime.config.environment === 'production') throw unavailable()
    const input = parseCheckout(orderRequestSchema, req.body)
    const data = await orders.create(input, req.auth?.identity.id ?? null, req.requestId)
    res.status(data.idempotent ? 200 : 201).json({ data, meta: { requestId: req.requestId } })
  }))
  router.post('/checkout/quote', limiter(quoteLimit, 60 * 1000), ...secure, route(async (req, res) => {
    const data = await quote.withRequestId(req.requestId).quote(parseCheckout(quoteRequestSchema, req.body), req.auth?.identity.id ?? null)
    res.json({ data: { ...data, orderingEnabled: runtime.config.environment !== 'production' }, meta: { requestId: req.requestId } })
  }))
  router.use((error, req, res, next) => {
    if (Object.values(AUTH_ERROR_CODES).includes(error.code)) return next(error)
    const known = error instanceof CheckoutApiError || typeof error.code === 'string' && error.code.startsWith('INVALID_')
    logger.warn?.({ event: 'checkout.request_failed', requestId: req.requestId, operation: 'request', subsystem: 'orders_v1',
      category: known ? error.code : 'UNEXPECTED_FAILURE' })
    res.status(known ? error.status : 500).json({ error: { code: known ? error.code : 'CHECKOUT_FAILED', message: known ? error.message : 'Checkout could not be completed.', requestId: req.requestId } })
  })
  return router
}
const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next)
