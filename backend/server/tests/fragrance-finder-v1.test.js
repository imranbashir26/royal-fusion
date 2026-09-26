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
import { createAdminFragranceFinderV1Router, createPublicFragranceFinderV1Router } from '../routes/fragranceFinderV1.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const origin = 'https://shop.example.invalid'
const config = createAuthConfig({
  NODE_ENV: 'test', CLIENT_ORIGIN: origin, AUTH_CSRF_SECRET: 'finder-contract-test-secret-1234567890',
  ADMIN_AUTH_PROVIDER: 'prototype', CUSTOMER_AUTH_PROVIDER: 'prototype', ENABLE_ADMIN_MFA: 'false',
})
const names = getAuthCookieNames(config)
const servers = []
after(async () => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))))

function mockClient(db) {
  return { from: (table) => new Query(db, table) }
}

class Query {
  constructor(db, table) {
    this.db = db
    this.table = table
    this.filters = []
    this.operation = 'read'
  }
  select() { return this }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this }
  in(column, values) { this.filters.push((row) => values.includes(row[column])); return this }
  order(column) { this.orderColumn = column; return this }
  update(values) { this.operation = 'update'; this.values = values; return this }
  insert(values) { this.db[this.table].push(values); return Promise.resolve({ error: null }) }
  maybeSingle() { return Promise.resolve({ data: this.execute()[0] ?? null, error: null }) }
  then(resolve, reject) { return Promise.resolve({ data: this.execute(), error: null }).then(resolve, reject) }
  execute() {
    const rows = this.db[this.table].filter((row) => this.filters.every((filter) => filter(row)))
    if (this.operation === 'update') rows.forEach((row) => Object.assign(row, this.values))
    return this.orderColumn ? [...rows].sort((a, b) => a[this.orderColumn] - b[this.orderColumn]) : rows
  }
}

