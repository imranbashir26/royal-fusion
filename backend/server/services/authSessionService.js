import { randomBytes } from 'node:crypto'
import { AUTH_ERROR_CODES } from '../auth/contracts.js'
import {
  createSessionCookieValues,
  getSessionCsrfToken,
  hashOpaqueValue,
} from '../auth/cookies.js'
import { AuthGatewayError } from './supabaseAuthGateway.js'
import { createSessionRecord, SessionRepositoryError } from './sessionRepository.js'

export class AuthSessionError extends Error {
  constructor(code) {
    super('Authentication session operation failed.')
    this.name = 'AuthSessionError'
    this.code = code
  }
}

export class AuthSessionService {
  constructor({ gateway, repository, config, clock = () => new Date() }) {
    this.gateway = gateway
    this.repository = repository
    this.config = config
    this.clock = clock
  }

  async createSession(authResult, {
    sessionClass = 'customer',
    authenticationContext = 'standard',
    deviceMetadata = {},
  } = {}) {
    const now = this.clock()
    const policy = authenticationContext === 'recovery'
      ? {
          idle: this.config.sessionPolicy.recoverySessionSeconds,
          absolute: this.config.sessionPolicy.recoverySessionSeconds,
        }
      : sessionClass === 'administrator'
      ? {
          idle: this.config.sessionPolicy.adminIdleSeconds,
          absolute: this.config.sessionPolicy.adminAbsoluteSeconds,
        }
      : {
          idle: this.config.sessionPolicy.customerIdleSeconds,
          absolute: this.config.sessionPolicy.customerAbsoluteSeconds,
        }
    const cookieValues = createSessionCookieValues(this.config)
    const record = createSessionRecord({
      userId: authResult.identity.id,
      sessionClass,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      idleExpiresAt: plusSeconds(now, policy.idle).toISOString(),
      absoluteExpiresAt: plusSeconds(now, policy.absolute).toISOString(),
      mfaAssurance: authResult.identity.assuranceLevel ?? 'aal1',
      authenticationContext,
      deviceMetadata: sanitizeDeviceMetadata(deviceMetadata),
      sessionKeyHash: cookieValues.sessionHash,
    })
    await safely(() => this.repository.create(record))
    return Object.freeze({
      identity: authResult.identity,
      record,
      accessToken: authResult.accessToken,
      refreshToken: authResult.refreshToken,
      accessExpiresAt: authResult.accessExpiresAt,
      ...cookieValues,
      maxAgeSeconds: policy.absolute,
    })
  }

  async restore({ accessToken, sessionHandle }, { requireMfa = false } = {}) {
    if (!accessToken || !sessionHandle) throw new AuthSessionError(AUTH_ERROR_CODES.INVALID_CREDENTIALS)
    const sessionHash = hashOpaqueValue(sessionHandle)
    const record = await safely(() => this.repository.findByHash(sessionHash))
    this.assertActive(record)
    const result = await safelyGateway(() => this.gateway.verifyAccessToken(accessToken))
    if (result.identity.id !== record.userId) {
      await this.revokeByHash(sessionHash, record.userId, 'Identity mismatch')
      throw new AuthSessionError(AUTH_ERROR_CODES.SESSION_REVOKED)
    }
    if (requireMfa && record.sessionClass === 'administrator' && record.mfaAssurance !== 'aal2') {
      throw new AuthSessionError(AUTH_ERROR_CODES.MFA_REQUIRED)
    }
    await this.touch(record)
    return Object.freeze({ identity: result.identity, record })
  }

  async refresh({ refreshToken, sessionHandle }) {
    if (!refreshToken || !sessionHandle) {
      throw new AuthSessionError(AUTH_ERROR_CODES.SESSION_EXPIRED)
    }
    const sessionHash = hashOpaqueValue(sessionHandle)
    const record = await safely(() => this.repository.findByHash(sessionHash))
    this.assertActive(record)
    const lockHash = hashOpaqueValue(randomBytes(32).toString('base64url'))
    const now = this.clock()
    const claimed = await safely(() => this.repository.claimRefresh(
      sessionHash,
      lockHash,
      now.toISOString(),
      this.config.sessionPolicy.refreshLeaseSeconds,
    ))
    if (!claimed) throw new AuthSessionError(AUTH_ERROR_CODES.SESSION_EXPIRED)

    try {
      const result = await safelyGateway(() => this.gateway.refresh(refreshToken))
      if (result.identity.id !== record.userId) {
        await this.revokeByHash(sessionHash, record.userId, 'Refresh identity mismatch')
        throw new AuthSessionError(AUTH_ERROR_CODES.SESSION_REVOKED)
      }
      await this.touch(record)
      return Object.freeze({
        identity: result.identity,
        record,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        accessExpiresAt: result.accessExpiresAt,
        sessionHandle,
        csrfToken: getSessionCsrfToken(sessionHandle, this.config),
        maxAgeSeconds: secondsUntil(record.absoluteExpiresAt, now),
      })
    } catch (error) {
      if (error.code !== AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE) {
        await this.revokeByHash(sessionHash, record.userId, 'Refresh failed')
      }
      throw error
    } finally {
      await safely(() => this.repository.releaseRefresh(sessionHash, lockHash))
    }
  }

