import assert from 'node:assert/strict'
import test from 'node:test'
import { pageFixture, origin } from './support/variantBrowserHarness.mjs'

const customerId = '00000000-0000-4000-8000-000000000001', couponId = '00000000-0000-4000-8000-000000000002'
const adminFixture = (permissions = ['*']) => ({ paths: [], requests: [], session: {
  authenticated: true, csrfToken: 'fixture-csrf', identity: { id: 'actor', email: 'admin@example.invalid', emailVerified: true },
  administrator: { userId: 'actor', name: 'Operator', role: 'Admin', roleKey: 'admin', permissions },
}, coupon: { id: couponId, code: 'PARENT10', type: 'Percentage', pricingPolicy:'LEGACY', discountValue: 10, minimumOrderAmount: 0, maxDiscountAmount: null, description: 'Existing parent coupon', startDate: null, endDate: null, usageLimit: 10, perCustomerUsageLimit: 1, status: 'Active', usedCount: 3, updatedAt: '2026-10-10T00:00:00Z' }, seo: [] })
async function setup(t, admin = adminFixture()) {
  const { page } = await pageFixture(t, { admin })
  page.setDefaultTimeout(15000)
  const legacy = []
  page.context().on('request', req => { if (new URL(req.url()).pathname.startsWith('/api/admin/')) legacy.push(req.url()) })
  t.after(() => assert.deepEqual(legacy, []))
  if (admin) await page.route('**/api/v1/admin/**', async route => {
    const req = route.request(), url = new URL(req.url()), [, , , , resource, id, action] = url.pathname.split('/')
    admin.requests.push({ path: url.pathname, method: req.method(), body: req.postDataJSON(), headers: req.headers() })
    if (admin.mode === 'error') return route.fulfill({ status: 503, json: { error: { message: 'secret database stack trace' } } })
    if (admin.mode === 'expired') { admin.session = { authenticated: false, csrfToken: 'fixture-csrf' }; return route.fulfill({ status: 401, json: { error: { code: 'SESSION_EXPIRED' } } }) }
    const customer = { id: customerId, name: 'Aisha', email: 'aisha@example.invalid', phone: '03001234567', status: 'Active', createdAt: '2026-10-10T00:00:00Z' }
    let data
    if (resource === 'customers') {
      if (action === 'orders') data = { items: [{ id: 'linked-order', orderNumber: 'RF-VERIFIED', status: 'Pending', paymentStatus: 'Unpaid', total: 3150, currency: 'PKR' }], total: 1, page: 1, pageSize: 10 }
      else if (id) data = { ...customer, addressesTruncated: false, addresses: [{ id: 'address', label: 'Home', recipient_name: 'Aisha', phone: '03001234567', address_line_1: 'Canonical address', address_line_2: '', city: 'Karachi', province: 'Sindh', postal_code: '', country_code: 'PK', is_default: true }] }
      else data = { items: url.searchParams.get('page') === '2' || url.searchParams.get('search') === 'missing' ? [] : [customer], total: 21, page: Number(url.searchParams.get('page')), pageSize: 20 }
    } else if (resource === 'coupons') {
      if (['POST', 'PUT'].includes(req.method())) {
        if (admin.pending) await admin.pending
        admin.coupon = { ...admin.coupon, ...req.postDataJSON(), updatedAt: '2026-10-10T00:00:01Z' }; data = admin.coupon
      } else if (id) data = { ...admin.coupon, productIds: ['monetary-parent-pack'], categoryIds: ['parent-category'], legacyProductIds: [], legacyCategoryIds: [], restrictionsTruncated: false, redemptionCount: 3, redemptions: [{ id: 'redemption', discount_amount: 45, created_at: '2026-10-09' }], ...admin.restrictions }
      else data = { items: [admin.coupon], total: 1, page: 1, pageSize: 20 }
    } else if (resource === 'seo') {
      if (req.method() === 'PUT') {
        data = { id: 'seo', pageKey: id, routePath: id === 'home' ? '/' : `/${id}`, ...req.postDataJSON(), active: true, robots: 'index,follow', updatedAt: '2026-10-10T00:00:01Z' }
        admin.seo = [data]
      } else data = admin.seo
    }
    return route.fulfill({ json: { data } })
  })
  return page
}

