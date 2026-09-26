import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { catalogFallback, normalizePrototypeProducts, prototypeCatalogFallback } from '../src/services/catalogFallback.ts'
import { catalogRouteCategory, compareNewArrivals, matchesCatalogFacets } from '../src/services/catalogFacets.ts'
import { mapProduct, normalizeProductType } from '../src/services/productionMappers.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const row = {
  id: 'p1', slug: 'known', name: 'Known', price: 3990, main_image_url: '/known.webp',
  gender: 'Women', scent_family: 'Floral', category_name: 'For Her', concentration: 'Eau de Parfum',
  is_best_seller: false, is_new_arrival: true, is_featured: true, is_premium: false,
  collection: 'Wrong legacy collection',
}

test('legacy gender and merchandising categories resolve only from evidenced type', () => {
  assert.equal(normalizeProductType('For Her', 'Eau de Parfum'), 'Eau de Parfum')
  assert.equal(normalizeProductType('Best Sellers', 'Extrait de Parfum'), 'Extrait de Parfum')
  assert.equal(normalizeProductType('For Him'), 'Uncategorized')
  assert.equal(normalizeProductType('Attars'), 'Attar')
  assert.equal(normalizeProductType('Gift Sets'), 'Gift Set')
  assert.equal(normalizeProductType('Oud Heritage'), 'Uncategorized')
  const product = mapProduct(row)
  assert.equal(product.category, 'Eau de Parfum')
  assert.equal(product.gender, 'Women')
  assert.equal(product.scentFamily, 'Floral')
  assert.equal(product.isBestSeller, false)
  assert.equal(product.isNewArrival, true)
  assert.equal(product.isAttar, false)
})

test('Attar sync and Gift Set classification use type, not product name or gender', () => {
  const attar = mapProduct({ ...row, name: 'Ordinary Oil', category_name: 'Attars', concentration: '', gender: 'Men' })
  const gift = mapProduct({ ...row, name: 'Oud Gift', category_name: 'Gift Sets', concentration: '', gender: 'Unisex' })
  assert.equal(attar.category, 'Attar')
  assert.equal(attar.isAttar, true)
  assert.equal(gift.category, 'Gift Set')
  assert.equal(gift.isAttar, false)
  assert.equal(gift.gender, 'Unisex')
  assert.equal(mapProduct({ ...row, name: 'Oud', category_name: 'For Him', concentration: '' }).isAttar, false)
})

test('storefront facets use explicit gender and flags; empty Gift Set stays empty', () => {
  const product = mapProduct(row)
  const options = { category: 'Eau de Parfum', gender: 'Women', bestOnly: false, newOnly: true, attarsOnly: false }
  assert.equal(matchesCatalogFacets(product, options), true)
  assert.equal(matchesCatalogFacets(product, { ...options, gender: 'Men' }), false)
  assert.equal(matchesCatalogFacets(product, { ...options, bestOnly: true }), false)
  assert.equal(matchesCatalogFacets(product, { ...options, category: 'Gift Set' }), false)
  assert.equal(catalogRouteCategory('Gift Sets'), 'Gift Set')
  assert.equal(catalogRouteCategory('Attars'), 'Attar')
  assert.deepEqual([mapProduct({ ...row, id: 'older', is_new_arrival: false }), product].sort(compareNewArrivals).map((item) => item.id), ['p1', 'older'])
})

test('production never substitutes bundled or prototype catalog products', () => {
  const bundled = [mapProduct(row)]
  assert.deepEqual(catalogFallback(true, bundled), [])
  assert.deepEqual(prototypeCatalogFallback(true, bundled, bundled), [])
  assert.deepEqual(catalogFallback(false, bundled), bundled)
  assert.deepEqual(prototypeCatalogFallback(false, undefined, bundled), bundled)
  const service = readFileSync(path.join(root, 'frontend/src/services/storefrontService.ts'), 'utf8')
  assert.match(service, /products: withApprovedReviewRatings\(catalogFallback\(import\.meta\.env\.PROD/)
  assert.match(service, /products: prototypeCatalogFallback\(import\.meta\.env\.PROD/)
})

test('prototype products normalize type without rewriting stock, price, flags, or source JSON', () => {
  const legacy = { ...mapProduct(row), category: 'Best Sellers', concentration: 'Eau de Parfum', stock: 23, price: 3990, isBestSeller: true }
  const normalized = normalizePrototypeProducts([legacy])[0]
  assert.equal(normalized.category, 'Eau de Parfum')
  assert.equal(normalized.stock, 23)
  assert.equal(normalized.price, 3990)
  assert.equal(normalized.isBestSeller, true)
  assert.equal(legacy.category, 'Best Sellers')
})

test('bundled product type data is canonical and does not invent Attar or Gift Set products', () => {
  const source = readFileSync(path.join(root, 'frontend/src/data/products.ts'), 'utf8')
  assert.match(source, /category = 'Eau de Parfum'/)
  assert.doesNotMatch(source, /category: '(?:For Him|For Her|Unisex|Best Sellers|Attars|Gift Sets)'/)
  const categories = readFileSync(path.join(root, 'frontend/src/data/categories.ts'), 'utf8')
  for (const name of ['Eau de Parfum', 'Extrait de Parfum', 'Attar', 'Gift Set']) assert.match(categories, new RegExp(`name: '${name}'`))
  assert.doesNotMatch(categories, /name: '(?:For Him|For Her|Unisex|Best Sellers|New Arrivals)'/)
})