  async signOut({ accessToken, sessionHandle, userId }) {
    const sessionHash = hashOpaqueValue(sessionHandle)
    await this.revokeByHash(sessionHash, userId, 'Current session signout')
    try {
      await this.gateway.signOut({ accessToken, scope: 'local' })
    } catch {
      // Local revocation and cookie clearing remain authoritative for this API.
    }
  }

  async signOutAll({ accessToken, sessionHandle, userId }) {
    await safely(() => this.repository.revokeAll(userId, {
      revokedAt: this.clock().toISOString(),
      revokedBy: userId,
      reason: 'Global signout',
    }))
    try {
      await this.gateway.signOut({ accessToken, scope: 'global' })
    } catch {
      // Fail closed locally even when provider-wide revocation is unavailable.
    }
    return hashOpaqueValue(sessionHandle)
  }

  async revokeSessionForAdministration({ sessionId, actorUserId, reason }) {
    if (!sessionId || !actorUserId) {
      throw new AuthSessionError(AUTH_ERROR_CODES.PERMISSION_DENIED)
    }
    const revoked = await safely(() => this.repository.revokeById(sessionId, {
      revokedAt: this.clock().toISOString(),
      revokedBy: actorUserId,
      reason: sanitizeRevocationReason(reason),
    }))
    if (!revoked) throw new AuthSessionError(AUTH_ERROR_CODES.SESSION_REVOKED)
    return true
  }

  async revokeByHash(sessionHash, userId, reason) {
    await safely(() => this.repository.revoke(sessionHash, {
      revokedAt: this.clock().toISOString(),
      revokedBy: userId,
      reason,
    }))
  }

  assertActive(record) {
    if (!record) throw new AuthSessionError(AUTH_ERROR_CODES.SESSION_REVOKED)
    if (record.revokedAt) throw new AuthSessionError(AUTH_ERROR_CODES.SESSION_REVOKED)
    const now = this.clock().getTime()
    if (new Date(record.absoluteExpiresAt).getTime() <= now ||
      new Date(record.idleExpiresAt).getTime() <= now) {
      throw new AuthSessionError(AUTH_ERROR_CODES.SESSION_EXPIRED)
    }
  }

  async touch(record) {
    const now = this.clock()
    const idleSeconds = record.sessionClass === 'administrator'
      ? this.config.sessionPolicy.adminIdleSeconds
      : this.config.sessionPolicy.customerIdleSeconds
    const nextIdle = new Date(Math.min(
      plusSeconds(now, idleSeconds).getTime(),
      new Date(record.absoluteExpiresAt).getTime(),
    ))
    const touched = await safely(() => this.repository.touch(
      record.sessionKeyHash,
      now.toISOString(),
      nextIdle.toISOString(),
    ))
    if (!touched) throw new AuthSessionError(AUTH_ERROR_CODES.SESSION_REVOKED)
  }
}

export function isAccessTokenNearExpiry(accessToken, {
  now = new Date(),
  windowSeconds,
} = {}) {
  if (!Number.isSafeInteger(windowSeconds) || windowSeconds <= 0) return false
  try {
    const parts = String(accessToken).split('.')
    if (parts.length !== 3) return false
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (!Number.isSafeInteger(payload.exp)) return false
    return payload.exp * 1000 <= now.getTime() + windowSeconds * 1000
  } catch {
    return false
  }
}

function sanitizeDeviceMetadata(metadata) {
  return {
    userAgentFamily: String(metadata.userAgentFamily ?? '').slice(0, 80),
    deviceLabel: String(metadata.deviceLabel ?? '').slice(0, 80),
  }
}

function sanitizeRevocationReason(reason) {
  const normalized = String(reason ?? 'Administrative session revocation')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
  return normalized.slice(0, 240) || 'Administrative session revocation'
}

function plusSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000)
}

function secondsUntil(iso, now) {
  return Math.max(1, Math.floor((new Date(iso).getTime() - now.getTime()) / 1000))
}

async function safely(operation) {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof AuthSessionError) throw error
    if (error instanceof SessionRepositoryError) {
      throw new AuthSessionError(AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE)
    }
    throw new AuthSessionError(AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE)
  }
}

async function safelyGateway(operation) {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof AuthSessionError) throw error
    if (error instanceof AuthGatewayError) throw new AuthSessionError(error.code)
    throw new AuthSessionError(AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE)
  }
}
