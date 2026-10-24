import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import { seoPages } from '../../backend/server/schemas/adminPhase3.js'
import { productRow } from './variantFixtures.mjs'

async function modules(t) {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', envDir: false, optimizeDeps: { noDiscovery: true } })
  t.after(() => server.close())
  return path => server.ssrLoadModule(path)
}

test('Phase 3 navigation, resource permissions and clients use canonical cookie/CSRF contracts', async t => {
  const load = await modules(t), originals = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document }
  t.after(() => Object.assign(globalThis, originals))
  globalThis.window = { location: { protocol: 'http:' } }
  globalThis.document = { cookie: 'rf-dev-csrf=phase3-csrf' }
  const requests = []
  globalThis.fetch = async (path, options) => { requests.push({ path, options }); return new Response(JSON.stringify({ data: {} })) }
  const { adminNav, resourceConfigs } = await load('/src/admin/adminConfig.ts')
  for (const [key, permission] of [['customers', 'customers.read'], ['coupons', 'coupons.manage'], ['seo', 'seo.manage']]) {
    assert.equal(adminNav.find(item => item.to === `/admin/${key}`).permission, permission)
    assert.equal(resourceConfigs[key].permission, permission)
  }
  const { adminCustomersApi, adminCouponsApi, adminSeoApi } = await load('/src/services/adminPhase3Api.ts')
  const id = '00000000-0000-4000-8000-000000000001', config = { discountValue: 10, minimumOrderAmount: 0, maxDiscountAmount: null, description: '', startDate: null, endDate: null, usageLimit: 0, perCustomerUsageLimit: 0, status: 'Inactive' }
  await adminCustomersApi.list({ page: 2, pageSize: 20, search: 'Aisha' })
  await adminCustomersApi.detail(id); await adminCustomersApi.orders(id, 1)
  await adminCouponsApi.create({ ...config, code: 'WELCOME10', type: 'Percentage' })
  await adminCouponsApi.update(id, { ...config, expectedUpdatedAt: '2026-10-10T00:00:00Z' })
  await adminSeoApi.save('contact', { title: 'Contact', description: '', canonicalUrl: '', ogTitle: '', ogDescription: '', ogImage: '', expectedUpdatedAt: null })
  assert.deepEqual(requests.map(r => r.path), ['/api/v1/admin/customers?page=2&pageSize=20&search=Aisha', `/api/v1/admin/customers/${id}`, `/api/v1/admin/customers/${id}/orders?page=1&pageSize=10`, '/api/v1/admin/coupons', `/api/v1/admin/coupons/${id}`, '/api/v1/admin/seo/contact'])
  assert.ok(requests.every(r => r.options.credentials === 'include'))
  assert.deepEqual(requests.slice(3).map(r => r.options.method), ['POST', 'PUT', 'PUT'])
  assert.ok(requests.slice(3).every(r => r.options.headers['X-RF-CSRF'] === 'phase3-csrf'))
  assert.ok(requests.slice(3).every(r => !('usedCount' in JSON.parse(r.options.body)) && !('robots' in JSON.parse(r.options.body))))
})

test('public SEO mapping accepts only active static pages and safe metadata URLs', async t => {
  const load = await modules(t), { staticSeoPaths, mapPublicSeoRows } = await load('/src/services/storefrontSeo.ts')
  const expectedStaticSeoPaths = [
    '/', '/shop', '/collections', '/attars', '/about', '/contact',
    '/privacy-policy', '/terms-and-conditions', '/shipping-policy', '/returns-refunds',
  ]
  assert.deepEqual(Object.values(seoPages), expectedStaticSeoPaths.slice(0, 6))
  assert.deepEqual(staticSeoPaths, expectedStaticSeoPaths)
  const rows = mapPublicSeoRows([
    { active: true, route_path: '/contact', title: 'Contact', robots: 'noindex,follow', canonical_url: 'https://royalfusion.example/contact' },
    { active: false, route_path: '/about', title: 'Hidden' }, { active: true, route_path: '/blogs/article', title: 'CMS-owned' },
    { active: true, route_path: '/', canonical_url: 'javascript:alert(1)', og_image_secure_url: 'https://user:secret@example.invalid/image.png' },
  ])
  assert.equal(rows.length, 2); assert.equal(rows[0].robots, 'noindex,follow')
  assert.equal(rows[1].canonicalUrl, ''); assert.equal(rows[1].ogImage, '')
})

test('existing commerce and Sanity mappers preserve SEO without changing UUID or stock', async t => {
  const load = await modules(t), { mapProduct, mapCategory, mapCollection, mapSanityBlog } = await load('/src/services/productionMappers.ts')
  const product = mapProduct({ ...productRow, seo_title: 'Baraan SEO', seo_description: 'Commerce description' })
  assert.equal(product.id, productRow.id); assert.equal(product.stock, 12); assert.equal(product.seoTitle, 'Baraan SEO')
  assert.equal(mapCategory({ id: 'category', name: 'Category', slug: 'category', seo_title: 'Category SEO' }).seoTitle, 'Category SEO')
  assert.equal(mapCollection({ id: 'collection', name: 'Collection', slug: 'collection', seo_title: 'Collection SEO' }).seoTitle, 'Collection SEO')
  const blog = mapSanityBlog({ _id: 'blog', title: 'Journal', slug: 'journal', seoTitle: 'Sanity SEO', seoDescription: 'Editorial description' })
  assert.equal(blog.seoTitle, 'Sanity SEO'); assert.equal(blog.seoDescription, 'Editorial description')
})

