import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import cookieParser from 'cookie-parser'
import { randomUUID } from 'node:crypto'
import { CustomerOrdersService } from '../services/customerOrdersService.js'
import { createCustomerAccountV1Router } from '../routes/customerAccountV1.js'
import { createAuthConfig } from '../auth/config.js'
import { getAuthCookieNames } from '../auth/cookies.js'
import { requestContext, authErrorHandler } from '../middleware/authSecurity.js'
import { AuthSessionError } from '../services/authSessionService.js'

// Read-only query doubles: these tests do not execute SQL or contact a database.
const customerA = randomUUID(), customerB = randomUUID(), guestId = randomUUID()
const order = (customer, version = 1) => ({ id: randomUUID(), customer_id: customer, order_number: 'RF-20261018-1234ABCD',
  created_at: '2026-10-18T08:00:00Z', status: 'Shipped', payment_status: 'Paid', payment_method: 'Cash on Delivery',
  total: '1250.50', subtotal: '1000.50', discount: '0', shipping_fee: '250', currency: 'PKR', checkout_version: version,
  customer_name: 'Snapshot Customer', shipping_address: 'Snapshot street', shipping_city: 'Attock', shipping_province: 'Punjab',
  order_notes: '', courier_name: '', tracking_number: '', internal_notes: ['private'], customer_email: 'private@example.invalid',
  canonical_request: { secret: true }, quote_snapshot: { secret: true }, idempotency_key: 'secret' })
const item = (parent, overrides = {}) => ({ id: randomUUID(), order_id: parent.id, product_id: null, variant_id: null,
  product_name: 'Frozen fragrance', size: '50 ml', sku: '', quantity: 2, unit_price: '500.25', line_total: '1000.50',
  line_kind: 'normal_variant', position: null, pack_id: null, ...overrides })

function reader(tables, { failTable } = {}) {
  const calls = []
  return { calls, from(table) {
    assert.ok(['profiles','orders','order_items','order_item_components'].includes(table), 'No catalog or admin reads')
    const call = { table, filters: [], orders: [], range: null }; calls.push(call)
    const query = {
      select(columns, options) { call.columns = columns; call.options = options; return query },
      eq(column, value) { call.filters.push(['eq', column, value]); return query },
      in(column, values) { call.filters.push(['in', column, values]); return query },
      order(column, options) { call.orders.push([column, options]); return query },
      range(from, to) { call.range = [from, to]; return query },
      maybeSingle() { call.single = true; return query },
      then(resolve, reject) {
        let rows = (tables[table] ?? []).filter(row => call.filters.every(([op, column, value]) => op === 'eq' ? row[column] === value : value.includes(row[column])))
        const count = rows.length
        rows = [...rows].sort((a, b) => {
          for (const [column, { ascending }] of call.orders) {
            const result = String(a[column] ?? '').localeCompare(String(b[column] ?? ''))
            if (result) return ascending ? result : -result
          }
          return 0
        })
        if (call.range) rows = rows.slice(call.range[0], call.range[1] + 1)
        const project = row => Object.fromEntries(call.columns.split(',').filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]))
        const data = call.single ? rows[0] ? project(rows[0]) : null : rows.map(project)
        return Promise.resolve({ data: failTable === table ? null : data, count, error: failTable === table ? { code: 'READ_FAILURE' } : null }).then(resolve, reject)
      },
    }
    return query
  } }
}

test('customer order service uses owned root IDs, recorded V1/V2 snapshots, and bounded child pagination', async () => {
  const v1 = order(customerA), v2 = order(customerA, 2), other = order(customerB), guest = order(null)
  const historical = item(v1)
  const pack = item(v2, { product_id: guestId, pack_id: guestId, line_kind: 'configurable_tester_pack', position: 0, size: 'Tester pack' })
  const components = Array.from({ length: 1101 }, (_, position) => ({ id: randomUUID(), order_id: v2.id, order_item_id: pack.id,
    tester_name: `Recorded tester ${position}`, sku: 'OLD-SKU', size: '5 ml', volume_ml: '5', quantity_per_pack: 2,
    total_physical_quantity: 4, reference_unit_price: '50.25', position }))
  const client = reader({ orders: [v1, v2, other, guest], order_items: [historical, pack, item(other)], order_item_components: components })
  const service = new CustomerOrdersService(client)
  const list = await service.list(customerA, { page: 1, pageSize: 1 })
  assert.equal(list.total, 2); assert.equal(list.totalPages, 2); assert.equal(list.items.length, 1)
  assert.ok(client.calls.find(c => c.table === 'orders').filters.some(f => f[1] === 'customer_id' && f[2] === customerA))
  assert.ok(!JSON.stringify(list).includes('private'))
  const legacy = await service.detail(v1.id, customerA)
  assert.equal(legacy.items[0].productId, null)
  assert.equal(legacy.items[0].sku, '')
  assert.equal(legacy.items[0].position, null)
  assert.equal(legacy.items[0].lineTotal, 1000.50)
  assert.deepEqual(legacy.items[0].components, [])
  const detail = await service.detail(v2.id, customerA)
  assert.equal(detail.items[0].kind, 'configurable_tester_pack')
  assert.equal(detail.items[0].components.length, 1101)
  assert.equal(detail.items[0].components.at(-1).name, 'Recorded tester 1100')
  assert.equal(detail.items[0].components[0].totalPhysicalQuantity, 4)
  assert.deepEqual(client.calls.filter(c => c.table === 'order_item_components').map(c => c.range), [[0,499],[500,999],[1000,1499]])
  for (const key of ['customer_id','internal_notes','canonical_request','quote_snapshot','idempotency_key','customer_email']) assert.equal(key in detail, false)
  const before = client.calls.length
  await assert.rejects(service.detail(other.id, customerA), { code: 'ORDER_NOT_FOUND', status: 404 })
  await assert.rejects(service.detail(guest.id, customerA), { code: 'ORDER_NOT_FOUND', status: 404 })
  assert.ok(client.calls.slice(before).every(c => c.table === 'orders'), 'No child reads before ownership succeeds')
})

