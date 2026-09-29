import { randomUUID } from 'node:crypto'

export class SessionRepositoryError extends Error {
  constructor() {
    super('Application session storage is unavailable.')
    this.name = 'SessionRepositoryError'
  }
}

export class InMemorySessionRepository {
  constructor() {
    this.sessions = new Map()
    this.refreshLocks = new Map()
  }

  async create(record) {
    const stored = structuredClone(record)
    this.sessions.set(stored.sessionKeyHash, stored)
    return structuredClone(stored)
  }

  async findByHash(sessionKeyHash) {
    const record = this.sessions.get(sessionKeyHash)
    return record ? structuredClone(record) : null
  }

  async touch(sessionKeyHash, lastSeenAt, idleExpiresAt) {
    const record = this.sessions.get(sessionKeyHash)
    if (!record || record.revokedAt) return false
    record.lastSeenAt = lastSeenAt
    record.idleExpiresAt = idleExpiresAt
    return true
  }

  async revoke(sessionKeyHash, { revokedAt, revokedBy = null, reason = '' }) {
    const record = this.sessions.get(sessionKeyHash)
    if (!record || record.revokedAt) return false
    record.revokedAt = revokedAt
    record.revokedBy = revokedBy
    record.revocationReason = reason
    this.refreshLocks.delete(sessionKeyHash)
    return true
  }

  async revokeAll(userId, { revokedAt, revokedBy = null, reason = '' }) {
    let count = 0
    for (const record of this.sessions.values()) {
      if (record.userId === userId && !record.revokedAt) {
        record.revokedAt = revokedAt
        record.revokedBy = revokedBy
        record.revocationReason = reason
        this.refreshLocks.delete(record.sessionKeyHash)
        count += 1
      }
    }
    return count
  }

  async revokeById(sessionId, { revokedAt, revokedBy, reason = '' }) {
    for (const record of this.sessions.values()) {
      if (record.id === sessionId && !record.revokedAt) {
        record.revokedAt = revokedAt
        record.revokedBy = revokedBy
        record.revocationReason = reason
        this.refreshLocks.delete(record.sessionKeyHash)
        return true
      }
    }
    return false
  }

  async claimRefresh(sessionKeyHash, lockHash, now, leaseSeconds) {
    const record = this.sessions.get(sessionKeyHash)
    if (!record || record.revokedAt) return false
    const existing = this.refreshLocks.get(sessionKeyHash)
    if (existing && new Date(existing.expiresAt).getTime() > new Date(now).getTime()) return false
    this.refreshLocks.set(sessionKeyHash, {
      hash: lockHash,
      expiresAt: new Date(new Date(now).getTime() + leaseSeconds * 1000).toISOString(),
    })
    return true
  }

  async releaseRefresh(sessionKeyHash, lockHash) {
    const existing = this.refreshLocks.get(sessionKeyHash)
    if (!existing || existing.hash !== lockHash) return false
    this.refreshLocks.delete(sessionKeyHash)
    return true
  }
}

export class SupabaseSessionRepository {
  constructor(client) {
    this.client = client
  }

  async create(record) {
    const row = toDatabaseRow(record)
    const { error } = await this.client.from('application_sessions').insert(row)
    if (error) {
      // TEMPORARY server-only diagnostic; never log session rows or token hashes.
      console.error({
        event: 'auth.session_repository.failed',
        operation: 'application_sessions.insert',
        code: typeof error.code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(error.code)
          ? error.code : 'unknown',
      })
      throw new SessionRepositoryError()
    }
    return record
  }

  async findByHash(sessionKeyHash) {
    const { data, error } = await this.client
      .from('application_sessions')
      .select([
        'id', 'user_id', 'session_class', 'created_at', 'last_seen_at',
        'idle_expires_at', 'absolute_expires_at', 'revoked_at', 'revoked_by',
        'revocation_reason', 'mfa_assurance', 'device_metadata', 'session_key_hash',
        'authentication_context',
      ].join(','))
      .eq('session_key_hash', sessionKeyHash)
      .maybeSingle()
    if (error) throw new SessionRepositoryError()
    return data ? fromDatabaseRow(data) : null
  }

