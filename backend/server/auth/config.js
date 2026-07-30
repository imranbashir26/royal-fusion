import { validateAuthFeatureFlags, validateCorsPolicy } from './contracts.js'

const DEFAULTS = Object.freeze({
  customerIdleSeconds: 7 * 24 * 60 * 60,
  customerAbsoluteSeconds: 30 * 24 * 60 * 60,
  adminIdleSeconds: 30 * 60,
  adminAbsoluteSeconds: 8 * 60 * 60,
  accessCookieSeconds: 60 * 60,
  refreshWindowSeconds: 5 * 60,
  refreshLeaseSeconds: 30,
  recentAuthenticationSeconds: 15 * 60,
  recoverySessionSeconds: 60 * 60,
  verificationStateSeconds: 24 * 60 * 60,
})

export function createAuthConfig(env = process.env) {
  const environment = normalizeEnvironment(env.NODE_ENV)
  const development = environment !== 'production'
  const flags = validateAuthFeatureFlags({
    CUSTOMER_AUTH_PROVIDER: env.CUSTOMER_AUTH_PROVIDER ?? (development ? 'prototype' : ''),
    ADMIN_AUTH_PROVIDER: env.ADMIN_AUTH_PROVIDER ?? (development ? 'prototype' : ''),
    ENABLE_GUEST_ORDER_LINKING: env.ENABLE_GUEST_ORDER_LINKING ?? 'false',
    ENABLE_ADMIN_MFA: env.ENABLE_ADMIN_MFA ?? (development ? 'false' : ''),
  }, environment)

  const allowedOrigins = parseOrigins(
    env.CLIENT_ORIGIN ?? (development ? 'http://localhost:5173' : ''),
  )
  validateCorsPolicy({ allowedOrigins, credentials: true, environment })

  const allowDevelopmentLoopback = parseBoolean(
    env.AUTH_ALLOW_DEV_LOOPBACK ?? (development ? 'true' : 'false'),
    'AUTH_ALLOW_DEV_LOOPBACK',
  )
  const secureCookies = parseBoolean(
    env.AUTH_SECURE_COOKIES ?? (environment === 'production' ? 'true' : 'false'),
    'AUTH_SECURE_COOKIES',
  )
  const trustProxy = parseBoolean(
    env.AUTH_TRUST_PROXY ?? (environment === 'production' ? 'true' : 'false'),
    'AUTH_TRUST_PROXY',
  )
  const csrfSecret = String(
    env.AUTH_CSRF_SECRET ?? (development ? env.JWT_SECRET ?? '' : ''),
  )
  const sessionPolicy = Object.freeze({
    customerIdleSeconds: positiveInteger(env.CUSTOMER_SESSION_IDLE_SECONDS, DEFAULTS.customerIdleSeconds),
    customerAbsoluteSeconds: positiveInteger(env.CUSTOMER_SESSION_ABSOLUTE_SECONDS, DEFAULTS.customerAbsoluteSeconds),
    adminIdleSeconds: positiveInteger(env.ADMIN_SESSION_IDLE_SECONDS, DEFAULTS.adminIdleSeconds),
    adminAbsoluteSeconds: positiveInteger(env.ADMIN_SESSION_ABSOLUTE_SECONDS, DEFAULTS.adminAbsoluteSeconds),
    accessCookieSeconds: positiveInteger(env.AUTH_ACCESS_COOKIE_SECONDS, DEFAULTS.accessCookieSeconds),
    refreshWindowSeconds: positiveInteger(env.AUTH_REFRESH_WINDOW_SECONDS, DEFAULTS.refreshWindowSeconds),
    refreshLeaseSeconds: boundedInteger(env.AUTH_REFRESH_LEASE_SECONDS, DEFAULTS.refreshLeaseSeconds, 5, 120),
    recentAuthenticationSeconds: positiveInteger(
      env.AUTH_RECENT_AUTH_SECONDS,
      DEFAULTS.recentAuthenticationSeconds,
    ),
    recoverySessionSeconds: positiveInteger(
      env.AUTH_RECOVERY_SESSION_SECONDS,
      DEFAULTS.recoverySessionSeconds,
    ),
    verificationStateSeconds: positiveInteger(
      env.AUTH_VERIFICATION_STATE_SECONDS,
      DEFAULTS.verificationStateSeconds,
    ),
  })
  const authCallbackUrl = safeCallbackUrl(env.AUTH_CALLBACK_URL, environment)

  validateSessionPolicy(sessionPolicy)
  if (csrfSecret.length < 32) {
    throw new TypeError('AUTH_CSRF_SECRET must contain at least 32 characters.')
  }
  if (environment === 'production') {
    if (!secureCookies) throw new TypeError('Production authentication cookies must be secure.')
    if (!trustProxy) throw new TypeError('Production authentication requires trusted HTTPS proxy configuration.')
    if (allowDevelopmentLoopback) throw new TypeError('Production cannot allow development loopback origins.')
    if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SECRET_KEY?.trim()) {
      throw new TypeError('Production Supabase authentication configuration is incomplete.')
    }
  }
  if (flags.customerProvider === 'supabase' && !authCallbackUrl) {
    throw new TypeError('Supabase customer authentication callback is required.')
  }

  return Object.freeze({
    environment,
    ...flags,
    allowedOrigins,
    allowDevelopmentLoopback,
    secureCookies,
    trustProxy,
    csrfSecret,
    sessionPolicy,
    authCallbackUrl,
    supabaseConfigured: Boolean(env.SUPABASE_URL?.trim() && env.SUPABASE_SECRET_KEY?.trim()),
  })
}

