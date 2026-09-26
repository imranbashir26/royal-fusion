import assert from 'node:assert/strict'
import test from 'node:test'
import { createProductSchema, updateProductSchema } from '../../backend/server/schemas/productAdmin.js'
import { productErrorMessage, toProductPayload } from '../src/services/adminProductContract.ts'

test('existing product form maps to the production create contract and preserves card presentation', () => {
  const payload = toProductPayload({
    id: 'read-only-id', name: 'Royal Oud', slug: 'Royal Oud', sku: 'RF-101',
    price: 3500, salePrice: '', oldPrice: '', stockQuantity: 5,
    categoryId: '', category: 'Old prototype category',
    scentFamily: 'Oud', notes: { top: ['Saffron'], middle: ['Rose'], base: ['Oud'] },
    image: '', gallery: ['https://cdn.example.com/main.webp'],
    cardImage: '/cards/bottle.webp', cardHoverImage: 'https://cdn.example.com/hover.webp',
    cardBackgroundColor: '#6B2A3C', status: 'Draft',
    active: false, rating: 4.8, contactReceiverEmail: 'private@example.com',
  })
  assert.equal(payload.image, 'https://cdn.example.com/main.webp')
  assert.equal(payload.categoryId, null)
  assert.equal(payload.salePrice, null)
  assert.equal(payload.oldPrice, null)
  assert.equal(payload.cardImage, '/cards/bottle.webp')
  assert.equal(payload.cardHoverImage, 'https://cdn.example.com/hover.webp')
  assert.equal(payload.cardBackgroundColor, '#6B2A3C')
  assert.equal(Object.hasOwn(payload, 'id'), false)
  assert.equal(Object.hasOwn(payload, 'category'), false)
  assert.equal(Object.hasOwn(payload, 'rating'), false)
  assert.equal(Object.hasOwn(payload, 'contactReceiverEmail'), false)
  assert.equal(createProductSchema.safeParse(payload).success, true)
})

test('edited product DTO strips read-only columns while retaining valid update values', () => {
  const payload = toProductPayload({
    id: 'uuid-from-server', name: 'Updated Oud', price: 4100,
    stockQuantity: 0, status: 'Published', cardImage: '/cards/updated.webp',
    cardBackgroundColor: '#E7C78F', category: 'Attars',
    publishedAt: '2026-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01',
  })
  assert.equal(updateProductSchema.safeParse(payload).success, true)
  assert.equal(payload.stockQuantity, 0)
  assert.equal(Object.hasOwn(payload, 'publishedAt'), false)
  assert.equal(Object.hasOwn(payload, 'updatedAt'), false)
})

test('product errors explain duplicate identities, session and permission failures', () => {
  const failure = (status, code) => Object.assign(new Error('Server detail'), { status, code })
  assert.match(productErrorMessage(failure(409, 'PRODUCT_CONFLICT')), /slug or SKU already exists/i)
  assert.match(productErrorMessage(failure(401, 'AUTH_REQUIRED')), /sign in again/i)
  assert.match(productErrorMessage(failure(403, 'PERMISSION_DENIED')), /permission/i)
  assert.match(productErrorMessage(failure(403, 'CSRF_INVALID')), /refresh the page/i)
  assert.match(productErrorMessage(failure(404, 'PRODUCT_NOT_FOUND')), /no longer exists/i)
  assert.match(productErrorMessage(failure(400, 'INVALID_CATEGORY')), /category/i)
  assert.match(productErrorMessage(failure(500, 'PRODUCT_SERVICE_ERROR')), /unavailable/i)
})
