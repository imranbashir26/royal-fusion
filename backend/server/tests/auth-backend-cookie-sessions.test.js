import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { afterEach, test } from 'node:test'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import net from 'node:net'
import { EventEmitter } from 'node:events'
import {
  AUTH_ERROR_CODES,
  createCookieContract,
} from '../auth/contracts.js'
import {
  createAuthConfig,
  getAuthReadiness,
  isAllowedCorsOrigin,
} from '../auth/config.js'
import {
  createSessionCookieValues,
  getSessionCsrfToken,
  verifySessionCsrf,
} from '../auth/cookies.js'
import { createAuthRuntime } from '../auth/runtime.js'
import {
  authErrorHandler,
  createRedactedRequestLogger,
  requestContext,
  requireRecentAuthentication,
} from '../middleware/authSecurity.js'
import { createAuthV1Router } from '../routes/authV1.js'
import { AuthSessionError } from '../services/authSessionService.js'
import { AdminAuthorizationService } from '../services/adminAuthorizationService.js'
import {
  AuthGatewayError,
  SupabaseAuthGateway,
} from '../services/supabaseAuthGateway.js'
import { InMemorySessionRepository } from '../services/sessionRepository.js'

const servers = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(({ server }) => new Promise((resolve) => server.close(resolve))))
})

test('production authentication configuration fails closed and USE_SUPABASE stays unrelated', () => {
  assert.throws(() => createAuthConfig(productionEnv({
    CUSTOMER_AUTH_PROVIDER: 'prototype',
  })), /Production authentication configuration is not ready/)
  assert.throws(() => createAuthConfig(productionEnv({
    ENABLE_ADMIN_MFA: 'false',
  })), /Production authentication configuration is not ready/)
  assert.throws(() => createAuthConfig(productionEnv({
    AUTH_SECURE_COOKIES: 'false',
  })), /must be secure/)
  assert.throws(() => createAuthConfig(productionEnv({
    CLIENT_ORIGIN: 'https://shop.example.invalid.evil.test',
    AUTH_ALLOW_DEV_LOOPBACK: 'true',
  })), /cannot allow development loopback/)
  assert.throws(() => createAuthConfig(productionEnv({
    AUTH_CALLBACK_URL: 'https://api.example.invalid/not-the-auth-callback',
  })), /callback URL is invalid/)

  const enabled = createAuthConfig(productionEnv({ USE_SUPABASE: 'false' }))
  assert.equal(enabled.customerProvider, 'supabase')
  assert.equal(enabled.adminProvider, 'supabase')
})

test('authentication readiness separates disabled, unavailable, and configured states', () => {
  const unavailable = testConfig()
  assert.deepEqual(getAuthReadiness(unavailable), {
    configured: false,
    status: 'unavailable',
  })
  assert.doesNotThrow(() => createAuthRuntime({ config: unavailable, env: {} }))

  const disabled = createAuthConfig({
    NODE_ENV: 'test',
    CLIENT_ORIGIN: 'https://shop.example.invalid',
    CUSTOMER_AUTH_PROVIDER: 'prototype',
    ADMIN_AUTH_PROVIDER: 'prototype',
    ENABLE_GUEST_ORDER_LINKING: 'false',
    ENABLE_ADMIN_MFA: 'false',
    AUTH_SECURE_COOKIES: 'false',
    AUTH_TRUST_PROXY: 'false',
    AUTH_ALLOW_DEV_LOOPBACK: 'true',
    AUTH_CSRF_SECRET: opaque('disabled-csrf'),
  })
  assert.deepEqual(getAuthReadiness(disabled), {
    configured: false,
    status: 'disabled',
  })
  assert.equal(getAuthReadiness(createAuthConfig(productionEnv())).status, 'configured')
})

test('cookie and CSRF utilities enforce the approved production attributes', () => {
  const config = createAuthConfig(productionEnv())
  const values = createSessionCookieValues(config)
  for (const kind of ['access', 'refresh', 'session', 'csrf']) {
    const contract = createCookieContract(kind, {
      environment: 'production',
      secureTransport: true,
    })
    assert.match(contract.name, /^__Host-rf-/)
    assert.equal(contract.attributes.secure, true)
    assert.equal(contract.attributes.sameSite, 'lax')
    assert.equal(contract.attributes.path, '/')
    assert.equal('domain' in contract.attributes, false)
    assert.equal(contract.attributes.httpOnly, kind !== 'csrf')
  }
  assert.equal(values.csrfToken, getSessionCsrfToken(values.sessionHandle, config))
  const req = {
    cookies: { '__Host-rf-csrf': values.csrfToken },
    get: (name) => name === 'X-RF-CSRF' ? values.csrfToken : '',
  }
  assert.equal(verifySessionCsrf({ req, config, sessionHandle: values.sessionHandle }), true)
  assert.equal(verifySessionCsrf({ req, config, sessionHandle: 'different' }), false)
})

test('signin, session restoration, and refresh use HttpOnly cookies without JSON token disclosure', async () => {
  const gateway = new TestAuthGateway()
  const api = await startAuthApi({ gateway })
  const jar = {}
  const preAuth = await fetchSession(api, jar)

  const signedIn = await request(api, '/api/v1/auth/signin', {
    method: 'POST',
    origin: api.allowedOrigin,
    csrf: preAuth.data.csrfToken,
    jar,
    body: { email: 'customer@example.invalid', password: 'fictional-password' },
  })
  assert.equal(signedIn.response.status, 200)
  absorbCookies(signedIn.response, jar)
  assert.equal(signedIn.body.data.authenticated, true)
  assert.equal(signedIn.body.data.identity.email, 'customer@example.invalid')
  assertNoCredentialFields(signedIn.body)
  assert.equal(Object.keys(jar).filter((name) => /(?:rf-dev|__Host-rf)-(at|rt|sid|csrf)$/.test(name)).length, 4)

  const restored = await request(api, '/api/v1/auth/session', { jar })
  assert.equal(restored.response.status, 200)
  assert.equal(restored.body.data.authenticated, true)
  assertNoCredentialFields(restored.body)

  const refreshed = await request(api, '/api/v1/auth/refresh', {
    method: 'POST',
    origin: api.allowedOrigin,
    csrf: signedIn.body.data.csrfToken,
    jar,
  })
  assert.equal(refreshed.response.status, 200)
  absorbCookies(refreshed.response, jar)
  assert.equal(gateway.calls.refresh, 1)
  assertNoCredentialFields(refreshed.body)
})

