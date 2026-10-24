import assert from 'node:assert/strict'
import test from 'node:test'
import { createCollectionSchema, updateCollectionSchema } from '../../backend/server/schemas/collectionAdmin.js'
import { collectionErrorMessage, toCollectionPayload } from '../src/services/adminCollectionContract.ts'
import { mapCollection, resolveCollectionSlug } from '../src/services/productionMappers.ts'

test('collection form maps to the production create contract and strips extraneous fields', () => {
  const payload = toCollectionPayload({
    id: 'read-only-col-id',
    name: 'Royal Fusion Originals',
    slug: 'royal-fusion-originals',
    description: 'Launch collection of signature scents',
    image: 'https://cdn.example.com/banner.webp',
    displayOrder: '1',
    featured: true,
    active: true,
    status: 'Published',
    seoTitle: 'Royal Fusion Originals',
    seoDescription: 'Explore our launch collection',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    unrelatedField: 'malicious',
  })

  assert.equal(payload.name, 'Royal Fusion Originals')
  assert.equal(payload.slug, 'royal-fusion-originals')
  assert.equal(payload.bannerSecureUrl, 'https://cdn.example.com/banner.webp')
  assert.equal(payload.displayOrder, 1)
  assert.equal(payload.featured, true)
  assert.equal(payload.active, true)
  assert.equal(payload.status, 'Published')
  assert.equal(Object.hasOwn(payload, 'id'), false)
  assert.equal(Object.hasOwn(payload, 'createdAt'), false)
  assert.equal(Object.hasOwn(payload, 'updatedAt'), false)
  assert.equal(Object.hasOwn(payload, 'unrelatedField'), false)

  const validation = createCollectionSchema.safeParse(payload)
  assert.equal(validation.success, true)
})

test('collection form maps to production update contract', () => {
  const payload = toCollectionPayload({
    id: 'server-id',
    name: 'Crystal Edit Modern',
    displayOrder: 3,
    status: 'Archived',
    createdAt: '2026-01-01',
  })

  assert.equal(Object.hasOwn(payload, 'id'), false)
  assert.equal(Object.hasOwn(payload, 'createdAt'), false)
  const validation = updateCollectionSchema.safeParse(payload)
  assert.equal(validation.success, true)
  assert.equal(validation.data.active, false)
})

for (const [operation, schema] of [['create', createCollectionSchema], ['update', updateCollectionSchema]]) {
  test(`collection ${operation} serializes single and empty banner values without losing existing images`, () => {
    const image = 'https://cdn.example.com/existing-banner.webp'
    for (const [value, expected] of [[image, image], [[image], image], ['', ''], [[], '']]) {
      const form = { name: 'Royal Edit', slug: 'royal-edit', bannerSecureUrl: value }
      const payload = toCollectionPayload(form)
      assert.equal(payload.bannerSecureUrl, expected)
      assert.equal(typeof payload.bannerSecureUrl, 'string')
      assert.equal(schema.parse(JSON.parse(JSON.stringify(payload))).bannerSecureUrl, expected)
      assert.deepEqual(form.bannerSecureUrl, value, 'serialization does not mutate the form')
    }
  })

  test(`collection ${operation} preserves an explicit banner clear over stale image aliases`, () => {
    const payload = toCollectionPayload({
      name: 'Royal Edit', slug: 'royal-edit', bannerSecureUrl: [],
      image: 'https://cdn.example.com/old.webp', imageUrl: 'https://cdn.example.com/old.webp',
    })
    assert.equal(schema.parse(payload).bannerSecureUrl, '')
    assert.equal(Object.hasOwn(payload, 'image'), false)
    assert.equal(Object.hasOwn(payload, 'imageUrl'), false)
  })

  test(`collection ${operation} refuses ambiguous banner arrays instead of silently choosing an image`, () => {
    for (const field of ['bannerSecureUrl', 'image', 'imageUrl']) {
      for (const value of [['https://cdn.example.com/one.webp', 'https://cdn.example.com/two.webp'], [null]]) {
        assert.throws(() => toCollectionPayload({ name: 'Royal Edit', slug: 'royal-edit', [field]: value }), /Select one collection banner image/)
      }
    }
  })
}

test('collection update leaves omitted banner fields unchanged and retains legacy string aliases', () => {
  assert.equal(Object.hasOwn(toCollectionPayload({ name: 'Renamed' }), 'bannerSecureUrl'), false)
  for (const field of ['image', 'imageUrl']) {
    const image = 'https://cdn.example.com/legacy.webp'
    assert.equal(toCollectionPayload({ [field]: image }).bannerSecureUrl, image)
    assert.equal(toCollectionPayload({ [field]: [image] }).bannerSecureUrl, image)
  }
})

test('collection errors explain duplicate identities, session and permission failures', () => {
  const failure = (status, code) => Object.assign(new Error('Server detail'), { status, code })
  assert.match(collectionErrorMessage(failure(409, 'COLLECTION_CONFLICT')), /slug already exists/i)
  assert.match(collectionErrorMessage(failure(401, 'AUTH_REQUIRED')), /sign in again/i)
  assert.match(collectionErrorMessage(failure(403, 'PERMISSION_DENIED')), /permission/i)
  assert.match(collectionErrorMessage(failure(403, 'CSRF_INVALID')), /refresh the page/i)
  assert.match(collectionErrorMessage(failure(404, 'COLLECTION_NOT_FOUND')), /no longer exists/i)
  assert.match(collectionErrorMessage(failure(400, 'INVALID_REQUEST')), /check the collection fields/i)
  assert.match(collectionErrorMessage(failure(500, 'COLLECTION_SERVICE_ERROR')), /unavailable/i)
})

test('mapCollection maps database row to storefront collection format and handles banner images', () => {
  const row = {
    id: 'col-123',
    name: 'Royal Fusion Originals',
    slug: 'royal-fusion-originals',
    description: 'Opulent evening fragrances.',
    active: true,
    display_order: 1,
    featured: true,
    banner_secure_url: 'https://res.cloudinary.com/royal-fusion/banner.webp',
    seo_title: 'Originals',
    seo_description: 'Originals desc',
  }

  const collection = mapCollection(row)
  assert.equal(collection.id, 'col-123')
  assert.equal(collection.name, 'Royal Fusion Originals')
  assert.equal(collection.slug, 'royal-fusion-originals')
  assert.equal(collection.description, 'Opulent evening fragrances.')
  assert.equal(collection.bannerImage, 'https://res.cloudinary.com/royal-fusion/banner.webp')
  assert.equal(collection.featured, true)
  assert.equal(collection.displayOrder, 1)
})

test('resolveCollectionSlug maps legacy royal-collection to royal-fusion-originals while preserving other slugs', () => {
  assert.equal(resolveCollectionSlug('royal-collection'), 'royal-fusion-originals')
  assert.equal(resolveCollectionSlug('royal-fusion-originals'), 'royal-fusion-originals')
  assert.equal(resolveCollectionSlug('crystal-edit'), 'crystal-edit')
  assert.equal(resolveCollectionSlug('oud-heritage'), 'oud-heritage')
  assert.equal(resolveCollectionSlug('unknown-slug'), 'unknown-slug')
})