  async touch(sessionKeyHash, lastSeenAt, idleExpiresAt) {
    const { data, error } = await this.client
      .from('application_sessions')
      .update({ last_seen_at: lastSeenAt, idle_expires_at: idleExpiresAt })
      .eq('session_key_hash', sessionKeyHash)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle()
    if (error) throw new SessionRepositoryError()
    return Boolean(data)
  }

  async revoke(sessionKeyHash, { revokedAt, revokedBy = null, reason = '' }) {
    const { data, error } = await this.client
      .from('application_sessions')
      .update({ revoked_at: revokedAt, revoked_by: revokedBy, revocation_reason: reason })
      .eq('session_key_hash', sessionKeyHash)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle()
    if (error) throw new SessionRepositoryError()
    return Boolean(data)
  }

  async revokeAll(userId, { revokedAt, revokedBy = null, reason = '' }) {
    const { data, error } = await this.client
      .from('application_sessions')
      .update({ revoked_at: revokedAt, revoked_by: revokedBy, revocation_reason: reason })
      .eq('user_id', userId)
      .is('revoked_at', null)
      .select('id')
    if (error) throw new SessionRepositoryError()
    return data?.length ?? 0
  }

  async revokeById(sessionId, { revokedAt, revokedBy, reason = '' }) {
    const { data, error } = await this.client
      .from('application_sessions')
      .update({ revoked_at: revokedAt, revoked_by: revokedBy, revocation_reason: reason })
      .eq('id', sessionId)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle()
    if (error) throw new SessionRepositoryError()
    return Boolean(data)
  }

  async claimRefresh(sessionKeyHash, lockHash, now, leaseSeconds) {
    const { data, error } = await this.client.rpc('claim_application_session_refresh', {
      p_session_key_hash: sessionKeyHash,
      p_lock_hash: lockHash,
      p_now: now,
      p_lease_seconds: leaseSeconds,
    })
    if (error) throw new SessionRepositoryError()
    return data === true
  }

  async releaseRefresh(sessionKeyHash, lockHash) {
    const { data, error } = await this.client.rpc('release_application_session_refresh', {
      p_session_key_hash: sessionKeyHash,
      p_lock_hash: lockHash,
    })
    if (error) throw new SessionRepositoryError()
    return data === true
  }
}

export function createSessionRecord(overrides) {
  return Object.freeze({
    id: overrides.id ?? randomUUID(),
    userId: overrides.userId,
    sessionClass: overrides.sessionClass,
    createdAt: overrides.createdAt,
    lastSeenAt: overrides.lastSeenAt,
    idleExpiresAt: overrides.idleExpiresAt,
    absoluteExpiresAt: overrides.absoluteExpiresAt,
    revokedAt: null,
    revokedBy: null,
    revocationReason: '',
    mfaAssurance: overrides.mfaAssurance ?? 'aal1',
    authenticationContext: overrides.authenticationContext ?? 'standard',
    deviceMetadata: overrides.deviceMetadata ?? {},
    sessionKeyHash: overrides.sessionKeyHash,
  })
}

function toDatabaseRow(record) {
  return {
    id: record.id,
    user_id: record.userId,
    session_class: record.sessionClass,
    created_at: record.createdAt,
    last_seen_at: record.lastSeenAt,
    idle_expires_at: record.idleExpiresAt,
    absolute_expires_at: record.absoluteExpiresAt,
    revoked_at: record.revokedAt,
    revoked_by: record.revokedBy,
    revocation_reason: record.revocationReason,
    mfa_assurance: record.mfaAssurance,
    device_metadata: record.deviceMetadata,
    session_key_hash: record.sessionKeyHash,
    authentication_context: record.authenticationContext,
  }
}

function fromDatabaseRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    sessionClass: row.session_class,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    revocationReason: row.revocation_reason,
    mfaAssurance: row.mfa_assurance,
    deviceMetadata: row.device_metadata,
    sessionKeyHash: row.session_key_hash,
    authenticationContext: row.authentication_context,
  }
}
