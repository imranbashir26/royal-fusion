import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { withApprovedReviewRatings } from '../src/services/reviewAggregation.ts'
import { mapProduct } from '../src/services/productionMappers.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const product = mapProduct({ id: 'p1', slug: 'royal', name: 'Royal', price: 4000, main_image_url: '/royal.webp' })

test('genuine approved reviews set arithmetic rating and count; no-review products have no rating', () => {
  assert.equal(product.rating, null)
  assert.equal(product.reviewCount, 0)
  const reviews = [
    { id: 'r1', productId: 'p1', rating: 5 },
    { id: 'r2', productId: 'p1', rating: 3 },
    { id: 'r3', productId: 'p2', rating: 2 },
    { id: 'r4', rating: 5 },
  ]
  const [rated, unrated] = withApprovedReviewRatings([product, { ...product, id: 'p3' }], reviews)
  assert.equal(rated.rating, 4)
  assert.equal(rated.reviewCount, 2)
  assert.equal(unrated.rating, null)
  assert.equal(unrated.reviewCount, 0)
})

test('storefront reviews come only from production public API and not bundled or prototype records', () => {
  const source = readFileSync(path.join(root, 'src/services/storefrontService.ts'), 'utf8')
  assert.doesNotMatch(source, /import \{ reviews \} from '\.\.\/data\/reviews'/)
  assert.match(source, /reviews: \[\]/)
  assert.match(source, /getPublicReviews\(\)\.catch\(\(\) => \[\]\)/)
  assert.match(source, /reviews: publicReviews/)
  const publicApi = readFileSync(path.join(root, 'src/services/publicReviewsService.ts'), 'utf8')
  assert.match(publicApi, /\/v1\/public\/reviews/)
})

test('product-specific reviews and shared homepage cards use canonical product ID', () => {
  const details = readFileSync(path.join(root, 'src/pages/ProductDetailsPage.tsx'), 'utf8')
  const homepage = readFileSync(path.join(root, 'src/components/home/ReviewsSection.tsx'), 'utf8')
  assert.match(details, /review\.productId === product\.id/)
  assert.match(details, /<ProductReviewForm/)
  assert.match(homepage, /item\.id === review\.productId/)
  assert.doesNotMatch(homepage, /bundledSampleReviews/)
})