test('metadata resolution respects commerce/editorial ownership and route-specific robots', async t => {
  const load = await modules(t), { resolveStorefrontSeo: resolve } = await load('/src/services/storefrontSeo.ts')
  const data = { seo: [{ slug: '/', seoTitle: 'Home', canonicalUrl: 'https://royalfusion.example/' }, { slug: '/contact', seoTitle: 'Contact', robots: 'noindex,follow' }], products: [{ slug: 'baraan', seoTitle: 'Baraan SEO', seoDescription: 'Commerce' }], blogs: [{ slug: 'journal', seoTitle: 'Sanity SEO', seoDescription: 'Editorial' }], categories: [{ slug: 'woody', name: 'Woody', seoTitle: 'Woody SEO' }], collections: [{ slug: 'royal-fusion-originals', seoTitle: 'Originals SEO' }] }
  const origin = 'https://royalfusion.example'
  assert.equal(resolve('/product/baraan', '', data, origin).title, 'Baraan SEO')
  assert.equal(resolve('/product/baraan', '', data, origin).canonical, `${origin}/product/baraan`)
  assert.equal(resolve('/blogs/journal', '', data, origin).title, 'Sanity SEO')
  assert.equal(resolve('/shop', '?category=Woody', data, origin).title, 'Woody SEO')
  assert.equal(resolve('/shop', '?collection=royal-collection', data, origin).title, 'Originals SEO')
  assert.equal(resolve('/contact', '', data, origin).robots, 'noindex,follow')
  assert.equal(resolve('/about', '', data, origin).robots, 'index,follow')
})

test('canonical fallbacks retain the storefront origin and strip query/hash without unsafe images', async t => {
  const load = await modules(t), { resolveStorefrontSeo: resolve } = await load('/src/services/storefrontSeo.ts')
  const data = { seo: [{ slug: '/shop', canonicalUrl: 'javascript:alert(1)', ogImage: 'javascript:alert(1)' }], products: [], blogs: [], categories: [], collections: [] }
  assert.equal(resolve('/shop', '?tracking=1', data, 'https://royalfusion.example').canonical, 'https://royalfusion.example/shop')
  assert.equal(new URL(resolve('//evil.invalid', '', data, 'https://royalfusion.example').canonical).origin, 'https://royalfusion.example')
  assert.equal(resolve('/shop', '', data, 'https://royalfusion.example').ogImage, '')
})

test('stored canonicals require the exact approved storefront origin, path and safe HTTPS form', async t => {
  const load = await modules(t), { resolveStorefrontSeo: resolve } = await load('/src/services/storefrontSeo.ts')
  const approved = 'https://royalfusion.example', expected = `${approved}/contact`
  for (const [name, canonicalUrl] of [
    ['approved', expected], ['normalized approved', 'https://ROYALFUSION.EXAMPLE:443/contact'],
    ['foreign matching path', 'https://foreign.example/contact'], ['historical host', 'https://old.royalfusion.example/contact'],
    ['historical relative path', '/contact'], ['historical HTTP', 'http://royalfusion.example/contact'],
    ['malformed', 'https://[invalid/contact'], ['credentials', 'https://user:secret@royalfusion.example/contact'],
    ['query', `${expected}?tracking=1`], ['hash', `${expected}#section`], ['mismatched path', `${approved}/about`],
    ['unsafe scheme', 'javascript:alert(1)'], ['scheme relative', '//foreign.example/contact'], ['missing', undefined], ['empty', ''],
  ]) {
    const data = { seo: [{ slug: '/contact', canonicalUrl }], products: [], blogs: [], categories: [], collections: [] }
    assert.equal(resolve('/contact', '?tracking=1', data, approved).canonical, expected, name)
  }
  const data = { seo: [{ slug: '/contact', canonicalUrl: 'https://royalfusion.example:444/contact' }], products: [], blogs: [], categories: [], collections: [] }
  assert.equal(resolve('/contact', '', data, approved).canonical, expected, 'foreign port')
})

test('coupon display distinguishes modern, historical and mixed restriction sources without rewriting IDs', async t => {
  const load = await modules(t), { couponRestrictionSources: sources } = await load('/src/services/adminPhase3Api.ts')
  const modern = Object.freeze(['modern-parent']), historical = Object.freeze(['historical-parent', 'historical-other'])
  assert.deepEqual(sources([], []), { source: 'Unrestricted', modernIds: [], historicalIds: [] })
  assert.equal(sources(modern, []).source, 'Modern restrictions')
  assert.deepEqual(sources([], historical), { source: 'Historical restrictions', modernIds: [], historicalIds: historical })
  assert.deepEqual(sources(modern, historical), { source: 'Mixed sources', modernIds: modern, historicalIds: historical })
  assert.equal(sources(null, historical).source, 'Historical restrictions')
  assert.equal(sources(modern, undefined).source, 'Modern restrictions')
  assert.deepEqual(sources(undefined, null), { source: 'Unrestricted', modernIds: [], historicalIds: [] })
  assert.deepEqual(historical, ['historical-parent', 'historical-other'])
})
