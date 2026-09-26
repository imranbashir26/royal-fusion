import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import cookieParser from 'cookie-parser'
import express from 'express'
import test, { after } from 'node:test'
import { createAuthConfig } from '../auth/config.js'
import { getAuthCookieNames, getSessionCsrfToken } from '../auth/cookies.js'
import { authErrorHandler, requestContext } from '../middleware/authSecurity.js'
import { createAdminMediaV1Router } from '../routes/adminMediaV1.js'
import { CloudinaryService } from '../services/cloudinaryService.js'

const origin = 'https://shop.example.invalid'
const config = createAuthConfig({
  NODE_ENV: 'test',
  CLIENT_ORIGIN: origin,
  AUTH_CSRF_SECRET: 'public-media-contract-test-secret-12345',
  ADMIN_AUTH_PROVIDER: 'prototype',
  CUSTOMER_AUTH_PROVIDER: 'prototype',
  ENABLE_ADMIN_MFA: 'false',
})
const names = getAuthCookieNames(config)
const servers = []
after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
})

// Sample valid buffers
const validPngBuffer = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])
const validJpegBuffer = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
])
const validWebpBuffer = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
])

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
  }
  select() { return this }
  eq(key, value) {
    this.filters.push((row) => row[key] === value)
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
  single() { return this.execute(true) }
  maybeSingle() { return this.execute(true) }
  then(resolve, reject) { return this.execute(false).then(resolve, reject) }

  async execute(one) {
    if (this.table === 'admin_audit_logs') {
      this.db.audits.push(this.value)
      return { data: null, error: null }
    }
    const rows = this.db[this.table]
    if (!rows) throw new Error(`Unexpected table: ${this.table}`)

    if (this.mode === 'insert') {
      const row = {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...this.value,
      }
      rows.push(row)
      return { data: row, error: null }
    }

    const matchingIndices = []
    const selected = []
    rows.forEach((row, idx) => {
      if (this.filters.every((f) => f(row))) {
        matchingIndices.push(idx)
        selected.push(row)
      }
    })

    if (this.mode === 'update') {
      selected.forEach((row) => {
        Object.assign(row, this.value, { updated_at: new Date().toISOString() })
      })
      return { data: selected[0] ?? null, error: null }
    }

    if (this.mode === 'delete') {
      // remove in reverse order
      for (let i = matchingIndices.length - 1; i >= 0; i--) {
        rows.splice(matchingIndices[i], 1)
      }
      return { data: null, error: null }
    }

    return { data: one ? selected[0] ?? null : selected, error: null }
  }
}

async function start({ cloudinaryFails = false } = {}) {
  const productId = randomUUID()
  const db = {
    products: [
      {
        id: productId,
        name: 'Royal Mirage',
        slug: 'royal-mirage',
        sku: 'RF-RM-01',
        image_url: 'https://res.cloudinary.com/demo/image/upload/v1/royal-fusion/products/' + productId + '/main-old.webp',
        card_image_url: '',
        card_hover_image_url: '',
        gallery: [],
        active: true,
      },
    ],
    product_media: [
      {
        id: randomUUID(),
        product_id: productId,
        cloudinary_public_id: `royal-fusion/products/${productId}/main-old`,
        secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/royal-fusion/products/' + productId + '/main-old.webp',
        alt_text: 'Old main image',
        media_type: 'image',
        display_order: 0,
        is_primary: true,
      },
    ],
    audits: [],
  }

  const client = mockClient(db)
  const destroyedPublicIds = []

  const mockCloudinaryClient = {
    upload: async ({ folder, publicId, mediaType }) => {
      if (cloudinaryFails) {
        const err = new Error('Cloudinary API upload error')
        err.status = 500
        throw err
      }
      const secureUrl = `https://res.cloudinary.com/demo/image/upload/v1/${publicId}.webp`
      return {
        url: secureUrl,
        secureUrl,
        publicId,
        width: 1000,
        height: 1200,
        format: 'webp',
      }
    },
    destroy: async ({ publicId }) => {
      destroyedPublicIds.push(publicId)
      return { result: 'ok' }
    },
  }

  const cloudinaryService = new CloudinaryService({
    client: mockCloudinaryClient,
    logger: { warn() {}, error() {} },
  })

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
      resolve: async (id) => ({
        userId: id,
        permissions:
          id === 'reader'
            ? ['products.read']
            : id === 'manager'
              ? ['products.manage', 'media.commerce.manage', 'media.delete']
              : id === 'owner'
                ? ['*']
                : [],
      }),
    },
  }

  const app = express()
  app.use(requestContext)
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/v1/admin/media', createAdminMediaV1Router(runtime, { client, cloudinaryService }))
  app.use(authErrorHandler(config))
  app.use((error, req, res, _next) => {
    res.status(error.status || 500).json({
      error: { code: error.code || 'UNEXPECTED', message: error.message, requestId: req.requestId },
    })
  })

  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  servers.push(server)

  return {
    base: `http://127.0.0.1:${server.address().port}/api/v1/admin/media`,
    productId,
    db,
    destroyedPublicIds,
  }
}