async function start() {
  const ids = { fresh: randomUUID(), sweet: randomUUID(), valid: randomUUID(), archived: randomUUID(), inactive: randomUUID() }
  const db = {
    fragrance_finder_preferences: [
      { id: ids.fresh, key: 'fresh', label: 'Fresh', descriptors: 'Fresh • Aromatic • Refined', copy: 'Fresh copy', icon_key: 'sparkles', product_id: null, active: true, display_order: 1 },
      { id: ids.sweet, key: 'sweet', label: 'Sweet', descriptors: 'Sweet • Amber • Radiant', copy: 'Sweet copy', icon_key: 'candy', product_id: ids.archived, active: false, display_order: 2 },
    ],
    products: [
      { id: ids.valid, name: 'Valid Product', status: 'Published', active: true },
      { id: ids.archived, name: 'Archived Product', status: 'Archived', active: false },
      { id: ids.inactive, name: 'Inactive Product', status: 'Published', active: false },
    ],
    admin_audit_logs: [],
  }
  const client = mockClient(db)
  const runtime = {
    config,
    repository: { client },
    sessionService: {
      restore: async ({ accessToken }) => {
        if (!accessToken) throw Object.assign(new Error('Authentication required'), { code: 'AUTH_REQUIRED' })
        return {
          record: { sessionClass: 'administrator', mfaAssurance: 'aal2' },
          identity: { id: accessToken, assuranceLevel: 'aal2' },
        }
      },
    },
    adminAuthorization: {
      resolve: async (id) => ({ userId: id, permissions: id === 'manager' ? ['homepage.manage'] : id === 'owner' ? ['*'] : [] }),
    },
  }
  const app = express()
  app.use(requestContext)
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/v1/admin/fragrance-finder', createAdminFragranceFinderV1Router(runtime, { client, logger: { warn() {} } }))
  app.use('/api/v1/public/fragrance-finder', createPublicFragranceFinderV1Router(runtime, { client, logger: { warn() {} } }))
  app.use(authErrorHandler(config))
  app.use((error, req, res, _next) => res.status(500).json({ error: { code: 'UNEXPECTED', requestId: req.requestId } }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  servers.push(server)
  return { base: `http://127.0.0.1:${server.address().port}/api/v1`, db, ids }
}

async function request(api, route, { method = 'GET', actor, body, csrf = true, requestOrigin = origin } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (actor) {
    const token = getSessionCsrfToken('handle', config)
    headers.Cookie = `${names.access}=${actor}; ${names.refresh}=refresh; ${names.session}=handle; ${names.csrf}=${token}`
    if (csrf) headers['X-RF-CSRF'] = token
  }
  if (method !== 'GET' && requestOrigin) headers.Origin = requestOrigin
  const response = await fetch(`${api.base}${route}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

test('Admin Finder read/update requires administrator and homepage permission', async () => {
  const api = await start()
  assert.equal((await request(api, '/admin/fragrance-finder')).status, 401)
  assert.equal((await request(api, '/admin/fragrance-finder/fresh', { method: 'PUT', body: { productId: api.ids.valid, active: true } })).status, 401)
  assert.equal((await request(api, '/admin/fragrance-finder', { actor: 'denied' })).status, 403)
  assert.equal((await request(api, '/admin/fragrance-finder/fresh', { method: 'PUT', actor: 'denied', body: { productId: api.ids.valid, active: true } })).status, 403)
  const list = await request(api, '/admin/fragrance-finder', { actor: 'manager' })
  assert.equal(list.status, 200)
  assert.equal(list.body.data.length, 2)
  const eligible = await request(api, '/admin/fragrance-finder/products', { actor: 'manager' })
  assert.equal(eligible.status, 200)
  assert.deepEqual(eligible.body.data, [{ id: api.ids.valid, name: 'Valid Product' }])
  const updated = await request(api, '/admin/fragrance-finder/fresh', { method: 'PUT', actor: 'manager', body: { productId: api.ids.valid, active: true } })
  assert.equal(updated.status, 200)
  assert.equal(updated.body.data.productId, api.ids.valid)
  assert.equal(api.db.fragrance_finder_preferences[0].product_id, api.ids.valid)
  assert.deepEqual(api.db.admin_audit_logs[0].metadata, { key: 'fresh', productId: api.ids.valid })
  assert.equal(api.db.admin_audit_logs[0].permission_key, 'homepage.manage')
  assert.ok(api.db.admin_audit_logs[0].request_id)
})

test('Finder rejects invalid keys, payloads, and non-published or inactive assignments', async () => {
  const api = await start()
  const put = (key, productId) => request(api, `/admin/fragrance-finder/${key}`, {
    method: 'PUT', actor: 'manager', body: { productId, active: true },
  })
  assert.equal((await put('unknown', api.ids.valid)).status, 400)
  assert.equal((await put('fresh', 'not-a-uuid')).status, 400)
  assert.equal((await put('fresh', randomUUID())).status, 400)
  assert.equal((await put('fresh', api.ids.archived)).status, 400)
  assert.equal((await put('fresh', api.ids.inactive)).status, 400)
  assert.equal(api.db.fragrance_finder_preferences[0].product_id, null)
})

test('Finder mutations enforce CSRF and exact Origin', async () => {
  const api = await start()
  const body = { productId: api.ids.valid, active: true }
  assert.equal((await request(api, '/admin/fragrance-finder/fresh', { method: 'PUT', actor: 'manager', body, csrf: false })).status, 403)
  assert.equal((await request(api, '/admin/fragrance-finder/fresh', { method: 'PUT', actor: 'manager', body, requestOrigin: 'https://evil.invalid' })).status, 403)
  assert.equal(api.db.fragrance_finder_preferences[0].product_id, null)
})

test('public Finder read returns only safe active fields and masks invalid products', async () => {
  const api = await start()
  api.db.fragrance_finder_preferences[0].product_id = api.ids.valid
  const result = await request(api, '/public/fragrance-finder')
  assert.equal(result.status, 200)
  assert.equal(result.body.data.length, 1)
  assert.deepEqual(Object.keys(result.body.data[0]).sort(), ['copy', 'descriptors', 'displayOrder', 'iconKey', 'key', 'label', 'productId'].sort())
  assert.equal(result.body.data[0].productId, api.ids.valid)
  api.db.fragrance_finder_preferences[0].product_id = api.ids.archived
  const invalid = await request(api, '/public/fragrance-finder')
  assert.equal(invalid.body.data[0].productId, null)
})

test('Finder migration seeds six unassigned keys with FK and no browser table privileges', () => {
  const sql = readFileSync(path.join(root, 'supabase/migrations/006_fragrance_finder_preferences.sql'), 'utf8')
  for (const key of ['fresh', 'sweet', 'woody', 'oud', 'spicy', 'floral']) assert.match(sql, new RegExp(`\\('${key}',`))
  assert.match(sql, /product_id uuid references public\.products\(id\)/)
  assert.match(sql, /on conflict \(key\) do nothing/)
  assert.match(sql, /revoke all on public\.fragrance_finder_preferences from anon, authenticated/)
  assert.doesNotMatch(sql, /'shaheen'|'crimson-crystal'|'pitch-black'|'change'|'voice-of-heart'|'floral-fusion'/)
})
