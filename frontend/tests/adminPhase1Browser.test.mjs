import assert from 'node:assert/strict'
import test from 'node:test'
import { createCollectionSchema, updateCollectionSchema } from '../../backend/server/schemas/collectionAdmin.js'
import { pageFixture, origin } from './support/variantBrowserHarness.mjs'
import { productId } from './variantFixtures.mjs'

const collectionId = '60000000-0000-4000-8000-000000000001'
const categoryId = '70000000-0000-4000-8000-000000000001'
const existingImage = 'https://cdn.example.invalid/existing.webp'
const uploadedImage = 'https://res.cloudinary.com/fixture/image/upload/gallery.webp'

function recordLegacyAdminRequests(context) {
  const requests = []
  // Request events are independent of route-handler precedence, fulfillment and abortion.
  context.on('request', request => {
    const path = new URL(request.url()).pathname
    if (path === '/api/admin' || path.startsWith('/api/admin/')) {
      requests.push({ method: request.method(), path })
    }
  })
  return requests
}

function assertNoLegacyAdminRequests(requests) {
  assert.deepEqual(requests, [], 'No legacy /api/admin requests')
}

function adminFixture(permissions = ['*']) {
  return {
    paths: [], requests: [],
    session: {
      authenticated: true, csrfToken: 'fixture-csrf',
      identity: { id: 'actor', email: 'admin@example.invalid', emailVerified: true },
      administrator: { userId: 'actor', name: 'Operator', role: 'Admin', roleKey: 'admin', permissions },
    },
    collections: [{ id: collectionId, name: 'Royal Edit', slug: 'royal-edit', description: '',
      bannerSecureUrl: existingImage, image: existingImage, imageUrl: existingImage,
      displayOrder: 0, featured: false, active: true, status: 'Published' }],
    categories: [{ id: categoryId, name: 'Eau de Parfum', slug: 'eau-de-parfum', image: existingImage,
      displayOrder: 0, showOnHomepage: false, active: true, status: 'Published' }],
    products: [{ id: productId, name: 'Baraan', slug: 'baraan', sku: 'RF-BAR-001', commerceKind: 'standard',
      categoryId, category: 'Eau de Parfum', price: 2900, stockQuantity: 12, scentFamily: 'Woody',
      image: existingImage, gallery: [existingImage], status: 'Published', catalogRevision: '1' }],
  }
}

async function setup(t, admin, path) {
  const { page } = await pageFixture(t, { admin })
  const legacyRequests = recordLegacyAdminRequests(page.context())
  t.after(() => assertNoLegacyAdminRequests(legacyRequests))
  page.setDefaultTimeout(15000)
  await page.context().route('**/api/v1/admin/**', async route => {
    const request = route.request(), url = new URL(request.url())
    const method = request.method()
    const body = method === 'GET' || url.pathname.endsWith('/media') ? null : request.postDataJSON()
    admin.paths.push(url.pathname)
    admin.requests.push({ path: url.pathname, method, body, headers: request.headers(), rawBody: request.postData() })
    const reply = data => route.fulfill({ json: { data } })
    if (url.pathname === '/api/v1/admin/media') return reply({
      secureUrl: uploadedImage, url: uploadedImage, mediaType: 'gallery', productId,
    })
    const resource = url.pathname.split('/')[4]
    const rows = admin[resource]
    if (!rows) return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Unsupported fixture endpoint.' } } })
    if (method === 'GET') {
      if (url.pathname.endsWith(resource)) return reply({ items: rows, total: rows.length, page: 1, pageSize: 25, totalPages: 1 })
      return reply(rows.find(row => url.pathname.endsWith(row.id)))
    }
    const id = method === 'POST' ? (resource === 'collections' ? collectionId : categoryId).replace(/1$/, '2') : url.pathname.split('/').at(-1)
    const row = { ...rows.find(item => item.id === id), ...body, id }
    if (method === 'POST') rows.push(row)
    else rows.splice(rows.findIndex(item => item.id === id), 1, row)
    return reply(row)
  })
  t.after(() => assert.equal(admin.paths.some(path => path.startsWith('/api/admin/')), false, 'No prototype admin request'))
  await page.goto(`${origin}${path}`)
  return page
}

async function addBanner(page, image) {
  await page.getByRole('textbox', { name: 'Image URL or path', exact: true }).fill(image)
  await page.getByRole('button', { name: 'Add URL', exact: true }).click()
}