test('near-expiry access sessions refresh before restoration', async () => {
  const gateway = new TestAuthGateway()
  gateway.signInAccessToken = jwtWithExpiry(Math.floor(Date.now() / 1000) + 60)
  const api = await startAuthApi({ gateway })
  const jar = {}
  const preAuth = await fetchSession(api, jar)
  const signedIn = await request(api, '/api/v1/auth/signin', {
    method: 'POST',
    origin: api.allowedOrigin,
    csrf: preAuth.data.csrfToken,
    jar,
    body: { email: 'customer@example.invalid', password: 'fictional-password' },
  })
  absorbCookies(signedIn.response, jar)

  const restored = await request(api, '/api/v1/auth/session', { jar })
  assert.equal(restored.response.status, 200)
  assert.equal(restored.body.data.authenticated, true)
  assert.equal(gateway.calls.refresh, 1)
  assert.ok(restored.response.headers.getSetCookie?.().length > 0)
  assertNoCredentialFields(restored.body)
})

test('authentication errors are generic and provider failures remain unavailable', async () => {
  const gateway = new TestAuthGateway()
  const api = await startAuthApi({ gateway })

  for (const email of ['unknown@example.invalid', 'wrong@example.invalid']) {
    const jar = {}
    const preAuth = await fetchSession(api, jar)
    const result = await request(api, '/api/v1/auth/signin', {
      method: 'POST',
      origin: api.allowedOrigin,
      csrf: preAuth.data.csrfToken,
      jar,
      body: { email, password: 'fictional-password' },
    })
    assert.equal(result.response.status, 401)
    assert.equal(result.body.error.code, AUTH_ERROR_CODES.INVALID_CREDENTIALS)
    assertNoCredentialFields(result.body)
  }

  const unverifiedJar = {}
  const unverifiedCsrf = await fetchSession(api, unverifiedJar)
  const unverified = await request(api, '/api/v1/auth/signin', {
    method: 'POST',
    origin: api.allowedOrigin,
    csrf: unverifiedCsrf.data.csrfToken,
    jar: unverifiedJar,
    body: { email: 'unverified@example.invalid', password: 'fictional-password' },
  })
  assert.equal(unverified.response.status, 403)
  assert.equal(unverified.body.error.code, AUTH_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED)

  const unavailableJar = {}
  const preAuth = await fetchSession(api, unavailableJar)
  gateway.unavailable = true
  const unavailable = await request(api, '/api/v1/auth/signin', {
    method: 'POST',
    origin: api.allowedOrigin,
    csrf: preAuth.data.csrfToken,
    jar: unavailableJar,
    body: { email: 'customer@example.invalid', password: 'fictional-password' },
  })
  assert.equal(unavailable.response.status, 503)
  assert.equal(unavailable.body.error.code, AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE)
  assertNoCredentialFields(unavailable.body)
})

test('unexpected provider transport failures map to safe unavailability', async () => {
  const gateway = new SupabaseAuthGateway({
    client: {
      auth: {
        signInWithPassword: async () => { throw new Error('test transport failure') },
      },
    },
    clientFactory: () => null,
    flowClientFactory: () => null,
  })
  await assert.rejects(
    gateway.signIn({ email: 'customer@example.invalid', password: 'fictional-password' }),
    (error) => error instanceof AuthGatewayError &&
      error.code === AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE,
  )
})

test('provider refresh errors and PKCE callback assurance map to stable contracts', async () => {
  const identity = {
    id: '00000000-0000-4000-8000-000000000301',
    email: 'customer@example.invalid',
    email_confirmed_at: '2030-01-01T00:00:00.000Z',
  }
  const callbackAccessToken = jwtWithExpiry(Math.floor(Date.now() / 1000) + 3600, 'aal2')
  const gateway = new SupabaseAuthGateway({
    client: {
      auth: {
        refreshSession: async () => ({
          data: null,
          error: { code: 'refresh_token_not_found', status: 400 },
        }),
      },
    },
    clientFactory: () => null,
    flowClientFactory: () => ({
      client: {
        auth: {
          exchangeCodeForSession: async () => ({
            data: {
              user: identity,
              session: {
                access_token: callbackAccessToken,
                refresh_token: opaque('callback-refresh'),
                expires_at: Math.floor(Date.now() / 1000) + 3600,
              },
              redirectType: 'recovery',
            },
            error: null,
          }),
        },
      },
      readCodeVerifier: () => opaque('callback-verifier'),
    }),
  })
  await assert.rejects(
    gateway.refresh(opaque('old-refresh')),
    (error) => error.code === AUTH_ERROR_CODES.SESSION_EXPIRED,
  )
  const verified = await gateway.verifyCode({
    code: opaque('callback-code'),
    type: 'recovery',
    codeVerifier: `${opaque('callback-verifier')}/recovery`,
  })
  assert.equal(verified.identity.assuranceLevel, 'aal2')
})

