import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const supabaseDir = path.resolve(scriptDir, '../../supabase');
const read = (relativePath) => readFileSync(path.join(supabaseDir, relativePath), 'utf8');
const migration = read('migrations/003_auth_schema_hardening.sql');
const rollback = read('rollback/003_auth_schema_hardening_rollback.sql');
const verification = read('tests/005_auth_schema_hardening_verification.sql');

const requirePattern = (source, pattern, message) => assert.match(source, pattern, message);
const rejectPattern = (source, pattern, message) => assert.doesNotMatch(source, pattern, message);
const escaped = (value) => value.replaceAll('.', '\\.');

assert.match(migration.trim(), /^--[\s\S]*\bbegin;[\s\S]*\bcommit;$/i);
for (const table of [
  'auth_bootstrap_state',
  'admin_invitations',
  'application_sessions',
  'guest_order_claims',
]) {
  requirePattern(migration, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'), `Missing ${table}`);
  requirePattern(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `RLS missing for ${table}`);
}

for (const role of ['owner', 'manager']) {
  requirePattern(migration, new RegExp(`\\('${role}',\\s*'`, 'i'), `Canonical ${role} role missing`);
}

const managerBundle = migration.match(
  /roles\.key = 'manager'[\s\S]*?permissions\.key = any\(array\[([\s\S]*?)\]\)/i,
)?.[1];
assert.ok(managerBundle, 'Manager permission bundle was not found');
for (const permission of [
  'dashboard.read', 'catalog.read', 'catalog.manage', 'categories.manage',
  'collections.manage', 'inventory.read', 'inventory.adjust', 'media.commerce.manage',
  'media.delete', 'homepage.manage', 'seo.content.manage',
]) {
  assert.match(managerBundle, new RegExp(`'${escaped(permission)}'`), `Manager missing ${permission}`);
}
for (const permission of [
  'access.manage', 'roles.manage', 'users.manage', 'orders.read', 'customers.read',
  'payments.read', 'payments.manage', 'tax.configure', 'settings.private.manage', 'audit.read',
]) {
  assert.doesNotMatch(managerBundle, new RegExp(`'${escaped(permission)}'`), `Manager has forbidden ${permission}`);
}

requirePattern(migration, /delete from public\.role_permissions[\s\S]*roles\.key in \('owner', 'manager', 'owner_admin', 'shop_manager'\)/i, 'Role grants are not deterministically reset');
requirePattern(migration, /update public\.roles[\s\S]*key in \('owner_admin', 'shop_manager'\)/i, 'Legacy roles are not retired');
requirePattern(migration, /RF_FINAL_OWNER_REQUIRED/, 'Final Owner guard missing');
requirePattern(migration, /pg_advisory_xact_lock\(hashtext\('royal_fusion_owner_guard'\)\)/, 'Owner guard is not concurrency serialized');
requirePattern(migration, /RF_OWNER_BOOTSTRAP_CLOSED/, 'Owner bootstrap closure missing');
requirePattern(migration, /auth_bootstrap_state_immutable/, 'Bootstrap marker immutability missing');
requirePattern(migration, /RF_OWNER_PERMISSION_BUNDLE_PROTECTED/, 'Owner wildcard bundle guard missing');
requirePattern(migration, /RF_OWNER_PROFILE_NOT_ACTIVE/, 'Active Owner profile guard missing');
requirePattern(migration, /RF_SESSION_REVOCATION_REQUIRED/, 'Session hard-delete guard missing');

const definerFunctions = [...migration.matchAll(
  /create or replace function\s+public\.([a-z0-9_]+)\([^)]*\)[\s\S]*?security definer[\s\S]*?as \$\$/gi,
)];
assert.ok(definerFunctions.length >= 8, 'Expected SECURITY DEFINER functions were not found');
for (const match of definerFunctions) {
  assert.match(match[0], /set search_path = ''/i, `${match[1]} lacks an empty search_path`);
}

rejectPattern(migration, /\b(access_token|refresh_token|raw_token|cookie_value)\s+(text|bytea)\b/i, 'Raw credential storage column found');
rejectPattern(migration, /grant\s+(all|insert|update|delete)[\s\S]{0,180}to\s+(anon|authenticated)/i, 'Privileged browser grant found');
requirePattern(migration, /revoke all on public\.auth_bootstrap_state,[\s\S]*from anon, authenticated/i, 'Sensitive tables are not revoked from browser roles');
requirePattern(migration, /order_status_history\.is_customer_visible/, 'Customer-visible history policy missing');
requirePattern(migration, /order_notes\.is_customer_visible/, 'Customer-visible notes policy missing');

requirePattern(rollback, /rollback refused:[\s\S]*forward-fix migration/i, 'Guarded rollback refusal missing');
requirePattern(rollback, /Shop Manager remains inactive/i, 'Unsafe legacy grant restoration warning missing');
rejectPattern(rollback, /'shop_manager'[\s\S]{0,500}'orders\.read'/i, 'Rollback restores excessive Shop Manager grants');

for (const expected of [
  'Customer profile isolation failed',
  'Customer address isolation failed',
  'Customer order isolation failed',
  'Customer order-item isolation failed',
  'Manager received forbidden permission',
  'Expired invitation was accepted',
  'Revoked invitation was accepted',
  'Consumed guest claim was replayed',
  'Revoked session was hard-deleted',
  'Final Owner assignment was deleted',
  'Final Owner profile was deactivated',
  'Canonical Owner wildcard grant was removed',
  'Inactive profile received an Owner assignment',
  'Browser role can delete audit records',
  'SECURITY DEFINER function lacks an empty search_path',
]) {
  assert.ok(verification.includes(expected), `Verification coverage missing: ${expected}`);
}

assert.match(verification.trim(), /^--[\s\S]*\bbegin;[\s\S]*\brollback;$/i);
console.log('Auth schema SQL static checks passed.');
