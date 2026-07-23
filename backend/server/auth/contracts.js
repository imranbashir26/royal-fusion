import { createHash, timingSafeEqual } from 'node:crypto'

export const AUTH_ERROR_CODES = Object.freeze({
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_VERIFICATION_REQUIRED: 'EMAIL_VERIFICATION_REQUIRED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  CSRF_INVALID: 'CSRF_INVALID',
  ORIGIN_NOT_ALLOWED: 'ORIGIN_NOT_ALLOWED',
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_CHALLENGE_FAILED: 'MFA_CHALLENGE_FAILED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INVITATION_INVALID: 'INVITATION_INVALID',
  INVITATION_EXPIRED: 'INVITATION_EXPIRED',
  CLAIM_INVALID: 'CLAIM_INVALID',
  CLAIM_EXPIRED: 'CLAIM_EXPIRED',
  CLAIM_ALREADY_USED: 'CLAIM_ALREADY_USED',
  RATE_LIMITED: 'RATE_LIMITED',
  AUTH_SERVICE_UNAVAILABLE: 'AUTH_SERVICE_UNAVAILABLE',
})

const ERROR_CONTRACTS = Object.freeze({
  AUTH_REQUIRED: [401, 'Authentication is required.'],
  INVALID_CREDENTIALS: [401, 'Unable to sign in with those details.'],
  EMAIL_VERIFICATION_REQUIRED: [403, 'Email verification is required.'],
  SESSION_EXPIRED: [401, 'Your session has expired. Please sign in again.'],
  SESSION_REVOKED: [401, 'Your session is no longer active. Please sign in again.'],
  CSRF_INVALID: [403, 'The request could not be verified.'],
  ORIGIN_NOT_ALLOWED: [403, 'The request origin is not allowed.'],
  MFA_REQUIRED: [403, 'Multi-factor authentication is required.'],
  MFA_CHALLENGE_FAILED: [401, 'The verification code could not be accepted.'],
  PERMISSION_DENIED: [403, 'You do not have permission for this action.'],
  INVITATION_INVALID: [400, 'The invitation is invalid or unavailable.'],
  INVITATION_EXPIRED: [410, 'The invitation has expired.'],
  CLAIM_INVALID: [400, 'The order claim is invalid or unavailable.'],
  CLAIM_EXPIRED: [410, 'The order claim has expired.'],
  CLAIM_ALREADY_USED: [409, 'The order claim has already been used.'],
  RATE_LIMITED: [429, 'Too many requests. Please try again later.'],
  AUTH_SERVICE_UNAVAILABLE: [503, 'Authentication is temporarily unavailable.'],
})

export const AUTH_COOKIE_KINDS = Object.freeze({
  access: Object.freeze({ suffix: 'at', purpose: 'access', httpOnly: true }),
  refresh: Object.freeze({ suffix: 'rt', purpose: 'refresh', httpOnly: true }),
  session: Object.freeze({ suffix: 'sid', purpose: 'session', httpOnly: true }),
  csrf: Object.freeze({ suffix: 'csrf', purpose: 'csrf', httpOnly: false }),
})

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const AUTH_PROVIDERS = new Set(['prototype', 'supabase'])
const BOOLEAN_FLAGS = new Set(['true', 'false'])
const RUNTIME_ENVIRONMENTS = new Set(['development', 'test', 'production'])

export function createAuthError(code, requestId = 'request_unavailable') {
  const contract = ERROR_CONTRACTS[code]
  if (!contract) throw new TypeError('Unknown authentication error code.')

  return Object.freeze({
    status: contract[0],
    body: Object.freeze({
      error: Object.freeze({ code, message: contract[1], requestId }),
    }),
  })
}

export function createCookieContract(kind, options = {}) {
  const definition = AUTH_COOKIE_KINDS[kind]
  if (!definition) throw new TypeError('Unknown authentication cookie kind.')

  const environment = options.environment ?? 'production'
  const secureTransport = options.secureTransport ?? environment === 'production'
  assertRuntimeEnvironment(environment)
  if (typeof secureTransport !== 'boolean') {
    throw new TypeError('Authentication cookie transport configuration is invalid.')
  }
  if (environment === 'production' && !secureTransport) {
    throw new TypeError('Production authentication cookies require secure transport.')
  }

  const hostPrefixed = secureTransport
  const name = hostPrefixed
    ? `__Host-rf-${definition.suffix}`
    : `rf-dev-${definition.suffix}`
  const attributes = {
    httpOnly: definition.httpOnly,
    secure: secureTransport,
    sameSite: 'lax',
    path: '/',
  }

  if (options.clear) {
    attributes.maxAge = 0
    attributes.expires = new Date(0)
  }

  return Object.freeze({
    name,
    purpose: definition.purpose,
    attributes: Object.freeze(attributes),
  })
}

export function createCsrfBinding(sessionId, token) {
  if (!sessionId || !token) throw new TypeError('CSRF binding inputs are required.')
  return createHash('sha256').update(`${sessionId}\0${token}`).digest('hex')
}