test('CSRF and exact Origin checks reject missing, mismatched, and deceptive requests', async () => {
  const api = await startAuthApi()
  const jar = {}
  const preAuth = await fetchSession(api, jar)
  const body = { email: 'customer@example.invalid', password: 'fictional-password' }

  const missing = await request(api, '/api/v1/auth/signin', {
    method: 'POST', origin: api.allowedOrigin, jar, body,
  })
  assert.equal(missing.body.error.code, AUTH_ERROR_CODES.CSRF_INVALID)

  const mismatch = await request(api, '/api/v1/auth/signin', {
    method: 'POST', origin: api.allowedOrigin, csrf: 'incorrect', jar, body,
  })
  assert.equal(mismatch.body.error.code, AUTH_ERROR_CODES.CSRF_INVALID)

  for (const origin of [
    `${api.allowedOrigin}.evil.test`,
    'https://evil.test',
    'https://shop.example.invalid.evil.test',
  ]) {
    const rejected = await request(api, '/api/v1/auth/signin', {
      method: 'POST', origin, csrf: preAuth.data.csrfToken, jar, body,
    })
    assert.equal(rejected.response.status, 403)
    assert.equal(rejected.body.error.code, AUTH_ERROR_CODES.ORIGIN_NOT_ALLOWED)
  }
})

test('malformed supplied authentication never becomes a guest session', async () => {
  const api = await startAuthApi()
  const malformed = await request(api, '/api/v1/auth/session', {
    jar: { 'rf-dev-sid': opaque('incomplete-session') },
  })
  assert.equal(malformed.response.status, 401)
  assert.equal(malformed.body.error.code, AUTH_ERROR_CODES.INVALID_CREDENTIALS)
  assert.notEqual(malformed.body.data?.authenticated, false)
})

test('idle expiry, absolute expiry, revocation, and global logout fail closed', async () => {
  let now = new Date('2030-01-01T00:00:00.000Z')
  const gateway = new TestAuthGateway()
  const repository = new InMemorySessionRepository()
  const config = testConfig({
    CUSTOMER_SESSION_IDLE_SECONDS: '10',
    CUSTOMER_SESSION_ABSOLUTE_SECONDS: '20',
    ADMIN_SESSION_IDLE_SECONDS: '5',
    ADMIN_SESSION_ABSOLUTE_SECONDS: '10',
    AUTH_ACCESS_COOKIE_SECONDS: '5',
    AUTH_REFRESH_WINDOW_SECONDS: '1',
    AUTH_RECENT_AUTH_SECONDS: '5',
    AUTH_RECOVERY_SESSION_SECONDS: '10',
  })
  const runtime = createAuthRuntime({
    config,
    gateway,
    repository,
    clock: () => new Date(now),
  })
  const authResult = await gateway.signIn({
    email: 'customer@example.invalid',
    password: 'fictional-password',
  })
  const first = await runtime.sessionService.createSession(authResult)
  const second = await runtime.sessionService.createSession(authResult)
  const third = await runtime.sessionService.createSession(authResult)

  now = new Date('2030-01-01T00:00:09.000Z')
  await runtime.sessionService.restore(third)

  now = new Date('2030-01-01T00:00:11.000Z')
  await assert.rejects(
    runtime.sessionService.restore(first),
    (error) => error instanceof AuthSessionError && error.code === AUTH_ERROR_CODES.SESSION_EXPIRED,
  )

  now = new Date('2030-01-01T00:00:21.000Z')
  await assert.rejects(
    runtime.sessionService.restore(third),
    (error) => error.code === AUTH_ERROR_CODES.SESSION_EXPIRED,
  )

  now = new Date('2030-01-01T00:00:22.000Z')
  await runtime.sessionService.signOutAll({
    accessToken: second.accessToken,
    sessionHandle: second.sessionHandle,
    userId: second.identity.id,
  })
  await assert.rejects(
    runtime.sessionService.restore(second),
    (error) => error.code === AUTH_ERROR_CODES.SESSION_REVOKED,
  )
})

test('global logout requires recent authentication', () => {
  const config = testConfig({ AUTH_RECENT_AUTH_SECONDS: '900' })
  const middleware = requireRecentAuthentication(
    config,
    () => new Date('2030-01-01T00:20:00.000Z').getTime(),
  )
  const response = mockResponse()
  let continued = false
  middleware({
    requestId: 'req_recent_auth',
    auth: { record: { createdAt: '2030-01-01T00:00:00.000Z' } },
  }, response, () => { continued = true })
  assert.equal(continued, false)
  assert.equal(response.statusCode, 401)
  assert.equal(response.body.error.code, AUTH_ERROR_CODES.AUTH_REQUIRED)
})

test('concurrent revocation wins over session touch and backend revocation remains auditable', async () => {
  const gateway = new TestAuthGateway()
  const config = testConfig()
  const raceRepository = new InMemorySessionRepository()
  raceRepository.touch = async () => false
  const raceRuntime = createAuthRuntime({ config, gateway, repository: raceRepository })
  const authResult = await gateway.signIn({
    email: 'customer@example.invalid',
    password: 'fictional-password',
  })
  const raced = await raceRuntime.sessionService.createSession(authResult)
  await assert.rejects(
    raceRuntime.sessionService.restore(raced),
    (error) => error.code === AUTH_ERROR_CODES.SESSION_REVOKED,
  )

  const repository = new InMemorySessionRepository()
  const runtime = createAuthRuntime({ config, gateway, repository })
  const session = await runtime.sessionService.createSession(authResult)
  assert.equal(await runtime.sessionService.revokeSessionForAdministration({
    sessionId: session.record.id,
    actorUserId: '00000000-0000-4000-8000-000000000399',
    reason: 'Fictional Owner review',
  }), true)
  const stored = await repository.findByHash(session.record.sessionKeyHash)
  assert.ok(stored.revokedAt)
  assert.equal(stored.revokedBy, '00000000-0000-4000-8000-000000000399')
  assert.equal(stored.revocationReason, 'Fictional Owner review')
})

