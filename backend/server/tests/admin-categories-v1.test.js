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
import { createAdminCategoriesV1Router } from '../routes/adminCategoriesV1.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const origin = 'https://shop.example.invalid'
const config = createAuthConfig({
  NODE_ENV: 'test',
  CLIENT_ORIGIN: origin,
  AUTH_CSRF_SECRET: 'public-category-contract-test-secret-12345',
  ADMIN_AUTH_PROVIDER: 'prototype',
  CUSTOMER_AUTH_PROVIDER: 'prototype',
  ENABLE_ADMIN_MFA: 'false',
})
const names = getAuthCookieNames(config)
const servers = []
after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
})

function sampleCategory(overrides = {}) {
  return {
    name: 'Eau de Parfum',
    slug: 'eau-de-parfum',
    description: 'High concentration signature fragrances.',
    displayOrder: 1,
    showOnHomepage: true,
    status: 'Published',
    ...overrides,
  }
}

async function start() {
  const db = {
    categories: [],
    products: [],
    audits: [],
  }
  const client = mockClient(db)
  const runtime = {
    config,
    repository: { client },
    sessionService: {
      restore: async ({ accessToken }) => {
        if (!accessToken) throw Object.assign(new Error('Authentication required'), { code: 'AUTH_REQUIRED' })
        return {
          record: {
            sessionClass: accessToken === 'customer' ? 'customer' : 'administrator',
            mfaAssurance: 'aal2',
          },
          identity: { id: accessToken, assuranceLevel: 'aal2' },
        }
      },
    },
    adminAuthorization: {
      resolve: async (id) => {
        if (id === 'reader') return { userId: id, permissions: ['products.read', 'catalog.read'] }
        if (id === 'manager') return { userId: id, permissions: ['categories.manage'] }
        if (id === 'owner') return { userId: id, permissions: ['*'] }
        return { userId: id, permissions: [] }
      },
    },
  }

  const app = express()
  app.use(requestContext)
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/v1/admin/categories', createAdminCategoriesV1Router(runtime, { client, logger: { warn() {} } }))
  app.use(authErrorHandler(config))
  app.use((error, req, res, _next) => {
    res.status(500).json({ error: { code: 'UNEXPECTED', requestId: req.requestId } })
  })

  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  servers.push(server)
  return { base: `http://127.0.0.1:${server.address().port}/api/v1/admin/categories`, db }
}

