import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import express from 'express'
import cookieParser from 'cookie-parser'
import { randomUUID } from 'node:crypto'
import { createAuthConfig } from '../auth/config.js'
import { getAuthCookieNames, getSessionCsrfToken } from '../auth/cookies.js'
import { authErrorHandler, requestContext } from '../middleware/authSecurity.js'
import { createAdminPhase3V1Router } from '../routes/adminPhase3V1.js'
import { phase3Database } from './support/phase3Database.js'

const origin = 'https://shop.example.invalid', admin = '00000000-0000-4000-8000-000000000001', customer = '00000000-0000-4000-8000-000000000002', other = '00000000-0000-4000-8000-000000000003'
const config = createAuthConfig({ NODE_ENV: 'test', CLIENT_ORIGIN: origin, AUTH_CSRF_SECRET: 'phase3-test-secret-123456789012345678', ADMIN_AUTH_PROVIDER: 'prototype', CUSTOMER_AUTH_PROVIDER: 'prototype', ENABLE_ADMIN_MFA: 'false' })
const cookies = getAuthCookieNames(config)
let fixture
before(async () => {
  fixture = await phase3Database()
  for (const id of [admin, customer, other]) {
    await fixture.db.query('insert into auth.users(id) values($1)', [id])
    await fixture.db.query('insert into profiles(id,full_name,email,phone) values($1,$2,$3,$4)', [id, id === admin ? 'Admin' : id === customer ? 'Customer A' : 'Customer B', 'shared@example.com', '03001234567'])
  }
  await fixture.db.exec(`insert into roles(key,name) values('admin','Admin'); insert into user_roles(user_id,role_id) select '${admin}',id from roles where key='admin'`)
})
after(async () => { await fixture?.db.close() })
async function start(t, client = fixture.client) {
  await fixture.db.exec('truncate coupon_redemptions, coupon_products, coupon_categories, coupons, seo_settings, admin_audit_logs, customer_addresses, orders cascade')
  const logs = [], permissions = { manager: ['customers.read', 'orders.read', 'coupons.manage', 'seo.manage'], customers: ['customers.read'], coupons: ['coupons.manage'], seo: ['seo.manage'], denied: [] }
  const runtime = { config, repository: { client }, sessionService: { restore: async ({ accessToken }) => {
    if (!accessToken) throw Object.assign(Error(), { code: 'AUTH_REQUIRED' })
    if (accessToken === 'expired') throw Object.assign(Error(), { code: 'SESSION_EXPIRED' })
    return { record: { sessionClass: accessToken === 'customer' ? 'customer' : 'administrator', mfaAssurance: 'aal2' }, identity: { id: accessToken, assuranceLevel: 'aal2' } }
  } }, adminAuthorization: { resolve: async token => ({ userId: admin, permissions: permissions[token] ?? [] }) } }
  const app = express(); app.use(requestContext, cookieParser())
  for (const resource of ['customers', 'coupons', 'seo']) app.use(`/api/v1/admin/${resource}`, createAdminPhase3V1Router(runtime, resource, { client, logger: { warn: row => logs.push(row) } }))
  app.use(authErrorHandler(config))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  return { base: `http://127.0.0.1:${server.address().port}/api/v1/admin`, logs }
}
async function request(api, route, { actor = 'manager', method = 'GET', body, raw, csrf = true, requestOrigin = origin } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (requestOrigin) headers.Origin = requestOrigin
  if (actor) {
    const token = getSessionCsrfToken('handle', config)
    headers.Cookie = `${cookies.access}=${actor}; ${cookies.refresh}=refresh; ${cookies.session}=handle; ${cookies.csrf}=${token}`
    if (csrf) headers['X-RF-CSRF'] = token
  }
  const response = await fetch(api.base + route, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) })
  return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text(), headers: response.headers }
}
const coupon = { code: 'ROYAL_10', type: 'Percentage', discountValue: 10, minimumOrderAmount: 0, maxDiscountAmount: null, description: 'A refined offer', startDate: null, endDate: null, usageLimit: 10, perCustomerUsageLimit: 1, status: 'Inactive' }
const seo = { title: 'Royal contact', description: 'Speak with our team.', canonicalUrl: `${origin}/contact`, ogTitle: '', ogDescription: '', ogImage: '', expectedUpdatedAt: null }
const configure = row => ({ discountValue: row.discountValue, minimumOrderAmount: row.minimumOrderAmount, maxDiscountAmount: row.maxDiscountAmount, description: row.description, startDate: row.startDate, endDate: row.endDate, usageLimit: row.usageLimit, perCustomerUsageLimit: row.perCustomerUsageLimit, status: row.status, expectedUpdatedAt: row.updatedAt })

