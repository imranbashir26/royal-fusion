import { nanoid } from 'nanoid'
import {
  AUTH_ERROR_CODES,
  createAuthError,
  evaluateOriginContract,
} from '../auth/contracts.js'
import {
  clearAuthCookies,
  readAuthCookies,
  setSessionCookies,
  verifyPreAuthCsrf,
  verifySessionCsrf,
} from '../auth/cookies.js'
import {
  AuthSessionError,
  isAccessTokenNearExpiry,
} from '../services/authSessionService.js'
import { AuthGatewayError } from '../services/supabaseAuthGateway.js'

export function requestContext(req, res, next) {
  const incoming = String(req.get('X-Request-ID') ?? '')
  req.requestId = /^[A-Za-z0-9_-]{8,80}$/.test(incoming) ? incoming : `req_${nanoid(12)}`
  res.set('X-Request-ID', req.requestId)
  next()
}

export function createOriginGuard(config) {
  return (req, res, next) => {
    const result = evaluateOriginContract({
      origin: req.get('Origin'),
      method: req.method,
      cookieAuthenticated: hasAnyAuthCookie(req, config),
      serverToServer: false,
      allowedOrigins: config.allowedOrigins,
      environment: config.environment,
      allowDevelopmentLoopback: config.allowDevelopmentLoopback,
    })
    if (!result.allowed) return sendAuthError(res, result.error, req.requestId)
    next()
  }
}

export function requirePreAuthCsrf(config) {
  return (req, res, next) => {
    if (!verifyPreAuthCsrf(req, config)) {
      return sendCode(res, AUTH_ERROR_CODES.CSRF_INVALID, req.requestId)
    }
    next()
  }
}

export function createOptionalIdentity({ config, sessionService }) {
  return async (req, res, next) => {
    let cookies = readAuthCookies(req, config)
    const supplied = [cookies.accessToken, cookies.refreshToken, cookies.sessionHandle]
    const present = supplied.filter(Boolean).length
    if (present === 0) {
      req.auth = null
      return next()
    }
    if (present !== supplied.length) {
      clearAuthCookies(res, config)
      return sendCode(res, AUTH_ERROR_CODES.INVALID_CREDENTIALS, req.requestId)
    }
    try {
      const result = await restoreRequestSession({ cookies, config, sessionService, res })
      const { restored } = result
      cookies = result.cookies
      req.auth = { ...restored, cookies }
      next()
    } catch (error) {
      if (error?.code !== AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE) {
        clearAuthCookies(res, config)
      }
      next(error)
    }
  }
}

export function requireIdentity(req, res, next) {
  if (!req.auth) return sendCode(res, AUTH_ERROR_CODES.AUTH_REQUIRED, req.requestId)
  next()
}

export function requireCustomerIdentity(req, res, next) {
  if (!req.auth) return sendCode(res, AUTH_ERROR_CODES.AUTH_REQUIRED, req.requestId)
  if (req.auth.record.sessionClass !== 'customer') {
    return sendCode(res, AUTH_ERROR_CODES.PERMISSION_DENIED, req.requestId)
  }
  next()
}

export function requireRecentAuthentication(config, clock = () => Date.now()) {
  return (req, res, next) => {
    if (!req.auth) return sendCode(res, AUTH_ERROR_CODES.AUTH_REQUIRED, req.requestId)
    const createdAt = new Date(req.auth.record.createdAt).getTime()
    const cutoff = clock() - config.sessionPolicy.recentAuthenticationSeconds * 1000
    if (!Number.isFinite(createdAt) || createdAt < cutoff) {
      return sendCode(res, AUTH_ERROR_CODES.AUTH_REQUIRED, req.requestId)
    }
    next()
  }
}

export function createAdminIdentity({ config, sessionService, adminAuthorization }) {
  return async (req, res, next) => {
    let cookies = readAuthCookies(req, config)
    try {
      const result = await restoreRequestSession({ cookies, config, sessionService, res })
      const { restored } = result
      cookies = result.cookies
      if (restored.record.sessionClass !== 'administrator') {
        return sendCode(res, AUTH_ERROR_CODES.PERMISSION_DENIED, req.requestId)
      }
      if (config.adminMfaEnabled &&
        (restored.record.mfaAssurance !== 'aal2' || restored.identity.assuranceLevel !== 'aal2')) {
        return sendCode(res, AUTH_ERROR_CODES.MFA_REQUIRED, req.requestId)
      }
      const administrator = await adminAuthorization.resolve(restored.identity.id)
      if (!administrator) {
        return sendCode(res, AUTH_ERROR_CODES.PERMISSION_DENIED, req.requestId)
      }
      req.auth = { ...restored, cookies }
      req.administrator = administrator
      next()
    } catch (error) {
      if (error?.code !== AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE) {
        clearAuthCookies(res, config)
      }
      next(error)
    }
  }
}

export function requireAuthenticatedCsrf(config) {
  return (req, res, next) => {
    if (!req.auth || !verifySessionCsrf({
      req,
      config,
      sessionHandle: req.auth.cookies.sessionHandle,
    })) {
      return sendCode(res, AUTH_ERROR_CODES.CSRF_INVALID, req.requestId)
    }
    next()
  }
}

export function authErrorHandler(config) {
  return (error, req, res, next) => {
    if (res.headersSent) return next(error)
    if (error instanceof AuthSessionError || error instanceof AuthGatewayError ||
      Object.values(AUTH_ERROR_CODES).includes(error?.code)) {
      if ([AUTH_ERROR_CODES.SESSION_EXPIRED, AUTH_ERROR_CODES.SESSION_REVOKED].includes(error.code)) {
        clearAuthCookies(res, config)
      }
      return sendCode(res, error.code, req.requestId)
    }
    next(error)
  }
}

export function sendCode(res, code, requestId) {
  return sendAuthError(res, createAuthError(code, requestId), requestId)
}

export function sendAuthError(res, contract, requestId) {
  const body = {
    error: {
      ...contract.body.error,
      requestId,
    },
  }
  return res.status(contract.status).json(body)
}

export function createRedactedRequestLogger(logger = console) {
  return (req, res, next) => {
    const startedAt = Date.now()
    res.on('finish', () => {
      logger.info?.({
        event: 'http.request',
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      })
    })
    next()
  }
}

function hasAnyAuthCookie(req, config) {
  const cookies = readAuthCookies(req, config)
  return Boolean(cookies.accessToken || cookies.refreshToken || cookies.sessionHandle)
}

async function restoreRequestSession({ cookies, config, sessionService, res }) {
  if (!isAccessTokenNearExpiry(cookies.accessToken, {
    windowSeconds: config.sessionPolicy.refreshWindowSeconds,
  })) {
    return { restored: await sessionService.restore(cookies), cookies }
  }

  const refreshed = await sessionService.refresh(cookies)
  setSessionCookies(res, config, refreshed)
  const rotatedCookies = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    sessionHandle: refreshed.sessionHandle,
    csrfToken: refreshed.csrfToken,
  }
  return {
    restored: { identity: refreshed.identity, record: refreshed.record },
    cookies: rotatedCookies,
  }
}
