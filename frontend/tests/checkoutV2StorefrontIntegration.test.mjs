import assert from 'node:assert/strict'
import test from 'node:test'
import { createCheckoutClient, isCheckedQuote, isOrderReceipt, CheckoutClientError } from '../src/services/checkoutClient.ts'
import { quoteAcceptanceKey, isDefinitiveQuoteRejection } from '../src/services/checkoutConfirmation.ts'

const variantId = 'b35b3be7-a7dd-4c70-9c14-d1a9394d4711'
const secondVariantId = 'b4035721-28fc-4539-a988-a08264c5a862'
const attemptToken = '70000000-0000-4000-8000-000000000001'
const methodId = '60000000-0000-4000-8000-000000000001'
const fingerprint = 'c'.repeat(64)

function v2QuoteFixture(overrides = {}) {
  return {
    contractVersion: 2,
    quoteFingerprint: fingerprint,
    lines: [
      {
        kind: 'normal_variant',
        variantId,
        productId: '45852db8-8b83-425e-8d1f-4112958ed505',
        name: 'Baraan',
        sku: 'RF-BAR-50',
        size: '50 ml',
        quantity: 2,
        unitPrice: 2900,
        lineTotal: 5800,
        position: 0,
        components: [],
      },
    ],
    subtotal: 5800,
    discount: 0,
    shippingFee: 250,
    total: 6050,
    currency: 'PKR',
    shippingMethodId: methodId,
    paymentMethods: ['Cash on Delivery', 'Bank Transfer'],
    orderingEnabled: true,
    ...overrides,
  }
}

function v2ReceiptFixture(quote, overrides = {}) {
  return {
    contractVersion: 2,
    snapshotVersion: 2,
    id: '80000000-0000-4000-8000-000000000001',
    idempotencyKey: attemptToken,
    orderNumber: 'RF-20261017-A1B2C3D4',
    status: 'Pending',
    paymentStatus: 'Unpaid',
    paymentMethod: 'Cash on Delivery',
    subtotal: quote.subtotal,
    discount: quote.discount,
    shippingFee: quote.shippingFee,
    total: quote.total,
    currency: 'PKR',
    idempotent: false,
    lines: quote.lines.map((line, idx) => ({
      ...line,
      id: `81000000-0000-4000-8000-00000000000${idx + 1}`,
    })),
    ...overrides,
  }
}

test('V2 checkoutClient dispatches to /v2/public endpoints with canonical contractVersion=2 and lines', async () => {
  const dispatchedRequests = []
  const q = v2QuoteFixture()
  const r = v2ReceiptFixture(q)

  const mockFetcher = async (url, options) => {
    if (url.endsWith('/session')) {
      return new Response(JSON.stringify({ data: { csrfToken: 'v2-csrf-test-token' } }), { status: 200 })
    }
    const body = options.body ? JSON.parse(options.body) : null
    dispatchedRequests.push({ url, method: options.method, headers: options.headers, body })
    if (url.endsWith('/v2/public/checkout/quote')) {
      return new Response(JSON.stringify({ data: q }), { status: 200 })
    }
    if (url.endsWith('/v2/public/orders')) {
      return new Response(JSON.stringify({ data: r }), { status: 201 })
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 })
  }

  const client = createCheckoutClient(mockFetcher, '/api', 'v2')

  const quoteReq = {
    items: [
      { variantId, quantity: 2, unitPrice: 2900, lineTotal: 5800 }, // Client-calculated amounts present on UI model
    ],
    shipping: { city: 'Lahore', province: 'Punjab' },
    email: 'customer@example.invalid',
    couponCode: 'TEST10',
  }

  const quoteResult = await client.quote(quoteReq)
  assert.equal(isCheckedQuote(quoteResult), true)
  assert.equal(quoteResult.contractVersion, 2)
  assert.equal(quoteResult.quoteFingerprint, fingerprint)
  assert.equal(quoteResult.total, 6050)

  // Verify quote request payload over the wire:
  const quoteHttp = dispatchedRequests.find((r) => r.url.endsWith('/v2/public/checkout/quote'))
  assert.ok(quoteHttp)
  assert.equal(quoteHttp.body.contractVersion, 2)
  assert.deepEqual(quoteHttp.body.lines, [{ kind: 'normal_variant', variantId, quantity: 2 }])
  assert.equal('items' in quoteHttp.body, false) // items must NOT be sent to V2 endpoint
  assert.equal('total' in quoteHttp.body, false)
  assert.equal('unitPrice' in quoteHttp.body.lines[0], false)
  assert.equal(quoteHttp.headers['X-RF-CSRF'], 'v2-csrf-test-token')

  const orderReq = {
    idempotencyKey: attemptToken,
    items: [
      { variantId, quantity: 2, unitPrice: 2900, lineTotal: 5800 },
    ],
    contact: { name: 'Royal Customer', email: 'customer@example.invalid', phone: '03001234567' },
    shipping: { address: 'Mall Road 10', city: 'Lahore', province: 'Punjab', notes: 'Fragile' },
    paymentMethod: 'Cash on Delivery',
    couponCode: 'TEST10',
    quoteFingerprint: fingerprint,
    total: 6050, // Client calculation
  }

  const orderResult = await client.createOrder(orderReq)
  assert.equal(isOrderReceipt(orderResult), true)
  assert.equal(orderResult.contractVersion, 2)
  assert.equal(orderResult.snapshotVersion, 2)
  assert.equal(orderResult.idempotent, false)
  assert.equal(orderResult.orderNumber, 'RF-20261017-A1B2C3D4')

  // Verify order request payload over the wire:
  const orderHttp = dispatchedRequests.find((r) => r.url.endsWith('/v2/public/orders'))
  assert.ok(orderHttp)
  assert.equal(orderHttp.body.contractVersion, 2)
  assert.equal(orderHttp.body.idempotencyKey, attemptToken)
  assert.deepEqual(orderHttp.body.lines, [{ kind: 'normal_variant', variantId, quantity: 2 }])
  assert.equal('items' in orderHttp.body, false)
  assert.equal('total' in orderHttp.body, false)
  assert.equal(orderHttp.body.quoteFingerprint, fingerprint)
})

