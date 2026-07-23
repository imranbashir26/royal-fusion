import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  AUTH_COOKIE_KINDS,
  AUTH_ERROR_CODES,
  createAuthError,
  createCookieContract,
  createCsrfBinding,
  evaluateCsrfContract,
  evaluateOptionalAuthentication,
  evaluateOriginContract,
  validateAuthFeatureFlags,
  validateCorsPolicy,
} from '../auth/contracts.js'
import { MockSupabaseAuthGateway } from './support/mockSupabaseAuthGateway.js'
import {
  CUSTOMER_PERMISSIONS,
  MANAGER_CAPABILITIES,
  MANAGER_FORBIDDEN_CAPABILITIES,
  MANAGER_FORBIDDEN_PERMISSIONS,
  MANAGER_PERMISSIONS,
  OWNER_CAPABILITIES,
  OWNER_PERMISSIONS,
} from './support/permissionFixtures.js'

const expectedErrorCodes = [
  'AUTH_REQUIRED', 'INVALID_CREDENTIALS', 'EMAIL_VERIFICATION_REQUIRED',
  'SESSION_EXPIRED', 'SESSION_REVOKED', 'CSRF_INVALID', 'ORIGIN_NOT_ALLOWED',
  'MFA_REQUIRED', 'MFA_CHALLENGE_FAILED', 'PERMISSION_DENIED', 'INVITATION_INVALID',
  'INVITATION_EXPIRED', 'CLAIM_INVALID', 'CLAIM_EXPIRED', 'CLAIM_ALREADY_USED',
  'RATE_LIMITED', 'AUTH_SERVICE_UNAVAILABLE',
]

test('stable authentication error codes and safe response shapes are complete', () => {
  assert.deepEqual(Object.keys(AUTH_ERROR_CODES), expectedErrorCodes)
  for (const code of expectedErrorCodes) {
    const response = createAuthError(code, 'request_test')
    assert.equal(response.body.error.code, code)
    assert.equal(typeof response.body.error.message, 'string')
    assert.equal(response.body.error.requestId, 'request_test')
    assert.deepEqual(Object.keys(response.body.error).sort(), ['code', 'message', 'requestId'])
    assert.doesNotMatch(JSON.stringify(response), /token|cookie|password|stack|sql|supabase/i)
  }
})

