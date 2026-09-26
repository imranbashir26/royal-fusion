import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { resolveFinderRecommendation } from '../src/services/finderRecommendation.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const keys = ['fresh', 'sweet', 'woody', 'oud', 'spicy', 'floral']
const products = keys.map((key) => ({ id: `product-${key}`, slug: `different-${key}`, name: key }))
const preferences = keys.map((key, index) => ({ key, productId: products[index].id }))

test('each Finder preference resolves its configured product ID', () => {
  for (const [index, key] of keys.entries()) {
    assert.equal(resolveFinderRecommendation(key, preferences, products)?.id, products[index].id)
  }
})

test('missing mapping or missing product never selects a fallback recommendation', () => {
  assert.equal(resolveFinderRecommendation('fresh', [], products), null)
  assert.equal(resolveFinderRecommendation('fresh', [{ key: 'fresh', productId: null }], products), null)
  assert.equal(resolveFinderRecommendation('fresh', [{ key: 'fresh', productId: 'deleted' }], products), null)
  assert.equal(resolveFinderRecommendation('fresh', preferences, []), null)
})

test('Finder component has no hardcoded product-slug recommendation and still uses shared ProductCard', () => {
  const component = readFileSync(path.join(root, 'src/components/home/FragranceFinder.tsx'), 'utf8')
  assert.doesNotMatch(component, /productSlug|fallbackProducts|catalog\[0\]|\.scentFamily === activePreference/)
  assert.match(component, /resolveFinderRecommendation\(selected, finderPreferences, products\)/)
  assert.match(component, /<ProductCard product=\{recommendation\}/)
  assert.match(component, /Recommendation unavailable/)
})

test('public Finder configuration remains empty when unavailable, with no bundled product assignments', () => {
  const storefront = readFileSync(path.join(root, 'src/services/storefrontService.ts'), 'utf8')
  assert.match(storefront, /finderPreferences: \[\]/)
  assert.match(storefront, /getPublicFinderPreferences\(\)\.catch\(\(\) => \[\]\)/)
  const service = readFileSync(path.join(root, 'src/services/fragranceFinderService.ts'), 'utf8')
  assert.match(service, /\/v1\/public\/fragrance-finder/)
})