test('current signout clears cookies and revoked sessions cannot be restored', async () => {
  const api = await startAuthApi()
  const jar = {}
  const preAuth = await fetchSession(api, jar)
  const signedIn = await request(api, '/api/v1/auth/signin', {
    method: 'POST',
    origin: api.allowedOrigin,
    csrf: preAuth.data.csrfToken,
    jar,
    body: { email: 'customer@example.invalid', password: 'fictional-password' },
  })
  absorbCookies(signedIn.response, jar)
  const signedOut = await request(api, '/api/v1/auth/signout', {
    method: 'POST',
    origin: api.allowedOrigin,
    csrf: signedIn.body.data.csrfToken,
    jar,
  })
  assert.equal(signedOut.response.status, 204)
  absorbCookies(signedOut.response, jar)
  assert.equal(Object.keys(jar).filter((name) => /(?:rf-dev|__Host-rf)-(at|rt|sid|csrf)$/.test(name)).length, 0)
})

test('global signout revokes provider and application sessions and clears cookies', async () => {
  const gateway = new TestAuthGateway()
  const api = await startAuthApi({ gateway })
  const jar = {}
  const preAuth = await fetchSession(api, jar)
  const signedIn = await request(api, '/api/v1/auth/signin', {
    method: 'POST',
    origin: api.allowedOrigin,
    csrf: preAuth.data.csrfToken,
    jar,
    body: { email: 'customer@example.invalid', password: 'fictional-password' },
  })
  absorbCookies(signedIn.response, jar)
  const signedOut = await request(api, '/api/v1/auth/signout-all', {
    method: 'POST',
    origin: api.allowedOrigin,
    csrf: signedIn.body.data.csrfToken,
    jar,
  })
  assert.equal(signedOut.response.status, 204)
  assert.equal(gateway.lastSignOutScope, 'global')
  absorbCookies(signedOut.response, jar)
  assert.equal(Object.keys(jar).filter((name) => /(?:rf-dev|__Host-rf)-(at|rt|sid|csrf)$/.test(name)).length, 0)
})

test('forgot and reset password responses remain generic and reset revokes sessions', async () => {
  const gateway = new TestAuthGateway()
  const api = await startAuthApi({ gateway })
  const jar = {}
  const preAuth = await fetchSession(api, jar)
  const forgot = await request(api, '/api/v1/auth/forgot-password', {
    method: 'POST',
    origin: api.allowedOrigin,
    csrf: preAuth.data.csrfToken,
    jar,
    body: { email: 'unknown@example.invalid' },
  })
  assert.equal(forgot.response.status, 202)
  assert.equal(
    forgot.body.data.message,
    'If an eligible account exists, recovery instructions will be sent.',
  )
  assert.doesNotMatch(forgot.body.data.message, /unknown|registered|not found/i)
  assert.ok(forgot.response.headers.getSetCookie?.().some((cookie) =>
    /rf-dev-rstate=/.test(cookie) && /HttpOnly/i.test(cookie) && /Max-Age=3600/i.test(cookie),
  ))
  absorbCookies(forgot.response, jar)
  const callback = await request(api,
    `/api/v1/auth/verify/callback?type=recovery&code=${encodeURIComponent(opaque('recovery-code'))}&state=${encodeURIComponent(gateway.lastState)}`,
    { jar, redirect: 'manual' },
  )
  assert.equal(callback.response.status, 303)
  assert.ok(callback.response.headers.getSetCookie?.().some((cookie) =>
    /rf-dev-rt=/.test(cookie) && /Max-Age=3600/i.test(cookie),
  ))
  absorbCookies(callback.response, jar)
  const session = await request(api, '/api/v1/auth/session', { jar })
  const reset = await request(api, '/api/v1/auth/reset-password', {
    method: 'POST',
    origin: api.allowedOrigin,
    csrf: session.body.data.csrfToken,
    jar,
    body: { newPassword: 'different-fictional-password' },
  })
  assert.equal(reset.response.status, 204)
  assert.equal(gateway.calls.updatePassword, 1)
  absorbCookies(reset.response, jar)
  assert.equal(Object.keys(jar).filter((name) => /(?:rf-dev|__Host-rf)-(at|rt|sid|csrf)$/.test(name)).length, 0)
})

test('a standard session cannot use the password-recovery update endpoint', async () => {
  const gateway = new TestAuthGateway()
  const api = await startAuthApi({ gateway })
  const jar = {}
  const preAuth = await fetchSession(api, jar)
  const signedIn = await request(api, '/api/v1/auth/signin', {
    method: 'POST',
    origin: api.allowedOrigin,
    csrf: preAuth.data.csrfToken,
    jar,
    body: { email: 'customer@example.invalid', password: 'fictional-password' },
  })
  absorbCookies(signedIn.response, jar)
  const reset = await request(api, '/api/v1/auth/reset-password', {
    method: 'POST',
    origin: api.allowedOrigin,
    csrf: signedIn.body.data.csrfToken,
    jar,
    body: { newPassword: 'different-fictional-password' },
  })
  assert.equal(reset.response.status, 401)
  assert.equal(reset.body.error.code, AUTH_ERROR_CODES.AUTH_REQUIRED)
  assert.equal(gateway.calls.updatePassword, 0)
})

