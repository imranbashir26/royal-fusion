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
import { createAdminReviewsV1Router, createPublicReviewsV1Router } from '../routes/reviewsV1.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const origin = 'https://shop.example.invalid'
const config = createAuthConfig({
  NODE_ENV: 'test', CLIENT_ORIGIN: origin, AUTH_CSRF_SECRET: 'reviews-contract-test-secret-1234567890',
  ADMIN_AUTH_PROVIDER: 'prototype', CUSTOMER_AUTH_PROVIDER: 'prototype', ENABLE_ADMIN_MFA: 'false',
})
const names = getAuthCookieNames(config)
const servers = []
after(async () => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))))

class Query {
  constructor(db, table) { this.db = db; this.table = table; this.filters = []; this.mode = 'read' }
  select(_columns, options) { this.count = options?.count; return this }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this }
  in(column, values) { this.filters.push((row) => values.includes(row[column])); return this }
  not(column, _operator, value) { this.filters.push((row) => row[column] !== value); return this }
  or(expression) {
    const term = expression.match(/name\.ilike\.%(.+)%/)?.[1]?.replace(/%,text\.ilike\..*/, '')?.toLowerCase() ?? ''
    this.filters.push((row) => row.name.toLowerCase().includes(term) || row.text.toLowerCase().includes(term))
    return this
  }
  order(column, options) { this.orderColumn = column; this.ascending = options?.ascending; return this }
  range(start, end) { this.start = start; this.end = end; return this }
  update(values) { this.mode = 'update'; this.values = values; return this }
  delete() { this.mode = 'delete'; return this }
  insert(values) { this.db[this.table].push({ id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...values }); return Promise.resolve({ error: null }) }
  maybeSingle() { return Promise.resolve({ data: this.execute().data[0] ?? null, error: null }) }
  then(resolve, reject) { return Promise.resolve(this.execute()).then(resolve, reject) }
  execute() {
    let rows = this.db[this.table].filter((row) => this.filters.every((filter) => filter(row)))
    const count = rows.length
    if (this.mode === 'update') rows.forEach((row) => Object.assign(row, this.values))
    if (this.mode === 'delete') this.db[this.table] = this.db[this.table].filter((row) => !rows.includes(row))
    if (this.orderColumn) rows = [...rows].sort((a, b) => String(a[this.orderColumn]).localeCompare(String(b[this.orderColumn])) * (this.ascending ? 1 : -1))
    if (this.start !== undefined) rows = rows.slice(this.start, this.end + 1)
    return { data: rows, count: this.count ? count : null, error: null }
  }
}

