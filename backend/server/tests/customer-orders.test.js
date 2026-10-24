import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import { randomUUID } from 'node:crypto'
import express from 'express'
import cookieParser from 'cookie-parser'
import { fixture014, client014 } from './support/fulfillmentV2Database.js'
import { normalLine, fixedLine, configuredLine, requestV2, orderV2 } from './support/checkoutV2Database.js'
import { createAuthConfig } from '../auth/config.js'
import { getAuthCookieNames, getSessionCsrfToken } from '../auth/cookies.js'
import { requestContext, authErrorHandler } from '../middleware/authSecurity.js'
import { createCustomerAccountV1Router } from '../routes/customerAccountV1.js'
import { CustomerOrdersService } from '../services/customerOrdersService.js'

let f, client, server, base
const origin = 'http://localhost:5173'
const config = createAuthConfig({
  NODE_ENV: 'test',
  CLIENT_ORIGIN: origin,
  AUTH_CSRF_SECRET: 'customer-orders-fixture-secret-at-least-32',
  CUSTOMER_AUTH_PROVIDER: 'prototype',
  ADMIN_AUTH_PROVIDER: 'prototype',
})
const names = getAuthCookieNames(config)

const customerA = randomUUID()
const customerB = randomUUID()
let customerAActive = true
let customerAVerified = true

before(async () => {
  f = await fixture014()
  client = client014(f.db)

  // Seed two distinct customer profiles
  await f.db.query('insert into auth.users(id,email) values($1,$2)', [customerA, 'customera@example.invalid'])
  await f.db.query("insert into public.profiles(id,full_name,email,status) values($1,'Customer A','customera@example.invalid','Active') on conflict(id) do update set status='Active'", [customerA])

  await f.db.query('insert into auth.users(id,email) values($1,$2)', [customerB, 'customerb@example.invalid'])
  await f.db.query("insert into public.profiles(id,full_name,email,status) values($1,'Customer B','customerb@example.invalid','Active') on conflict(id) do update set status='Active'", [customerB])

  const runtime = {
    config,
    repository: { client },
    sessionService: {
      restore: async ({ accessToken }) => {
        if (!accessToken) return null
        if (accessToken === 'customerA') {
          return {
            record: { sessionClass: 'customer' },
            identity: { id: customerA, email: 'customera@example.invalid', emailVerified: customerAVerified, assuranceLevel: 'aal1' }
          }
        }
        if (accessToken === 'customerB') {
          return {
            record: { sessionClass: 'customer' },
            identity: { id: customerB, email: 'customerb@example.invalid', emailVerified: true, assuranceLevel: 'aal1' }
          }
        }
        if (accessToken === 'adminUser') {
          return {
            record: { sessionClass: 'administrator' },
            identity: { id: f.admin, email: 'admin@example.invalid', emailVerified: true, assuranceLevel: 'aal2' }
          }
        }
        return null
      }
    }
  }

  const app = express()
  app.use(requestContext, cookieParser(), express.json())
  app.use('/api/v1/customer', createCustomerAccountV1Router(runtime, { client }))
  app.use(authErrorHandler(config))

  server = app.listen(0, '127.0.0.1')
  await new Promise(r => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (server) await new Promise(r => server.close(r))
  if (f) await f.db.close()
})

async function request(path, { actor = 'customerA', method = 'GET', body, query } = {}) {
  const url = new URL(base + path)
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v))
  }
  const headers = {
    Origin: origin,
    'X-Request-ID': 'req_test_' + randomUUID().slice(0, 8)
  }
  if (actor) {
    const token = getSessionCsrfToken('fixture-handle-' + actor, config)
    headers.Cookie = `${names.access}=${actor}; ${names.refresh}=ref; ${names.session}=handle-${actor}; ${names.csrf}=${token}`
  }
  if (body) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(url.toString(), {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  return {
    status: res.status,
    body: await res.json().catch(() => null)
  }
}

test('Gate I: Security & Ownership Boundaries', async (t) => {
  await t.test('1. Unauthenticated list request returns 401 AUTH_REQUIRED', async () => {
    const res = await request('/api/v1/customer/orders', { actor: null })
    assert.equal(res.status, 401)
    assert.equal(res.body.error.code, 'AUTH_REQUIRED')
  })

  await t.test('2. Unauthenticated detail request returns 401 AUTH_REQUIRED', async () => {
    const res = await request('/api/v1/customer/orders/' + randomUUID(), { actor: null })
    assert.equal(res.status, 401)
    assert.equal(res.body.error.code, 'AUTH_REQUIRED')
  })

  await t.test('3. Unverified account is rejected with 403 EMAIL_VERIFICATION_REQUIRED', async () => {
    customerAVerified = false
    try {
      const res = await request('/api/v1/customer/orders', { actor: 'customerA' })
      assert.equal(res.status, 403)
      assert.equal(res.body.error.code, 'EMAIL_VERIFICATION_REQUIRED')
    } finally {
      customerAVerified = true
    }
  })

  await t.test('4. Disabled/inactive customer profile is rejected with 403 PERMISSION_DENIED', async () => {
    await f.db.query("update public.profiles set status='Inactive' where id=$1", [customerA])
    try {
      const res = await request('/api/v1/customer/orders', { actor: 'customerA' })
      assert.equal(res.status, 403)
      assert.equal(res.body.error.code, 'PERMISSION_DENIED')
    } finally {
      await f.db.query("update public.profiles set status='Active' where id=$1", [customerA])
    }
  })

  await t.test('10. Browser-supplied customerId in query cannot change ownership scope', async () => {
    const res = await request('/api/v1/customer/orders', {
      actor: 'customerA',
      query: { customerId: customerB }
    })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'INVALID_PAGINATION')
  })

  await t.test('11. Invalid pagination parameters return 400 INVALID_PAGINATION', async () => {
    const resNegative = await request('/api/v1/customer/orders', {
      actor: 'customerA',
      query: { page: 0 }
    })
    assert.equal(resNegative.status, 400)
    assert.equal(resNegative.body.error.code, 'INVALID_PAGINATION')

    const resNaN = await request('/api/v1/customer/orders', {
      actor: 'customerA',
      query: { page: 'invalid' }
    })
    assert.equal(resNaN.status, 400)
    assert.equal(resNaN.body.error.code, 'INVALID_PAGINATION')
  })

  await t.test('12. Large pageSize (>50) is bounded and returns 400 INVALID_PAGINATION', async () => {
    const res = await request('/api/v1/customer/orders', {
      actor: 'customerA',
      query: { pageSize: 100 }
    })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'INVALID_PAGINATION')
  })

  await t.test('16. Invalid non-UUID order ID returns 404 ORDER_NOT_FOUND safely', async () => {
    const res = await request('/api/v1/customer/orders/not-a-valid-uuid', { actor: 'customerA' })
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'ORDER_NOT_FOUND')
  })

  await t.test('17. Customer endpoints reject administrator sessions without customer identity', async () => {
    const res = await request('/api/v1/customer/orders', { actor: 'adminUser' })
    assert.equal(res.status, 403)
  })
})