async function uploadRequest(api, {
  actor,
  csrf = true,
  productId,
  mediaType = 'main',
  buffer = validPngBuffer,
  filename = 'test.png',
  mimetype = 'image/png',
  altText = 'Test Image',
} = {}) {
  const form = new FormData()
  if (buffer) {
    form.append('file', new Blob([buffer], { type: mimetype }), filename)
  }
  if (productId) form.append('productId', productId)
  if (mediaType) form.append('mediaType', mediaType)
  if (altText) form.append('altText', altText)

  const headers = {}
  if (actor) {
    const token = getSessionCsrfToken('handle', config)
    headers.Cookie = `${names.access}=${actor}; ${names.refresh}=refresh; ${names.session}=handle; ${names.csrf}=${token}`
    if (csrf) headers['X-RF-CSRF'] = token
  }
  headers.Origin = origin

  const response = await fetch(api.base, {
    method: 'POST',
    headers,
    body: form,
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

async function deleteRequest(api, { actor, csrf = true, productId, mediaId, secureUrl } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (actor) {
    const token = getSessionCsrfToken('handle', config)
    headers.Cookie = `${names.access}=${actor}; ${names.refresh}=refresh; ${names.session}=handle; ${names.csrf}=${token}`
    if (csrf) headers['X-RF-CSRF'] = token
  }
  headers.Origin = origin

  const response = await fetch(api.base, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ productId, mediaId, secureUrl }),
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

test('unauthenticated upload is denied (401)', async () => {
  const api = await start()
  const res = await uploadRequest(api, { productId: api.productId })
  assert.equal(res.status, 401)
})

test('missing permission is denied (403)', async () => {
  const api = await start()
  const res = await uploadRequest(api, { actor: 'reader', productId: api.productId })
  assert.equal(res.status, 403)
})

test('customer actor is denied (403)', async () => {
  const api = await start()
  const res = await uploadRequest(api, { actor: 'customer', productId: api.productId })
  assert.equal(res.status, 403)
})

test('missing or invalid CSRF is denied', async () => {
  const api = await start()
  const res = await uploadRequest(api, { actor: 'manager', productId: api.productId, csrf: false })
  assert.equal(res.body?.error?.code, 'CSRF_INVALID')
})

test('valid PNG, JPEG, and WebP uploads succeed', async () => {
  const api = await start()

  const pngRes = await uploadRequest(api, {
    actor: 'manager',
    productId: api.productId,
    mediaType: 'gallery',
    buffer: validPngBuffer,
    filename: 'image.png',
    mimetype: 'image/png',
  })
  assert.equal(pngRes.status, 201)
  assert.equal(pngRes.body.data.format, 'webp')
  assert(pngRes.body.data.secureUrl.startsWith('https://res.cloudinary.com/'))

  const jpegRes = await uploadRequest(api, {
    actor: 'manager',
    productId: api.productId,
    mediaType: 'gallery',
    buffer: validJpegBuffer,
    filename: 'image.jpg',
    mimetype: 'image/jpeg',
  })
  assert.equal(jpegRes.status, 201)

  const webpRes = await uploadRequest(api, {
    actor: 'manager',
    productId: api.productId,
    mediaType: 'gallery',
    buffer: validWebpBuffer,
    filename: 'image.webp',
    mimetype: 'image/webp',
  })
  assert.equal(webpRes.status, 201)
})

test('fake MIME / invalid image bytes is rejected (415)', async () => {
  const api = await start()
  const fakeBuffer = Buffer.from('This is a text file posing as an image')
  const res = await uploadRequest(api, {
    actor: 'manager',
    productId: api.productId,
    buffer: fakeBuffer,
    filename: 'fake.png',
    mimetype: 'image/png',
  })
  assert.equal(res.status, 415)
  assert.equal(res.body.error.code, 'INVALID_IMAGE_BYTES')
})

test('oversized file is rejected (413)', async () => {
  const api = await start()
  const oversizedBuffer = Buffer.alloc(5 * 1024 * 1024 + 10)
  const res = await uploadRequest(api, {
    actor: 'manager',
    productId: api.productId,
    buffer: oversizedBuffer,
    filename: 'huge.png',
    mimetype: 'image/png',
  })
  assert.equal(res.status, 413)
})

test('unsupported format (.gif / .svg / .txt) is rejected (415)', async () => {
  const api = await start()
  const res = await uploadRequest(api, {
    actor: 'manager',
    productId: api.productId,
    buffer: Buffer.from('GIF89a'),
    filename: 'anim.gif',
    mimetype: 'image/gif',
  })
  assert.equal(res.status, 415)
  assert.equal(res.body.error.code, 'UNSUPPORTED_MEDIA_TYPE')
})

test('Cloudinary failure is safely handled (500)', async () => {
  const api = await start({ cloudinaryFails: true })
  const res = await uploadRequest(api, {
    actor: 'manager',
    productId: api.productId,
    buffer: validPngBuffer,
  })
  assert.equal(res.status, 500)
  assert.equal(res.body.error.code, 'CLOUDINARY_UPLOAD_FAILED')
})

test('successful main image upload updates product and records replacement of superseded asset', async () => {
  const api = await start()
  const oldPublicId = `royal-fusion/products/${api.productId}/main-old`

  const res = await uploadRequest(api, {
    actor: 'manager',
    productId: api.productId,
    mediaType: 'main',
    buffer: validWebpBuffer,
    filename: 'new-main.webp',
    mimetype: 'image/webp',
  })
  assert.equal(res.status, 201)

  const prod = api.db.products.find((p) => p.id === api.productId)
  assert.equal(prod.image_url, res.body.data.secureUrl)

  // Superseded old asset was safely deleted from Cloudinary
  assert(api.destroyedPublicIds.includes(oldPublicId))

  // Audit log recorded product_media.replace
  const audit = api.db.audits.find((a) => a.action === 'product_media.replace')
  assert(audit)
  assert.equal(audit.resource_id, api.productId)
})

test('cardImage and cardHoverImage upload and persist to products table and product_media', async () => {
  const api = await start()

  const cardRes = await uploadRequest(api, {
    actor: 'manager',
    productId: api.productId,
    mediaType: 'card',
    buffer: validPngBuffer,
    filename: 'card-bottle.png',
    mimetype: 'image/png',
  })
  assert.equal(cardRes.status, 201)

  const hoverRes = await uploadRequest(api, {
    actor: 'manager',
    productId: api.productId,
    mediaType: 'cardHover',
    buffer: validJpegBuffer,
    filename: 'card-hover.jpg',
    mimetype: 'image/jpeg',
  })
  assert.equal(hoverRes.status, 201)

  const prod = api.db.products.find((p) => p.id === api.productId)
  assert.equal(prod.card_image_url, cardRes.body.data.secureUrl)
  assert.equal(prod.card_hover_image_url, hoverRes.body.data.secureUrl)

  const cardMediaRow = api.db.product_media.find((m) => m.secure_url === cardRes.body.data.secureUrl)
  assert(cardMediaRow)
  assert.equal(cardMediaRow.is_primary, false)
})

test('gallery add and remove maintains deterministic list and cleans up Cloudinary', async () => {
  const api = await start()

  // Add 1
  const g1 = await uploadRequest(api, {
    actor: 'manager',
    productId: api.productId,
    mediaType: 'gallery',
    buffer: validPngBuffer,
    filename: 'g1.png',
    mimetype: 'image/png',
  })
  assert.equal(g1.status, 201)

  // Add 2
  const g2 = await uploadRequest(api, {
    actor: 'manager',
    productId: api.productId,
    mediaType: 'gallery',
    buffer: validPngBuffer,
    filename: 'g2.png',
    mimetype: 'image/png',
  })
  assert.equal(g2.status, 201)

  let prod = api.db.products.find((p) => p.id === api.productId)
  assert.equal(prod.gallery.length, 2)
  assert.equal(prod.gallery[0], g1.body.data.secureUrl)
  assert.equal(prod.gallery[1], g2.body.data.secureUrl)

  // Remove g1
  const delRes = await deleteRequest(api, {
    actor: 'manager',
    productId: api.productId,
    secureUrl: g1.body.data.secureUrl,
  })
  assert.equal(delRes.status, 200)

  prod = api.db.products.find((p) => p.id === api.productId)
  assert.equal(prod.gallery.length, 1)
  assert.equal(prod.gallery[0], g2.body.data.secureUrl)

  // g1 publicId destroyed in Cloudinary
  assert(api.destroyedPublicIds.includes(g1.body.data.publicId))

  // Audit log recorded product_media.delete
  const delAudit = api.db.audits.find((a) => a.action === 'product_media.delete')
  assert(delAudit)
})

test('unauthorized or arbitrary asset deletion outside product is prevented', async () => {
  const api = await start()
  // Non-manager cannot delete
  const forbiddenRes = await deleteRequest(api, {
    actor: 'reader',
    productId: api.productId,
    secureUrl: 'https://example.com/something',
  })
  assert.equal(forbiddenRes.status, 403)

  // Cannot delete with invalid/missing product ID
  const invalidRes = await deleteRequest(api, {
    actor: 'manager',
    productId: 'not-a-uuid',
    secureUrl: 'https://example.com/something',
  })
  assert.equal(invalidRes.status, 400)
})

test('unconfigured Cloudinary fails clearly with 503 CLOUDINARY_NOT_CONFIGURED', async () => {
  const unconfiguredService = new CloudinaryService({ cloudName: '', apiKey: '', apiSecret: '' })
  assert.equal(unconfiguredService.isConfigured(), false)
  await assert.rejects(
    () => unconfiguredService.uploadImageBuffer(validPngBuffer, { productId: randomUUID(), mediaType: 'main' }),
    { code: 'CLOUDINARY_NOT_CONFIGURED', status: 503 }
  )
})

test('invalid mediaType is rejected with 400', async () => {
  const api = await start()
  const res = await uploadRequest(api, {
    actor: 'manager',
    productId: api.productId,
    mediaType: 'invalid_type',
    buffer: validPngBuffer,
  })
  assert.equal(res.status, 400)
  assert.equal(res.body.error.code, 'INVALID_MEDIA_TYPE')
})

test('storefront-compatible persisted URLs are returned and stored', async () => {
  const api = await start()
  const res = await uploadRequest(api, {
    actor: 'manager',
    productId: api.productId,
    mediaType: 'card',
    buffer: validPngBuffer,
    filename: 'card.png',
  })
  assert.equal(res.status, 201)
  assert(res.body.data.secureUrl.startsWith('https://'))
  const prod = api.db.products.find((p) => p.id === api.productId)
  assert.equal(prod.card_image_url, res.body.data.secureUrl)
})