test('failed refresh revokes the session, clears cookies, and returns a stable error', async () => {
  const gateway = new TestAuthGateway()
  const api = await startAuthApi({ gateway })
  const jar = {}
  const preAuth = await fetchSession(api, jar)
  const signedIn = await request(api, '/api/v1/auth/signin', {
    method: 'POST',
    origin: api.allowedOrigin,
    csrf: preAuth.data.csrfToken,
    jar,
    body: { email: 'customer@example.invalid', password: 'fictional-password' },
  })
  absorbCookies(signedIn.response, jar)
  gateway.refreshFailureCode = AUTH_ERROR_CODES.SESSION_EXPIRED
  const refreshed = await request(api, '/api/v1/auth/refresh', {
    method: 'POST',
    origin: api.allowedOrigin,
    csrf: signedIn.body.data.csrfToken,
    jar,
  })
  assert.equal(refreshed.response.status, 401)
  assert.equal(refreshed.body.error.code, AUTH_ERROR_CODES.SESSION_EXPIRED)
  absorbCookies(refreshed.response, jar)
  assert.equal(Object.keys(jar).filter((name) => /(?:rf-dev|__Host-rf)-(at|rt|sid|csrf)$/.test(name)).length, 0)
})

test('administrator sessions fail closed when required MFA assurance is absent', async () => {
  const gateway = new TestAuthGateway()
  const config = testConfig()
  const runtime = createAuthRuntime({
    config,
    gateway,
    repository: new InMemorySessionRepository(),
  })
  const authResult = await gateway.signIn({
    email: 'customer@example.invalid',
    password: 'fictional-password',
  })
  const session = await runtime.sessionService.createSession(authResult, {
    sessionClass: 'administrator',
  })
  await assert.rejects(
    runtime.sessionService.restore(session, { requireMfa: true }),
    (error) => error.code === AUTH_ERROR_CODES.MFA_REQUIRED,
  )
})

test('request logging records only a redacted operational envelope', () => {
  const events = []
  const logger = { info: (event) => events.push(event) }
  const middleware = createRedactedRequestLogger(logger)
  const response = new EventEmitter()
  response.statusCode = 200
  const request = {
    requestId: 'req_redaction_test',
    method: 'POST',
    path: '/api/v1/auth/signin',
    headers: {
      authorization: opaque('authorization'),
      cookie: opaque('cookie'),
    },
    body: { password: 'fictional-password' },
  }
  middleware(request, response, () => {})
  response.emit('finish')
  assert.equal(events.length, 1)
  assert.deepEqual(Object.keys(events[0]).sort(), [
    'durationMs', 'event', 'method', 'path', 'requestId', 'status',
  ])
  assertNoCredentialFields(events[0])
})

test('verification callback validates state and rejects open redirects', async () => {
  const gateway = new TestAuthGateway()
  const api = await startAuthApi({ gateway })
  const jar = {}
  const preAuth = await fetchSession(api, jar)
  const signup = await request(api, '/api/v1/auth/signup', {
    method: 'POST',
    origin: api.allowedOrigin,
    csrf: preAuth.data.csrfToken,
    jar,
    body: {
      email: 'new-customer@example.invalid',
      password: 'fictional-password',
      fullName: 'Fictional Customer',
      phone: '',
    },
  })
  assert.equal(signup.response.status, 202)
  assert.ok(signup.response.headers.getSetCookie?.().some((cookie) =>
    /rf-dev-vstate=/.test(cookie) && /HttpOnly/i.test(cookie) && /Max-Age=86400/i.test(cookie),
  ))
  absorbCookies(signup.response, jar)
  const callback = await request(api,
    `/api/v1/auth/verify/callback?code=${encodeURIComponent(opaque('code'))}&state=${encodeURIComponent(gateway.lastState)}&next=//evil.test`,
    { jar, redirect: 'manual' },
  )
  assert.equal(callback.response.status, 303)
  assert.equal(callback.response.headers.get('location'), 'https://shop.example.invalid/account')
  assert.equal(callback.response.headers.get('referrer-policy'), 'no-referrer')
  assertNoCredentialFields(callback.body)
})

test('verification callback rejects mismatched signed state before code exchange', async () => {
  const gateway = new TestAuthGateway()
  const api = await startAuthApi({ gateway })
  const jar = {}
  const preAuth = await fetchSession(api, jar)
  const signup = await request(api, '/api/v1/auth/signup', {
    method: 'POST',
    origin: api.allowedOrigin,
    csrf: preAuth.data.csrfToken,
    jar,
    body: {
      email: 'new-customer@example.invalid',
      password: 'fictional-password',
      fullName: 'Fictional Customer',
      phone: '',
    },
  })
  absorbCookies(signup.response, jar)
  const callback = await request(api,
    `/api/v1/auth/verify/callback?code=${encodeURIComponent(opaque('code'))}&state=${encodeURIComponent(opaque('wrong-state'))}`,
    { jar, redirect: 'manual' },
  )
  assert.equal(callback.response.status, 401)
  assert.equal(callback.body.error.code, AUTH_ERROR_CODES.INVALID_CREDENTIALS)
  assert.equal(gateway.calls.verifyCode, 0)
})

test('endpoint-specific limiter returns stable RATE_LIMITED without account evidence', async () => {
  const api = await startAuthApi({
    rateLimitOverrides: { signIn: { limit: 1, windowMs: 60_000 } },
  })
  const jar = {}
  const preAuth = await fetchSession(api, jar)
  const options = {
    method: 'POST',
    origin: api.allowedOrigin,
    csrf: preAuth.data.csrfToken,
    jar,
    body: { email: 'unknown@example.invalid', password: 'fictional-password' },
  }
  await request(api, '/api/v1/auth/signin', options)
  const limited = await request(api, '/api/v1/auth/signin', options)
  assert.equal(limited.response.status, 429)
  assert.equal(limited.body.error.code, AUTH_ERROR_CODES.RATE_LIMITED)
  assert.ok(limited.response.headers.get('retry-after'))
})

