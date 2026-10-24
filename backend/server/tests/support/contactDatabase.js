import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Disposable, in-memory PostgreSQL. Copies existing table DDL; applies no migration.
export async function contactDatabase() {
  const db = new PGlite()
  const sql = await readFile(new URL('../../../supabase/migrations/001_initial_schema.sql', import.meta.url), 'utf8')
  const tableDdl = name => sql.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]
  await db.exec('create schema auth; create table auth.users (id uuid primary key)')
  await db.exec(tableDdl('contact_messages'))
  await db.exec(tableDdl('admin_audit_logs'))
  const foundation = await readFile(new URL('../../../supabase/migrations/002_launch_schema_foundation.sql', import.meta.url), 'utf8')
  for (const column of ['permission_key', 'request_id']) {
    const ddl = foundation.match(new RegExp(`alter table public\\.admin_audit_logs add column if not exists ${column}[^;]+;`))[0]
    await db.exec(ddl)
  }
  return { db, client: { from: tableName => new Query(db, tableName) } }
}
const tables = new Set(['contact_messages', 'admin_audit_logs'])
const identifier = value => {
  if (!/^[a-z_]+$/.test(value)) throw new Error('Invalid fixture identifier')
  return `"${value}"`
}
class Query {
  constructor(db, table) {
    if (!tables.has(table)) throw new Error('Unexpected fixture table')
    this.db = db; this.table = table; this.mode = 'select'; this.filters = []; this.orders = []
  }
  select(columns, options) { this.columns = columns; this.count = options?.count; return this }
  insert(values) { this.mode = 'insert'; this.values = values; return this }
  update(values) { this.mode = 'update'; this.values = values; return this }
  eq(column, value) { this.filters.push([column, value]); return this }
  order(column, { ascending }) { this.orders.push(`${identifier(column)} ${ascending ? 'asc' : 'desc'}`); return this }
  range(start, end) { this.start = start; this.limit = end - start + 1; return this }
  maybeSingle() { return this.execute(true) }
  then(resolve, reject) { return this.execute().then(resolve, reject) }
  async execute(single = false) {
    const params = []
    const bind = value => { params.push(value); return `$${params.length}` }
    const columns = this.columns?.split(',').map(identifier).join(',')
    const where = () => this.filters.length ? ' where ' + this.filters.map(([column, value]) => `${identifier(column)}=${bind(value)}`).join(' and ') : ''
    try {
      let sql, count = null
      if (this.mode === 'insert') {
        sql = `insert into ${identifier(this.table)} (${Object.keys(this.values).map(identifier)}) values (${Object.values(this.values).map(bind)})`
      } else if (this.mode === 'update') {
        sql = `update ${identifier(this.table)} set ${Object.entries(this.values).map(([column, value]) => `${identifier(column)}=${bind(value)}`)}${where()}`
      } else {
        const condition = where()
        if (this.count) count = Number((await this.db.query(`select count(*) from ${identifier(this.table)}${condition}`, params)).rows[0].count)
        sql = `select ${columns} from ${identifier(this.table)}${condition}`
        if (this.orders.length) sql += ` order by ${this.orders.join(',')}`
        if (this.limit !== undefined) sql += ` limit ${bind(this.limit)} offset ${bind(this.start)}`
      }
      if (this.mode !== 'select' && columns) sql += ` returning ${columns}`
      const { rows } = await this.db.query(sql, params)
      return { data: single ? rows[0] ?? null : rows, count, error: null }
    } catch (error) { return { data: null, error: { code: error.code, message: error.message } } }
  }
}