async function start() {
  const ids = { valid: randomUUID(), inactive: randomUUID(), archived: randomUUID() }
  const db = {
    products: [
      { id: ids.valid, name: 'Royal Oud', slug: 'royal-oud', status: 'Published', active: true },
      { id: ids.inactive, name: 'Hidden', status: 'Published', active: false },
      { id: ids.archived, name: 'Old', status: 'Archived', active: false },
    ], reviews: [], admin_audit_logs: [],
  }
  const client = { from: (table) => new Query(db, table) }
  const runtime = {
    config, repository: { client },
    sessionService: { restore: async ({ accessToken }) => {
      if (!accessToken) throw Object.assign(new Error('Authentication required'), { code: 'AUTH_REQUIRED' })
      return { record: { sessionClass: 'administrator', mfaAssurance: 'aal2' }, identity: { id: accessToken, assuranceLevel: 'aal2' } }
    } },
    adminAuthorization: { resolve: async (id) => ({ userId: id, permissions: id === 'manager' ? ['reviews.manage'] : [] }) },
  }
  const app = express()
  app.use(requestContext)
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/v1/admin/reviews', createAdminReviewsV1Router(runtime, { client, logger: { warn() {} } }))
  app.use('/api/v1/public/reviews', createPublicReviewsV1Router(runtime, { client, logger: { warn() {} } }))
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
  const response = await fetch(`${api.base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}

const submission = (productId) => ({ productId, name: 'Customer Name', city: '', rating: 4, text: 'A refined fragrance with lovely depth.' })

test('public submission stores Pending and hides moderation fields from response', async () => {
  const api = await start()
  const result = await request(api, '/public/reviews', { method: 'POST', body: submission(api.ids.valid) })
  assert.equal(result.status, 201)
  assert.deepEqual(Object.keys(result.body.data), ['message'])
  assert.equal(api.db.reviews[0].status, 'Pending')
  assert.equal(api.db.reviews[0].featured, false)
  assert.equal(api.db.reviews[0].product_id, api.ids.valid)
  assert.equal(api.db.reviews[0].product, 'Royal Oud')
  assert.deepEqual((await request(api, '/public/reviews')).body.data, [])
})

test('public input rejects bad rating, product, text, and moderation fields', async () => {
  for (const body of [
    (api) => ({ ...submission(api.ids.valid), rating: 0 }),
    (api) => ({ ...submission(api.ids.valid), rating: 4.5 }),
    (api) => ({ ...submission(api.ids.valid), text: 'short' }),
    (api) => ({ ...submission(api.ids.valid), text: 'x'.repeat(2001) }),
    (api) => ({ ...submission(api.ids.valid), text: '<script>alert(1)</script>' }),
    (api) => ({ ...submission(api.ids.valid), status: 'Approved' }),
    (api) => ({ ...submission(api.ids.valid), featured: true }),
    (api) => ({ ...submission(api.ids.valid), customerId: randomUUID() }),
    (api) => ({ ...submission(api.ids.valid), productId: randomUUID() }),
    (api) => submission(api.ids.inactive),
    (api) => submission(api.ids.archived),
  ]) {
    const api = await start()
    const result = await request(api, '/public/reviews', { method: 'POST', body: body(api) })
    assert.equal(result.status, 400, JSON.stringify(result))
    assert.equal(api.db.reviews.length, 0)
  }
})

test('public submission is rate limited and Origin guarded', async () => {
  const api = await start()
  assert.equal((await request(api, '/public/reviews', { method: 'POST', body: submission(api.ids.valid), requestOrigin: 'https://evil.invalid' })).status, 403)
  for (let index = 0; index < 4; index++) assert.equal((await request(api, '/public/reviews', { method: 'POST', body: submission(api.ids.valid) })).status, 201)
  assert.equal((await request(api, '/public/reviews', { method: 'POST', body: submission(api.ids.valid) })).status, 429)
})

test('public request body limit rejects oversized metadata', async () => {
  const api = await start()
  const result = await request(api, '/public/reviews', {
    method: 'POST', body: { ...submission(api.ids.valid), unused: 'x'.repeat(5000) },
  })
  assert.equal(result.status, 413)
  assert.equal(api.db.reviews.length, 0)
})

test('Admin auth, permission, CSRF, moderation, public read, filtering, and deletion', async () => {
  const api = await start()
  await request(api, '/public/reviews', { method: 'POST', body: submission(api.ids.valid) })
  const id = api.db.reviews[0].id
  assert.equal((await request(api, '/admin/reviews')).status, 401)
  assert.equal((await request(api, '/admin/reviews', { actor: 'denied' })).status, 403)
  assert.equal((await request(api, `/admin/reviews/${id}`, { method: 'PUT', actor: 'denied', body: { status: 'Approved', featured: false } })).status, 403)
  assert.equal((await request(api, `/admin/reviews/${randomUUID()}`, { actor: 'manager' })).status, 404)
  assert.equal((await request(api, `/admin/reviews/${id}`, { actor: 'manager' })).status, 200)
  const page = await request(api, '/admin/reviews?status=Pending&rating=4&page=1&pageSize=1', { actor: 'manager' })
  assert.equal(page.body.data.total, 1)
  assert.equal(page.body.data.items[0].id, id)
  const body = { status: 'Approved', featured: true }
  assert.equal((await request(api, `/admin/reviews/${id}`, { method: 'PUT', actor: 'manager', body, csrf: false })).status, 403)
  assert.equal((await request(api, `/admin/reviews/${id}`, { method: 'PUT', actor: 'manager', body, requestOrigin: 'https://evil.invalid' })).status, 403)
  assert.equal((await request(api, `/admin/reviews/${id}`, { method: 'PUT', actor: 'manager', body: { ...body, text: 'tamper' } })).status, 400)
  assert.equal((await request(api, `/admin/reviews/${id}`, { method: 'PUT', actor: 'manager', body })).status, 200)
  assert.equal(api.db.reviews[0].status, 'Approved')
  assert.equal(api.db.admin_audit_logs[0].action, 'review.approve')
  assert.equal(api.db.admin_audit_logs[0].resource_id, id)
  assert.ok(api.db.admin_audit_logs[0].request_id)
  const publicResult = await request(api, '/public/reviews')
  assert.equal(publicResult.body.data.length, 1)
  assert.deepEqual(Object.keys(publicResult.body.data[0]).sort(), ['id', 'productId', 'product', 'name', 'city', 'rating', 'text', 'createdAt'].sort())
  assert.equal((await request(api, `/admin/reviews/${id}`, { method: 'PUT', actor: 'manager', body: { status: 'Rejected', featured: false } })).status, 200)
  assert.equal((await request(api, '/public/reviews')).body.data.length, 0)
  assert.equal(api.db.admin_audit_logs[1].action, 'review.reject')
  assert.equal((await request(api, `/admin/reviews/${id}`, { method: 'DELETE', actor: 'manager', csrf: false })).status, 403)
  assert.equal((await request(api, `/admin/reviews/${id}`, { method: 'DELETE', actor: 'manager' })).status, 200)
  assert.equal(api.db.reviews.length, 0)
  assert.equal(api.db.admin_audit_logs[2].action, 'review.delete')
})

test('Admin list applies search, status, product and pagination to production rows', async () => {
  const api = await start()
  api.db.reviews.push(
    { id: randomUUID(), product_id: api.ids.valid, name: 'Aisha', city: '', rating: 5, product: 'Royal Oud', text: 'Deep oud', featured: false, status: 'Pending', created_at: '2026-01-02' },
    { id: randomUUID(), product_id: api.ids.valid, name: 'Bilal', city: '', rating: 4, product: 'Royal Oud', text: 'Soft spice', featured: false, status: 'Approved', created_at: '2026-01-03' },
  )
  const result = await request(api, `/admin/reviews?search=Bilal&status=Approved&productId=${api.ids.valid}&rating=4&page=1&pageSize=1`, { actor: 'manager' })
  assert.equal(result.status, 200)
  assert.equal(result.body.data.total, 1)
  assert.equal(result.body.data.items[0].name, 'Bilal')
  const page = await request(api, '/admin/reviews?page=2&pageSize=1', { actor: 'manager' })
  assert.equal(page.body.data.total, 2)
  assert.equal(page.body.data.items.length, 1)
})

test('review RLS migration closes direct browser access', () => {
  const sql = readFileSync(path.join(root, 'supabase/migrations/007_reviews_public_api_boundary.sql'), 'utf8')
  assert.match(sql, /using \(status = 'Approved'\)/)
  assert.match(sql, /revoke select, insert, update, delete on public\.reviews from anon, authenticated/)
})
