import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../supabase')
const read = (relative) => readFileSync(path.join(root, relative), 'utf8')
const migration = read('migrations/004_auth_session_refresh_lease.sql')
const rollback = read('rollback/004_auth_session_refresh_lease_rollback.sql')
const verification = read('tests/006_auth_session_refresh_lease_verification.sql')

assert.match(migration, /\bbegin;[\s\S]*\bcommit;/i)
assert.match(migration, /refresh_lock_hash text/)
assert.match(migration, /refresh_locked_until timestamptz/)
assert.match(migration, /authentication_context text not null default 'standard'/)
assert.match(migration, /claim_application_session_refresh/)
assert.match(migration, /release_application_session_refresh/)
assert.match(migration, /security definer[\s\S]*set search_path = ''/i)
assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/i)
assert.doesNotMatch(migration, /\b(access_token|refresh_token|cookie_value|raw_token)\s+(text|bytea)/i)
assert.match(migration, /session\.created/)
assert.match(migration, /session\.revoked/)
assert.match(rollback, /rollback refused/i)
assert.match(rollback, /if exists \(select 1 from public\.application_sessions\)/i)
assert.match(rollback, /use a forward fix/i)
assert.match(verification, /Concurrent refresh lease was acquired/)
assert.match(verification, /Session heartbeat created noisy audit events/)
assert.match(verification.trim(), /rollback;$/i)

console.log('Auth session SQL static checks passed.')
