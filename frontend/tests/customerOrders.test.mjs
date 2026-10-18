import assert from 'node:assert/strict'
import test from 'node:test'
import { createCustomerOrdersClient, CustomerOrderApiError } from '../src/services/customerOrdersClient.ts'
import { formatCustomerOrderCurrency } from '../src/utils/customerOrderPresentation.ts'
import { useCustomerAuthStore } from '../src/store/customerAuthStore.ts'
import { customerAuthClient } from '../src/services/customerAuthClient.ts'

const orderId = 'a1000000-0000-4000-8000-000000000001'
const sampleListResponse = {
  data: {
    items: [
      {
        id: orderId,
        orderNumber: 'RF-20261017-TEST0001',
        createdAt: '2026-10-17T12:00:00Z',
        status: 'Delivered',
        paymentStatus: 'Paid',
        paymentMethod: 'Cash on Delivery',
        total: 5500,
        currency: 'PKR',
        itemCount: 2,
        courier: 'TCS',
        trackingNumber: 'TCS123456'
      }
    ],
    page: 1,
    pageSize: 10,
    total: 1,
    totalPages: 1
  },
  meta: { requestId: 'req_test' }
}

const sampleDetailResponse = {
  data: {
    id: orderId,
    orderNumber: 'RF-20261017-TEST0001',
    createdAt: '2026-10-17T12:00:00Z',
    status: 'Delivered',
    paymentStatus: 'Paid',
    paymentMethod: 'Cash on Delivery',
    subtotal: 5250,
    discount: 0,
    shippingFee: 250,
    total: 5500,
    currency: 'PKR',
    courier: 'TCS',
    trackingNumber: 'TCS123456',
    shipping: {
      name: 'Test Customer',
      address: '123 Main Street',
      city: 'Karachi',
      province: 'Sindh',
      orderNotes: 'Leave with guard'
    },
    items: [
      {
        id: 'item-1',
        productId: 'prod-1',
        variantId: null,
        packId: 'pack-1',
        kind: 'fixed_tester_pack',
        name: 'Fixed Discovery Pack (5 x 5ml)',
        size: '5 x 5ml',
        sku: 'TP-FIXED-01',
        quantity: 1,
        unitPrice: 3500,
        lineTotal: 3500,
        position: 0,
        components: [
          {
            id: 'comp-1',
            name: 'Baraan',
            sku: 'TST-BAR-01',
            size: '5 ml',
            volumeMl: 5,
            quantityPerPack: 2,
            totalPhysicalQuantity: 2,
            referenceUnitPrice: 350,
            position: 0
          }
        ]
      }
    ]
  },
  meta: { requestId: 'req_test' }
}

