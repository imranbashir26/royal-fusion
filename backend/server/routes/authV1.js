import { Router } from 'express'
import { AUTH_ERROR_CODES } from '../auth/contracts.js'
import {
  clearAuthCookies,
  clearStateCookie,
  createAuthFlowState,
  getStateCodeVerifier,
  issuePreAuthCsrf,
  readAuthCookies,
  setSessionCookies,
  setStateCookie,
  verifySessionCsrf,
} from '../auth/cookies.js'
import { authSchemas, validateAuthBody } from '../auth/schemas.js'
import {
  createOptionalIdentity,
  createOriginGuard,
  requireRecentAuthentication,
  requireAuthenticatedCsrf,
  requireIdentity,
  requirePreAuthCsrf,
  sendCode,
} from '../middleware/authSecurity.js'
import { createAuthRateLimiters } from '../middleware/authRateLimits.js'

export function createAuthV1Router(runtime, { rateLimitOverrides } = {}) {
  const router = Router()
  const { config, gateway, sessionService } = runtime
  const limiters = createAuthRateLimiters(rateLimitOverrides)
  const originGuard = createOriginGuard(config)
  const optionalIdentity = createOptionalIdentity({ config, sessionService })
  const preAuthCsrf = requirePreAuthCsrf(config)
  const authenticatedCsrf = requireAuthenticatedCsrf(config)

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    res.set('Referrer-Policy', 'no-referrer')
    next()
  })

  router.get('/session', optionalIdentity, asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    if (!req.auth) {
      const csrfToken = issuePreAuthCsrf(res, config)
      return res.json({
        data: { authenticated: false, csrfToken },
        meta: { requestId: req.requestId },
      })
    }
    return res.json({
      data: safeSessionData(req.auth, readAuthCookies(req, config).csrfToken),
      meta: { requestId: req.requestId },
    })
  }))

  router.post('/signup',
    originGuard,
    limiters.signUp,
    preAuthCsrf,
    validateAuthBody(authSchemas.signUp),
    asyncHandler(async (req, res) => {
      assertCustomerProvider(config)
      const state = createAuthFlowState()
      const result = await gateway.signUp({ ...req.body, state })
      if (result.codeVerifier) {
        setStateCookie(res, config, 'verification', {
          state,
          codeVerifier: result.codeVerifier,
        })
      }
      res.set('Cache-Control', 'no-store')
      res.status(202).json({
        data: { message: 'If the address is eligible, verification instructions will be sent.' },
        meta: { requestId: req.requestId },
      })
    }),
  )

  router.post('/signin',
    originGuard,
    limiters.signIn,
    preAuthCsrf,
    validateAuthBody(authSchemas.signIn),
    asyncHandler(async (req, res) => {
      assertCustomerProvider(config)
      const authResult = await gateway.signIn(req.body)
      if (!authResult.identity.emailVerified) {
        return sendCode(res, AUTH_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED, req.requestId)
      }
      const session = await sessionService.createSession(authResult, {
        sessionClass: 'customer',
        authenticationContext: 'standard',
        deviceMetadata: deviceMetadata(req),
      })
      setSessionCookies(res, config, session)
      res.set('Cache-Control', 'no-store')
      res.json({
        data: safeCreatedSessionData(session),
        meta: { requestId: req.requestId },
      })
    }),
  )

  router.post('/refresh',
    originGuard,
    limiters.refresh,
    asyncHandler(async (req, res) => {
      assertCustomerProvider(config)
      const cookies = readAuthCookies(req, config)
      if (!verifySessionCsrf({ req, config, sessionHandle: cookies.sessionHandle })) {
        return sendCode(res, AUTH_ERROR_CODES.CSRF_INVALID, req.requestId)
      }
      try {
        const session = await sessionService.refresh(cookies)
        setSessionCookies(res, config, session)
        res.set('Cache-Control', 'no-store')
        res.json({
          data: safeCreatedSessionData(session),
          meta: { requestId: req.requestId },
        })
      } catch (error) {
        if (error.code !== AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE) clearAuthCookies(res, config)
        throw error
      }
    }),
  )

  router.post('/signout',
    originGuard,
    optionalIdentity,
    requireIdentity,
    authenticatedCsrf,
    asyncHandler(async (req, res) => {
      await sessionService.signOut({
        accessToken: req.auth.cookies.accessToken,
        sessionHandle: req.auth.cookies.sessionHandle,
        userId: req.auth.identity.id,
      })
      clearAuthCookies(res, config)
      res.status(204).end()
    }),
  )

  router.post('/signout-all',
    originGuard,
    limiters.signOutAll,
    optionalIdentity,
    requireIdentity,
    authenticatedCsrf,
    requireRecentAuthentication(config),
    asyncHandler(async (req, res) => {
      await sessionService.signOutAll({
        accessToken: req.auth.cookies.accessToken,
        sessionHandle: req.auth.cookies.sessionHandle,
        userId: req.auth.identity.id,
      })
      clearAuthCookies(res, config)
      res.status(204).end()
    }),
  )

  router.post('/forgot-password',
    originGuard,
    limiters.forgotPassword,
    preAuthCsrf,
    validateAuthBody(authSchemas.forgotPassword),
    asyncHandler(async (req, res) => {
      assertCustomerProvider(config)
      const state = createAuthFlowState()
      const result = await gateway.forgotPassword({ email: req.body.email, state })
      if (result.codeVerifier) {
        setStateCookie(res, config, 'recovery', {
          state,
          codeVerifier: result.codeVerifier,
        })
      }
      res.status(202).json({
        data: { message: 'If an eligible account exists, recovery instructions will be sent.' },
        meta: { requestId: req.requestId },
      })
    }),
  )

  router.post('/verification/resend',
    originGuard,
    limiters.verificationResend,
    preAuthCsrf,
    validateAuthBody(authSchemas.resendVerification),
    asyncHandler(async (req, res) => {
      assertCustomerProvider(config)
      const state = createAuthFlowState()
      const result = await gateway.resendVerification({ ...req.body, state })
      if (result.codeVerifier) {
        setStateCookie(res, config, 'verification', {
          state,
          codeVerifier: result.codeVerifier,
        })
      }
      res.status(202).json({
        data: { message: 'If the address is eligible, verification instructions will be sent.' },
        meta: { requestId: req.requestId },
      })
    }),
  )

  router.get('/verify/callback',
    limiters.verificationCallback,
    asyncHandler(async (req, res) => {
      assertCustomerProvider(config)
      const type = req.query.type === 'recovery' ? 'recovery' : 'verification'
      const codeVerifier = getStateCodeVerifier(req, config, type, req.query.state)
      if (!codeVerifier || typeof req.query.code !== 'string' || !req.query.code) {
        return sendCode(res, AUTH_ERROR_CODES.INVALID_CREDENTIALS, req.requestId)
      }
      const authResult = await gateway.verifyCode({
        code: req.query.code,
        type: type === 'recovery' ? 'recovery' : 'email',
        codeVerifier,
      })
      const session = await sessionService.createSession(authResult, {
        sessionClass: 'customer',
        authenticationContext: type === 'recovery' ? 'recovery' : 'standard',
        deviceMetadata: deviceMetadata(req),
      })
      setSessionCookies(res, config, session)
      clearStateCookie(res, config, type)
      res.redirect(303, frontendRedirect(config, safeRelativeNext(req.query.next, type)))
    }),
  )

  router.post('/reset-password',
    originGuard,
    limiters.resetPassword,
    optionalIdentity,
    requireIdentity,
    authenticatedCsrf,
    validateAuthBody(authSchemas.resetPassword),
    asyncHandler(async (req, res) => {
      if (req.auth.record.authenticationContext !== 'recovery') {
        return sendCode(res, AUTH_ERROR_CODES.AUTH_REQUIRED, req.requestId)
      }
      await gateway.updatePassword({
        accessToken: req.auth.cookies.accessToken,
        refreshToken: req.auth.cookies.refreshToken,
        newPassword: req.body.newPassword,
      })
      await sessionService.signOutAll({
        accessToken: req.auth.cookies.accessToken,
        sessionHandle: req.auth.cookies.sessionHandle,
        userId: req.auth.identity.id,
      })
      clearAuthCookies(res, config)
      res.status(204).end()
    }),
  )

  return router
}

function safeSessionData(auth, csrfToken) {
  return {
    authenticated: true,
    identity: auth.identity,
    administrator: null,
    expiresAt: auth.record.absoluteExpiresAt,
    csrfToken,
  }
}

function safeCreatedSessionData(session) {
  return {
    authenticated: true,
    identity: session.identity,
    administrator: null,
    expiresAt: session.record.absoluteExpiresAt,
    csrfToken: session.csrfToken,
  }
}

function deviceMetadata(req) {
  const family = String(req.get('User-Agent') ?? '').split(/[ /]/, 1)[0]
  return { userAgentFamily: family, deviceLabel: '' }
}

function safeRelativeNext(value, type) {
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') &&
    !value.includes('\\')) return value
  return type === 'recovery' ? '/reset-password' : '/account'
}

function frontendRedirect(config, relativePath) {
  return new URL(relativePath, config.allowedOrigins[0]).toString()
}

function assertCustomerProvider(config) {
  if (config.customerProvider !== 'supabase') {
    const error = new Error('Customer authentication provider is disabled.')
    error.code = AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE
    throw error
  }
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}