test('mock gateway covers approved identities and safe failure outcomes without network access', async () => {
  const gateway = new MockSupabaseAuthGateway()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('External network is forbidden in Auth contract tests.') }
  try {
    for (const type of ['owner', 'manager', 'customer']) {
      const result = await gateway.verifyIdentity(type)
      assert.equal(result.authenticated, true)
      assert.equal(result.identity.type, type)
    }
    assert.deepEqual(await gateway.verifyIdentity('unauthenticated'), { authenticated: false })
    assert.equal((await gateway.signIn('invalid')).code, AUTH_ERROR_CODES.INVALID_CREDENTIALS)
    assert.equal((await gateway.signIn('unverified')).code, AUTH_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED)
    assert.equal((await gateway.verifyIdentity('expired')).code, AUTH_ERROR_CODES.SESSION_EXPIRED)
    assert.equal((await gateway.verifyIdentity('revoked')).code, AUTH_ERROR_CODES.SESSION_REVOKED)
    assert.equal((await gateway.refresh('success')).refreshed, true)
    assert.equal((await gateway.refresh('failure')).code, AUTH_ERROR_CODES.SESSION_EXPIRED)
    assert.equal((await gateway.refresh('unavailable')).code, AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('session-state contracts are stable, safe, and machine readable', async () => {
  const gateway = new MockSupabaseAuthGateway()
  const authenticated = await gateway.verifyIdentity('customer')
  const unauthenticated = await gateway.verifyIdentity('unauthenticated')
  assert.deepEqual(authenticated, {
    authenticated: true,
    identity: {
      id: '00000000-0000-4000-8000-000000000103',
      type: 'customer',
      emailVerified: true,
    },
  })
  assert.deepEqual(unauthenticated, { authenticated: false })

  const states = [
    await gateway.verifyIdentity('expired'),
    await gateway.verifyIdentity('revoked'),
    await gateway.verifyIdentity('unavailable'),
    createAuthError(AUTH_ERROR_CODES.MFA_REQUIRED).body,
    createAuthError(AUTH_ERROR_CODES.PERMISSION_DENIED).body,
  ]
  assert.deepEqual(states.slice(0, 3).map((state) => state.code), [
    AUTH_ERROR_CODES.SESSION_EXPIRED,
    AUTH_ERROR_CODES.SESSION_REVOKED,
    AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE,
  ])
  assert.equal(states[3].error.code, AUTH_ERROR_CODES.MFA_REQUIRED)
  assert.equal(states[4].error.code, AUTH_ERROR_CODES.PERMISSION_DENIED)
  assert.doesNotMatch(JSON.stringify({ authenticated, unauthenticated, states }), /accessToken|refreshToken|cookie|password|stack|sql/i)
})

test('future authentication cookies satisfy the production __Host- contract', () => {
  const access = createCookieContract('access')
  const refresh = createCookieContract('refresh')
  assert.equal(access.name, '__Host-rf-at')
  assert.equal(refresh.name, '__Host-rf-rt')
  assert.notEqual(access.purpose, refresh.purpose)

  for (const kind of Object.keys(AUTH_COOKIE_KINDS)) {
    const cookie = createCookieContract(kind)
    assert.equal(cookie.attributes.secure, true)
    assert.equal(cookie.attributes.sameSite, 'lax')
    assert.equal(cookie.attributes.path, '/')
    assert.equal('domain' in cookie.attributes, false)
    assert.equal(cookie.attributes.httpOnly, kind !== 'csrf')
  }
  assert.throws(
    () => createCookieContract('access', { environment: 'production', secureTransport: false }),
    /secure transport/,
  )
  assert.throws(
    () => createCookieContract('access', { environment: 'prodution' }),
    /environment configuration/,
  )
})

test('logout and revocation cookie clearing preserves security attributes', () => {
  for (const kind of Object.keys(AUTH_COOKIE_KINDS)) {
    const cleared = createCookieContract(kind, { clear: true })
    assert.equal(cleared.attributes.maxAge, 0)
    assert.equal(cleared.attributes.expires.getTime(), 0)
    assert.equal(cleared.attributes.secure, true)
    assert.equal(cleared.attributes.path, '/')
  }
})

test('development HTTP cookie names are explicit and never misuse __Host-', () => {
  const cookie = createCookieContract('access', {
    environment: 'development',
    secureTransport: false,
  })
  assert.equal(cookie.name, 'rf-dev-at')
  assert.equal(cookie.name.startsWith('__Host-'), false)
})

test('CSRF contract requires a correct session-bound token only for cookie mutations', () => {
  const sessionId = 'session-test'
  const token = 'x'.repeat(32)
  const binding = createCsrfBinding(sessionId, token)

  assert.equal(evaluateCsrfContract({ method: 'GET', cookieAuthenticated: true }).allowed, true)
  assert.equal(evaluateCsrfContract({ method: 'POST', cookieAuthenticated: false }).allowed, true)
  assert.equal(evaluateCsrfContract({ method: 'POST', cookieAuthenticated: true }).allowed, false)
  assert.equal(evaluateCsrfContract({
    method: 'POST', cookieAuthenticated: true, sessionId, suppliedToken: 'y'.repeat(32), expectedBinding: binding,
  }).allowed, false)
  assert.equal(evaluateCsrfContract({
    method: 'POST', cookieAuthenticated: true, sessionId: 'other-session', suppliedToken: token, expectedBinding: binding,
  }).allowed, false)
  assert.equal(evaluateCsrfContract({
    method: 'POST', cookieAuthenticated: true, sessionId, suppliedToken: token, expectedBinding: binding,
  }).allowed, true)

  const failure = evaluateCsrfContract({ method: 'POST', cookieAuthenticated: true })
  assert.equal(failure.error.body.error.code, AUTH_ERROR_CODES.CSRF_INVALID)
  assert.doesNotMatch(JSON.stringify(failure), new RegExp(token))
})

test('Origin and CORS contracts use exact origins and explicit development loopback', () => {
  const allowedOrigins = ['https://store.example.invalid']
  assert.deepEqual(validateCorsPolicy({ allowedOrigins, credentials: true, environment: 'production' }), {
    allowedOrigins,
    credentials: true,
  })
  assert.throws(
    () => validateCorsPolicy({ allowedOrigins: ['*'], credentials: true, environment: 'production' }),
    /Wildcard/,
  )
  assert.throws(
    () => validateCorsPolicy({ allowedOrigins: ['http://localhost:5173'], credentials: true, environment: 'production' }),
    /loopback/,
  )
  assert.throws(
    () => validateCorsPolicy({ allowedOrigins: ['http://[::1]:5173'], credentials: true, environment: 'production' }),
    /loopback/,
  )
  assert.throws(
    () => validateCorsPolicy({ allowedOrigins, credentials: true, environment: 'prodution' }),
    /environment configuration/,
  )

  const evaluate = (origin, overrides = {}) => evaluateOriginContract({
    origin,
    method: 'POST',
    cookieAuthenticated: true,
    allowedOrigins,
    ...overrides,
  }).allowed
  assert.equal(evaluate('https://store.example.invalid'), true)
  assert.equal(evaluate('https://evil.example.invalid'), false)
  assert.equal(evaluate('https://store.example.invalid.evil.invalid'), false)
  assert.equal(evaluate('https://sub.store.example.invalid'), false)
  assert.equal(evaluate(undefined), false)
  assert.equal(evaluate('http://localhost:5173'), false)
  assert.equal(evaluate('http://localhost:5173', {
    environment: 'development', allowDevelopmentLoopback: true,
  }), true)
  assert.equal(evaluateOriginContract({
    method: 'POST', cookieAuthenticated: false, serverToServer: true,
    allowedOrigins, environment: 'production',
  }).allowed, true)
})

test('feature flag validator accepts explicit development modes and fails closed in production', () => {
  const prototype = {
    CUSTOMER_AUTH_PROVIDER: 'prototype',
    ADMIN_AUTH_PROVIDER: 'prototype',
    ENABLE_GUEST_ORDER_LINKING: 'false',
    ENABLE_ADMIN_MFA: 'false',
    USE_SUPABASE: 'true',
  }
  assert.equal(validateAuthFeatureFlags(prototype, 'development').customerProvider, 'prototype')
  assert.throws(() => validateAuthFeatureFlags(prototype, 'production'), /not ready/)

  const production = {
    ...prototype,
    CUSTOMER_AUTH_PROVIDER: 'supabase',
    ADMIN_AUTH_PROVIDER: 'supabase',
    ENABLE_ADMIN_MFA: 'true',
    USE_SUPABASE: 'false',
    frontendSelectedProvider: 'prototype',
  }
  const first = validateAuthFeatureFlags(production, 'production')
  const second = validateAuthFeatureFlags({ ...production, USE_SUPABASE: 'true' }, 'production')
  assert.deepEqual(first, second)
  assert.equal('frontendSelectedProvider' in first, false)
  assert.throws(() => validateAuthFeatureFlags({ ...production, ENABLE_ADMIN_MFA: 'maybe' }, 'production'))
  assert.throws(() => validateAuthFeatureFlags({ ...production, ADMIN_AUTH_PROVIDER: 'unknown' }, 'production'))
  assert.throws(() => validateAuthFeatureFlags(prototype, 'prodution'), /environment configuration/)
})

test('permission fixtures preserve Owner, Manager, and customer boundaries', () => {
  assert.deepEqual(OWNER_PERMISSIONS, ['*'])
  for (const capability of ['users', 'orders', 'refunds', 'tax', 'deployment']) {
    assert.ok(OWNER_CAPABILITIES.includes(capability))
  }
  for (const capability of [
    'products', 'variants', 'categories', 'collections', 'inventory', 'commerce-media',
    'homepage', 'announcement-bar', 'hero-slides', 'promotional-banners',
    'featured-products', 'best-sellers', 'new-arrivals', 'testimonials', 'blogs',
    'journals', 'content-seo',
  ]) {
    assert.ok(MANAGER_CAPABILITIES.includes(capability))
  }
  for (const capability of [
    'users', 'roles', 'orders', 'customers', 'refund-authorization', 'tax-configuration',
    'payment-configuration', 'shipping-configuration', 'protected-settings',
    'provider-secrets', 'audit-log-deletion', 'deployment',
  ]) {
    assert.ok(MANAGER_FORBIDDEN_CAPABILITIES.includes(capability))
  }
  for (const permission of MANAGER_FORBIDDEN_PERMISSIONS) {
    assert.equal(MANAGER_PERMISSIONS.includes(permission), false)
  }
  assert.deepEqual(CUSTOMER_PERMISSIONS, [])
})

test('optional authentication distinguishes guest, verified customer, and invalid credentials', () => {
  assert.deepEqual(evaluateOptionalAuthentication({ credentialState: 'absent' }), {
    allowed: true,
    mode: 'guest',
  })
  const verified = evaluateOptionalAuthentication({
    credentialState: 'valid',
    verifiedCustomerId: '00000000-0000-4000-8000-000000000103',
  })
  assert.equal(verified.allowed, true)
  assert.equal(verified.mode, 'customer')
  assert.equal(evaluateOptionalAuthentication({ credentialState: 'invalid' }).allowed, false)
  assert.equal(evaluateOptionalAuthentication({ credentialState: 'malformed' }).allowed, false)
  assert.equal(evaluateOptionalAuthentication({
    credentialState: 'absent', browserCustomerId: 'browser-selected-id',
  }).allowed, false)
})

test('test gateway remains isolated from production Supabase and network modules', async () => {
  const source = await readFile(new URL('./support/mockSupabaseAuthGateway.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /@supabase|https?:\/\/|fetch\(|SUPABASE_(URL|SECRET|KEY)/i)
})
