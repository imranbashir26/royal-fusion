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
import { createAdminCollectionsV1Router } from '../routes/adminCollectionsV1.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const origin = 'https://shop.example.invalid'
const config = createAuthConfig({
  NODE_ENV: 'test',
  CLIENT_ORIGIN: origin,
  AUTH_CSRF_SECRET: 'public-collection-contract-test-secret-12345',
  ADMIN_AUTH_PROVIDER: 'prototype',
  CUSTOMER_AUTH_PROVIDER: 'prototype',
  ENABLE_ADMIN_MFA: 'false',
})
const names = getAuthCookieNames(config)
const servers = []
after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
})

function sampleCollection(overrides = {}) {
  return {
    name: 'Royal Fusion Originals',
    slug: 'royal-fusion-originals',
    description: 'The launch collection of signature fragrances.',
    displayOrder: 1,
    featured: true,
    active: true,
    bannerSecureUrl: 'https://res.cloudinary.com/royal-fusion/image/upload/v1/banner.webp',
    bannerAltText: 'Royal Fusion Originals banner',
    seoTitle: 'Royal Fusion Originals',
    seoDescription: 'Explore our originals.',
    ...overrides,
  }
}

async function start() {
  const db = {
    collections: [],
    product_collections: [],
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
        if (id === 'manager') return { userId: id, permissions: ['collections.manage'] }
        if (id === 'owner') return { userId: id, permissions: ['*'] }
        return { userId: id, permissions: [] }
      },
    },
  }

  const app = express()
  app.use(requestContext)
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/v1/admin/collections', createAdminCollectionsV1Router(runtime, { client, logger: { warn() {} } }))
  app.use(authErrorHandler(config))
  app.use((error, req, res, _next) => {
    res.status(500).json({ error: { code: 'UNEXPECTED', requestId: req.requestId } })
  })

  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  servers.push(server)
  return { base: `http://127.0.0.1:${server.address().port}/api/v1/admin/collections`, db }
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

