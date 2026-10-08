import { readFile } from 'node:fs/promises'
import { testerBaseline, applyTesterMigration } from './testerCatalogDatabase.js'
import { installProductionCatalogMetadata, productionEventSnapshotSQL } from './productionCatalogFixture.js'
import { shapeSQL } from './catalogManifest.js'

export const hardeningURL = new URL('../../../supabase/release-migrations/004_pre013_legacy_acl_hardening.sql', import.meta.url)
export const hardenedHash = 'a2ad954731059c790d88e4cdb49682979548a83a3a3fa52379551763a06464dc'
export const historicalHash = 'f64ceda44b4f076680f84dc5ac4b7e1b4bf7ff58911929804d456f7d32e506b4'
export const hardenedTablesHash = '3ac4ae8fc1e111a7d68bb2853c7f7d2f6df1c492104cf8f714b0630791005184'
export const excessPrivileges = ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
export const authenticatedOnlyRelations = ['admin_audit_logs', 'site_settings']
export const bothBrowserRelations = [
  'admin_memberships', 'categories', 'collections', 'contact_messages',
  'coupon_categories', 'coupon_products', 'coupon_redemptions', 'coupons',
  'customer_addresses', 'inventory_movements', 'newsletter_subscribers',
  'order_items', 'order_notes', 'order_status_history', 'orders', 'payments',
  'permissions', 'product_categories', 'product_collections', 'product_media',
  'product_sales_rankings', 'product_variants', 'products', 'profiles',
  'promotions', 'public_site_settings', 'refunds', 'reviews', 'role_permissions',
  'roles', 'seo_settings', 'shipping_methods', 'shipping_rates', 'user_roles',
]
export const affectedRelations = [...authenticatedOnlyRelations, ...bothBrowserRelations].sort()
export const browserRolesFor = name => authenticatedOnlyRelations.includes(name) ? ['authenticated'] : ['anon', 'authenticated']

// Reproduce only the exact grants proved by the supplied post-012 catalog export.
// The fixture is disposable; no environment or remote database client is used.
export async function installHistoricalAclDrift(db) {
  for (const [relations, roles] of [[authenticatedOnlyRelations, ['authenticated']], [bothBrowserRelations, ['anon', 'authenticated']]]) {
    await db.exec(`grant ${excessPrivileges.join(', ')} on table ${relations.map(name => `public.${name}`).join(', ')} to ${roles.join(', ')};`)
  }
}

export async function pre013Fixture() {
  const fixture = await testerBaseline()
  await installProductionCatalogMetadata(fixture.db)
  await applyTesterMigration(fixture.db)
  return fixture
}

export async function applyHardening(db, style = 'LF', source = null) {
  let sql = (source ?? await readFile(hardeningURL, 'utf8')).replaceAll('\r\n', '\n')
  if (style === 'CRLF') sql = sql.replaceAll('\n', '\r\n')
  try { await db.exec(sql) } catch (error) { await db.exec('rollback'); throw error }
}

const prefix = 'select encode(sha256(convert_to('
const suffix = "::text,'UTF8')),'hex') as shape"
if (!shapeSQL.startsWith(prefix) || !shapeSQL.endsWith(suffix)) throw new Error('Unknown catalog manifest wrapper')
export const manifestJSONSQL = `select ${shapeSQL.slice(prefix.length, -suffix.length)} as manifest`

export async function catalogSnapshot(db) {
  return (await db.query(manifestJSONSQL)).rows[0].manifest
}

// Capture raw source bytes and platform callback metadata, not merely normalized hashes.
export async function preservedSnapshot(db) {
  const tables = (await db.query("select relname from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p') order by relname")).rows
  const data = {}
  for (const { relname } of tables) {
    const identifier = `"${relname.replaceAll('"', '""')}"`
    data[relname] = (await db.query(`select coalesce(jsonb_agg(row order by row::text),'[]'::jsonb) rows from (select to_jsonb(t) row from public.${identifier} t) q`)).rows[0].rows
  }
  const functions = (await db.query(`select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),
    p.prosrc,p.proconfig,p.proacl::text,p.proowner::regrole::text,p.prosecdef) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) state
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','extensions')`)).rows[0].state
  const events = (await db.query(productionEventSnapshotSQL)).rows[0].state
  const defaults = (await db.query('select defaclrole::regrole::text creator,defaclnamespace,defaclobjtype,defaclacl::text acl from pg_default_acl order by defaclrole,defaclnamespace,defaclobjtype')).rows
  return { data, functions, events, defaults }
}
