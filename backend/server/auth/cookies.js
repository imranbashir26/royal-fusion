import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { AUTH_COOKIE_KINDS, createCookieContract } from './contracts.js'

const STATE_COOKIE_SUFFIXES = Object.freeze({
  verification: 'vstate',
  recovery: 'rstate',
})

export function getAuthCookieNames(config) {
  return Object.freeze(Object.fromEntries(
    Object.keys(AUTH_COOKIE_KINDS).map((kind) => [
      kind,
      createCookieContract(kind, cookieContractOptions(config)).name,
    ]),
  ))
}

export function issuePreAuthCsrf(res, config) {
  const token = randomValue()
  const contract = createCookieContract('csrf', cookieContractOptions(config))
  res.cookie(contract.name, token, {
    ...contract.attributes,
    maxAge: 60 * 60 * 1000,
  })
  return token
}

export function createSessionCookieValues(config) {
  const sessionHandle = randomValue()
  return Object.freeze({
    sessionHandle,
    sessionHash: hashOpaqueValue(sessionHandle),
    csrfToken: getSessionCsrfToken(sessionHandle, config),
  })
}

export function createAuthFlowState() {
  return randomValue()
}

export function setSessionCookies(res, config, values) {
  const maxAge = values.maxAgeSeconds * 1000
  setCookie(res, config, 'access', values.accessToken, Math.min(
    maxAge,
    config.sessionPolicy.accessCookieSeconds * 1000,
  ))
  setCookie(res, config, 'refresh', values.refreshToken, maxAge)
  setCookie(res, config, 'session', values.sessionHandle, maxAge)
  setCookie(res, config, 'csrf', values.csrfToken, maxAge)
}

export function clearAuthCookies(res, config) {
  for (const kind of Object.keys(AUTH_COOKIE_KINDS)) {
    const contract = createCookieContract(kind, { ...cookieContractOptions(config), clear: true })
    res.clearCookie(contract.name, contract.attributes)
  }
  clearStateCookie(res, config, 'verification')
  clearStateCookie(res, config, 'recovery')
}

export function readAuthCookies(req, config) {
  const names = getAuthCookieNames(config)
  return Object.freeze({
    accessToken: req.cookies?.[names.access] ?? '',
    refreshToken: req.cookies?.[names.refresh] ?? '',
    sessionHandle: req.cookies?.[names.session] ?? '',
    csrfToken: req.cookies?.[names.csrf] ?? '',
  })
}

export function verifySessionCsrf({ req, config, sessionHandle }) {
  const cookies = readAuthCookies(req, config)
  const supplied = String(req.get('X-RF-CSRF') ?? '')
  if (!cookies.csrfToken || !supplied || !sessionHandle) return false
  if (!safeEqual(cookies.csrfToken, supplied)) return false
  const expected = getSessionCsrfToken(sessionHandle, config)
  return safeEqual(expected, supplied)
}

export function getSessionCsrfToken(sessionHandle, config) {
  return createHmac('sha256', config.csrfSecret).update(sessionHandle).digest('base64url')
}

export function verifyPreAuthCsrf(req, config) {
  const cookies = readAuthCookies(req, config)
  const supplied = String(req.get('X-RF-CSRF') ?? '')
  return Boolean(cookies.csrfToken && supplied && safeEqual(cookies.csrfToken, supplied))
}

export function setStateCookie(res, config, kind, { state, codeVerifier }) {
  if (!state || !codeVerifier) throw new TypeError('Authentication flow state is incomplete.')
  const maxAgeSeconds = getStateMaxAgeSeconds(config, kind)
  const payload = Buffer.from(JSON.stringify({
    kind,
    stateHash: hashOpaqueValue(state),
    codeVerifier,
    expiresAt: Math.floor(Date.now() / 1000) + maxAgeSeconds,
  })).toString('base64url')
  const value = `${payload}.${signStatePayload(payload, config)}`
  res.cookie(getStateCookieName(config, kind), value, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  })
}

export function verifyStateCookie(req, config, kind, suppliedState) {
  return Boolean(getStateCodeVerifier(req, config, kind, suppliedState))
}

export function getStateCodeVerifier(req, config, kind, suppliedState) {
  const value = req.cookies?.[getStateCookieName(config, kind)] ?? ''
  const [payload, signature, ...extra] = String(value).split('.')
  if (!payload || !signature || extra.length > 0 || !suppliedState) return ''
  if (!safeEqual(signature, signStatePayload(payload, config))) return ''
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (decoded.kind !== kind || !decoded.codeVerifier ||
      !Number.isSafeInteger(decoded.expiresAt) || decoded.expiresAt <= Math.floor(Date.now() / 1000) ||
      !safeEqual(decoded.stateHash, hashOpaqueValue(suppliedState))) return ''
    return String(decoded.codeVerifier)
  } catch {
    return ''
  }
}

export function clearStateCookie(res, config, kind) {
  res.clearCookie(getStateCookieName(config, kind), {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
    path: '/',
  })
}

export function hashOpaqueValue(value) {
  return createHash('sha256').update(value).digest('hex')
}

function setCookie(res, config, kind, value, maxAge) {
  if (!value) throw new TypeError('Authentication cookie value is missing.')
  const contract = createCookieContract(kind, cookieContractOptions(config))
  res.cookie(contract.name, value, { ...contract.attributes, maxAge })
}

function getStateCookieName(config, kind) {
  const suffix = STATE_COOKIE_SUFFIXES[kind]
  if (!suffix) throw new TypeError('Unknown authentication state cookie.')
  return config.secureCookies ? `__Host-rf-${suffix}` : `rf-dev-${suffix}`
}

function cookieContractOptions(config) {
  return {
    environment: config.environment,
    secureTransport: config.secureCookies,
  }
}

function randomValue() {
  return randomBytes(32).toString('base64url')
}

function getStateMaxAgeSeconds(config, kind) {
  if (kind === 'verification') return config.sessionPolicy.verificationStateSeconds
  if (kind === 'recovery') return config.sessionPolicy.recoverySessionSeconds
  throw new TypeError('Unknown authentication state cookie.')
}

function signStatePayload(payload, config) {
  return createHmac('sha256', config.csrfSecret)
    .update(`royal-fusion-auth-state\0${payload}`)
    .digest('base64url')
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left))
  const rightBuffer = Buffer.from(String(right))
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