test('Gate J: Real Connected Order History & Historical V1/V2 Receipts', async (t) => {
  // Empty state check first
  await t.test('Customer with zero orders receives empty items array', async () => {
    const res = await request('/api/v1/customer/orders', { actor: 'customerA' })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.data.items, [])
    assert.equal(res.body.data.total, 0)
    assert.equal(res.body.data.page, 1)
    assert.equal(res.body.data.totalPages, 0)
  })

  // Create Order 1 for Customer A: V2 with Fixed Pack + Normal perfume
  const reqA1 = await requestV2(f.db, [fixedLine(f), normalLine(f.normal.variant)], {
    order: { contact: { name: 'Customer A', email: 'customera@example.invalid', phone: '03001234567' } }
  })
  const orderA1Receipt = await orderV2(f.db, reqA1, customerA)
  assert.ok(orderA1Receipt.id)

  // Create Order 2 for Customer A: V2 with Configurable Discovery Pack
  const reqA2 = await requestV2(f.db, [configuredLine(f, [{ variantId: f.tester.tester.variant_id, quantityPerPack: 2 }])], {
    order: { contact: { name: 'Customer A', email: 'customera@example.invalid', phone: '03001234567' } }
  })
  const orderA2Receipt = await orderV2(f.db, reqA2, customerA)
  assert.ok(orderA2Receipt.id)

  // Create Order 1 for Customer B: V2 with normal variant
  const reqB1 = await requestV2(f.db, [normalLine(f.normal.variant, 2)], {
    order: { contact: { name: 'Customer B', email: 'customerb@example.invalid', phone: '03009876543' } }
  })
  const orderB1Receipt = await orderV2(f.db, reqB1, customerB)
  assert.ok(orderB1Receipt.id)

  // Create a Guest Order with Customer A's email (to test guest isolation)
  const reqGuest = await requestV2(f.db, [normalLine(f.normal.variant, 1)], {
    order: { contact: { name: 'Impostor Guest', email: 'customera@example.invalid', phone: '03000000000' } }
  })
  const guestReceipt = await orderV2(f.db, reqGuest, null)
  assert.ok(guestReceipt.id)

  // Create a legacy V1 Order for Customer A directly in database
  const v1OrderId = randomUUID()
  await f.db.query(`
    insert into public.orders(id, order_number, customer_id, customer_name, customer_email, customer_phone,
      shipping_address, shipping_city, shipping_province, status, payment_method, payment_status,
      subtotal, discount, shipping_fee, total, currency, checkout_version, snapshot_version, idempotency_key)
    values($1, 'RF-V1-LEGACY-001', $2, 'Customer A', 'customera@example.invalid', '03001234567',
      'Old V1 Address', 'Lahore', 'Punjab', 'Delivered', 'Cash on Delivery', 'Paid',
      2900, 0, 200, 3100, 'PKR', 1, 1, $3)
  `, [v1OrderId, customerA, 'checkout:' + randomUUID()])

  await f.db.query(`
    insert into public.order_items(id, order_id, product_id, variant_id, product_name, size, sku, quantity, unit_price, snapshot_version, line_kind)
    values($1, $2, $3, $4, 'Baraan Vintage', '50 ml', 'RF-BAR-001-50', 1, 2900, 1, 'normal_variant')
  `, [randomUUID(), v1OrderId, f.normal.product, f.normal.variant])

  // Assign courier and tracking to Order A1
  await f.db.query(`
    update public.orders set courier_name='TCS Logistics', tracking_number='TCS-987654321', status='Shipped'
    where id=$1
  `, [orderA1Receipt.id])

  await t.test('5. Customer A sees only Customer A orders (count = 3, excludes Customer B and Guest)', async () => {
    const res = await request('/api/v1/customer/orders', { actor: 'customerA' })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.total, 3)
    assert.equal(res.body.data.items.length, 3)

    const ids = res.body.data.items.map(i => i.id)
    assert.ok(ids.includes(orderA1Receipt.id))
    assert.ok(ids.includes(orderA2Receipt.id))
    assert.ok(ids.includes(v1OrderId))
    assert.ok(!ids.includes(orderB1Receipt.id), 'Must not include Customer B order')
    assert.ok(!ids.includes(guestReceipt.id), 'Must not include Guest order with matching email')
  })

  await t.test('6. Customer B sees only Customer B orders (count = 1)', async () => {
    const res = await request('/api/v1/customer/orders', { actor: 'customerB' })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.total, 1)
    assert.equal(res.body.data.items.length, 1)
    assert.equal(res.body.data.items[0].id, orderB1Receipt.id)
  })

  await t.test('7. Customer A cannot access Customer B order detail (returns 404 ORDER_NOT_FOUND)', async () => {
    const res = await request('/api/v1/customer/orders/' + orderB1Receipt.id, { actor: 'customerA' })
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'ORDER_NOT_FOUND')
    assert.equal(res.body.error.message, 'Order not found.')
  })

  await t.test('8. Unauthorized ID and completely nonexistent ID return identical 404 responses', async () => {
    const nonExistent = randomUUID()
    const resNonExistent = await request('/api/v1/customer/orders/' + nonExistent, { actor: 'customerA' })
    const resUnauthorized = await request('/api/v1/customer/orders/' + orderB1Receipt.id, { actor: 'customerA' })

    assert.equal(resNonExistent.status, 404)
    assert.equal(resUnauthorized.status, 404)
    assert.equal(resNonExistent.body.error.code, resUnauthorized.body.error.code)
    assert.equal(resNonExistent.body.error.message, resUnauthorized.body.error.message)
  })

  await t.test('9. Guest order with Customer A email remains strictly inaccessible (returns 404)', async () => {
    const res = await request('/api/v1/customer/orders/' + guestReceipt.id, { actor: 'customerA' })
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'ORDER_NOT_FOUND')
  })

  await t.test('13. List ordering is deterministic: created_at DESC, id DESC', async () => {
    const res = await request('/api/v1/customer/orders?page=1&pageSize=10', { actor: 'customerA' })
    assert.equal(res.status, 200)
    const items = res.body.data.items
    for (let i = 0; i < items.length - 1; i++) {
      const current = new Date(items[i].createdAt).getTime()
      const next = new Date(items[i + 1].createdAt).getTime()
      assert.ok(current >= next, `Ordering failure at index ${i}`)
    }
  })

  await t.test('14 & 15. Internal admin fields and payment secrets are completely absent from responses', async () => {
    const resList = await request('/api/v1/customer/orders', { actor: 'customerA' })
    const strList = JSON.stringify(resList.body)
    assert.doesNotMatch(strList, /internal_notes|admin_audit_logs|inventory_movements|idempotency_key|quote_snapshot|canonical_request/)

    const resDetail = await request('/api/v1/customer/orders/' + orderA1Receipt.id, { actor: 'customerA' })
    const strDetail = JSON.stringify(resDetail.body)
    assert.doesNotMatch(strDetail, /internal_notes|admin_audit_logs|inventory_movements|idempotency_key|canonical_request|request_fingerprint|quote_fingerprint|revision/)
  })

  await t.test('18. Historical V1 order receipt accurately renders frozen line items and prices', async () => {
    const res = await request('/api/v1/customer/orders/' + v1OrderId, { actor: 'customerA' })
    assert.equal(res.status, 200)
    const d = res.body.data
    assert.equal(d.id, v1OrderId)
    assert.equal(d.orderNumber, 'RF-V1-LEGACY-001')
    assert.equal(d.status, 'Delivered')
    assert.equal(d.paymentStatus, 'Paid')
    assert.equal(d.total, 3100)
    assert.equal(d.subtotal, 2900)
    assert.equal(d.shippingFee, 200)
    assert.equal(d.items.length, 1)
    assert.equal(d.items[0].name, 'Baraan Vintage')
    assert.equal(d.items[0].unitPrice, 2900)
    assert.equal(d.items[0].lineTotal, 2900)
    assert.equal(d.items[0].components.length, 0)
  })

  await t.test('19. V2 Fixed Discovery Pack receipt renders frozen pack and included components', async () => {
    const res = await request('/api/v1/customer/orders/' + orderA1Receipt.id, { actor: 'customerA' })
    assert.equal(res.status, 200)
    const d = res.body.data
    assert.equal(d.id, orderA1Receipt.id)
    assert.equal(d.status, 'Shipped')
    assert.equal(d.courier, 'TCS Logistics')
    assert.equal(d.trackingNumber, 'TCS-987654321')

    const fixedItem = d.items.find(i => i.kind === 'fixed_tester_pack')
    assert.ok(fixedItem, 'Fixed tester pack line must be present')
    assert.equal(fixedItem.components.length, 1)
    assert.equal(fixedItem.components[0].size, '5 ml')
    assert.equal(fixedItem.components[0].quantityPerPack, 2)
  })

  await t.test('20. V2 Configurable Discovery Pack renders custom selections', async () => {
    const res = await request('/api/v1/customer/orders/' + orderA2Receipt.id, { actor: 'customerA' })
    assert.equal(res.status, 200)
    const d = res.body.data
    const configItem = d.items.find(i => i.kind === 'configurable_tester_pack')
    assert.ok(configItem, 'Configurable tester pack line must be present')
    assert.equal(configItem.components.length, 1)
    assert.equal(configItem.components[0].size, '5 ml')
    assert.equal(configItem.components[0].quantityPerPack, 2)
  })

  await t.test('21. Catalog price and name changes do NOT alter historical frozen order receipt', async () => {
    // Change current product catalog price and name
    await f.db.query("update public.products set name='Renamed Catalog Baraan' where id=$1", [f.normal.product])
    await f.db.query("update public.product_variants set regular_price=9999 where id=$1", [f.normal.variant])

    const res = await request('/api/v1/customer/orders/' + orderA1Receipt.id, { actor: 'customerA' })
    assert.equal(res.status, 200)
    const d = res.body.data
    const normalItem = d.items.find(i => i.kind === 'normal_variant')
    assert.ok(normalItem)
    assert.equal(normalItem.name, 'Baraan', 'Historical name must not be overwritten by catalog rename')
    assert.equal(normalItem.unitPrice, 2900, 'Historical price must not be overwritten by catalog price change')
  })
})