test('backend auth runtime sources contain no frontend imports or direct external calls in tests', async () => {
  const sources = await Promise.all([
    import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../services/authSessionService.js', import.meta.url), 'utf8',
    )),
    import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../routes/authV1.js', import.meta.url), 'utf8',
    )),
    import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('./auth-backend-cookie-sessions.test.js', import.meta.url), 'utf8',
    )),
  ])
  assert.doesNotMatch(sources.slice(0, 2).join('\n'), /frontend\/|VITE_|localStorage/)
  assert.doesNotMatch(
    sources[2],
    /https?:\/\/(?:[^/\s]+\.)?(?:supabase\.co|cloudinary\.com|resend\.com|sanity\.io)/i,
  )
})

test('administrator signin rejects wrong password, non-admin users, and browser-supplied roles', async () => {
  const api = await startAuthApi()
  const jar = {}
  const preAuth = await fetchSession(api, jar)
  const base = {
    method: 'POST', origin: api.allowedOrigin, csrf: preAuth.data.csrfToken, jar,
  }
  const wrong = await request(api, '/api/v1/auth/admin/signin', {
    ...base, body: { email: 'wrong@example.invalid', password: 'fictional-password', verificationCode: '123456' },
  })
  assert.equal(wrong.response.status, 401)
  const wrongOrigin = await request(api, '/api/v1/auth/admin/signin', {
    ...base, origin: 'https://shop.example.invalid.evil.test',
    body: { email: 'customer@example.invalid', password: 'fictional-password', verificationCode: '123456' },
  })
  assert.equal(wrongOrigin.body.error.code, AUTH_ERROR_CODES.ORIGIN_NOT_ALLOWED)
  const normal = await request(api, '/api/v1/auth/admin/signin', {
    ...base, body: { email: 'customer@example.invalid', password: 'fictional-password', verificationCode: '123456' },
  })
  assert.equal(normal.response.status, 403)
  const spoofed = await request(api, '/api/v1/auth/admin/signin', {
    ...base,
    body: { email: 'customer@example.invalid', password: 'fictional-password', verificationCode: '123456', administrator: true, permissions: ['*'] },
  })
  assert.equal(spoofed.response.status, 400)
  assert.equal((await request(api, '/api/v1/auth/session', { jar })).body.data.authenticated, false)
})

test('administrator session requires MFA, restores permissions, refreshes, and signs out', async () => {
  const gateway = new TestAuthGateway()
  const adminAuthorization = { resolve: async (userId) => ({
    userId, name: 'Test Owner', role: 'Owner', roleKey: 'owner', permissions: ['*'],
  }) }
  const api = await startAuthApi({ gateway, adminAuthorization })
  const jar = {}
  const preAuth = await fetchSession(api, jar)
  const base = {
    method: 'POST', origin: api.allowedOrigin, csrf: preAuth.data.csrfToken, jar,
  }
  const challenge = await request(api, '/api/v1/auth/admin/signin', {
    ...base, body: { email: 'owner@example.invalid', password: 'fictional-password' },
  })
  assert.equal(challenge.body.error.code, AUTH_ERROR_CODES.MFA_REQUIRED)
  const signedIn = await request(api, '/api/v1/auth/admin/signin', {
    ...base, body: { email: 'owner@example.invalid', password: 'fictional-password', verificationCode: '123456' },
  })
  assert.equal(signedIn.response.status, 200)
  assert.equal(signedIn.body.data.administrator.roleKey, 'owner')
  assert.deepEqual(signedIn.body.data.administrator.permissions, ['*'])
  assertNoCredentialFields(signedIn.body)
  absorbCookies(signedIn.response, jar)
  const restored = await request(api, '/api/v1/auth/session', { jar })
  assert.equal(restored.body.data.administrator.role, 'Owner')
  const refreshed = await request(api, '/api/v1/auth/refresh', {
    method: 'POST', origin: api.allowedOrigin, csrf: restored.body.data.csrfToken, jar,
  })
  assert.equal(refreshed.response.status, 200)
  assert.equal(refreshed.body.data.administrator.roleKey, 'owner')
  absorbCookies(refreshed.response, jar)
  const invalidCsrf = await request(api, '/api/v1/auth/signout', {
    method: 'POST', origin: api.allowedOrigin, csrf: 'wrong', jar,
  })
  assert.equal(invalidCsrf.body.error.code, AUTH_ERROR_CODES.CSRF_INVALID)
  const signedOut = await request(api, '/api/v1/auth/signout', {
    method: 'POST', origin: api.allowedOrigin, csrf: refreshed.body.data.csrfToken, jar,
  })
  assert.equal(signedOut.response.status, 204)
  absorbCookies(signedOut.response, jar)
  assert.equal((await request(api, '/api/v1/auth/session', { jar })).body.data.authenticated, false)
})

test('deactivated administrator loses restored and refreshed access', async () => {
  let active = true
  const adminAuthorization = { resolve: async (userId) => active ? {
    userId, name: 'Test Manager', role: 'Manager', roleKey: 'manager', permissions: ['catalog.read'],
  } : null }
  const api = await startAuthApi({ adminAuthorization })
  const jar = {}
  const preAuth = await fetchSession(api, jar)
  const signedIn = await request(api, '/api/v1/auth/admin/signin', {
    method: 'POST', origin: api.allowedOrigin, csrf: preAuth.data.csrfToken, jar,
    body: { email: 'manager@example.invalid', password: 'fictional-password', verificationCode: '123456' },
  })
  assert.equal(signedIn.response.status, 200)
  absorbCookies(signedIn.response, jar)
  active = false
  const refreshDenied = await request(api, '/api/v1/auth/refresh', {
    method: 'POST', origin: api.allowedOrigin, csrf: signedIn.body.data.csrfToken, jar,
  })
  assert.equal(refreshDenied.response.status, 403)
  absorbCookies(refreshDenied.response, jar)
  active = true
  const secondPreAuth = await fetchSession(api, jar)
  const secondSignIn = await request(api, '/api/v1/auth/admin/signin', {
    method: 'POST', origin: api.allowedOrigin, csrf: secondPreAuth.data.csrfToken, jar,
    body: { email: 'manager@example.invalid', password: 'fictional-password', verificationCode: '123456' },
  })
  assert.equal(secondSignIn.response.status, 200)
  absorbCookies(secondSignIn.response, jar)
  active = false
  const denied = await request(api, '/api/v1/auth/session', { jar })
  assert.equal(denied.response.status, 403)
  assert.equal(denied.body.error.code, AUTH_ERROR_CODES.PERMISSION_DENIED)
  absorbCookies(denied.response, jar)
  assert.equal((await request(api, '/api/v1/auth/session', { jar })).body.data.authenticated, false)
})

