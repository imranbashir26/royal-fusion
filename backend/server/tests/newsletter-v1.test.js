import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cookieParser from 'cookie-parser'
import express from 'express'
import test, { after } from 'node:test'
import { createAuthConfig } from '../auth/config.js'
import { getAuthCookieNames, getSessionCsrfToken } from '../auth/cookies.js'
import { authErrorHandler, requestContext } from '../middleware/authSecurity.js'
import { createAdminNewsletterV1Router, createPublicNewsletterV1Router } from '../routes/newsletterV1.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const origin = 'https://shop.example.invalid'
const config = createAuthConfig({
  NODE_ENV: 'test', CLIENT_ORIGIN: origin, AUTH_CSRF_SECRET: 'newsletter-contract-secret-1234567890',
  ADMIN_AUTH_PROVIDER: 'prototype', CUSTOMER_AUTH_PROVIDER: 'prototype', ENABLE_ADMIN_MFA: 'false',
})
const names = getAuthCookieNames(config)
const servers = []
after(async () => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))))

class Query {
  constructor(db, table) { this.db = db; this.table = table; this.filters = []; this.mode = 'read' }
  select(_columns, options) { this.count = options?.count; return this }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this }
  ilike(column, pattern) { this.filters.push((row) => row[column].toLowerCase().includes(pattern.replaceAll('%', '').toLowerCase())); return this }
  order(column, options) { this.orderColumn = column; this.ascending = options?.ascending; return this }
  range(start, end) { this.start = start; this.end = end; return this }
  delete() { this.mode = 'delete'; return this }
  insert(values) { this.mode = 'insert'; this.values = values; return this }
  single() { return Promise.resolve(this.execute()) }
  maybeSingle() { const result = this.execute(); return Promise.resolve({ data: result.data[0] ?? null, error: result.error }) }
  then(resolve, reject) { return Promise.resolve(this.execute()).then(resolve, reject) }
  execute() {
    if (this.mode === 'insert') {
      if (this.table === 'newsletter_subscribers' && this.db[this.table].some((row) => row.email.toLowerCase() === this.values.email.toLowerCase())) {
        return { data: null, error: { code: '23505' } }
      }
      const row = { id: randomUUID(), subscribed_at: new Date().toISOString(), ...this.values }
      this.db[this.table].push(row)
      return { data: row, error: null }
    }
    let rows = this.db[this.table].filter((row) => this.filters.every((filter) => filter(row)))
    const count = rows.length
    if (this.mode === 'delete') this.db[this.table] = this.db[this.table].filter((row) => !rows.includes(row))
    if (this.orderColumn) rows = [...rows].sort((a, b) => String(a[this.orderColumn]).localeCompare(String(b[this.orderColumn])) * (this.ascending ? 1 : -1))
    if (this.start !== undefined) rows = rows.slice(this.start, this.end + 1)
    return { data: rows, count: this.count ? count : null, error: null }
  }
}