test('customers navigation, canonical addresses, order links and pagination remain read-only and permission-scoped', async t => {
  const admin = adminFixture(['customers.read', 'orders.read']), page = await setup(t, admin)
  await page.goto(`${origin}/admin/customers`)
  await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('link', { name: 'Customer Database', exact: true }).waitFor()
  await page.getByRole('button', { name: 'View customer Aisha', exact: true }).click()
  await page.getByText(/Canonical address/).waitFor()
  await page.getByRole('link', { name: 'RF-VERIFIED', exact: true }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'RF-VERIFIED' }).getAttribute('href'), '/admin/orders/linked-order')
  await page.getByRole('button', { name: 'Close customer', exact: true }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByText('No customers match this search.', { exact: true }).waitFor()
  assert.ok(admin.requests.every(req => req.method === 'GET'))
  const limited = adminFixture(['customers.read']), other = await setup(t, limited)
  await other.goto(`${origin}/admin/customers`); await other.getByRole('button', { name: 'View customer Aisha', exact: true }).click()
  await other.getByText(/Canonical address/).waitFor()
  assert.equal(await other.getByText('Order history', { exact: true }).count(), 0)
  assert.equal(limited.requests.some(req => req.path.endsWith('/orders')), false)
})

test('coupon details and configuration/status updates preserve restrictions and usage with CSRF transport', async t => {
  const admin = adminFixture(['coupons.manage']), page = await setup(t, admin)
  await page.goto(`${origin}/admin/coupons`)
  await page.getByRole('button', { name: 'View coupon PARENT10', exact: true }).click()
  await page.getByText('Product restrictions: Modern restrictions', { exact: true }).waitFor()
  await page.getByText('Modern product IDs: monetary-parent-pack', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Edit coupon PARENT10', exact: true }).click()
  assert.equal(await page.getByLabel('Coupon code', { exact: true }).isDisabled(), true)
  assert.equal(await page.getByLabel('Coupon type', { exact: true }).isDisabled(), true)
  await page.getByLabel('Status', { exact: true }).selectOption('Inactive')
  await page.getByRole('button', { name: 'Save Coupon', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Coupon saved.' }).waitFor()
  const mutations = admin.requests.filter(req => req.method === 'PUT')
  assert.equal(mutations.length, 1); assert.equal(mutations[0].headers['x-rf-csrf'], 'fixture-csrf')
  assert.equal(mutations[0].body.expectedUpdatedAt, '2026-10-10T00:00:00Z')
  assert.equal(mutations[0].body.status, 'Inactive'); assert.equal('usedCount' in mutations[0].body, false)
  assert.equal('productIds' in mutations[0].body, false); assert.equal(admin.coupon.usedCount, 3)
})

test('coupon creation defaults inactive and blocks duplicate submissions while pending', async t => {
  const admin = adminFixture(['coupons.manage']), page = await setup(t, admin)
  let release; admin.pending = new Promise(resolve => { release = resolve })
  await page.goto(`${origin}/admin/coupons`)
  await page.getByRole('button', { name: 'Add Coupon', exact: true }).click()
  await page.getByLabel('Coupon code', { exact: true }).fill('SAFE10')
  await page.getByRole('button', { name: 'Save Coupon', exact: true }).click()
  try {
    await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor()
    await page.getByRole('form', { name: 'Coupon configuration' }).evaluate(form => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
  } finally { release() }
  await page.getByRole('status').filter({ hasText: 'Coupon saved.' }).waitFor()
  const mutations = admin.requests.filter(req => req.method === 'POST')
  assert.equal(mutations.length, 1); assert.equal(mutations[0].body.status, 'Inactive'); assert.equal('usedCount' in mutations[0].body, false)
})

test('SEO static-page editor saves approved fields and keeps editorial/deferred modules isolated', async t => {
  const admin = adminFixture(['seo.manage']), page = await setup(t, admin)
  await page.goto(`${origin}/admin/seo`)
  await page.getByLabel('Storefront page', { exact: true }).selectOption('contact')
  await page.getByLabel('SEO title', { exact: true }).fill('Contact Royal Fusion')
  await page.getByLabel('Canonical URL', { exact: true }).fill('https://royalfusion.example/contact')
  await page.getByRole('button', { name: 'Save SEO Settings', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'SEO settings saved.' }).waitFor()
  const mutation = admin.requests.find(req => req.method === 'PUT')
  assert.equal(mutation.path, '/api/v1/admin/seo/contact'); assert.equal(mutation.headers['x-rf-csrf'], 'fixture-csrf')
  assert.equal('robots' in mutation.body, false); assert.equal('active' in mutation.body, false)
  assert.doesNotMatch(await page.getByLabel('Storefront page').innerText(), /blog|journal|product/)
  await page.getByRole('button', { name: 'Editable Pages', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Production integration for editable pages is pending.' }).waitFor()
})

test('unrelated permission hides each Phase 3 navigation item and denies direct routes without requests', async t => {
  for (const route of ['customers', 'coupons', 'seo']) {
    const admin = adminFixture(['contact_messages.manage']), page = await setup(t, admin)
    await page.goto(`${origin}/admin/${route}`)
    await page.getByRole('alert').filter({ hasText: 'You do not have permission' }).waitFor()
    assert.equal(await page.getByRole('navigation', { name: 'Admin navigation' }).locator(`a[href="/admin/${route}"]`).count(), 0)
    assert.deepEqual(admin.requests, [])
  }
})

test('Phase 3 errors are safe and expired sessions return to Admin Login', async t => {
  for (const route of ['customers', 'coupons', 'seo']) {
    const admin = adminFixture(); admin.mode = 'error'; const page = await setup(t, admin)
    await page.goto(`${origin}/admin/${route}`)
    await page.getByRole('alert').filter({ hasText: 'This request could not be completed.' }).waitFor()
    assert.doesNotMatch(await page.locator('main').innerText(), /secret database|stack trace/)
  }
  const admin = adminFixture(); admin.mode = 'expired'; const page = await setup(t, admin)
  await page.goto(`${origin}/admin/customers`)
  await page.getByRole('heading', { name: 'Admin Login', exact: true }).waitFor()
})

test('public SEO read safely renders literal metadata, preserves intentional robots and clears route-specific state', async t => {
  const page = await setup(t, null), requests = [], title = 'Contact <script>window.__seoInjected=true</script>'
  await page.route('**/rest/v1/seo_settings**', route => {
    requests.push(new URL(route.request().url()))
    return route.fulfill({ json: [{ active: true, route_path: '/contact', title, description: 'Contact us', robots: 'noindex,follow', canonical_url: 'https://royalfusion.example/contact', og_image_secure_url: 'javascript:alert(1)' }, { active: false, route_path: '/about', title: 'Inactive' }], headers: { 'access-control-allow-origin': '*' } })
  })
  await page.goto(`${origin}/contact`)
  await page.waitForFunction(expected => document.title === expected, title)
  assert.equal(await page.evaluate(() => window.__seoInjected), undefined)
  assert.equal(await page.locator('head script').filter({ hasText: 'window.__seoInjected' }).count(), 0)
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex,follow')
  assert.equal(await page.locator('meta[property="og:image"]').count(), 0)
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `${origin}/contact`)
  assert.ok(requests.length > 0); assert.ok(requests.every(url => url.searchParams.get('active') === 'eq.true'))
  assert.ok(requests.every(url => !/admin|updated_at|public_id/.test(url.searchParams.get('select'))))
  await page.goto(`${origin}/about?tracking=1`)
  await page.waitForFunction(expected => document.querySelector('link[rel="canonical"]')?.href === expected, `${origin}/about`)
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'index,follow')
  assert.notEqual(await page.title(), 'Inactive')
})

test('coupon details display legacy-only and mixed restrictions accurately without mutation requests', async t => {
  for (const [source, modern] of [['Historical restrictions', []], ['Mixed sources', ['modern-parent']]]) {
    const admin = adminFixture(['coupons.manage'])
    admin.restrictions = { productIds: modern, categoryIds: modern.length ? ['modern-category'] : [], legacyProductIds: ['historical-parent'], legacyCategoryIds: ['historical-category'] }
    const page = await setup(t, admin)
    await page.goto(`${origin}/admin/coupons`)
    await page.getByRole('button', { name: 'View coupon PARENT10', exact: true }).click()
    const details = page.getByRole('region', { name: 'Coupon details' })
    await details.getByText(`Product restrictions: ${source}`, { exact: true }).waitFor()
    await details.getByText(`Category restrictions: ${source}`, { exact: true }).waitFor()
    await details.getByText('Historical product IDs (preserved): historical-parent', { exact: true }).waitFor()
    await details.getByText('Historical category IDs (preserved): historical-category', { exact: true }).waitFor()
    if (modern.length) {
      await details.getByText('Modern product IDs: modern-parent', { exact: true }).waitFor()
      await details.getByText('Modern category IDs: modern-category', { exact: true }).waitFor()
    }
    assert.doesNotMatch(await details.innerText(), /Unrestricted|All monetary parent products|All categories/)
    assert.ok(admin.requests.every(req => req.method === 'GET'))
    assert.deepEqual(admin.restrictions.legacyProductIds, ['historical-parent'])
  }
})

test('coupon details tolerate missing/null arrays and mark unrestricted only when both sources are empty', async t => {
  const admin = adminFixture(['coupons.manage'])
  admin.restrictions = { productIds: null, categoryIds: undefined, legacyProductIds: ['historical-parent'], legacyCategoryIds: null }
  const page = await setup(t, admin)
  await page.goto(`${origin}/admin/coupons`)
  await page.getByRole('button', { name: 'View coupon PARENT10', exact: true }).click()
  const details = page.getByRole('region', { name: 'Coupon details' })
  await details.getByText('Product restrictions: Historical restrictions', { exact: true }).waitFor()
  await details.getByText('Historical product IDs (preserved): historical-parent', { exact: true }).waitFor()
  await details.getByText('Category restrictions: Unrestricted', { exact: true }).waitFor()
  assert.ok(admin.requests.every(req => req.method === 'GET'))
})

test('public canonicals reject foreign, malformed and historical stored hosts and use the storefront fallback', async t => {
  const page = await setup(t, null)
  let canonical
  await page.route('**/rest/v1/seo_settings**', route => route.fulfill({ json: [{ active: true, route_path: '/contact', title: 'Canonical verification', canonical_url: canonical }], headers: { 'access-control-allow-origin': '*' } }))
  for (canonical of ['https://foreign.example/contact', 'https://old.royalfusion.example/contact', 'https://[invalid/contact', 'https://foreign.example/contact?x=1', '/contact', '']) {
    await page.goto(`${origin}/contact?tracking=1`)
    await page.waitForFunction(() => document.title === 'Canonical verification')
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `${origin}/contact`, canonical)
  }
})


test('percentage-only creation supports a cap and minimum while legacy types remain readable',async t=>{
 const admin=adminFixture(['coupons.manage']),page=await setup(t,admin)
 await page.goto(origin+'/admin/coupons');await page.getByRole('button',{name:'Add Coupon',exact:true}).click()
 assert.deepEqual(await page.getByLabel('Coupon type',{exact:true}).locator('option').allTextContents(),['Percentage'])
 await page.getByLabel('Coupon code',{exact:true}).fill('GLOBALCAP');await page.getByLabel('Maximum discount amount',{exact:true}).fill('150.25');await page.getByLabel('Minimum order amount',{exact:true}).fill('1000.05')
 await page.getByRole('button',{name:'Save Coupon',exact:true}).click();await page.getByRole('status').filter({hasText:'Coupon saved.'}).waitFor()
 const submitted=admin.requests.find(r=>r.method==='POST').body;assert.equal(submitted.type,'Percentage');assert.equal(submitted.maxDiscountAmount,150.25);assert.equal(submitted.minimumOrderAmount,1000.05);assert(!('pricingPolicy'in submitted))
 const legacy=adminFixture(['coupons.manage']);legacy.coupon.type='Fixed Amount';legacy.coupon.discountValue=100
 const other=await setup(t,legacy);await other.goto(origin+'/admin/coupons');await other.getByRole('button',{name:'View coupon PARENT10',exact:true}).click();await other.getByText('Legacy coupon — existing terms preserved',{exact:true}).waitFor()
 await other.getByRole('button',{name:'Edit coupon PARENT10',exact:true}).click();assert.equal(await other.getByLabel('Coupon type',{exact:true}).inputValue(),'Fixed Amount');assert(await other.getByLabel('Coupon type',{exact:true}).isDisabled())
})
