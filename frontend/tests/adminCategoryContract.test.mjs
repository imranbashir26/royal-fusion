import assert from 'node:assert/strict'
import test from 'node:test'
import { createCategorySchema, updateCategorySchema } from '../../backend/server/schemas/categoryAdmin.js'
import { categoryErrorMessage, selectableCategories, toCategoryPayload } from '../src/services/adminCategoryContract.ts'
import { isAttarCategory, mapProduct } from '../src/services/productionMappers.ts'

test('category form maps to the production create contract and strips extraneous fields', () => {
  const payload = toCategoryPayload({
    id: 'read-only-cat-id',
    name: 'Eau de Parfum',
    slug: 'eau-de-parfum',
    description: 'Luxury EDP concentrations',
    image: 'https://cdn.example.com/cat.webp',
    displayOrder: '2',
    showOnHomepage: true,
    status: 'Published',
    active: true,
    seoTitle: 'EDP Perfumes',
    seoDescription: 'Explore our EDP collection',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    unrelatedField: 'malicious',
  })

  assert.equal(payload.name, 'Eau de Parfum')
  assert.equal(payload.slug, 'eau-de-parfum')
  assert.equal(payload.imageUrl, 'https://cdn.example.com/cat.webp')
  assert.equal(payload.displayOrder, 2)
  assert.equal(payload.showOnHomepage, true)
  assert.equal(payload.status, 'Published')
  assert.equal(payload.active, true)
  assert.equal(Object.hasOwn(payload, 'id'), false)
  assert.equal(Object.hasOwn(payload, 'createdAt'), false)
  assert.equal(Object.hasOwn(payload, 'updatedAt'), false)
  assert.equal(Object.hasOwn(payload, 'unrelatedField'), false)

  const validation = createCategorySchema.safeParse(payload)
  assert.equal(validation.success, true)
})

test('category form maps to production update contract', () => {
  const payload = toCategoryPayload({
    id: 'server-id',
    name: 'Extrait de Parfum',
    displayOrder: 5,
    status: 'Archived',
    createdAt: '2026-01-01',
  })

  assert.equal(Object.hasOwn(payload, 'id'), false)
  assert.equal(Object.hasOwn(payload, 'createdAt'), false)
  const validation = updateCategorySchema.safeParse(payload)
  assert.equal(validation.success, true)
  assert.equal(validation.data.active, false)
})

test('new category with no image passes create validation and only published active categories are selectable', () => {
  const payload = toCategoryPayload({ name: 'For Him', slug: 'for-him', image: [], status: 'Published', active: true })
  assert.equal(payload.imageUrl, '')
  assert.equal(createCategorySchema.safeParse(payload).success, true)
  const categories = [
    { id: 'a', status: 'Published', active: true },
    { id: 'b', status: 'Published', active: false },
    { id: 'c', status: 'Draft', active: true },
  ]
  assert.deepEqual(selectableCategories(categories).map(({ id }) => id), ['a'])
})

test('category errors explain duplicate identities, referential conflicts, session and permission failures', () => {
  const failure = (status, code) => Object.assign(new Error('Server detail'), { status, code })
  assert.match(categoryErrorMessage(failure(409, 'CATEGORY_IN_USE')), /referenced by existing products/i)
  assert.match(categoryErrorMessage(failure(409, 'CATEGORY_CONFLICT')), /slug already exists/i)
  assert.match(categoryErrorMessage(failure(401, 'AUTH_REQUIRED')), /sign in again/i)
  assert.match(categoryErrorMessage(failure(403, 'PERMISSION_DENIED')), /permission/i)
  assert.match(categoryErrorMessage(failure(403, 'CSRF_INVALID')), /refresh the page/i)
  assert.match(categoryErrorMessage(failure(404, 'CATEGORY_NOT_FOUND')), /no longer exists/i)
  assert.match(categoryErrorMessage(failure(400, 'INVALID_REQUEST')), /check the category fields/i)
  assert.match(categoryErrorMessage(failure(500, 'CATEGORY_SERVICE_ERROR')), /unavailable/i)
})

test('mapProduct derives isAttar from category and uses Uncategorized for missing category', () => {
  assert.equal(isAttarCategory('Attar'), true)
  assert.equal(isAttarCategory('Attars'), true)
  assert.equal(isAttarCategory('Eau de Parfum'), false)
  assert.equal(isAttarCategory(''), false)
  assert.equal(isAttarCategory(undefined), false)

  // 1. Missing category -> Uncategorized, not Eau de Parfum
  const uncategorized = mapProduct({
    id: 'p1',
    name: 'Mystery Scent',
    slug: 'mystery-scent',
    price: 3000,
    main_image_url: 'https://cdn.example.com/p1.webp',
  })
  assert.equal(uncategorized.category, 'Uncategorized')
  assert.equal(uncategorized.isAttar, false)

  // 2. Attar category -> isAttar true even if is_attar was omitted/false
  const attarProd = mapProduct({
    id: 'p2',
    name: 'Royal Musk',
    slug: 'royal-musk',
    price: 2500,
    category_name: 'Attar',
    is_attar: false,
    main_image_url: 'https://cdn.example.com/p2.webp',
  })
  assert.equal(attarProd.category, 'Attar')
  assert.equal(attarProd.isAttar, true)

  // 3. Eau de Parfum category -> isAttar false even if is_attar was true
  const edpProd = mapProduct({
    id: 'p3',
    name: 'Royal Oud EDP',
    slug: 'royal-oud-edp',
    price: 5500,
    category_name: 'Eau de Parfum',
    is_attar: true,
    main_image_url: 'https://cdn.example.com/p3.webp',
  })
  assert.equal(edpProd.category, 'Eau de Parfum')
  assert.equal(edpProd.isAttar, false)

  // 4. Backward compatibility: if category_name is missing, fallback to is_attar
  const compatAttar = mapProduct({
    id: 'p4',
    name: 'Legacy Attar',
    slug: 'legacy-attar',
    price: 2200,
    is_attar: true,
    main_image_url: 'https://cdn.example.com/p4.webp',
  })
  assert.equal(compatAttar.category, 'Uncategorized')
  assert.equal(compatAttar.isAttar, true)
})