test('legacy request detector catches fulfilled and aborted attempts even when another handler bypasses fixture logging', async t => {
  const admin = adminFixture()
  const { page } = await pageFixture(t, { admin })
  const legacyRequests = recordLegacyAdminRequests(page.context())
  await page.goto(`${origin}/admin/dashboard`)
  await page.getByRole('heading', { name: 'Dashboard', exact: true, level: 2 }).waitFor()
  assertNoLegacyAdminRequests(legacyRequests)

  // These page routes run before the harness's context route and never fall through to it.
  await page.route('**/api/admin/**', route => route.request().method() === 'POST'
    ? route.abort()
    : route.fulfill({ json: { data: [] } }))
  const attempts = [
    { method: 'GET', path: '/api/admin/resources/customers' },
    { method: 'POST', path: '/api/admin/media' },
  ]
  for (const attempt of attempts) {
    await Promise.all([
      page.context().waitForEvent('request', { predicate: request => new URL(request.url()).pathname === attempt.path }),
      page.evaluate(async ({ method, path }) => {
        await fetch(path, { method }).catch(() => {})
      }, attempt),
    ])
  }
  assert.deepEqual(legacyRequests, attempts)
  assert.equal(admin.paths.some(path => path.startsWith('/api/admin/')), false, 'Overriding handlers bypass the old fixture log')
  assert.throws(() => assertNoLegacyAdminRequests(legacyRequests), /No legacy \/api\/admin requests/)
})

test('Collections navigation supports modern create/update and a single banner string without legacy uploads', async t => {
  const admin = adminFixture(), page = await setup(t, admin, '/admin/dashboard')
  await page.getByRole('link', { name: 'Curated Collections', exact: true }).click()
  await page.getByRole('heading', { name: 'Collections', exact: true, level: 1 }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/admin/collections')
  await page.getByRole('button', { name: 'Add Collection', exact: true }).click()
  await page.getByLabel('Collection name').fill('New Collection')
  await page.getByLabel('Slug', { exact: false }).fill('new-collection')
  assert.equal(await page.locator('input[type="file"]').count(), 0)
  await page.getByText('Image uploads are pending integration.', { exact: false }).waitFor()
  await addBanner(page, 'https://cdn.example.invalid/first.webp')
  await addBanner(page, 'https://cdn.example.invalid/selected.webp')
  await page.getByRole('button', { name: 'Save Record', exact: true }).click()
  await page.getByText('Collection created.', { exact: true }).waitFor()
  const created = admin.requests.find(request => request.method === 'POST')
  assert.equal(created.path, '/api/v1/admin/collections')
  assert.equal(created.headers['x-rf-csrf'], 'fixture-csrf')
  assert.equal(created.body.bannerSecureUrl, 'https://cdn.example.invalid/selected.webp')
  assert.equal(createCollectionSchema.parse(created.body).bannerSecureUrl, created.body.bannerSecureUrl)

  // Reloaded DTO aliases must not revive the old image when the canonical image is cleared.
  await page.goto(`${origin}/admin/collections`)
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
  await page.getByRole('heading', { name: 'Edit Collection', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Remove image 1', exact: true }).click()
  await page.getByRole('button', { name: 'Save Record', exact: true }).click()
  await page.getByText('Collection updated.', { exact: true }).waitFor()
  const updated = admin.requests.find(request => request.method === 'PUT')
  assert.equal(updated.headers['x-rf-csrf'], 'fixture-csrf')
  assert.equal(updated.body.bannerSecureUrl, '')
  assert.equal(updateCollectionSchema.parse(updated.body).bannerSecureUrl, '')
  assert.equal(admin.requests.some(request => request.path.endsWith('/media')), false)
})

test('a new Collection without a banner submits the schema-approved empty string', async t => {
  const admin = adminFixture(), page = await setup(t, admin, '/admin/collections')
  await page.getByRole('button', { name: 'Add Collection', exact: true }).click()
  await page.getByLabel('Collection name').fill('No Banner')
  await page.getByLabel('Slug', { exact: false }).fill('no-banner')
  await page.getByRole('button', { name: 'Save Record', exact: true }).click()
  await page.getByText('Collection created.', { exact: true }).waitFor()
  const created = admin.requests.find(request => request.method === 'POST')
  assert.equal(created.body.bannerSecureUrl, '')
  assert.equal(createCollectionSchema.safeParse(created.body).success, true)
})

const pendingModules = [
  ['customers', 'Customers'], ['coupons', 'Coupons & Offers'], ['banners', 'Banners & Campaigns'],
  ['blogs', 'Blogs'], ['testimonials', 'Testimonials'],
  ['seo', 'SEO Settings'], ['editable-pages', 'Editable Pages'],
]
for (const [resource, title] of pendingModules) {
  test(`${resource} keeps its direct route and shows pending integration without resource or upload requests`, async t => {
    const admin = adminFixture(), page = await setup(t, admin, `/admin/${resource}`)
    await page.getByRole('heading', { name: title, exact: true, level: 1 }).waitFor()
    assert.equal(new URL(page.url()).pathname, `/admin/${resource}`)
    assert.match(await page.getByRole('status').innerText(), /Production integration.*pending.*currently unavailable/)
    assert.equal(await page.locator('main form, main input[type="file"], main table').count(), 0)
    assert.equal(await page.getByRole('button', { name: /^(Add |Export|Save Record)/ }).count(), 0)
    assert.deepEqual(admin.paths.filter(path => path.includes('/admin/')), [])
  })
}

test('SEO and Editable Pages choose their initial mode on direct and sidebar navigation and retain mode switching', async t => {
  const admin = adminFixture(), page = await setup(t, admin, '/admin/seo')
  const seo = page.getByRole('button', { name: 'SEO Meta', exact: true })
  const pages = page.getByRole('button', { name: 'Editable Pages', exact: true })
  await page.getByRole('heading', { name: 'SEO Settings', exact: true, level: 1 }).waitFor()
  assert.equal(await seo.getAttribute('aria-pressed'), 'true')
  await pages.click()
  await page.getByRole('heading', { name: 'Editable Pages', exact: true, level: 1 }).waitFor()
  assert.equal(await pages.getAttribute('aria-pressed'), 'true')
  await page.getByRole('link', { name: 'Custom Policy Pages', exact: true }).click()
  await page.getByRole('heading', { name: 'Editable Pages', exact: true, level: 1 }).waitFor()
  await seo.click()
  await page.getByRole('heading', { name: 'SEO Settings', exact: true, level: 1 }).waitFor()
  await page.getByRole('link', { name: 'SEO Settings', exact: true }).click()
  await page.getByRole('heading', { name: 'SEO Settings', exact: true, level: 1 }).waitFor()
  assert.equal(await seo.getAttribute('aria-pressed'), 'true')
  assert.deepEqual(admin.paths.filter(path => path.includes('/admin/')), [])
})

test('Products retain their modern API and approved product-media callback with CSRF', async t => {
  const admin = adminFixture(), page = await setup(t, admin, '/admin/products')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('heading', { name: 'Edit Product', exact: true }).waitFor()
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'gallery.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64'),
  })
  await page.locator(`img[src="${uploadedImage}"]`).waitFor()
  const upload = admin.requests.find(request => request.path === '/api/v1/admin/media')
  assert.equal(upload.method, 'POST')
  assert.equal(upload.headers['x-rf-csrf'], 'fixture-csrf')
  assert.match(upload.headers['content-type'], /^multipart\/form-data; boundary=/)
  assert.ok(upload.rawBody.includes(productId))
  assert.ok(admin.requests.some(request => request.path === `/api/v1/admin/products/${productId}`))
})

