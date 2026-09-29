import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import { mediaErrorMessage, secureMediaUrl } from '../src/services/adminMediaContract.ts'

test('only permanent Cloudinary HTTPS upload results enter the product form', () => {
  const secureUrl = 'https://res.cloudinary.com/royal/image/upload/v1/product.webp'
  assert.equal(secureMediaUrl({ secureUrl }), secureUrl)
  for (const invalid of ['blob:https://shop.example.invalid/image', 'http://res.cloudinary.com/royal/image.png', 'https://evil.example/image.png']) {
    assert.throws(() => secureMediaUrl({ secureUrl: invalid }))
  }
})

test('admin media client sends the selected File to the protected upload endpoint', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  try {
    globalThis.window = { location: { protocol: 'http:' } }
    globalThis.document = { cookie: 'rf-dev-csrf=test-csrf-token' }
    const requests = []
    globalThis.fetch = async (path, options) => {
      requests.push({ path, options })
      return new Response(JSON.stringify({ data: {
        secureUrl: 'https://res.cloudinary.com/demo/image/upload/card.webp',
        uploadToken: 'signed-token',
      } }), { status: 201, headers: { 'Content-Type': 'application/json' } })
    }
    const { adminMediaApi } = await server.ssrLoadModule('/src/services/adminMediaApi.ts')
    const file = new File(['real file bytes'], 'card.png', { type: 'image/png' })
    const result = await adminMediaApi.upload(file, { mediaType: 'card' })
    assert.equal(result.secureUrl, 'https://res.cloudinary.com/demo/image/upload/card.webp')
    assert.equal(requests.length, 1)
    assert.equal(requests[0].path, '/api/v1/admin/media')
    assert.equal(requests[0].options.method, 'POST')
    assert.equal(requests[0].options.credentials, 'include')
    assert.equal(requests[0].options.headers['X-RF-CSRF'], 'test-csrf-token')
    assert.equal(requests[0].options.headers['Content-Type'], undefined)
    assert.equal(requests[0].options.body.get('file'), file)
    assert.equal(requests[0].options.body.get('mediaType'), 'card')
    assert.equal(requests[0].options.body.has('productId'), false)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.window = originalWindow
    globalThis.document = originalDocument
    await server.close()
  }
})

test('mediaErrorMessage maps HTTP status codes and error codes to human-readable strings', () => {
  assert.equal(
    mediaErrorMessage({ message: 'Forbidden', code: 'PERMISSION_DENIED', status: 403 }),
    'You do not have permission to manage media.'
  )
  assert.equal(
    mediaErrorMessage({ message: 'Unauthorized', code: 'AUTH_REQUIRED', status: 401 }),
    'Session expired. Please sign in again.'
  )
  assert.equal(
    mediaErrorMessage({ message: 'Too Large', code: 'FILE_TOO_LARGE', status: 413 }),
    'Image file exceeds the 5MB size limit.'
  )
  assert.equal(
    mediaErrorMessage({ message: 'Bad format', code: 'UNSUPPORTED_MEDIA_TYPE', status: 415 }),
    'Invalid image file. Only JPEG, PNG, and WebP images are supported.'
  )
  assert.equal(
    mediaErrorMessage({ message: 'Not config', code: 'CLOUDINARY_NOT_CONFIGURED', status: 503 }),
    'Cloudinary is not configured on this server.'
  )
  assert.equal(
    mediaErrorMessage({ message: 'CSRF failure', code: 'CSRF_INVALID', status: 403 }),
    'Security token expired. Please refresh the page.'
  )
  assert.equal(
    mediaErrorMessage({ message: 'Not found', code: 'PRODUCT_NOT_FOUND', status: 404 }),
    'The specified product or media was not found.'
  )
})

test('error message falls back gracefully for unknown errors', () => {
  assert.equal(mediaErrorMessage(new Error('Custom network failure')), 'Custom network failure')
  assert.equal(mediaErrorMessage('unexpected string'), 'A media error occurred. Please try again.')
})