export function getAuthReadiness(config) {
  const providersEnabled = config.customerProvider === 'supabase' ||
    config.adminProvider === 'supabase'
  if (!providersEnabled) {
    return Object.freeze({ configured: false, status: 'disabled' })
  }
  return Object.freeze({
    configured: config.supabaseConfigured,
    status: config.supabaseConfigured ? 'configured' : 'unavailable',
  })
}

export function isAllowedCorsOrigin(origin, config) {
  if (!origin) return true
  if (config.allowedOrigins.includes(origin)) return true
  if (config.environment === 'production' || !config.allowDevelopmentLoopback) return false
  try {
    const url = new URL(origin)
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    return url.origin === origin &&
      (hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname))
  } catch {
    return false
  }
}

function normalizeEnvironment(value) {
  const environment = value || 'development'
  if (!['development', 'test', 'production'].includes(environment)) {
    throw new TypeError('NODE_ENV is invalid for authentication.')
  }
  return environment
}

function parseOrigins(value) {
  const origins = String(value).split(',').map((origin) => origin.trim()).filter(Boolean)
  if (origins.length === 0) throw new TypeError('CLIENT_ORIGIN must contain an exact origin.')
  for (const origin of origins) {
    const url = new URL(origin)
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) {
      throw new TypeError('CLIENT_ORIGIN contains an invalid exact origin.')
    }
  }
  return Object.freeze([...new Set(origins)])
}

function parseBoolean(value, name) {
  if (value !== 'true' && value !== 'false') throw new TypeError(`${name} must be true or false.`)
  return value === 'true'
}

function positiveInteger(value, fallback) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError('Authentication duration configuration is invalid.')
  }
  return parsed
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = positiveInteger(value, fallback)
  if (parsed < minimum || parsed > maximum) {
    throw new TypeError('Authentication duration configuration is outside its safe range.')
  }
  return parsed
}

function validateSessionPolicy(policy) {
  if (policy.customerIdleSeconds > policy.customerAbsoluteSeconds ||
    policy.adminIdleSeconds > policy.adminAbsoluteSeconds ||
    policy.adminAbsoluteSeconds > policy.customerAbsoluteSeconds ||
    policy.accessCookieSeconds > policy.adminAbsoluteSeconds ||
    policy.refreshWindowSeconds >= policy.accessCookieSeconds ||
    policy.recentAuthenticationSeconds > policy.adminAbsoluteSeconds ||
    policy.recoverySessionSeconds > policy.customerAbsoluteSeconds) {
    throw new TypeError('Authentication session durations are inconsistent.')
  }
}

function safeCallbackUrl(value, environment) {
  if (!value) return ''
  const url = new URL(value)
  if (environment === 'production' && url.protocol !== 'https:') {
    throw new TypeError('Production authentication callback must use HTTPS.')
  }
  if (url.username || url.password || url.search || url.hash ||
    url.pathname !== '/api/v1/auth/verify/callback') {
    throw new TypeError('Authentication callback URL is invalid.')
  }
  return url.toString()
}