test('large list item counts are complete, read failures never return partial receipts', async () => {
  const own = order(customerA)
  const items = Array.from({ length: 1100 }, () => item(own, { quantity: 1 }))
  const client = reader({ orders: [own], order_items: items })
  assert.equal((await new CustomerOrdersService(client).list(customerA)).items[0].itemCount, 1100)
  const unavailable = new CustomerOrdersService(reader({ orders: [own] }, { failTable: 'order_items' }), { logger: { warn() {} } })
  await assert.rejects(unavailable.detail(own.id, customerA), { code: 'CUSTOMER_ORDER_UNAVAILABLE', status: 503 })
})

async function httpFixture(t, limit = 60) {
  const own = order(customerA), other = order(customerB), guest = order(null)
  const tables = { profiles: [{ id: customerA, full_name: 'Customer A', phone: '', status: 'Active' }, { id: customerB, full_name: 'Customer B', phone: '', status: 'Active' }],
    orders: [own, other, guest], order_items: [item(own)] }
  const client = reader(tables)
  const config = createAuthConfig({ NODE_ENV: 'test', CLIENT_ORIGIN: 'http://localhost:5173', AUTH_CSRF_SECRET: 'readonly-customer-fixture-secret-32-plus', CUSTOMER_AUTH_PROVIDER: 'prototype', ADMIN_AUTH_PROVIDER: 'prototype' })
  const runtime = { config, repository: { client }, sessionService: { restore: async ({ accessToken }) => {
    if (accessToken === 'expired') throw new AuthSessionError('SESSION_EXPIRED')
    return {
    record: { sessionClass: accessToken === 'administrator' ? 'administrator' : 'customer' },
    identity: { id: accessToken === 'other-customer' ? customerB : customerA, email: 'a@example.invalid', emailVerified: accessToken !== 'unverified' },
  } } } }
  const app = express()
  app.use(requestContext, cookieParser(), express.json())
  app.use('/api/v1/customer', createCustomerAccountV1Router(runtime, { orderReadLimit: limit }))
  app.use(authErrorHandler(config))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const names = getAuthCookieNames(config)
  const get = async (path, actor = 'customer') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/customer${path}`, { headers: {
      Origin: 'http://localhost:5173', ...(actor ? { Cookie: `${names.access}=${actor}; ${names.refresh}=refresh; ${names.session}=session` } : {}),
    } })
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() }
  }
  return { get, own, other, guest, tables, client }
}

test('HTTP order endpoints enforce verified customer sessions, ownership, private caching and pagination', async t => {
  const { get, own, other, guest, tables } = await httpFixture(t)
  for (const path of ['/orders', `/orders/${own.id}`]) {
    assert.equal((await get(path, null)).status, 401)
    assert.equal((await get(path, 'expired')).status, 401)
    assert.equal((await get(path, 'administrator')).status, 403)
    assert.equal((await get(path, 'unverified')).status, 403)
  }
  const list = await get('/orders?page=1&pageSize=1')
  assert.equal(list.status, 200); assert.equal(list.cache, 'no-store')
  assert.deepEqual(list.body.data.items.map(o => o.id), [own.id])
  assert.equal((await get(`/orders/${own.id}`)).status, 200)
  assert.equal((await get(`/orders/${own.id}`, 'other-customer')).status, 404)
  assert.deepEqual((await get('/orders', 'other-customer')).body.data.items.map(o => o.id), [other.id])
  for (const id of [other.id, guest.id, randomUUID(), 'invalid']) {
    const result = await get(`/orders/${id}`)
    assert.equal(result.status, 404); assert.equal(result.body.error.code, 'ORDER_NOT_FOUND')
  }
  for (const query of ['customerId='+customerB, 'page=0', 'pageSize=51', 'page=-1', 'page=1.5', 'page=100001']) assert.equal((await get('/orders?'+query)).status, 400)
  tables.profiles[0].status = 'Inactive'
  assert.equal((await get('/orders')).status, 403)
})

test('read rate limiting is scoped to customer identity and never caches private error responses', async t => {
  const { get } = await httpFixture(t, 1)
  assert.equal((await get('/orders')).status, 200)
  const limited = await get('/orders')
  assert.equal(limited.status, 429); assert.equal(limited.body.error.code, 'RATE_LIMITED'); assert.equal(limited.cache, 'no-store')
  assert.equal((await get('/orders', 'other-customer')).status, 200)
})