async function request(api, path = '', { method = 'GET', actor, body, csrf = true, requestOrigin = origin } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (actor) {
    const token = getSessionCsrfToken('handle', config)
    headers.Cookie = `${names.access}=${actor}; ${names.refresh}=refresh; ${names.session}=handle; ${names.csrf}=${token}`
    if (csrf) headers['X-RF-CSRF'] = token
  }
  if (method !== 'GET' && requestOrigin) headers.Origin = requestOrigin
  const response = await fetch(`${api.base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

test('every category endpoint requires production administrator identity and permissions', async () => {
  const api = await start()
  const endpoints = [
    ['GET', ''],
    ['GET', `/${randomUUID()}`],
    ['POST', ''],
    ['PUT', `/${randomUUID()}`],
    ['DELETE', `/${randomUUID()}`],
  ]
  for (const [method, path] of endpoints) {
    assert.equal((await request(api, path, { method })).status, 401)
    assert.equal((await request(api, path, { method, actor: 'customer' })).status, 403)
    assert.equal((await request(api, path, { method, actor: 'no-permission' })).status, 403)
  }

  // Reader with catalog.read or products.read can read
  assert.equal((await request(api, '', { actor: 'reader' })).status, 200)

  // Bearer only rejected (requires cookie session)
  const bearerOnly = await fetch(api.base, { headers: { Authorization: 'Bearer owner' } })
  assert.equal(bearerOnly.status, 401)

  // Reader cannot mutate
  assert.equal((await request(api, '', { method: 'POST', actor: 'reader', body: sampleCategory() })).status, 403)

  // Manager with categories.manage can mutate
  assert.equal((await request(api, '', { method: 'POST', actor: 'manager', body: sampleCategory() })).status, 201)

  // Mutation requires CSRF
  assert.equal(
    (await request(api, '', { method: 'POST', actor: 'manager', body: sampleCategory({ slug: 'c2' }), csrf: false })).body.error.code,
    'CSRF_INVALID'
  )

  // Mutation requires allowed origin
  assert.equal(
    (await request(api, '', { method: 'POST', actor: 'manager', body: sampleCategory({ slug: 'c3' }), requestOrigin: 'https://evil.invalid' })).status,
    403
  )
})

test('category CRUD, slug validation, duplicate conflicts, and list filters', async () => {
  const api = await start()

  // 1. Validation error on invalid slug
  const invalidRes = await request(api, '', {
    method: 'POST',
    actor: 'manager',
    body: sampleCategory({ slug: 'INVALID SLUG!' }),
  })
  assert.equal(invalidRes.status, 400)
  assert.equal(invalidRes.body.error.code, 'INVALID_REQUEST')

  // 2. Create category
  const createRes = await request(api, '', {
    method: 'POST',
    actor: 'manager',
    body: sampleCategory({ name: 'Extrait de Parfum', slug: 'extrait-de-parfum', displayOrder: 2 }),
  })
  assert.equal(createRes.status, 201)
  assert.equal(createRes.body.data.name, 'Extrait de Parfum')
  assert.equal(createRes.body.data.slug, 'extrait-de-parfum')
  assert.equal(createRes.body.data.active, true)
  const createdId = createRes.body.data.id

  // Audit log created
  assert.equal(api.db.audits.length, 1)
  assert.equal(api.db.audits[0].action, 'category.create')
  assert.equal(api.db.audits[0].resource, 'categories')
  assert.equal(api.db.audits[0].resource_id, createdId)

  // 3. Duplicate slug returns 409 conflict
  const dupRes = await request(api, '', {
    method: 'POST',
    actor: 'manager',
    body: sampleCategory({ name: 'Duplicate Extrait', slug: 'extrait-de-parfum' }),
  })
  assert.equal(dupRes.status, 409)
  assert.equal(dupRes.body.error.code, 'CATEGORY_CONFLICT')

  // 4. Get by ID
  const getRes = await request(api, `/${createdId}`, { actor: 'reader' })
  assert.equal(getRes.status, 200)
  assert.equal(getRes.body.data.id, createdId)
  assert.equal(getRes.body.data.name, 'Extrait de Parfum')

  // 5. Get non-existent returns 404
  const notFoundRes = await request(api, `/${randomUUID()}`, { actor: 'reader' })
  assert.equal(notFoundRes.status, 404)
  assert.equal(notFoundRes.body.error.code, 'CATEGORY_NOT_FOUND')

  // 6. Create another category for filtering
  await request(api, '', {
    method: 'POST',
    actor: 'manager',
    body: sampleCategory({ name: 'Attars', slug: 'attars', displayOrder: 1, status: 'Draft' }),
  })

  // 7. List categories
  const listAll = await request(api, '', { actor: 'reader' })
  assert.equal(listAll.status, 200)
  assert.equal(listAll.body.data.items.length, 2)
  // Ordered by displayOrder: Attars (1), then Extrait (2)
  assert.equal(listAll.body.data.items[0].name, 'Attars')
  assert.equal(listAll.body.data.items[1].name, 'Extrait de Parfum')

  // Filter by status
  const listDraft = await request(api, '?status=Draft', { actor: 'reader' })
  assert.equal(listDraft.body.data.items.length, 1)
  assert.equal(listDraft.body.data.items[0].name, 'Attars')

  // Search filter
  const listSearch = await request(api, '?search=Extrait', { actor: 'reader' })
  assert.equal(listSearch.body.data.items.length, 1)
  assert.equal(listSearch.body.data.items[0].slug, 'extrait-de-parfum')
})

test('category update synchronizes denormalized products.category_name and is_attar flag, and records audit log', async () => {
  const api = await start()

  // Create category
  const createRes = await request(api, '', {
    method: 'POST',
    actor: 'manager',
    body: sampleCategory({ name: 'Gift Sets Old', slug: 'gift-sets' }),
  })
  const catId = createRes.body.data.id

  // Add a product referencing this category
  api.db.products.push({
    id: randomUUID(),
    name: 'Royal Gift Box',
    slug: 'royal-gift-box',
    category_id: catId,
    category_name: 'Gift Sets Old',
    is_attar: false,
  })

  // Update category name to canonical Attar
  const updateRes = await request(api, `/${catId}`, {
    method: 'PUT',
    actor: 'manager',
    body: { name: 'Attar' },
  })
  assert.equal(updateRes.status, 200)
  assert.equal(updateRes.body.data.name, 'Attar')

  // Verify denormalized category_name and is_attar in product were updated
  assert.equal(api.db.products[0].category_name, 'Attar')
  assert.equal(api.db.products[0].is_attar, true)

  // Verify audit log
  const updateAudit = api.db.audits.find((a) => a.action === 'category.update' && a.resource_id === catId)
  assert.ok(updateAudit)
})

test('delete category behavior: hard delete if unreferenced, clean archive response if referenced by products', async () => {
  const api = await start()

  // 1. Create unreferenced category
  const catRes1 = await request(api, '', {
    method: 'POST',
    actor: 'manager',
    body: sampleCategory({ name: 'Unreferenced Cat', slug: 'unreferenced-cat' }),
  })
  const unreferencedId = catRes1.body.data.id

  // Delete unreferenced category -> hard deletes
  const delRes1 = await request(api, `/${unreferencedId}`, {
    method: 'DELETE',
    actor: 'manager',
  })
  assert.equal(delRes1.status, 200)
  assert.equal(delRes1.body.data.deleted, true)
  assert.equal(delRes1.body.data.archived, false)
  assert.equal(api.db.categories.some((c) => c.id === unreferencedId), false)

  // Verify audit log for delete
  const deleteAudit = api.db.audits.find((a) => a.action === 'category.delete' && a.resource_id === unreferencedId)
  assert.ok(deleteAudit)

  // 2. Create category referenced by a product
  const catRes2 = await request(api, '', {
    method: 'POST',
    actor: 'manager',
    body: sampleCategory({ name: 'In Use Cat', slug: 'in-use-cat' }),
  })
  const inUseId = catRes2.body.data.id

  // Add product referencing this category
  api.db.products.push({
    id: randomUUID(),
    name: 'Sample Perfume',
    slug: 'sample-perfume',
    category_id: inUseId,
    category_name: 'In Use Cat',
  })

  // Attempt delete -> cleanly soft archives and returns 200 with archived: true
  const delRes2 = await request(api, `/${inUseId}`, {
    method: 'DELETE',
    actor: 'manager',
  })
  assert.equal(delRes2.status, 200)
  assert.equal(delRes2.body.data.archived, true)
  assert.equal(delRes2.body.data.deleted, false)
  assert.match(delRes2.body.data.message, /archived instead of deleted/i)

  // Verify category still exists in db but is now Archived and inactive
  const categoryInDb = api.db.categories.find((c) => c.id === inUseId)
  assert.ok(categoryInDb)
  assert.equal(categoryInDb.status, 'Archived')
  assert.equal(categoryInDb.active, false)

  // Verify audit log recorded category.archive
  const archiveAudit = api.db.audits.find((a) => a.action === 'category.archive' && a.resource_id === inUseId)
  assert.ok(archiveAudit)
})

test('category architecture maintains isolation from prototype files', () => {
  const serviceSource = readFileSync(path.join(root, 'backend/server/services/categoryAdminService.js'), 'utf8')
  assert.doesNotMatch(serviceSource, /readDb|updateDb|db\.json/)
})

function mockClient(db) {
  return {
    from(table) {
      return new Query(db, table)
    },
  }
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
  select(_columns, options = {}) {
    this.count = options.count === 'exact'
    return this
  }
  eq(key, value) {
    this.filters.push((row) => row[key] === value)
    return this
  }
  or(value) {
    const searchMatch = value.match(/name\.ilike\.%(.+?)%,slug\.ilike/)
    const search = searchMatch ? searchMatch[1].toLowerCase() : ''
    this.filters.push((row) =>
      ['name', 'slug'].some((key) => String(row[key] ?? '').toLowerCase().includes(search))
    )
    return this
  }
  order(key, { ascending }) {
    this.ordering.push([key, ascending])
    return this
  }
  range(from, to) {
    this.slice = [from, to]
    return this
  }
  insert(value) {
    this.mode = 'insert'
    this.value = value
    return this
  }
  update(value) {
    this.mode = 'update'
    this.value = value
    return this
  }
  delete() {
    this.mode = 'delete'
    return this
  }
  single() {
    return this.execute(true)
  }
  maybeSingle() {
    return this.execute(true)
  }
  then(resolve, reject) {
    return this.execute(false).then(resolve, reject)
  }
  async execute(one) {
    if (this.table === 'admin_audit_logs') {
      this.db.audits.push(this.value)
      return { data: null, error: null }
    }
    const rows = this.db[this.table]
    if (!rows) throw new Error(`Unexpected table: ${this.table}`)

    if (this.mode === 'insert') {
      if (rows.some((row) => row.slug?.toLowerCase() === this.value.slug?.toLowerCase())) {
        return { data: null, error: { code: '23505' } }
      }
      const row = {
        id: randomUUID(),
        description: '',
        image_url: '',
        display_order: 0,
        show_on_homepage: false,
        status: 'Published',
        active: true,
        seo_title: '',
        seo_description: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...this.value,
      }
      rows.push(row)
      return { data: row, error: null }
    }

    let selected = rows.filter((row) => this.filters.every((filter) => filter(row)))

    if (this.mode === 'update') {
      for (const row of selected) {
        Object.assign(row, this.value, { updated_at: new Date().toISOString() })
      }
      return { data: selected[0] ?? null, error: null }
    }

    if (this.mode === 'delete') {
      for (const row of selected) {
        const idx = rows.indexOf(row)
        if (idx !== -1) rows.splice(idx, 1)
      }
      return { data: null, error: null }
    }

    const count = selected.length
    for (const [key, ascending] of this.ordering.reverse()) {
      selected = selected.toSorted((a, b) => {
        const valA = a[key] ?? 0
        const valB = b[key] ?? 0
        if (typeof valA === 'number' && typeof valB === 'number') {
          return (valA - valB) * (ascending ? 1 : -1)
        }
        return String(valA).localeCompare(String(valB)) * (ascending ? 1 : -1)
      })
    }
    if (this.slice) selected = selected.slice(this.slice[0], this.slice[1] + 1)
    return { data: one ? selected[0] ?? null : selected, count: this.count ? count : null, error: null }
  }
}