test('canonical database assignments determine administrator roles and effective permissions', async () => {
  const userId = '00000000-0000-4000-8000-000000000301'
  const rows = {
    profiles: [{ id: userId, full_name: 'Canonical Owner', status: 'Active' }],
    user_roles: [{ user_id: userId, role_id: 'owner-role', active: true, revoked_at: null, expires_at: null }],
    roles: [{ id: 'owner-role', key: 'owner', name: 'Owner', active: true }],
    role_permissions: [{ role_id: 'owner-role', permission_id: 'wildcard' }],
    permissions: [{ id: 'wildcard', key: '*' }],
  }
  const service = new AdminAuthorizationService(fakeAdminTables(rows))
  assert.deepEqual(await service.resolve(userId), {
    userId, name: 'Canonical Owner', role: 'Owner', roleKey: 'owner', permissions: ['*'],
  })
  rows.user_roles[0].active = false
  assert.equal(await service.resolve(userId), null)
  rows.user_roles[0].active = true
  rows.profiles[0].status = 'Inactive'
  assert.equal(await service.resolve(userId), null)
  rows.profiles[0].status = 'Active'
  rows.roles[0].key = 'shop_manager'
  assert.equal(await service.resolve(userId), null)
})

function fakeAdminTables(tables) {
  return {
    from(table) {
      let rows = tables[table] ?? []
      const query = {
        select() { return query },
        eq(key, value) { rows = rows.filter((row) => row[key] === value); return query },
        is(key, value) { rows = rows.filter((row) => row[key] === value); return query },
        in(key, values) { rows = rows.filter((row) => values.includes(row[key])); return query },
        maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }) },
        then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve) },
      }
      return query
    },
  }
}

