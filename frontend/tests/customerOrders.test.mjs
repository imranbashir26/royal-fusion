import assert from 'node:assert/strict'
import test from 'node:test'
import { createCustomerOrdersClient, CustomerOrderApiError } from '../src/services/customerOrdersClient.ts'

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