test('Categories retain their modern create contract and CSRF while unsupported file uploads stay hidden', async t => {
  const admin = adminFixture(), page = await setup(t, admin, '/admin/categories')
  await page.getByRole('button', { name: 'Add Category', exact: true }).click()
  await page.getByLabel('Category name').fill('Royal Category')
  await page.getByLabel('Slug', { exact: false }).fill('royal-category')
  assert.equal(await page.locator('input[type="file"]').count(), 0)
  await addBanner(page, existingImage)
  await page.getByRole('button', { name: 'Save Record', exact: true }).click()
  await page.getByText('Category created.', { exact: true }).waitFor()
  const created = admin.requests.find(request => request.method === 'POST')
  assert.equal(created.path, '/api/v1/admin/categories')
  assert.equal(created.headers['x-rf-csrf'], 'fixture-csrf')
  assert.equal(created.body.image, existingImage)
})

test('new routes retain authentication and administrator boundaries', async t => {
  const anonymous = adminFixture()
  anonymous.session = { authenticated: false, csrfToken: 'fixture-csrf' }
  const page = await setup(t, anonymous, '/admin/collections')
  await page.getByRole('heading', { name: 'Admin Login', exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/admin/login')
  assert.deepEqual(anonymous.paths.filter(path => path.includes('/admin/')), [])
  const customer = adminFixture()
  customer.session.administrator = null
  const customerPage = await setup(t, customer, '/admin/editable-pages')
  await customerPage.getByRole('alert').filter({ hasText: 'Administrator access is required.' }).waitFor()
  assert.deepEqual(customer.paths.filter(path => path.includes('/admin/')), [])
})

test('Collection mutation controls and navigation retain permission checks', async t => {
  const admin = adminFixture(['catalog.read']), page = await setup(t, admin, '/admin/collections')
  await page.getByRole('cell', { name: 'Royal Edit', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: /^(Add Collection|Edit|Delete)$/ }).count(), 0)
  assert.equal(await page.getByRole('link', { name: 'Curated Collections', exact: true }).count(), 0)
  assert.equal(admin.requests.every(request => request.method === 'GET'), true)
})