async function startAuthApi({
  gateway = new TestAuthGateway(),
  rateLimitOverrides,
  env = {},
  adminAuthorization = { resolve: async () => null },
} = {}) {
  const config = testConfig(env)
  const repository = new InMemorySessionRepository()
  const runtime = createAuthRuntime({ config, gateway, repository, adminAuthorization })
  const app = express()
  app.use(requestContext)
  app.use(cors({
    origin(origin, callback) {
      if (isAllowedCorsOrigin(origin, config)) return callback(null, true)
      callback(Object.assign(new Error('Origin not allowed.'), { status: 403 }))
    },
    credentials: true,
  }))
  app.use(express.json({ limit: '64kb' }))
  app.use(cookieParser())
  app.use('/api/v1/auth', createAuthV1Router(runtime, { rateLimitOverrides }))
  app.use(authErrorHandler(config))
  app.use((error, req, res, _next) => {
    res.status(error.status || 500).json({
      error: {
        code: error.status === 403
          ? AUTH_ERROR_CODES.ORIGIN_NOT_ALLOWED
          : AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE,
        message: 'The request could not be completed.',
        requestId: req.requestId,
      },
    })
  })
  const port = await reservePort()
  const server = app.listen(port, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const api = {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    allowedOrigin: 'https://shop.example.invalid',
  }
  servers.push(api)
  return api
}

class TestAuthGateway {
  constructor() {
    this.unavailable = false
    this.lastState = ''
    this.lastCodeVerifier = ''
    this.signInAccessToken = ''
    this.lastSignOutScope = ''
    this.calls = { refresh: 0, signOut: 0, updatePassword: 0, verifyCode: 0 }
    this.refreshFailureCode = ''
    this.current = credentials('initial')
  }

  async signUp({ state }) {
    this.failIfUnavailable()
    this.lastState = state
    this.lastCodeVerifier = opaque(`verifier-${state}`)
    return { accepted: true, codeVerifier: this.lastCodeVerifier }
  }

  async signIn({ email }) {
    this.failIfUnavailable()
    if (email.startsWith('unknown') || email.startsWith('wrong')) {
      throw new AuthGatewayError(AUTH_ERROR_CODES.INVALID_CREDENTIALS)
    }
    if (email.startsWith('unverified')) {
      throw new AuthGatewayError(AUTH_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED)
    }
    this.current = credentials(email, { accessToken: this.signInAccessToken })
    this.signInAccessToken = ''
    return this.current
  }

  async signInAdministrator({ email, password, verificationCode, requireMfa }) {
    const result = await this.signIn({ email, password })
    if (requireMfa && verificationCode !== '123456') {
      throw new AuthGatewayError(verificationCode
        ? AUTH_ERROR_CODES.MFA_CHALLENGE_FAILED
        : AUTH_ERROR_CODES.MFA_REQUIRED)
    }
    this.current = {
      ...result,
      identity: { ...result.identity, assuranceLevel: requireMfa ? 'aal2' : 'aal1' },
    }
    return this.current
  }

  async verifyAccessToken(accessToken) {
    this.failIfUnavailable()
    if (accessToken !== this.current.accessToken) {
      throw new AuthGatewayError(AUTH_ERROR_CODES.SESSION_EXPIRED)
    }
    return { identity: this.current.identity }
  }

  async refresh(refreshToken) {
    this.failIfUnavailable()
    if (this.refreshFailureCode) throw new AuthGatewayError(this.refreshFailureCode)
    if (refreshToken !== this.current.refreshToken) {
      throw new AuthGatewayError(AUTH_ERROR_CODES.SESSION_EXPIRED)
    }
    this.calls.refresh += 1
    this.current = {
      ...credentials(`refresh-${this.calls.refresh}`),
      identity: {
        ...this.current.identity,
        assuranceLevel: this.current.identity.assuranceLevel,
      },
    }
    return this.current
  }

  async signOut({ scope }) {
    this.calls.signOut += 1
    this.lastSignOutScope = scope
  }

  async forgotPassword({ state }) {
    this.failIfUnavailable()
    this.lastState = state
    this.lastCodeVerifier = `${opaque(`verifier-${state}`)}/recovery`
    return { accepted: true, codeVerifier: this.lastCodeVerifier }
  }

  async resendVerification({ state }) {
    this.failIfUnavailable()
    this.lastState = state
    this.lastCodeVerifier = opaque(`verifier-${state}`)
    return { accepted: true, codeVerifier: this.lastCodeVerifier }
  }

  async verifyCode({ type, codeVerifier }) {
    this.failIfUnavailable()
    this.calls.verifyCode += 1
    assert.equal(codeVerifier, this.lastCodeVerifier)
    assert.equal(type === 'recovery', codeVerifier.endsWith('/recovery'))
    this.current = credentials('verified')
    return this.current
  }

  async updatePassword() {
    this.failIfUnavailable()
    this.calls.updatePassword += 1
  }

  failIfUnavailable() {
    if (this.unavailable) throw new AuthGatewayError(AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE)
  }
}

function credentials(seed, { accessToken = '' } = {}) {
  return Object.freeze({
    identity: Object.freeze({
      id: '00000000-0000-4000-8000-000000000301',
      email: 'customer@example.invalid',
      emailVerified: true,
      assuranceLevel: 'aal1',
    }),
    accessToken: accessToken || opaque(`access-${seed}`),
    refreshToken: opaque(`refresh-${seed}`),
    accessExpiresAt: '2030-01-01T01:00:00.000Z',
  })
}

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    CLIENT_ORIGIN: 'https://shop.example.invalid',
    CUSTOMER_AUTH_PROVIDER: 'supabase',
    ADMIN_AUTH_PROVIDER: 'supabase',
    ENABLE_GUEST_ORDER_LINKING: 'false',
    ENABLE_ADMIN_MFA: 'true',
    AUTH_SECURE_COOKIES: 'true',
    AUTH_TRUST_PROXY: 'true',
    AUTH_ALLOW_DEV_LOOPBACK: 'false',
    AUTH_CSRF_SECRET: opaque('csrf-production'),
    AUTH_CALLBACK_URL: 'https://api.example.invalid/api/v1/auth/verify/callback',
    SUPABASE_URL: 'https://project.example.invalid',
    SUPABASE_SECRET_KEY: opaque('server-key'),
    ...overrides,
  }
}

function testConfig(overrides = {}) {
  return createAuthConfig({
    NODE_ENV: 'test',
    CLIENT_ORIGIN: 'https://shop.example.invalid',
    CUSTOMER_AUTH_PROVIDER: 'supabase',
    ADMIN_AUTH_PROVIDER: 'supabase',
    ENABLE_GUEST_ORDER_LINKING: 'false',
    ENABLE_ADMIN_MFA: 'true',
    AUTH_SECURE_COOKIES: 'false',
    AUTH_TRUST_PROXY: 'false',
    AUTH_ALLOW_DEV_LOOPBACK: 'true',
    AUTH_CSRF_SECRET: opaque('csrf-test'),
    AUTH_CALLBACK_URL: 'http://127.0.0.1/api/v1/auth/verify/callback',
    ...overrides,
  })
}

async function fetchSession(api, jar) {
  const result = await request(api, '/api/v1/auth/session', { jar })
  absorbCookies(result.response, jar)
  return result.body
}

async function request(api, pathname, {
  method = 'GET',
  origin,
  csrf,
  jar = {},
  body,
  redirect,
} = {}) {
  const headers = {}
  const cookie = Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ')
  if (cookie) headers.Cookie = cookie
  if (origin) headers.Origin = origin
  if (csrf) headers['X-RF-CSRF'] = csrf
  if (body) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${api.baseUrl}${pathname}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...(redirect ? { redirect } : {}),
  })
  const text = await response.text()
  let parsed = {}
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { raw: text }
    }
  }
  return { response, body: parsed }
}

function absorbCookies(response, jar) {
  const cookies = response.headers.getSetCookie?.() ?? []
  for (const cookie of cookies) {
    const [pair, ...attributes] = cookie.split(';').map((part) => part.trim())
    const separator = pair.indexOf('=')
    const name = pair.slice(0, separator)
    const value = pair.slice(separator + 1)
    if (!value || attributes.some((attribute) => /^Max-Age=0$/i.test(attribute))) {
      delete jar[name]
    } else {
      jar[name] = value
    }
  }
}

function assertNoCredentialFields(value) {
  const serialized = JSON.stringify(value)
  assert.doesNotMatch(serialized, /accessToken|refreshToken|sessionHandle|password|cookie|stack|sql|supabase/i)
}

function opaque(seed) {
  return createHash('sha256').update(seed).digest('base64url')
}

function jwtWithExpiry(exp, aal = 'aal1') {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode({ exp, aal })}.test-signature`
}

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
}

async function reservePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}
