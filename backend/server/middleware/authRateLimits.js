import { createHash } from 'node:crypto'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { AUTH_ERROR_CODES } from '../auth/contracts.js'
import { sendCode } from './authSecurity.js'

const POLICIES = Object.freeze({
  signIn: { windowMs: 15 * 60 * 1000, limit: 10, signal: 'email' },
  signUp: { windowMs: 60 * 60 * 1000, limit: 5, signal: 'email' },
  forgotPassword: { windowMs: 60 * 60 * 1000, limit: 5, signal: 'email' },
  resetPassword: { windowMs: 60 * 60 * 1000, limit: 5, signal: 'session' },
  verificationResend: { windowMs: 60 * 60 * 1000, limit: 3, signal: 'email' },
  verificationCallback: { windowMs: 15 * 60 * 1000, limit: 10, signal: 'state' },
  refresh: { windowMs: 15 * 60 * 1000, limit: 30, signal: 'session' },
  signOutAll: { windowMs: 60 * 60 * 1000, limit: 10, signal: 'session' },
})

export function createAuthRateLimiters(overrides = {}) {
  return Object.freeze(Object.fromEntries(
    Object.entries(POLICIES).map(([name, policy]) => [
      name,
      createLimiter({ ...policy, ...overrides[name] }),
    ]),
  ))
}

function createLimiter(policy) {
  return rateLimit({
    windowMs: policy.windowMs,
    limit: policy.limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator(req) {
      const ip = ipKeyGenerator(req.ip)
      const signal = safeSignal(req, policy.signal)
      return signal ? `${ip}:${hash(signal)}` : ip
    },
    handler(req, res) {
      sendCode(res, AUTH_ERROR_CODES.RATE_LIMITED, req.requestId)
    },
  })
}

function safeSignal(req, kind) {
  if (kind === 'email') return String(req.body?.email ?? '').trim().toLowerCase()
  if (kind === 'state') return String(req.query?.state ?? '')
  if (kind === 'session') {
    return req.cookies
      ? Object.entries(req.cookies).sort(([left], [right]) => left.localeCompare(right))
          .map(([name, value]) => `${name}=${value}`).join('\0')
      : ''
  }
  return ''
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}