test('all Phase 3 domains deny anonymous/customer/unauthorized sessions and keep private responses no-store', async t => {
  const api = await start(t)
  for (const domain of ['customers', 'coupons', 'seo']) for (const [actor, status] of [[null, 401], ['customer', 403], ['denied', 403], ['expired', 401], ['manager', 200]]) {
    const r = await request(api, `/${domain}`, { actor }); assert.equal(r.status, status); assert.equal(r.headers.get('cache-control'), 'no-store')
  }
})
test('customers listing searches approved fields, excludes active administrators, bounds pagination and private fields', async t => {
  const api = await start(t)
  const all = await request(api, '/customers?pageSize=1', { actor: 'customers' })
  assert.equal(all.body.data.total, 2); assert.equal(all.body.data.items.length, 1)
  assert.deepEqual(Object.keys(all.body.data.items[0]).sort(), ['createdAt', 'email', 'id', 'name', 'phone', 'status'])
  const found = await request(api, '/customers?search=Customer%20A', { actor: 'customers' })
  assert.equal(found.body.data.total, 1); assert.equal(found.body.data.items[0].id, customer)
  for (const query of ['pageSize=51', 'page=0', 'search=bad%2Cfilter', 'search=wild%25', 'sort=email']) assert.equal((await request(api, `/customers?${query}`)).status, 400)
})
test('customer details and orders use UUID foreign keys, never matching shared email; order permission is separate', async t => {
  const api = await start(t)
  await fixture.db.query(`insert into customer_addresses(customer_id,recipient_name,phone,address_line_1,city,province) values($1,'Customer A','03001234567','Verified address','Lahore','Punjab')`, [customer])
  for (const id of [customer, other]) await fixture.db.query(`insert into orders(order_number,customer_id,customer_name,customer_email,shipping_address,shipping_city,payment_method,total) values($1,$2,'Same email','shared@example.com','Address','Lahore','Cash on Delivery',2900)`, [id === customer ? 'RF-A' : 'RF-B', id])
  const detail = await request(api, `/customers/${customer}`, { actor: 'customers' })
  assert.equal(detail.status, 200, JSON.stringify(detail.body))
  assert.equal(detail.body.data.addresses[0].address_line_1, 'Verified address')
  assert.equal((await request(api, `/customers/${customer}/orders`, { actor: 'customers' })).status, 403)
  const orders = await request(api, `/customers/${customer}/orders`)
  assert.equal(orders.body.data.total, 1); assert.equal(orders.body.data.items[0].orderNumber, 'RF-A')
  assert.deepEqual(Object.keys(orders.body.data.items[0]).sort(), ['createdAt', 'currency', 'id', 'orderNumber', 'paymentStatus', 'status', 'total'])
  assert.equal((await request(api, `/customers/${randomUUID()}`)).status, 404)
  assert.equal((await request(api, `/customers/${admin}`)).status, 404)
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await request(api, `/customers/${customer}`, { method, body: {} })).status, 404)
})
test('coupon creation accepts each approved type, persists audit and rejects duplicate codes case-insensitively', async t => {
  const api = await start(t)
  for (const [type, discountValue] of [['Percentage', 10], ['Fixed Amount', 500], ['Free Shipping', 0]]) {
    const r = await request(api, '/coupons', { actor: 'coupons', method: 'POST', body: { ...coupon, code: type.replaceAll(' ', '_'), type, discountValue } })
    assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.data.usedCount, 0)
  }
  assert.equal((await request(api, '/coupons', { method: 'POST', body: { ...coupon, code: 'percentage' } })).status, 409)
  const audits = (await fixture.db.query('select * from admin_audit_logs')).rows
  assert.equal(audits.length, 3); assert.ok(audits.every(r => r.admin_id === admin && r.permission_key === 'coupons.manage' && r.request_id))
  assert.deepEqual(api.logs, [])
})
test('coupon input rejects invalid money, dates, limits, counters and unapproved restriction writes', async t => {
  const api = await start(t)
  for (const patch of [{ discountValue: 101 }, { discountValue: 0 }, { discountValue: 1.001 }, { minimumOrderAmount: -1 }, { maxDiscountAmount: -1 },
    { usageLimit: -1 }, { perCustomerUsageLimit: 1.5 }, { startDate: '2026-02-30' }, { startDate: '2026-03-02', endDate: '2026-03-01' },
    { usedCount: 1 }, { productIds: [randomUUID()] }, { applicableProducts: [] }, { status: 'Deleted' }, { type: 'Free Shipping', discountValue: 10 }, { description: '<script>unsafe</script>' }]) {
    assert.equal((await request(api, '/coupons', { method: 'POST', body: { ...coupon, ...patch } })).status, 400, JSON.stringify(patch))
  }
  assert.equal((await fixture.db.query('select count(*) from coupons')).rows[0].count, 0)
})
test('coupon config/status update preserves redemptions, usage and tester-pack parent restrictions', async t => {
  const api = await start(t), created = (await request(api, '/coupons', { method: 'POST', body: coupon })).body.data
  const parent = randomUUID(), component = randomUUID(), category = randomUUID()
  await fixture.db.query(`insert into products(id,name,commerce_kind) values($1,'Pack','tester_pack'),($2,'Tester','tester')`, [parent, component])
  await fixture.db.query('insert into categories(id,name) values($1,$2)', [category, 'Tester packs'])
  await fixture.db.query('insert into coupon_products(coupon_id,product_id) values($1,$2)', [created.id, parent])
  await fixture.db.query('insert into coupon_categories(coupon_id,category_id) values($1,$2)', [created.id, category])
  const order = (await fixture.db.query(`insert into orders(order_number,customer_id,customer_name,customer_email,shipping_address,shipping_city,payment_method,total) values('RF-C',$1,'Customer','private@example.com','Address','Lahore','Cash on Delivery',2900) returning id`, [customer])).rows[0]
  await fixture.db.query('insert into coupon_redemptions(coupon_id,order_id,customer_id,customer_email,discount_amount) values($1,$2,$3,$4,290)', [created.id, order.id, customer, 'private@example.com'])
  await fixture.db.query('update coupons set used_count=1 where id=$1', [created.id])
  const before = (await fixture.db.query('select to_jsonb(r) as row from coupon_redemptions r')).rows
  const current = (await request(api, `/coupons/${created.id}`)).body.data
  assert.deepEqual(current.productIds, [parent]); assert.deepEqual(current.categoryIds, [category])
  assert.doesNotMatch(JSON.stringify(current.redemptions), /private@example.com|customer_id|order_id/)
  const changed = await request(api, `/coupons/${created.id}`, { method: 'PUT', body: { ...configure(current), status: 'Active', discountValue: 20 } })
  assert.equal(changed.status, 200, JSON.stringify(changed.body)); assert.equal(changed.body.data.usedCount, 1)
  assert.deepEqual((await fixture.db.query('select to_jsonb(r) as row from coupon_redemptions r')).rows, before)
  assert.deepEqual((await request(api, `/coupons/${created.id}`)).body.data.productIds, [parent])
  assert.equal((await fixture.db.query('select sum(stock_quantity) as stock from products')).rows[0].stock, 24)
  assert.equal((await request(api, `/coupons/${created.id}`, { method: 'PUT', body: configure(current) })).status, 409)
  assert.equal((await request(api, `/coupons/${created.id}`, { method: 'DELETE' })).status, 404)
})
test('coupon updates reject readonly fields and limits below usage without resetting counters', async t => {
  const api = await start(t), row = (await request(api, '/coupons', { method: 'POST', body: coupon })).body.data
  await fixture.db.query('update coupons set used_count=5 where id=$1', [row.id])
  const current = (await request(api, `/coupons/${row.id}`)).body.data
  for (const patch of [{ usageLimit: 4 }, { usedCount: 0 }, { code: 'NEWCODE' }, { type: 'Fixed Amount' }, { productIds: [] }]) assert.equal((await request(api, `/coupons/${row.id}`, { method: 'PUT', body: { ...configure(current), ...patch } })).status, 400)
  assert.equal((await request(api, `/coupons/${row.id}`)).body.data.usedCount, 5)
})
test('mutations require domain permission, CSRF and Origin; byte limits and malformed JSON have safe errors', async t => {
  const api = await start(t)
  for (const [route, body] of [['/coupons', coupon], ['/seo/contact', seo]]) {
    const method = route.startsWith('/seo') ? 'PUT' : 'POST'
    assert.equal((await request(api, `${route}?unexpected=1`, { method, body })).status, 400)
    for (const options of [{ actor: 'denied' }, { csrf: false }, { requestOrigin: null }, { requestOrigin: 'https://evil.invalid' }]) assert.equal((await request(api, route, { method, body, ...options })).status, 403)
    assert.equal((await request(api, route, { method, raw: '{"private":' })).status, 400)
    assert.equal((await request(api, route, { method, body: { ...body, oversized: 'x'.repeat(17000) } })).status, 413)
  }
})
test('SEO create/update uses approved static routes, persists audit and preserves intentional robots/active state', async t => {
  const api = await start(t), first = await request(api, '/seo/contact', { actor: 'seo', method: 'PUT', body: seo })
  assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(first.body.data.robots, 'index,follow')
  await fixture.db.query("update seo_settings set robots='noindex,follow',active=false where id=$1", [first.body.data.id])
  const current = (await request(api, '/seo', { actor: 'seo' })).body.data[0]
  const changed = await request(api, '/seo/contact', { method: 'PUT', body: { ...seo, title: 'Updated title', expectedUpdatedAt: current.updatedAt } })
  assert.equal(changed.status, 200); assert.equal(changed.body.data.robots, 'noindex,follow'); assert.equal(changed.body.data.active, false)
  assert.equal((await request(api, '/seo/contact', { method: 'PUT', body: { ...seo, expectedUpdatedAt: current.updatedAt } })).status, 409)
  assert.equal((await fixture.db.query("select count(*) from admin_audit_logs where permission_key='seo.manage'")).rows[0].count, 2)
  assert.deepEqual(api.logs, [])
})
test('SEO rejects unsafe URLs, HTML, indexing changes, query injection and Sanity-owned route writes', async t => {
  const api = await start(t)
  for (const patch of [{ title: '<script>bad</script>' }, { canonicalUrl: 'javascript:alert(1)' }, { canonicalUrl: 'https://evil.invalid/contact' },
    { canonicalUrl: `${origin}/about` }, { canonicalUrl: `${origin}/contact?x=1` }, { ogImage: 'http://images.invalid/image.png' }, { robots: 'noindex,nofollow' }, { active: false }, { routePath: '/blogs' }]) assert.equal((await request(api, '/seo/contact', { method: 'PUT', body: { ...seo, ...patch } })).status, 400)
  assert.equal((await request(api, '/seo/blogs', { method: 'PUT', body: seo })).status, 400)
  assert.equal((await request(api, '/seo?unknown=1')).status, 400)
  assert.equal((await fixture.db.query('select count(*) from seo_settings')).rows[0].count, 0)
})
test('transport failures are safe and no service secrets or private database errors reach responses', async t => {
  const api = await start(t, { from() { throw Error('private password refresh_token database secret') } })
  for (const route of ['/customers', '/coupons', '/seo']) {
    const r = await request(api, route); assert.equal(r.status, 503); assert.doesNotMatch(JSON.stringify(r.body), /password|refresh_token|database secret/)
  }
})

