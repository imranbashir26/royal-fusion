import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { collectionFallback, prototypeCollectionFallback } from '../src/services/collectionFallback.ts'
import { productMatchesSearch } from '../src/services/productSearch.ts'
import {
  attachCollectionMembership,
  collectionNamesForProduct,
  collectionProductIdsForSlug,
  mergeStorefrontData,
  resolveCollectionSlug,
  selectCollectionProduct,
} from '../src/services/productionMappers.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const collections = [
  { id: 'c1', slug: 'royal-fusion-originals', name: 'Originals', featuredProductSlug: 'assigned' },
  { id: 'c2', slug: 'other-edit', name: 'Other Edit', featuredProductSlug: 'unrelated' },
  { id: 'c3', slug: 'empty-edit', name: 'Empty Edit' },
]
const products = [
  { id: 'p1', slug: 'assigned', name: 'Assigned', collection: 'Wrong legacy label' },
  { id: 'p2', slug: 'unrelated', name: 'Unrelated', collection: 'Originals' },
]

test('junction links assign one product to multiple collections independently of legacy text', () => {
  const mapped = attachCollectionMembership(collections, [
    { collection_id: 'c1', product_id: 'p1' },
    { collection_id: 'c2', product_id: 'p1' },
  ])
  assert.deepEqual(mapped[0].productIds, ['p1'])
  assert.deepEqual(mapped[1].productIds, ['p1'])
  assert.deepEqual(mapped[2].productIds, [])
  assert.equal(selectCollectionProduct(mapped[0], products)?.id, 'p1')
  assert.equal(selectCollectionProduct(mapped[1], products)?.id, 'p1')
})

test('unassigned featured product and global first product never fill an empty collection', () => {
  const mapped = attachCollectionMembership(collections, [])
  for (const collection of mapped) assert.equal(selectCollectionProduct(collection, products), null)
  const assigned = attachCollectionMembership(collections, [{ collection_id: 'c2', product_id: 'p1' }])
  assert.equal(selectCollectionProduct(assigned[1], products)?.id, 'p1')
  const page = readFileSync(path.join(root, 'frontend/src/pages/CollectionsPage.tsx'), 'utf8')
  assert.doesNotMatch(page, /products\[0\]|item\.collection/)
})

test('production collection absence stays empty while local fallback remains available', () => {
  const bundled = [{ id: 'local', slug: 'local-edit' }]
  assert.deepEqual(collectionFallback(true, bundled), [])
  assert.deepEqual(collectionFallback(false, bundled), bundled)
  assert.deepEqual(prototypeCollectionFallback(true, bundled, bundled), [])
  assert.deepEqual(prototypeCollectionFallback(false, undefined, bundled), bundled)
  assert.deepEqual(prototypeCollectionFallback(false, [], bundled), [])
  const merged = mergeStorefrontData({ collections: bundled, settings: {}, homepage: {}, shipping: {}, payments: [], seo: [] }, { collections: [] })
  assert.deepEqual(merged.collections, [])
})

test('legacy slug resolves to one canonical collection and storefront reads junction links', () => {
  const mapped = attachCollectionMembership(collections, [{ collection_id: 'c1', product_id: 'p1' }])
  assert.equal(resolveCollectionSlug('royal-collection'), 'royal-fusion-originals')
  assert.deepEqual([...collectionProductIdsForSlug(mapped, 'royal-collection')], ['p1'])
  assert.deepEqual([...collectionProductIdsForSlug(mapped, 'royal-fusion-originals')], ['p1'])
  const service = readFileSync(path.join(root, 'frontend/src/services/supabaseStorefrontService.ts'), 'utf8')
  assert.match(service, /\.from\('product_collections'\)/)
  const adminService = readFileSync(path.join(root, 'backend/server/services/collectionAdminService.js'), 'utf8')
  assert.doesNotMatch(adminService, /\.update\(\{ collection:/)
})

test('product detail resolves every assigned collection and omits unassigned legacy text', () => {
  const linked = attachCollectionMembership([
    { id: 'c1', slug: 'royal-fusion-originals', name: 'Royal Fusion Originals' },
    { id: 'c2', slug: 'crystal-edit', name: 'Crystal Edit' },
    { id: 'c3', slug: 'oud-heritage', name: 'Oud Heritage' },
  ], [
    { collection_id: 'c1', product_id: 'p1' },
    { collection_id: 'c2', product_id: 'p1' },
  ])
  assert.deepEqual(collectionNamesForProduct(linked, 'p1'), ['Royal Fusion Originals', 'Crystal Edit'])
  assert.deepEqual(collectionNamesForProduct(linked, 'p2'), [])
  const detail = readFileSync(path.join(root, 'frontend/src/pages/ProductDetailsPage.tsx'), 'utf8')
  assert.match(detail, /collectionNamesForProduct\(collections, product\.id\)/)
  assert.doesNotMatch(detail, /product\.collection/)
})

test('search matches relational collection names and preserves other product terms', () => {
  const linked = attachCollectionMembership([
    { id: 'c1', slug: 'royal-fusion-originals', name: 'Royal Fusion Originals' },
    { id: 'c2', slug: 'crystal-edit', name: 'Crystal Edit' },
  ], [
    { collection_id: 'c1', product_id: 'p1' },
    { collection_id: 'c2', product_id: 'p1' },
  ])
  const product = { id: 'p1', name: 'SHAHEEN', scentFamily: 'Fresh', category: 'Eau de Parfum', gender: 'Men', collection: 'Wrong Legacy Label' }
  for (const term of ['shaheen', 'fresh', 'eau de parfum', 'men', 'originals', 'crystal edit']) {
    assert.equal(productMatchesSearch(product, linked, term), true)
  }
  assert.equal(productMatchesSearch(product, linked, 'wrong legacy label'), false)
  assert.equal(productMatchesSearch(product, [], 'originals'), false)
  const search = readFileSync(path.join(root, 'frontend/src/components/layout/SearchOverlay.tsx'), 'utf8')
  assert.match(search, /productMatchesSearch\(product, collections, normalized\)/)
  assert.doesNotMatch(search, /product\.collection/)
})
