import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cookieParser from 'cookie-parser'
import express from 'express'
import test, { after } from 'node:test'
import { createAuthConfig } from '../auth/config.js'
import { getAuthCookieNames, getSessionCsrfToken } from '../auth/cookies.js'
import { authErrorHandler, requestContext } from '../middleware/authSecurity.js'
import { createAdminProductsV1Router } from '../routes/adminProductsV1.js'

const categoryId = randomUUID()
const secondCategoryId = randomUUID()
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const origin = 'https://shop.example.invalid'
const config = createAuthConfig({
  NODE_ENV: 'test', CLIENT_ORIGIN: origin, AUTH_CSRF_SECRET: 'public-product-contract-test-secret-12345',
  ADMIN_AUTH_PROVIDER: 'prototype', CUSTOMER_AUTH_PROVIDER: 'prototype', ENABLE_ADMIN_MFA: 'false',
})
const names = getAuthCookieNames(config)
const servers = []
after(async () => { await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))) })

function product(overrides = {}) {
  return {
    name: 'Royal Oud', slug: 'royal-oud', sku: 'RF-001', price: 3500,
    scentFamily: 'Oud', image: 'https://cdn.example.com/royal.webp',
    categoryId, ...overrides,
  }
}

async function start() {
  const db = { products: [], audits: [], categories: [
    { id: categoryId, name: 'Attars', active: true },
    { id: secondCategoryId, name: 'Gift Sets', active: true },
  ] }
  const client = mockClient(db)
  const runtime = {
    config,
    repository: { client },
    sessionService: {
      restore: async ({ accessToken }) => {
        if (!accessToken) throw Object.assign(new Error('Authentication required'), { code: 'AUTH_REQUIRED' })
        return {
          record: { sessionClass: accessToken === 'customer' ? 'customer' : 'administrator', mfaAssurance: 'aal2' },
          identity: { id: accessToken, assuranceLevel: 'aal2' },
        }
      },
    },
    adminAuthorization: {
      resolve: async (id) => ({
        userId: id, permissions: id === 'reader' ? ['products.read'] :
          id === 'manager' ? ['products.manage'] : id === 'owner' ? ['products.read', 'products.manage'] : [],
      }),
    },
  }
  const app = express()
  app.use(requestContext)
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/v1/admin/products', createAdminProductsV1Router(runtime, { client, logger: { warn() {} } }))
  app.use(authErrorHandler(config))
  app.use((error, req, res, _next) => res.status(500).json({ error: { code: 'UNEXPECTED', requestId: req.requestId } }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  servers.push(server)
  return { base: `http://127.0.0.1:${server.address().port}/api/v1/admin/products`, db }
}

async function request(api, path = '', { method = 'GET', actor, body, csrf = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (actor) {
    const token = getSessionCsrfToken('handle', config)
    headers.Cookie = `${names.access}=${actor}; ${names.refresh}=refresh; ${names.session}=handle; ${names.csrf}=${token}`
    if (csrf) headers['X-RF-CSRF'] = token
  }
  if (method !== 'GET') headers.Origin = origin
  const response = await fetch(`${api.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}

test('every endpoint requires production administrator identity and canonical permission', async () => {
  const api = await start()
  const endpoints = [
    ['GET', ''], ['GET', `/${randomUUID()}`], ['POST', ''],
    ['PUT', `/${randomUUID()}`], ['DELETE', `/${randomUUID()}`],
  ]
  for (const [method, path] of endpoints) {
    assert.equal((await request(api, path, { method })).status, 401)
    assert.equal((await request(api, path, { method, actor: 'customer' })).status, 403)
    assert.equal((await request(api, path, { method, actor: 'no-permission' })).status, 403)
  }
  assert.equal((await request(api, '', { actor: 'reader' })).status, 200)
  const bearerOnly = await fetch(api.base, { headers: { Authorization: 'Bearer owner' } })
  assert.equal(bearerOnly.status, 401)
  assert.equal((await request(api, '', { method: 'POST', actor: 'manager', body: product() })).status, 201)
  assert.equal((await request(api, '', { method: 'POST', actor: 'reader', body: product({ sku: 'RF-002' }) })).status, 403)
  assert.equal((await request(api, '', { method: 'POST', actor: 'manager', body: product({ sku: 'RF-003' }), csrf: false })).body.error.code, 'CSRF_INVALID')
})

test('create validates schema, uniqueness, category, image and card fields; writes audit event', async () => {
  const api = await start()
  const invalid = [
    product({ price: 0 }), product({ price: -1 }), product({ stockQuantity: -1 }),
    product({ status: 'Active' }), product({ categoryId: randomUUID() }),
    product({ cardBackgroundColor: 'url(evil)' }), product({ image: 'javascript:alert(1)' }),
    product({ arbitrarySecret: 'secret' }), product({ salePrice: 4000 }),
  ]
  for (const payload of invalid) {
    assert.equal((await request(api, '', { method: 'POST', actor: 'owner', body: payload })).status, 400)
  }
  const created = await request(api, '', { method: 'POST', actor: 'owner', body: product({
    slug: '  Royal Oud  ', stockQuantity: 3, status: 'Published',
    cardImage: '/cards/oud.webp', cardHoverImage: 'https://cdn.example.com/hover.webp',
    cardBackgroundColor: '#ABC123', isPremium: true, isNewArrival: true,
  }) })
  assert.equal(created.status, 201)
  assert.equal(created.body.data.slug, 'royal-oud')
  assert.equal(created.body.data.category, 'Attars')
  assert.equal(created.body.data.cardImage, '/cards/oud.webp')
  assert.equal(created.body.data.cardHoverImage, 'https://cdn.example.com/hover.webp')
  assert.equal(created.body.data.cardBackgroundColor, '#ABC123')
  assert.equal(created.body.data.stockStatus, 'Low Stock')
  assert.equal(created.body.data.isNewArrival, true)
  assert.equal(created.body.data.isPremium, true)
  assert.equal(api.db.products[0].main_image_url, 'https://cdn.example.com/royal.webp')
  assert.equal(api.db.audits[0].action, 'product.create')
  assert.equal(api.db.audits[0].admin_id, 'owner')
  assert.equal((await request(api, '', { method: 'POST', actor: 'owner', body: product({ sku: 'RF-002' }) })).status, 409)
  assert.equal((await request(api, '', { method: 'POST', actor: 'owner', body: product({ slug: 'other', sku: 'RF-001' }) })).status, 409)
})

test('partial update preserves omitted fields, validates category and price, and archives without deleting', async () => {
  const api = await start()
  const created = await request(api, '', { method: 'POST', actor: 'owner', body: product() })
  const id = created.body.data.id
  assert.equal((await request(api, `/${randomUUID()}`, { actor: 'owner' })).status, 404)
  assert.equal((await request(api, `/${randomUUID()}`, { method: 'PUT', actor: 'owner', body: { price: 3000 } })).status, 404)
  assert.equal((await request(api, `/${id}`, { method: 'PUT', actor: 'owner', body: { categoryId: randomUUID() } })).status, 400)
  assert.equal((await request(api, `/${id}`, { method: 'PUT', actor: 'owner', body: { salePrice: 4000 } })).status, 400)
  const changedCategory = await request(api, `/${id}`, { method: 'PUT', actor: 'owner', body: { categoryId: secondCategoryId } })
  assert.equal(changedCategory.body.data.category, 'Gift Sets')
  const updated = await request(api, `/${id}`, { method: 'PUT', actor: 'owner', body: {
    price: 3000, salePrice: 0, stockQuantity: 0, categoryId: null,
    isFeatured: true, isBestSeller: true, status: 'Published',
    cardImage: '/cards/new.webp', cardBackgroundColor: '#123ABC',
  } })
  assert.equal(updated.status, 200)
  assert.equal(updated.body.data.name, 'Royal Oud')
  assert.equal(updated.body.data.sku, 'RF-001')
  assert.equal(updated.body.data.category, '')
  assert.equal(updated.body.data.salePrice, 0)
  assert.equal(updated.body.data.stockStatus, 'Out of Stock')
  assert.equal(updated.body.data.status, 'Published')
  assert.equal(updated.body.data.cardImage, '/cards/new.webp')
  const archived = await request(api, `/${id}`, { method: 'DELETE', actor: 'owner' })
  assert.equal(archived.status, 200)
  assert.equal(archived.body.data.status, 'Archived')
  assert.equal(archived.body.data.active, false)
  assert.equal(api.db.products.length, 1)
  assert.equal(api.db.audits.at(-1).action, 'product.archive')
  assert.equal((await request(api, `/${randomUUID()}`, { method: 'DELETE', actor: 'owner' })).status, 404)
})

test('list provides server pagination, search, status filter, and deterministic order', async () => {
  const api = await start()
  for (const [slug, sku, status] of [
    ['amber', 'RF-A', 'Draft'], ['oud', 'RF-O', 'Published'], ['rose', 'RF-R', 'Published'],
  ]) {
    assert.equal((await request(api, '', { method: 'POST', actor: 'owner', body: product({ name: slug, slug, sku, status }) })).status, 201)
  }
  const paged = await request(api, '?page=1&pageSize=2', { actor: 'reader' })
  assert.equal(paged.status, 200)
  assert.equal(paged.body.data.total, 3)
  assert.equal(paged.body.data.totalPages, 2)
  assert.equal(paged.body.data.items.length, 2)
  const filtered = await request(api, '?status=Published&search=RF-R', { actor: 'reader' })
  assert.equal(filtered.body.data.total, 1)
  assert.equal(filtered.body.data.items[0].slug, 'rose')
  assert.equal((await request(api, '?pageSize=999', { actor: 'reader' })).status, 400)
})

test('card migration follows prior migrations and browser write restrictions remain intact', () => {
  const migrationDir = path.join(root, 'backend/supabase/migrations')
  const names = readdirSync(migrationDir).sort()
  assert.ok(names.indexOf('005_product_card_presentation.sql') > names.indexOf('004_auth_session_refresh_lease.sql'))
  const cardSql = readFileSync(path.join(migrationDir, '005_product_card_presentation.sql'), 'utf8')
  for (const column of ['card_image_url', 'card_hover_image_url', 'card_background_color']) {
    assert.match(cardSql, new RegExp(`add column if not exists ${column} text not null default`, 'i'))
  }
  const foundationSql = readFileSync(path.join(migrationDir, '002_launch_schema_foundation.sql'), 'utf8')
  assert.match(foundationSql, /revoke insert, update, delete on public\.roles,[\s\S]*?public\.products,[\s\S]*?from anon, authenticated;/i)
  const serviceSource = readFileSync(path.join(root, 'backend/server/services/productAdminService.js'), 'utf8')
  assert.doesNotMatch(serviceSource, /readDb|updateDb|db\.json/)
})

function mockClient(db) {
  return { from(table) { return new Query(db, table) } }
}

class Query {
  constructor(db, table) {
    this.db = db
    this.table = table
    this.filters = []
    this.mode = 'read'
    this.count = false
    this.ordering = []
  }
  select(_columns, options = {}) { this.count = options.count === 'exact'; return this }
  eq(key, value) { this.filters.push((row) => row[key] === value); return this }
  or(value) {
    const search = value.match(/name\.ilike\.%(.+?)%,slug\.ilike/)[1].toLowerCase()
    this.filters.push((row) => ['name', 'slug', 'sku'].some((key) => String(row[key] ?? '').toLowerCase().includes(search)))
    return this
  }
  order(key, { ascending }) { this.ordering.push([key, ascending]); return this }
  range(from, to) { this.slice = [from, to]; return this }
  insert(value) { this.mode = 'insert'; this.value = value; return this }
  update(value) { this.mode = 'update'; this.value = value; return this }
  single() { return this.execute(true) }
  maybeSingle() { return this.execute(true) }
  then(resolve, reject) { return this.execute(false).then(resolve, reject) }
  async execute(one) {
    if (this.table === 'admin_audit_logs') {
      this.db.audits.push(this.value)
      return { data: null, error: null }
    }
    const rows = this.db[this.table]
    if (!rows) throw new Error(`Unexpected table: ${this.table}`)
    if (this.mode === 'insert') {
      if (rows.some((row) => row.slug?.toLowerCase() === this.value.slug?.toLowerCase() || row.sku?.toLowerCase() === this.value.sku?.toLowerCase())) {
        return { data: null, error: { code: '23505' } }
      }
      const row = { id: randomUUID(), category_name: '', stock_status: 'In Stock', active: true,
        sale_price: null, old_price: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        ...this.value }
      rows.push(row)
      return { data: row, error: null }
    }
    let selected = rows.filter((row) => this.filters.every((filter) => filter(row)))
    if (this.mode === 'update') {
      for (const row of selected) Object.assign(row, this.value, { updated_at: new Date().toISOString() })
      return { data: selected[0] ?? null, error: null }
    }
    const count = selected.length
    for (const [key, ascending] of this.ordering.reverse()) {
      selected = selected.toSorted((a, b) => String(a[key]).localeCompare(String(b[key])) * (ascending ? 1 : -1))
    }
    if (this.slice) selected = selected.slice(this.slice[0], this.slice[1] + 1)
    return { data: one ? selected[0] ?? null : selected, count: this.count ? count : null, error: null }
  }
}