test('coupon details preserve legacy-only and mixed restriction IDs through configuration updates', async t => {
  const api = await start(t), created = (await request(api, '/coupons', { method: 'POST', body: coupon })).body.data
  const historicalProducts = [randomUUID(), randomUUID()], historicalCategories = [randomUUID()]
  await fixture.db.query('update coupons set applicable_product_ids=$2,applicable_category_ids=$3 where id=$1', [created.id, historicalProducts, historicalCategories])
  let row = (await request(api, `/coupons/${created.id}`)).body.data
  assert.deepEqual(row.productIds, []); assert.deepEqual(row.categoryIds, [])
  assert.deepEqual(row.legacyProductIds, historicalProducts); assert.deepEqual(row.legacyCategoryIds, historicalCategories)
  const product = randomUUID(), category = randomUUID()
  await fixture.db.query("insert into products(id,name,commerce_kind) values($1,'Modern parent','standard')", [product])
  await fixture.db.query("insert into categories(id,name) values($1,'Modern category')", [category])
  await fixture.db.query('insert into coupon_products(coupon_id,product_id) values($1,$2)', [created.id, product])
  await fixture.db.query('insert into coupon_categories(coupon_id,category_id) values($1,$2)', [created.id, category])
  row = (await request(api, `/coupons/${created.id}`)).body.data
  assert.deepEqual(row.productIds, [product]); assert.deepEqual(row.categoryIds, [category])
  assert.equal((await request(api, `/coupons/${created.id}`, { method: 'PUT', body: { ...configure(row), description: 'Display correction preserves restrictions' } })).status, 200)
  const after = (await request(api, `/coupons/${created.id}`)).body.data
  assert.deepEqual(after.legacyProductIds, historicalProducts); assert.deepEqual(after.legacyCategoryIds, historicalCategories)
  assert.deepEqual(after.productIds, [product]); assert.deepEqual(after.categoryIds, [category])
  assert.equal(after.usedCount, 0); assert.equal((await fixture.db.query('select count(*) from coupon_redemptions')).rows[0].count, 0)
})