test('every collection endpoint requires production administrator identity and permissions', async () => {
  const api = await start()
  const endpoints = [
    ['GET', ''],
    ['GET', `/${randomUUID()}`],
    ['GET', `/${randomUUID()}/products`],
    ['POST', ''],
    ['PUT', `/${randomUUID()}`],
    ['PUT', `/${randomUUID()}/products`],
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
  assert.equal((await request(api, '', { method: 'POST', actor: 'reader', body: sampleCollection() })).status, 403)

  // Manager with collections.manage can mutate
  assert.equal((await request(api, '', { method: 'POST', actor: 'manager', body: sampleCollection() })).status, 201)

  // Mutation requires CSRF
  assert.equal(
    (await request(api, '', { method: 'POST', actor: 'manager', body: sampleCollection({ slug: 'c2' }), csrf: false })).body.error.code,
    'CSRF_INVALID'
  )

  // Mutation requires allowed origin
  assert.equal(
    (await request(api, '', { method: 'POST', actor: 'manager', body: sampleCollection({ slug: 'c3' }), requestOrigin: 'https://evil.invalid' })).status,
    403
  )
})

test('collection CRUD, slug validation, duplicate conflicts, and list filters', async () => {
  const api = await start()

  // 1. Validation error on invalid slug
  const invalidRes = await request(api, '', {
    method: 'POST',
    actor: 'manager',
    body: sampleCollection({ slug: 'INVALID SLUG!' }),
  })
  assert.equal(invalidRes.status, 400)
  assert.equal(invalidRes.body.error.code, 'INVALID_REQUEST')

  // 2. Create collection
  const createRes = await request(api, '', {
    method: 'POST',
    actor: 'manager',
    body: sampleCollection({ name: 'Crystal Edit', slug: 'crystal-edit', displayOrder: 2, featured: true }),
  })
  assert.equal(createRes.status, 201)
  assert.equal(createRes.body.data.name, 'Crystal Edit')
  assert.equal(createRes.body.data.slug, 'crystal-edit')
  assert.equal(createRes.body.data.active, true)
  assert.equal(createRes.body.data.featured, true)
  assert.equal(createRes.body.data.displayOrder, 2)
  const createdId = createRes.body.data.id

  // Audit log created
  assert.equal(api.db.audits.length, 1)
  assert.equal(api.db.audits[0].action, 'collection.create')
  assert.equal(api.db.audits[0].resource, 'collections')
  assert.equal(api.db.audits[0].resource_id, createdId)

  // 3. Duplicate slug returns 409 conflict
  const dupRes = await request(api, '', {
    method: 'POST',
    actor: 'manager',
    body: sampleCollection({ name: 'Duplicate Crystal', slug: 'crystal-edit' }),
  })
  assert.equal(dupRes.status, 409)
  assert.equal(dupRes.body.error.code, 'COLLECTION_CONFLICT')

  // 4. Get by ID
  const getRes = await request(api, `/${createdId}`, { actor: 'reader' })
  assert.equal(getRes.status, 200)
  assert.equal(getRes.body.data.id, createdId)
  assert.equal(getRes.body.data.name, 'Crystal Edit')

  // 5. Get non-existent returns 404
  const notFoundRes = await request(api, `/${randomUUID()}`, { actor: 'reader' })
  assert.equal(notFoundRes.status, 404)
  assert.equal(notFoundRes.body.error.code, 'COLLECTION_NOT_FOUND')

  // 6. Create another collection for filtering
  await request(api, '', {
    method: 'POST',
    actor: 'manager',
    body: sampleCollection({ name: 'Oud Heritage', slug: 'oud-heritage', displayOrder: 1, featured: false, active: false }),
  })

  // 7. List collections
  const listAll = await request(api, '', { actor: 'reader' })
  assert.equal(listAll.status, 200)
  assert.equal(listAll.body.data.items.length, 2)
  // Ordered by displayOrder: Oud Heritage (1), then Crystal Edit (2)
  assert.equal(listAll.body.data.items[0].name, 'Oud Heritage')
  assert.equal(listAll.body.data.items[1].name, 'Crystal Edit')

  // Filter by active
  const listActive = await request(api, '?active=true', { actor: 'reader' })
  assert.equal(listActive.body.data.items.length, 1)
  assert.equal(listActive.body.data.items[0].name, 'Crystal Edit')

  // Filter by featured
  const listFeatured = await request(api, '?featured=true', { actor: 'reader' })
  assert.equal(listFeatured.body.data.items.length, 1)
  assert.equal(listFeatured.body.data.items[0].name, 'Crystal Edit')

  // Search filter
  const listSearch = await request(api, '?search=Crystal', { actor: 'reader' })
  assert.equal(listSearch.body.data.items.length, 1)
  assert.equal(listSearch.body.data.items[0].slug, 'crystal-edit')
})

test('collection rename preserves relational membership without rewriting legacy products.collection', async () => {
  const api = await start()

  // Create collection
  const createRes = await request(api, '', {
    method: 'POST',
    actor: 'manager',
    body: sampleCollection({ name: 'Royal Fusion Originals', slug: 'royal-fusion-originals' }),
  })
  const collectionId = createRes.body.data.id

  // Add a product referencing this collection
  const productId = randomUUID()
  api.db.products.push({
    id: productId,
    name: 'SHAHEEN',
    slug: 'shaheen',
    collection: 'Royal Fusion Originals',
    active: true,
  })
  api.db.product_collections.push({ collection_id: collectionId, product_id: productId, display_order: 1 })

  // Update collection name
  const updateRes = await request(api, `/${collectionId}`, {
    method: 'PUT',
    actor: 'manager',
    body: { name: 'Royal Fusion Prestige' },
  })
  assert.equal(updateRes.status, 200)
  assert.equal(updateRes.body.data.name, 'Royal Fusion Prestige')

  // Audit logged
  const updateAudit = api.db.audits.find((a) => a.action === 'collection.update')
  assert.ok(updateAudit)
  assert.equal(updateAudit.resource_id, collectionId)

  // The legacy text is not a membership source and is deliberately not synchronized.
  const product = api.db.products.find((p) => p.slug === 'shaheen')
  assert.equal(product.collection, 'Royal Fusion Originals')
  assert.equal(api.db.product_collections[0].collection_id, collectionId)
})

test('delete collection behavior: hard delete if unreferenced, clean archive response if referenced by products', async () => {
  const api = await start()

  // 1. Create unreferenced collection
  const c1Res = await request(api, '', {
    method: 'POST',
    actor: 'manager',
    body: sampleCollection({ name: 'Solitary Edit', slug: 'solitary-edit' }),
  })
  const solitaryId = c1Res.body.data.id
  api.db.products.push({ id: randomUUID(), collection: 'Solitary Edit' })

  // Delete unreferenced collection -> Hard deleted
  const delRes1 = await request(api, `/${solitaryId}`, {
    method: 'DELETE',
    actor: 'manager',
  })
  assert.equal(delRes1.status, 200)
  assert.equal(delRes1.body.data.deleted, true)
  assert.equal(delRes1.body.data.archived, false)
  assert.equal(api.db.collections.some((c) => c.id === solitaryId), false)
  assert.ok(api.db.audits.some((a) => a.action === 'collection.delete' && a.resource_id === solitaryId))

  // 2. Create collection with product_collections reference
  const c2Res = await request(api, '', {
    method: 'POST',
    actor: 'manager',
    body: sampleCollection({ name: 'Referenced Collection', slug: 'referenced-collection' }),
  })
  const refId = c2Res.body.data.id
  const prodId = randomUUID()

  // Add reference in product_collections
  api.db.product_collections.push({
    collection_id: refId,
    product_id: prodId,
    display_order: 1,
  })

  // Delete referenced collection -> Soft archived
  const delRes2 = await request(api, `/${refId}`, {
    method: 'DELETE',
    actor: 'manager',
  })
  assert.equal(delRes2.status, 200)
  assert.equal(delRes2.body.data.deleted, false)
  assert.equal(delRes2.body.data.archived, true)
  assert.ok(delRes2.body.data.message.includes('archived instead of deleted'))

  const archivedCollection = api.db.collections.find((c) => c.id === refId)
  assert.ok(archivedCollection)
  assert.equal(archivedCollection.active, false)
  assert.ok(api.db.audits.some((a) => a.action === 'collection.archive' && a.resource_id === refId))
})

test('product membership: list products and assign products to collection', async () => {
  const api = await start()

  const cRes = await request(api, '', {
    method: 'POST',
    actor: 'manager',
    body: sampleCollection({ name: 'Curated Wardrobe', slug: 'curated-wardrobe' }),
  })
  const collectionId = cRes.body.data.id

  const p1Id = randomUUID()
  const p2Id = randomUUID()
  api.db.products.push(
    { id: p1Id, name: 'Perfume 1', slug: 'perfume-1', price: 3990, main_image_url: 'img1.webp', active: true, status: 'Published' },
    { id: p2Id, name: 'Perfume 2', slug: 'perfume-2', price: 4990, main_image_url: 'img2.webp', active: true, status: 'Published' },
  )

  // Assign products
  const assignRes = await request(api, `/${collectionId}/products`, {
    method: 'PUT',
    actor: 'manager',
    body: { productIds: [p2Id, p1Id] },
  })
  assert.equal(assignRes.status, 200)
  assert.equal(assignRes.body.data.count, 2)

  // Audit logged
  assert.ok(api.db.audits.some((a) => a.action === 'collection.assign_products' && a.resource_id === collectionId))

  // Get products for collection
  const listProdRes = await request(api, `/${collectionId}/products`, { actor: 'reader' })
  assert.equal(listProdRes.status, 200)
  assert.equal(listProdRes.body.data.length, 2)
  assert.equal(listProdRes.body.data[0].product.slug, 'perfume-2')
  assert.equal(listProdRes.body.data[1].product.slug, 'perfume-1')
})

test('one product can belong to multiple collections without a legacy text assignment', async () => {
  const api = await start()
  const first = await request(api, '', { method: 'POST', actor: 'manager', body: sampleCollection({ name: 'First Edit', slug: 'first-edit' }) })
  const second = await request(api, '', { method: 'POST', actor: 'manager', body: sampleCollection({ name: 'Second Edit', slug: 'second-edit' }) })
  const productId = randomUUID()
  api.db.products.push({ id: productId, name: 'Shared Scent', slug: 'shared-scent', price: 3990, main_image_url: 'image.webp', active: true, status: 'Published', collection: 'Legacy Label' })

  for (const collectionId of [first.body.data.id, second.body.data.id]) {
    const response = await request(api, `/${collectionId}/products`, { method: 'PUT', actor: 'manager', body: { productIds: [productId] } })
    assert.equal(response.status, 200)
    const listed = await request(api, `/${collectionId}/products`, { actor: 'reader' })
    assert.equal(listed.body.data[0].product.id, productId)
  }
  assert.equal(api.db.product_collections.filter((link) => link.product_id === productId).length, 2)
  assert.equal(api.db.products.find((product) => product.id === productId).collection, 'Legacy Label')
})

test('collection architecture maintains isolation from prototype files', () => {
  const routerSource = readFileSync(path.join(root, 'backend/server/routes/adminCollectionsV1.js'), 'utf8')
  assert.equal(routerSource.includes('prototype'), false)
  assert.equal(routerSource.includes('lowdb'), false)

  const serviceSource = readFileSync(path.join(root, 'backend/server/services/collectionAdminService.js'), 'utf8')
  assert.equal(serviceSource.includes('prototype'), false)
  assert.equal(serviceSource.includes('lowdb'), false)
})

function mockClient(db) {
  return {
    from: (table) => new MockQuery(db, table),
  }
}

class MockQuery {
  constructor(db, table) {
    this.db = db
    this.table = table
    this.filters = []
    this.ordering = []
    this.mode = 'select'
    this.slice = null
    this.count = null
  }
  select(_fields, opts = {}) {
    if (opts.count) this.count = opts.count
    return this
  }
  eq(key, value) {
    this.filters.push((row) => row[key] === value)
    return this
  }
  or(value) {
    const searchMatch = value.match(/name\.ilike\.%(.+?)%,slug\.ilike/)
    if (searchMatch) {
      const search = searchMatch[1].toLowerCase()
      this.filters.push((row) =>
        ['name', 'slug'].some((key) => String(row[key] ?? '').toLowerCase().includes(search))
      )
      return this
    }
    const collectionMatch = value.match(/collection\.eq\.(.+?),collection\.eq\.(.+)/)
    if (collectionMatch) {
      const c1 = collectionMatch[1]
      const c2 = collectionMatch[2]
      this.filters.push((row) => row.collection === c1 || row.collection === c2)
      return this
    }
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
      const items = Array.isArray(this.value) ? this.value : [this.value]
      const createdRows = []
      for (const item of items) {
        if (this.table === 'collections' && rows.some((row) => row.slug?.toLowerCase() === item.slug?.toLowerCase())) {
          return { data: null, error: { code: '23505' } }
        }
        const row = {
          id: randomUUID(),
          description: '',
          banner_cloudinary_public_id: '',
          banner_secure_url: '',
          banner_alt_text: '',
          display_order: 0,
          featured: false,
          active: true,
          seo_title: '',
          seo_description: '',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...item,
        }
        rows.push(row)
        createdRows.push(row)
      }
      return { data: one ? createdRows[0] : createdRows, error: null }
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

    // Join with products table if product_collections is requested with products
    if (this.table === 'product_collections') {
      selected = selected.map((pc) => {
        const prod = this.db.products.find((p) => p.id === pc.product_id)
        return {
          ...pc,
          products: prod || null,
        }
      })
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