test('customerOrdersClient sends credentials and retrieves list and detail', async () => {
  const calls = []
  const client = createCustomerOrdersClient(async (url, options) => {
    calls.push({ url, ...options })
    assert.equal(options.credentials, 'include')
    assert.equal(options.method, 'GET')

    if (url.includes('/orders?page=')) {
      return Response.json(sampleListResponse)
    }
    if (url.includes(`/orders/${orderId}`)) {
      return Response.json(sampleDetailResponse)
    }
    return Response.json({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' } }, { status: 404 })
  }, '/api')

  const list = await client.listOrders(1, 10)
  assert.equal(list.items.length, 1)
  assert.equal(list.items[0].orderNumber, 'RF-20261017-TEST0001')
  assert.equal(list.total, 1)

  const detail = await client.getOrder(orderId)
  assert.equal(detail.id, orderId)
  assert.equal(detail.status, 'Delivered')
  assert.equal(detail.items[0].components[0].name, 'Baraan')
  assert.equal(detail.items[0].components[0].volumeMl, 5)

  // Verify non-existent ID throws CustomerOrderApiError with 404 status
  await assert.rejects(
    client.getOrder('non-existent-id'),
    (err) => err instanceof CustomerOrderApiError && err.status === 404 && err.code === 'ORDER_NOT_FOUND'
  )
})

test('order reads reject malformed snapshots, substituted order IDs and invalid pagination without inventing fields', async () => {
  for (const mutate of [v => { v.id = 'another-order' }, v => { v.items = null }, v => { v.currency = '' },
    v => { v.items[0].components = [{}] }, v => { v.total = NaN }, v => { v.shipping = [] }]) {
    const value = structuredClone(sampleDetailResponse.data); mutate(value)
    const client = createCustomerOrdersClient(async () => Response.json({ data: value }), '/api')
    await assert.rejects(client.getOrder(orderId), { code: 'INVALID_RESPONSE' })
  }
  let requests = 0
  const client = createCustomerOrdersClient(async () => { requests++; return Response.json(sampleListResponse) }, '/api')
  for (const args of [[0,10],[1,51],[1.5,10],[100001,10]]) await assert.rejects(client.listOrders(...args), { code: 'INVALID_PAGINATION' })
  assert.equal(requests, 0)
  const mismatchedPage = createCustomerOrdersClient(async () => Response.json(sampleListResponse), '/api')
  await assert.rejects(mismatchedPage.listOrders(2, 10), { code: 'INVALID_RESPONSE' })
})

test('historical V1 null identities and recorded V2 pack units and currencies are retained', async () => {
  const value = structuredClone(sampleDetailResponse.data)
  value.items[0] = { ...value.items[0], kind: 'normal_variant', productId: null, variantId: null, packId: null, sku: '', position: null, components: [] }
  value.currency = 'USD'
  const client = createCustomerOrdersClient(async (_url, options) => {
    assert.equal(options.cache, 'no-store')
    return Response.json({ data: value })
  }, '/api')
  const detail = await client.getOrder(orderId)
  assert.equal(detail.items[0].productId, null)
  assert.equal(detail.items[0].position, null)
  assert.equal(detail.items[0].sku, '')
  assert.equal(detail.currency, 'USD')
  assert.match(formatCustomerOrderCurrency(10.25, 'USD'), /10\.25/)
  assert.notEqual(formatCustomerOrderCurrency(10.25, 'USD'), formatCustomerOrderCurrency(10.25, 'PKR'))
})

test('interrupted reads provide retryable errors and request cancellation remains distinguishable', async () => {
  const client = createCustomerOrdersClient(async () => { throw new Error('offline') }, '/api')
  await assert.rejects(client.listOrders(), { code: 'NETWORK_ERROR', status: 0 })
  const controller = new AbortController(); controller.abort()
  const cancelled = createCustomerOrdersClient(async (_url, options) => { assert.equal(options.signal, controller.signal); throw new DOMException('Cancelled', 'AbortError') }, '/api')
  await assert.rejects(cancelled.getOrder(orderId, { signal: controller.signal }), { name: 'AbortError' })
})

test('session expiry clears only the current customer and late restoration cannot revive private presentation', async t => {
  const original = customerAuthClient.restore
  t.after(() => { customerAuthClient.restore = original; useCustomerAuthStore.setState({ currentCustomer: null, sessionMessage: '', isRestoring: false }) })
  const customer = { id: orderId, name: 'Customer A', email: 'a@example.invalid', phone: '', address: '', city: '', province: '' }
  useCustomerAuthStore.setState({ currentCustomer: customer })
  useCustomerAuthStore.getState().expireSession('other-customer')
  assert.equal(useCustomerAuthStore.getState().currentCustomer.id, orderId)
  let resolve
  customerAuthClient.restore = () => new Promise(done => { resolve = done })
  const pending = useCustomerAuthStore.getState().restoreSession()
  assert.equal(useCustomerAuthStore.getState().currentCustomer, null)
  assert.equal(useCustomerAuthStore.getState().isRestoring, true)
  // Represents a valid customer presentation restored by a newer request.
  useCustomerAuthStore.setState({ currentCustomer: customer })
  useCustomerAuthStore.getState().expireSession(orderId)
  resolve(customer); await pending
  assert.equal(useCustomerAuthStore.getState().currentCustomer, null)
  assert.equal(useCustomerAuthStore.getState().isRestoring, false)
  assert.match(useCustomerAuthStore.getState().sessionMessage, /sign in again/)
})
