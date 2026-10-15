import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// In-memory fixtures only. Copies selected approved definitions, never applies a migration.
export async function phase3Database() {
  const db = new PGlite()
  const initial = await readFile(new URL('../../../supabase/migrations/001_initial_schema.sql', import.meta.url), 'utf8')
  const foundation = await readFile(new URL('../../../supabase/migrations/002_launch_schema_foundation.sql', import.meta.url), 'utf8')
  for (const name of ['account_status', 'coupon_type', 'order_status', 'payment_status']) await db.exec(initial.match(new RegExp(`create type public\\.${name} as enum \\([^;]+;`))[0])
  await db.exec('create schema auth; create table auth.users (id uuid primary key)')
  const table = (source, name) => source.match(new RegExp(`create table(?: if not exists)? public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]
  for (const name of ['profiles', 'coupons', 'orders', 'admin_audit_logs']) await db.exec(table(initial, name))
  for (const name of ['roles', 'user_roles', 'customer_addresses', 'seo_settings']) await db.exec(table(foundation, name))
  await db.exec('create table products(id uuid primary key, name text, commerce_kind text, stock_quantity int default 12); create table categories(id uuid primary key, name text)')
  for (const name of ['coupon_products', 'coupon_categories', 'coupon_redemptions']) await db.exec(table(foundation, name))
  for (const [name, column] of [['coupons', 'max_discount_amount'], ['coupons', 'description'], ['orders', 'currency'], ['admin_audit_logs', 'permission_key'], ['admin_audit_logs', 'request_id']]) {
    await db.exec(foundation.match(new RegExp(`alter table public\\.${name} add column if not exists ${column}[^;]+;`))[0])
  }
  await db.exec(foundation.match(/alter table public\.coupons add constraint coupons_max_discount_nonnegative[\s\S]*?;/)[0])
  for (const name of ['coupons_code_lower_uidx', 'seo_settings_page_key_lower_uidx', 'seo_settings_route_lower_uidx']) await db.exec(foundation.match(new RegExp(`create unique index if not exists ${name}[^;]+;`))[0])
  await db.exec(initial.match(/create or replace function public\.set_updated_at\(\)[\s\S]*?\$\$;/)[0])
  for (const name of ['coupons', 'seo_settings']) await db.exec(`create trigger fixture_updated_at before update on ${name} for each row execute function public.set_updated_at()`)
  return { db, client: phase3SqlClient(db) }
}
export const phase3SqlClient=db=>({from:name=>new Query(db,name)})
const tables = new Set(['profiles', 'roles', 'user_roles', 'customer_addresses', 'orders', 'coupons', 'coupon_products', 'coupon_categories', 'coupon_redemptions', 'seo_settings', 'admin_audit_logs', 'products', 'product_variants', 'product_categories', 'shipping_methods', 'shipping_rates', 'site_settings', 'public_site_settings'])
const ident = v => { if (!/^[a-z_][a-z0-9_]*$/.test(v)) throw Error('Invalid fixture identifier'); return `"${v}"` }
class Query {
  constructor(db, name) { if (!tables.has(name)) throw Error('Unexpected table'); this.db = db; this.table = name; this.mode = 'select'; this.filters = []; this.orders = [] }
  select(columns, options) { this.columns = columns; this.count = options?.count; return this }
  eq(column, value) { this.filters.push(['=', column, value]); return this }
  neq(column, value) { this.filters.push(['<>', column, value]); return this }
  in(column, values) { this.filters.push(['in', column, values]); return this }
  ilike(column, value) { this.filters.push(['ilike', column, value]); return this }
  or(value) { this.orValues = value.split(/,(?=[a-z_]+\.ilike\.)/).map(v => { const match = /^([a-z_]+)\.ilike\.(".*")$/.exec(v); return [match[1], JSON.parse(match[2])] }); return this }
  order(column, { ascending }) { this.orders.push(`${ident(column)} ${ascending ? 'asc' : 'desc'}`); return this }
  range(start, end) { this.start = start; this.limit = end - start + 1; return this }
  insert(values) { this.mode = 'insert'; this.values = values; return this }
  update(values) { this.mode = 'update'; this.values = values; return this }
  single() { return this.execute(true) }
  maybeSingle() { return this.execute(true) }
  then(resolve, reject) { return this.execute().then(resolve, reject) }
  async execute(single = false) {
    const params = [], bind = v => { params.push(v); return `$${params.length}` }
    const columns = this.columns?.split(',').map(ident).join(',')
    const where = () => {
      const conditions = this.filters.map(([op, col, value]) => op === 'in' ? `${ident(col)} in (${value.map(bind).join(',')})` : `${ident(col)} ${op} ${bind(value)}`)
      if (this.orValues) conditions.push('(' + this.orValues.map(([col, v]) => `${ident(col)} ilike ${bind(v)}`).join(' or ') + ')')
      return conditions.length ? ' where ' + conditions.join(' and ') : ''
    }
    try {
      let sql, count = null
      if (this.mode === 'insert') sql = `insert into ${ident(this.table)} (${Object.keys(this.values).map(ident)}) values (${Object.values(this.values).map(bind)})`
      else if (this.mode === 'update') sql = `update ${ident(this.table)} set ${Object.entries(this.values).map(([k, v]) => `${ident(k)}=${bind(v)}`)}${where()}`
      else {
        const condition = where()
        if (this.count) count = Number((await this.db.query(`select count(*) from ${ident(this.table)}${condition}`, params)).rows[0].count)
        sql = `select ${columns} from ${ident(this.table)}${condition}`
        if (this.orders.length) sql += ` order by ${this.orders.join(',')}`
        if (this.limit !== undefined) sql += ` limit ${bind(this.limit)} offset ${bind(this.start)}`
      }
      if (this.mode !== 'select' && columns) sql = `with changed as (${sql} returning ${columns}) select to_jsonb(changed) as row from changed`
      else if (this.mode === 'select') sql = `select to_jsonb(selected) as row from (${sql}) selected`
      const { rows } = await this.db.query(sql, params)
      const data = rows.map(row => row.row)
      return { data: single ? data[0] ?? null : data, count, error: null }
    } catch (error) { return { data: null, error: { code: error.code, message: error.message } } }
  }
}