test('V2 quote rejection (QUOTE_CHANGED) is definitively recognized and permits reconfirmation', async () => {
  const mockFetcher = async (url) => {
    if (url.endsWith('/session')) return new Response(JSON.stringify({ data: { csrfToken: 'csrf' } }))
    return new Response(JSON.stringify({
      error: { code: 'QUOTE_CHANGED', message: 'Checkout changed. Please refresh your quote.' },
    }), { status: 409 })
  }

  const client = createCheckoutClient(mockFetcher, '/api', 'v2')
  await assert.rejects(
    () => client.createOrder({
      idempotencyKey: attemptToken,
      items: [{ variantId, quantity: 1 }],
      contact: { name: 'Customer', email: 'c@example.invalid', phone: '03000000000' },
      shipping: { address: 'Street 1', city: 'Karachi', province: 'Sindh', notes: '' },
      paymentMethod: 'Cash on Delivery',
      couponCode: '',
      quoteFingerprint: fingerprint,
    }),
    (err) => {
      assert.equal(err instanceof CheckoutClientError, true)
      assert.equal(err.code, 'QUOTE_CHANGED')
      assert.equal(err.status, 409)
      assert.equal(isDefinitiveQuoteRejection(err), true)
      return true
    }
  )
})

test('V2 idempotent replay returns 200 with idempotent:true and matching attempt receipt', async () => {
  const q = v2QuoteFixture()
  const replayReceipt = v2ReceiptFixture(q, { idempotent: true })

  const mockFetcher = async (url) => {
    if (url.endsWith('/session')) return new Response(JSON.stringify({ data: { csrfToken: 'csrf' } }))
    return new Response(JSON.stringify({ data: replayReceipt }), { status: 200 })
  }

  const client = createCheckoutClient(mockFetcher, '/api', 'v2')
  const result = await client.createOrder({
    idempotencyKey: attemptToken,
    items: [{ variantId, quantity: 2 }],
    contact: { name: 'Customer', email: 'c@example.invalid', phone: '03000000000' },
    shipping: { address: 'Street 1', city: 'Lahore', province: 'Punjab', notes: '' },
    paymentMethod: 'Cash on Delivery',
    couponCode: '',
    quoteFingerprint: fingerprint,
  })

  assert.equal(result.idempotent, true)
  assert.equal(result.idempotencyKey, attemptToken)
  assert.equal(result.total, 6050)
  assert.equal(isOrderReceipt(result), true)
})

test('two-step confirmation binding: acceptanceKey binds signature, quoteFingerprint and paymentMethod', () => {
  const q = v2QuoteFixture()
  const sig1 = JSON.stringify({ items: [{ variantId, quantity: 2 }], shipping: { city: 'Lahore', province: 'Punjab' }, email: 'c@example.invalid', couponCode: '' })
  const sig2 = JSON.stringify({ items: [{ variantId, quantity: 1 }], shipping: { city: 'Lahore', province: 'Punjab' }, email: 'c@example.invalid', couponCode: '' })

  const key1 = quoteAcceptanceKey(sig1, q, 'Cash on Delivery')
  const key2 = quoteAcceptanceKey(sig2, q, 'Cash on Delivery')
  const key3 = quoteAcceptanceKey(sig1, q, 'Bank Transfer')
  const key4 = quoteAcceptanceKey(sig1, { ...q, quoteFingerprint: 'd'.repeat(64) }, 'Cash on Delivery')

  assert.ok(key1)
  assert.ok(key2)
  assert.notEqual(key1, key2) // Quantity / line difference changes acceptance key
  assert.notEqual(key1, key3) // Payment method change requires reconfirmation
  assert.notEqual(key1, key4) // Quote fingerprint refresh requires reconfirmation
})