async function start() {
  const db = { newsletter_subscribers: [], admin_audit_logs: [] }
  const client = { from: (table) => new Query(db, table) }
  const runtime = {
    config, repository: { client },
    sessionService: { restore: async ({ accessToken }) => {
      if (!accessToken) throw Object.assign(new Error('Authentication required'), { code: 'AUTH_REQUIRED' })
      return { record: { sessionClass: 'administrator', mfaAssurance: 'aal2' }, identity: { id: accessToken, assuranceLevel: 'aal2' } }
    } },
    adminAuthorization: { resolve: async (id) => ({ userId: id, permissions: id === 'manager' ? ['newsletter.manage'] : [] }) },
  }
  const app = express()
  app.use(requestContext)
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/v1/admin/newsletter', createAdminNewsletterV1Router(runtime, { client, logger: { warn() {} } }))
  app.use('/api/v1/public/newsletter', createPublicNewsletterV1Router(runtime, { client, logger: { warn() {} } }))
  app.use(authErrorHandler(config))
  app.use((error, req, res, _next) => res.status(500).json({ error: { code: 'UNEXPECTED', requestId: req.requestId } }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  servers.push(server)
  return { base: `http://127.0.0.1:${server.address().port}/api/v1`, db }
}

async function request(api, route, { method = 'GET', actor, body, csrf = true, requestOrigin = origin } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (actor) {
    const token = getSessionCsrfToken('handle', config)
    headers.Cookie = `${names.access}=${actor}; ${names.refresh}=refresh; ${names.session}=handle; ${names.csrf}=${token}`
    if (csrf) headers['X-RF-CSRF'] = token
  }
  if (method !== 'GET' && requestOrigin) headers.Origin = requestOrigin
  const response = await fetch(`${api.base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const contentType = response.headers.get('content-type') ?? ''
  return { status: response.status, body: contentType.includes('application/json') ? await response.json() : await response.text(), headers: response.headers }
}

test('public subscription normalizes case and whitespace; duplicate is safe and not inserted', async () => {
  const api = await start()
  const first = await request(api, '/public/newsletter', { method: 'POST', body: { email: '  Person@Example.COM  ' } })
  assert.equal(first.status, 200)
  assert.deepEqual(Object.keys(first.body.data), ['message'])
  assert.equal(api.db.newsletter_subscribers[0].email, 'person@example.com')
  const duplicate = await request(api, '/public/newsletter', { method: 'POST', body: { email: 'PERSON@example.com' } })
  assert.equal(duplicate.status, 200)
  assert.match(duplicate.body.data.message, /already subscribed/i)
  assert.equal(api.db.newsletter_subscribers.length, 1)
  assert.equal((await request(api, '/public/newsletter')).status, 404)
})

test('public subscription validates email, body size, Origin and rate limit', async () => {
  const api = await start()
  assert.equal((await request(api, '/public/newsletter', { method: 'POST', body: { email: 'invalid' } })).status, 400)
  assert.equal((await request(api, '/public/newsletter', { method: 'POST', body: { email: 'a@example.com', name: 'extra' } })).status, 400)
  assert.equal((await request(api, '/public/newsletter', { method: 'POST', body: { email: 'a@example.com', data: 'x'.repeat(1500) } })).status, 413)
  assert.equal((await request(api, '/public/newsletter', { method: 'POST', body: { email: 'a@example.com' }, requestOrigin: 'https://evil.invalid' })).status, 403)
  assert.equal((await request(api, '/public/newsletter', { method: 'POST', body: { email: 'a@example.com' } })).status, 200)
  assert.equal((await request(api, '/public/newsletter', { method: 'POST', body: { email: 'b@example.com' } })).status, 429)
})

test('Admin requires session, permission, CSRF and Origin; list/search/add/delete use production rows', async () => {
  const api = await start()
  assert.equal((await request(api, '/admin/newsletter')).status, 401)
  assert.equal((await request(api, '/admin/newsletter', { actor: 'denied' })).status, 403)
  assert.equal((await request(api, '/admin/newsletter', { method: 'POST', actor: 'denied', body: { email: 'x@example.com' } })).status, 403)
  assert.equal((await request(api, '/admin/newsletter', { method: 'POST', actor: 'manager', csrf: false, body: { email: 'x@example.com' } })).status, 403)
  assert.equal((await request(api, '/admin/newsletter', { method: 'POST', actor: 'manager', requestOrigin: 'https://evil.invalid', body: { email: 'x@example.com' } })).status, 403)
  const added = await request(api, '/admin/newsletter', { method: 'POST', actor: 'manager', body: { email: '  NEW@example.com  ' } })
  assert.equal(added.status, 201)
  assert.equal(added.body.data.email, 'new@example.com')
  assert.equal(api.db.admin_audit_logs[0].action, 'newsletter.add')
  assert.ok(api.db.admin_audit_logs[0].request_id)
  assert.equal((await request(api, '/admin/newsletter', { method: 'POST', actor: 'manager', body: { email: 'new@example.com' } })).status, 409)
  const list = await request(api, '/admin/newsletter?search=NEW&page=1&pageSize=1', { actor: 'manager' })
  assert.equal(list.body.data.total, 1)
  assert.equal(list.body.data.items[0].id, added.body.data.id)
  assert.equal((await request(api, `/admin/newsletter/${added.body.data.id}`, { actor: 'manager' })).status, 200)
  assert.equal((await request(api, `/admin/newsletter/${added.body.data.id}`, { method: 'DELETE', actor: 'manager', csrf: false })).status, 403)
  assert.equal((await request(api, `/admin/newsletter/${added.body.data.id}`, { method: 'DELETE', actor: 'manager' })).status, 200)
  assert.equal(api.db.newsletter_subscribers.length, 0)
  assert.equal(api.db.admin_audit_logs[1].action, 'newsletter.delete')
})

test('CSV export is Admin-only, escaped, limited to appropriate fields, and audited', async () => {
  const api = await start()
  api.db.newsletter_subscribers.push({ id: randomUUID(), email: 'quoted"@example.com', subscribed_at: '2026-01-01T00:00:00Z', secret: 'hidden' })
  assert.equal((await request(api, '/admin/newsletter/export')).status, 401)
  assert.equal((await request(api, '/admin/newsletter/export', { actor: 'denied' })).status, 403)
  const csv = await request(api, '/admin/newsletter/export', { actor: 'manager' })
  assert.equal(csv.status, 200)
  assert.match(csv.headers.get('content-disposition'), /royal-fusion-newsletter\.csv/)
  assert.match(csv.body, /email,subscribedAt/)
  assert.match(csv.body, /"quoted""@example\.com"/)
  assert.doesNotMatch(csv.body, /hidden|secret|id/)
  assert.equal(api.db.admin_audit_logs[0].action, 'newsletter.export')
  assert.equal(api.db.admin_audit_logs[0].resource_id, '')
})

test('legacy prototype newsletter write endpoints are unavailable', () => {
  const publicSource = readFileSync(path.join(root, 'server/routes/public.js'), 'utf8')
  const adminSource = readFileSync(path.join(root, 'server/routes/admin.js'), 'utf8')
  assert.doesNotMatch(publicSource, /publicRouter\.post\('\/newsletter'/)
  assert.match(adminSource, /req\.params\.resource === 'newsletter'/)
})

test('existing newsletter schema is private and has case-insensitive uniqueness', () => {
  const sql = readFileSync(path.join(root, 'supabase/migrations/002_launch_schema_foundation.sql'), 'utf8')
  assert.match(sql, /newsletter_email_lower_uidx[\s\S]*?lower\(email\)/)
  assert.match(sql, /create policy rf_newsletter_admin[\s\S]*?newsletter\.manage/)
  assert.match(sql, /revoke insert, update, delete on[\s\S]*?public\.newsletter_subscribers[\s\S]*?from anon, authenticated/)
  assert.doesNotMatch(sql, /grant select on public\.newsletter_subscribers to anon/)
})