export function evaluateCsrfContract({
  method,
  cookieAuthenticated,
  sessionId,
  suppliedToken,
  expectedBinding,
}) {
  if (SAFE_METHODS.has(String(method).toUpperCase()) || !cookieAuthenticated) {
    return Object.freeze({ allowed: true })
  }

  if (!sessionId || !suppliedToken || !expectedBinding) {
    return Object.freeze({ allowed: false, error: createAuthError(AUTH_ERROR_CODES.CSRF_INVALID) })
  }

  const actual = Buffer.from(createCsrfBinding(sessionId, suppliedToken), 'hex')
  const expected = Buffer.from(expectedBinding, 'hex')
  const matches = actual.length === expected.length && timingSafeEqual(actual, expected)
  return matches
    ? Object.freeze({ allowed: true })
    : Object.freeze({ allowed: false, error: createAuthError(AUTH_ERROR_CODES.CSRF_INVALID) })
}

export function validateCorsPolicy({ allowedOrigins, credentials, environment }) {
  assertRuntimeEnvironment(environment)
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    throw new TypeError('At least one exact origin is required.')
  }
  if (credentials && allowedOrigins.includes('*')) {
    throw new TypeError('Wildcard origins cannot be used with credentials.')
  }
  if (environment === 'production' && allowedOrigins.some(isLoopbackOrigin)) {
    throw new TypeError('Production origins cannot include loopback hosts.')
  }

  return Object.freeze({ allowedOrigins: Object.freeze([...allowedOrigins]), credentials: Boolean(credentials) })
}

export function evaluateOriginContract({
  origin,
  method,
  cookieAuthenticated,
  serverToServer = false,
  allowedOrigins,
  environment = 'production',
  allowDevelopmentLoopback = false,
}) {
  assertRuntimeEnvironment(environment)
  const mutation = !SAFE_METHODS.has(String(method).toUpperCase())
  if (!origin) {
    const allowed = !mutation || (!cookieAuthenticated && serverToServer)
    return allowed
      ? Object.freeze({ allowed: true })
      : Object.freeze({ allowed: false, error: createAuthError(AUTH_ERROR_CODES.ORIGIN_NOT_ALLOWED) })
  }

  const exactMatch = allowedOrigins.includes(origin)
  const developmentLoopback = environment !== 'production' &&
    allowDevelopmentLoopback && isLoopbackOrigin(origin)
  return exactMatch || developmentLoopback
    ? Object.freeze({ allowed: true })
    : Object.freeze({ allowed: false, error: createAuthError(AUTH_ERROR_CODES.ORIGIN_NOT_ALLOWED) })
}

export function validateAuthFeatureFlags(serverConfig, environment = 'development') {
  assertRuntimeEnvironment(environment)
  const customerProvider = String(serverConfig.CUSTOMER_AUTH_PROVIDER ?? '')
  const adminProvider = String(serverConfig.ADMIN_AUTH_PROVIDER ?? '')
  const guestLinking = String(serverConfig.ENABLE_GUEST_ORDER_LINKING ?? '')
  const adminMfa = String(serverConfig.ENABLE_ADMIN_MFA ?? '')

  if (!AUTH_PROVIDERS.has(customerProvider) || !AUTH_PROVIDERS.has(adminProvider)) {
    throw new TypeError('Authentication provider configuration is invalid.')
  }
  if (!BOOLEAN_FLAGS.has(guestLinking) || !BOOLEAN_FLAGS.has(adminMfa)) {
    throw new TypeError('Authentication feature flag configuration is invalid.')
  }
  if (environment === 'production' &&
    (customerProvider !== 'supabase' || adminProvider !== 'supabase' || adminMfa !== 'true')) {
    throw new TypeError('Production authentication configuration is not ready.')
  }

  return Object.freeze({
    customerProvider,
    adminProvider,
    guestOrderLinkingEnabled: guestLinking === 'true',
    adminMfaEnabled: adminMfa === 'true',
  })
}

export function evaluateOptionalAuthentication({ credentialState, verifiedCustomerId, browserCustomerId }) {
  if (browserCustomerId !== undefined) {
    return Object.freeze({
      allowed: false,
      error: createAuthError(AUTH_ERROR_CODES.PERMISSION_DENIED),
    })
  }
  if (credentialState === 'absent') return Object.freeze({ allowed: true, mode: 'guest' })
  if (credentialState === 'valid' && verifiedCustomerId) {
    return Object.freeze({ allowed: true, mode: 'customer', customerId: verifiedCustomerId })
  }
  return Object.freeze({
    allowed: false,
    error: createAuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS),
  })
}

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin)
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    return url.origin === origin &&
      (hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname))
  } catch {
    return false
  }
}

function assertRuntimeEnvironment(environment) {
  if (!RUNTIME_ENVIRONMENTS.has(environment)) {
    throw new TypeError('Runtime environment configuration is invalid.')
  }
}
