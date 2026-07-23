import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { startIsolatedApi } from './support/isolatedApi.js'

test('current guest checkout remains unauthenticated and authoritative in an isolated database', async (context) => {
  const api = await startIsolatedApi()
  context.after(() => api.stop())

  const response = await fetch(`${api.baseUrl}/api/public/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [{ productId: 'product-selected', size: '50 ml', quantity: 2 }],
      contact: {
        name: 'Fictional Customer',
        email: 'customer@example.invalid',
        phone: '+00 000 0000000',
      },
      shipping: {
        address: 'Fictional address',
        city: 'Example City',
        province: 'Example Province',
        notes: '',
      },
      paymentMethod: 'Cash on Delivery',
      couponCode: 'FICTIONAL10',
      subtotal: 1,
      shippingFee: 1,
      total: 1,
    }),
  })
  const result = await response.json()

  assert.equal(response.status, 201)
  assert.equal(result.status, 'confirmed')
  assert.equal(result.order.subtotal, 2000)
  assert.equal(result.order.discount, 200)
  assert.equal(result.order.shippingFee, 300)
  assert.equal(result.order.total, 2100)
  assert.equal(result.order.items.length, 1)
  assert.equal(result.order.items[0].productId, 'product-selected')

  const db = await api.readFixtureDb()
  assert.equal(db.products.find((item) => item.id === 'product-selected').stock, 6)
  assert.equal(db.products.find((item) => item.id === 'product-unselected').stock, 6)
  assert.equal(db.coupons[0].usedCount, 1)
  assert.equal(db.orders.length, 1)
})

test('failed guest order does not report success or mutate isolated persistence', async (context) => {
  const api = await startIsolatedApi()
  context.after(() => api.stop())

  const before = await api.readFixtureDb()
  const response = await fetch(`${api.baseUrl}/api/public/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [{ productId: 'missing-product', size: '50 ml', quantity: 1 }],
      contact: {
        name: 'Fictional Customer',
        email: 'customer@example.invalid',
        phone: '+00 000 0000000',
      },
      shipping: {
        address: 'Fictional address',
        city: 'Example City',
        province: 'Example Province',
      },
      paymentMethod: 'Cash on Delivery',
      couponCode: '',
    }),
  })
  const result = await response.json()
  const after = await api.readFixtureDb()

  assert.equal(response.status, 400)
  assert.equal('id' in result, false)
  assert.equal('order' in result, false)
  assert.equal(after.orders.length, before.orders.length)
  assert.deepEqual(after.products, before.products)
  assert.deepEqual(after.coupons, before.coupons)
})

test('current checkout submits selected lines only and has no false-success fallback', async () => {
  const checkout = await readFile(
    new URL('../../../frontend/src/pages/CheckoutPage.tsx', import.meta.url),
    'utf8',
  )
  const service = await readFile(
    new URL('../../../frontend/src/services/orderService.ts', import.meta.url),
    'utf8',
  )
  const publicRoute = await readFile(new URL('../routes/public.js', import.meta.url), 'utf8')
  const orderRoute = publicRoute.slice(
    publicRoute.indexOf("publicRouter.post('/orders'"),
    publicRoute.indexOf('function upsertCustomer'),
  )

  assert.match(checkout, /items\.filter\(\(item\) => selectedLineIdSet\.has\(item\.lineId\)\)/)
  assert.match(checkout, /items: enrichedItems\.map/)
  assert.match(checkout, /removeItems\(orderedLineIds\)/)
  assert.match(service, /throw new Error\('The order API returned an invalid confirmation\.'/)
  assert.doesNotMatch(service, /mock|fallback/i)
  assert.doesNotMatch(orderRoute, /supabase|requireAdmin|authorization|customer_id/i)
})
