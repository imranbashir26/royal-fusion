import assert from 'node:assert/strict'
import test from 'node:test'
import {pageFixture, origin} from './support/variantBrowserHarness.mjs'
import {updateProductSchema} from '../../backend/server/schemas/productAdmin.js'
import {updatePackSchema} from '../../backend/server/schemas/testerCatalog.js'

// Actual React routes, authentication client and H2 controller; HTTP persistence
// below is a controlled fixture, not PostgreSQL transaction/integration evidence.
const admin = () => ({session: {authenticated: true, csrfToken: 'fixture-csrf', identity: {id: 'actor', email: 'admin@example.invalid', emailVerified: true}, administrator: {userId: 'actor', name: 'Operator', role: 'Admin', roleKey: 'admin', permissions: ['*']}}})
const id = n => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`
const start = '2099-01-01T05:00:00.123456+05:00', end = '2099-02-01T00:00:00.654321Z'
const snapshot = (regularPrice = 2900) => ({regularPrice, salePrice: null, saleStartsAt: null, saleEndsAt: null, effectivePrice: regularPrice, saleActive: false, pricingAt: '2026-10-16T00:00:00Z', validUntil: null})
function product(n, {count = 1, tester = false} = {}) {
  return {id: id(n * 100), name: `Perfume ${n}`, slug: `perfume-${n}`, commerceKind: tester ? 'tester' : 'standard', catalogRevision: '7', testerAvailable: false, categoryId: null, category: '', image: '/favicon.svg', gallery: [], price: 2900, stockQuantity: 12, sku: `P${n}`, status: 'Draft', variants: Array.from({length: count}, (_, i) => ({...snapshot(), id: id(n * 100 + i + 1), productId: id(n * 100), optionName: 'Size', optionValue: tester ? '5 ml' : `${50 + i * 50} ml`, sku: `SKU-${n}-${i}`, stockQuantity: i + 12, active: true, available: false, standardManualAvailable: false, displayOrder: i}))}
}
function pack(n, mode = 'fixed') {
  return {...snapshot(450), id: id(50000 + n * 100), name: `Pack ${n}`, slug: `pack-${n}`, commerceKind: 'tester_pack', mode, catalogRevision: '8', definitionRevision: '9', sku: `PACK-${n}`, image: '/favicon.svg', gallery: [], description: '', shortDescription: '', scentFamily: 'Discovery', categoryId: null, status: 'Draft', active: false, minimumUnits: null, maximumUnits: null, fixedRegularPrice: 450, fixedSalePrice: null, fixedSaleStartsAt: null, fixedSaleEndsAt: null, manualAvailable: false, available: false, availablePackCount: 0, components: [{testerVariantId: id(9001), quantityPerPack: 2, displayOrder: 0}], allowedVariants: [], diagnostics: {structurallyComplete: true, hiddenOrInactiveCount: 0}}
}
async function fixture(t, {products = [product(1), product(2)], packs = [pack(3), pack(4, 'configurable')], capability = true, onWrite, onDetailRead, list, permissions = ['*']} = {}) {
  const authentication = admin(); authentication.session.administrator.permissions = permissions
  const {page} = await pageFixture(t, {admin: authentication}), writes = [], reads = []
  const data = new Map([...products, ...packs].map(p => [p.id, structuredClone(p)]))
  const settings = {capability}
  const apply = (target, body) => {
    if (body.variants) target.variants = target.variants.map(v => ({...v, ...body.variants.find(x => x.id === v.id)}))
    else Object.assign(target, body.definition)
    target.catalogRevision = String(BigInt(target.catalogRevision) + 1n)
    if (body.definition) target.definitionRevision = String(BigInt(target.definitionRevision) + 1n)
  }
  const handle = async route => {
    const request = route.request(), url = new URL(request.url()), last = url.pathname.split('/').at(-1)
    if (last === 'sale-capabilities') return route.fulfill({json: {data: {scheduledSaleWrites: settings.capability}}})
    if (['PUT', 'PATCH'].includes(request.method())) {
      const body = request.postDataJSON(), target = data.get(last)
      assert(target, 'Mutation must address an existing canonical parent')
      assert.equal(request.headers()['x-rf-csrf'], 'fixture-csrf')
      assert.match(request.headers()['x-request-id'], /^bulk_[a-z0-9-]+$/)
      const parsed = (request.method() === 'PUT' ? updateProductSchema : updatePackSchema).safeParse(body)
      assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues))
      writes.push({id: last, body, method: request.method()})
      const special = await onWrite?.({route, target, body, apply, writes})
      if (special) return
      apply(target, body)
      return route.fulfill({json: {data: target}})
    }
    reads.push(last)
    if (last === 'tester-options') return route.fulfill({json: {data: []}})
    if (data.has(last)) {
      const detail = data.get(last)
      onDetailRead?.(request, detail)
      return route.fulfill({json: {data: detail}})
    }
    if (url.pathname.includes('tester-packs')) return route.fulfill({json: {data: {items: packs, totalPages: 1}}})
    return route.fulfill({json: {data: list ? list(url) : {items: products, page: 1, pageSize: 25, total: products.length, totalPages: 1}}})
  }
  await page.route('**/api/v1/admin/products**', handle)
  await page.route('**/api/v2/admin/tester-packs**', handle)
  await page.route('**/api/v1/admin/categories**', route => route.fulfill({json: {data: {items: []}}}))
  return {page, writes, data, reads, settings, products, packs}
}
const editor = page => page.getByRole('region', {name: 'Bulk fixed sale administration'})
const row = (page, name, option = 'Size: 50 ml') => page.getByRole('article', {name: `Sale row ${name} ${option}`, exact: true})
async function open(page, scope = 'products') {
  await page.goto(`${origin}/admin/${scope === 'products' ? 'products' : 'tester-packs'}`)
  await page.getByRole('button', {name: 'Bulk fixed sales', exact: true}).click()
}
async function select(page, name, option = 'Size: 50 ml') {
  await editor(page).getByRole('button', {name: `Choose ${name}`, exact: true}).click()
  await editor(page).getByRole('button', {name: `Add ${name} ${option}`, exact: true}).click()
}
async function amount(page, name, value, option) {await row(page, name, option).getByLabel('Fixed sale amount (PKR)', {exact: true}).fill(value)}
async function review(page) {await editor(page).getByRole('button', {name: 'Review changes', exact: true}).click(); await page.getByRole('region', {name: 'Confirm bulk review'}).waitFor()}
async function submit(page) {await review(page); await page.getByRole('button', {name: 'Confirm and save reviewed changes', exact: true}).click()}
const results = page => page.getByRole('region', {name: 'Bulk submission results'})
async function finished(page, text) {await results(page).getByRole('heading', {name: text, exact: true}).waitFor()}

test('Single, multi-variant and tester selection; independent exact amounts/windows; review invalidation and canonical serialized preservation', {timeout: 90000}, async t => {
  const products = [product(1, {count: 2}), product(2, {tester: true})], f = await fixture(t, {products}), {page, writes} = f
  await open(page)
  await page.getByRole('button', {name: 'Choose Perfume 1', exact: true}).click()
  assert.equal(await editor(page).getByRole('article').count(), 0, 'Loading a multi-variant product must select nothing')
  await page.getByRole('button', {name: 'Add Perfume 1 Size: 100 ml', exact: true}).click()
  await select(page, 'Perfume 2', 'Size: 5 ml')
  await amount(page, 'Perfume 1', '2400.75', 'Size: 100 ml'); await amount(page, 'Perfume 2', '1700.25', 'Size: 5 ml')
  await row(page, 'Perfume 1', 'Size: 100 ml').getByLabel('Sale start (inclusive, ISO offset)').fill(start)
  await row(page, 'Perfume 1', 'Size: 100 ml').getByLabel('Sale end (exclusive, ISO offset)').fill(end)
  const otherEnd = '2099-03-01T05:00:00.999999+05:00'
  await row(page, 'Perfume 2', 'Size: 5 ml').getByLabel('Sale end (exclusive, ISO offset)').fill(otherEnd)
  await review(page)
  assert.match(await page.getByRole('region', {name: 'Confirm bulk review'}).innerText(), /2 rows · 2 product groups · 0 fixed-pack groups/)
  await amount(page, 'Perfume 1', '2399.25', 'Size: 100 ml')
  assert.equal(await page.getByRole('button', {name: 'Confirm and save reviewed changes', exact: true}).count(), 0)
  assert.equal(writes.length, 0)
  await submit(page); await finished(page, 'All groups saved')
  assert.equal(writes.length, 2)
  const standard = writes[0].body, v = standard.variants[0], original = products[0].variants[1]
  assert.equal(standard.expectedRevision, '7'); assert.equal(standard.variants.length, 1)
  for (const k of ['id', 'optionName', 'optionValue', 'sku', 'regularPrice', 'stockQuantity', 'active', 'displayOrder', 'standardManualAvailable']) assert.equal(v[k], original[k], k)
  assert.equal('available' in v, false); assert.equal('effectivePrice' in v, false)
  assert.deepEqual([v.salePrice, v.saleStartsAt, v.saleEndsAt], [2399.25, start, end])
  assert.equal(writes[1].body.variants[0].available, false)
  assert.equal(writes[1].body.variants[0].saleEndsAt, otherEnd)
  assert.equal(writes[1].body.variants[0].salePrice, 1700.25)
})

test('Fixed pack uses separate parent/definition revisions and independent prices; configurable parents excluded', {timeout: 90000}, async t => {
  const {page, writes, packs} = await fixture(t)
  await open(page, 'packs')
  assert.equal(await page.getByRole('button', {name: 'Choose Pack 4 (configurable: ineligible)', exact: true}).isDisabled(), true)
  await select(page, 'Pack 3', 'fixed pack')
  await amount(page, 'Pack 3', '390.25', `Fixed pack ${packs[0].id}`)
  await submit(page); await finished(page, 'All groups saved')
  assert.equal(writes.length, 1); assert.equal(writes[0].method, 'PATCH')
  assert.deepEqual(writes[0].body, {product: {}, definition: {fixedSalePrice: 390.25}, expectedRevision: '8', expectedDefinitionRevision: '9'})
})

test('Selection survives list pagination/filter changes; duplicates rejected and rows removable', {timeout: 90000}, async t => {
  const products = [product(1), product(2)], {page} = await fixture(t, {products, list: url => {const page = Number(url.searchParams.get('page')); return {items: [products[page - 1]], page, pageSize: 25, total: 2, totalPages: 2}}})
  await open(page); await select(page, 'Perfume 1')
  await page.getByRole('button', {name: 'Add Perfume 1 Size: 50 ml', exact: true}).click()
  await editor(page).getByRole('alert').filter({hasText: 'already selected'}).waitFor()
  await page.getByRole('button', {name: 'Next', exact: true}).click()
  await select(page, 'Perfume 2')
  assert.equal(await editor(page).getByRole('article').count(), 2)
  await page.getByPlaceholder('Search products...').fill('Perfume')
  await page.getByRole('button', {name: 'Choose Perfume 1', exact: true}).waitFor()
  assert.equal(await editor(page).getByRole('article').count(), 2)
  await row(page, 'Perfume 1').getByRole('button', {name: 'Remove row', exact: true}).click()
  assert.equal(await editor(page).getByRole('article').count(), 1)
})

test('Selection cap is enforced at exactly 50 canonical rows', {timeout: 120000}, async t => {
  const {page} = await fixture(t, {products: [product(1, {count: 51})]})
  await open(page); await page.getByRole('button', {name: 'Choose Perfume 1', exact: true}).click()
  for (let i = 0; i < 50; i++) await page.getByRole('button', {name: `Add Perfume 1 Size: ${50 + i * 50} ml`, exact: true}).click()
  await page.getByRole('button', {name: 'Add Perfume 1 Size: 2550 ml', exact: true}).click()
  await editor(page).getByRole('alert').filter({hasText: 'Maximum 50 rows'}).waitFor()
  assert.equal(await editor(page).getByRole('article').count(), 50)
})

test('Raw money and offset/window validation reject invalid inputs without sending writes', {timeout: 90000}, async t => {
  const {page, writes} = await fixture(t)
  await open(page); await select(page, 'Perfume 1')
  for (const invalid of ['1e2', '10%', '0', '-1', '2400.001', '2900', '99999999999']) {
    await amount(page, 'Perfume 1', invalid)
    assert.equal(await page.getByRole('button', {name: 'Review changes', exact: true}).isDisabled(), true, invalid)
  }
  await amount(page, 'Perfume 1', '2400.25')
  await row(page, 'Perfume 1').getByLabel('Sale start (inclusive, ISO offset)').fill('2099-01-01T00:00:00')
  assert.equal(await page.getByRole('button', {name: 'Review changes', exact: true}).isDisabled(), true)
  await row(page, 'Perfume 1').getByLabel('Sale start (inclusive, ISO offset)').fill(start)
  await row(page, 'Perfume 1').getByLabel('Sale end (exclusive, ISO offset)').fill('2000-01-01T00:00:00Z')
  await row(page, 'Perfume 1').getByRole('alert').filter({hasText: 'Sale end must be after sale start.'}).waitFor()
  assert.equal(writes.length, 0)
})

test('Disabled capability allows immediate sales and atomic clearing, while protecting existing scheduled amounts', {timeout: 90000}, async t => {
  const products = [product(1), product(2)]
  Object.assign(products[1].variants[0], {salePrice: 2500.25, saleStartsAt: start, saleEndsAt: end, validUntil: start})
  const {page, writes} = await fixture(t, {products, capability: false})
  await open(page); await select(page, 'Perfume 1'); await select(page, 'Perfume 2')
  await amount(page, 'Perfume 1', '2450.25')
  assert.equal(await row(page, 'Perfume 2').getByLabel('Fixed sale amount (PKR)').isDisabled(), true)
  assert.equal(await row(page, 'Perfume 1').getByLabel('Sale start (inclusive, ISO offset)').isDisabled(), true)
  await row(page, 'Perfume 2').getByRole('button', {name: 'Clear sale', exact: true}).click()
  await submit(page); await finished(page, 'All groups saved')
  const v = writes[1].body.variants[0]
  assert.deepEqual([v.salePrice, v.saleStartsAt, v.saleEndsAt], [null, null, null])
  assert.equal('saleStartsAt' in writes[0].body.variants[0], false)
})

for (const [status, code, paused] of [[422, 'INVALID_PRODUCT', false], [409, 'CATALOG_STALE', false], [401, 'AUTH_REQUIRED', true], [403, 'PERMISSION_DENIED', true], [429, 'RATE_LIMITED', true], [409, 'SALE_SCHEDULING_DISABLED', true], [503, 'SALE_SCHEDULING_UNAVAILABLE', true]]) {
  test(`Actual controller renders ${status}/${code}; independent outcomes and pause behavior`, {timeout: 90000}, async t => {
    const {page, writes} = await fixture(t, {products: [product(1), product(2), product(3)], onWrite: async ({route, writes}) => {
      if (writes.length === 2) {await route.fulfill({status, json: {error: {code, message: 'Fixture rejection'}}}); return true}
    }})
    await open(page)
    for (let i = 1; i <= 3; i++) {await select(page, `Perfume ${i}`); await amount(page, `Perfume ${i}`, '2400.25')}
    await submit(page)
    await finished(page, paused ? 'Submissions paused' : 'Submission finished with individual outcomes')
    assert.equal(writes.length, paused ? 2 : 3)
    assert.match(await row(page, 'Perfume 1').innerText(), /Row result: Saved/)
    assert.match(await row(page, 'Perfume 2').innerText(), code === 'CATALOG_STALE' ? /Row result: Stale revision/ : /Row result: Rejected/)
    assert.match(await row(page, 'Perfume 3').innerText(), paused ? /Row result: Not attempted/ : /Row result: Saved/)
    assert.equal(await results(page).getByText('All groups saved', {exact: true}).count(), 0)
    if (paused) {
      await page.getByRole('button', {name: 'Explicitly resume not-attempted groups', exact: true}).click()
      await finished(page, 'Submission finished with individual outcomes')
      assert.equal(writes.length, 3); assert.equal(writes[2].id, id(300))
    }
  })
}

test('Scheduling capability lost after review prevents protected mutation and pauses remaining groups', {timeout: 90000}, async t => {
  const {page, writes, settings} = await fixture(t)
  await open(page); await select(page, 'Perfume 1'); await amount(page, 'Perfume 1', '2400.25')
  await row(page, 'Perfume 1').getByLabel('Sale start (inclusive, ISO offset)').fill(start)
  await review(page); settings.capability = false
  await page.getByRole('button', {name: 'Confirm and save reviewed changes', exact: true}).click()
  await finished(page, 'Submissions paused')
  assert.equal(writes.length, 0); assert.match(await results(page).innerText(), /SALE_SCHEDULING_DISABLED/)
})

for (const mode of ['matches', 'unchanged', 'conflict']) {
  test(`Uncertain write reconciliation: ${mode}; explicit retry requires original revisions and no automatic replay`, {timeout: 90000}, async t => {
    const {page, writes} = await fixture(t, {onWrite: async ({route, target, body, apply, writes}) => {
      if (writes.length !== 1) return false
      if (mode === 'matches') apply(target, body)
      if (mode === 'conflict') {target.catalogRevision = '9'; target.variants[0].salePrice = 2600.25}
      await route.fulfill({status: 503, json: {error: {code: 'RESPONSE_LOST', message: 'Unknown outcome'}}}); return true
    }})
    await open(page); await select(page, 'Perfume 1'); await select(page, 'Perfume 2')
    await amount(page, 'Perfume 1', '2400.25'); await amount(page, 'Perfume 2', '2300.75')
    await submit(page); await finished(page, 'Submissions paused')
    assert.equal(writes.length, 1)
    assert.equal(await page.getByRole('button', {name: 'Retry unchanged captured revision', exact: true}).count(), 0)
    assert.equal(await page.getByRole('button', {name: 'Refresh remaining rows for a new review', exact: true}).isDisabled(), true)
    assert.equal(await page.getByRole('button', {name: 'Explicitly resume not-attempted groups', exact: true}).isDisabled(), true)
    await page.getByRole('button', {name: 'Reconcile current state', exact: true}).click()
    if (mode === 'matches') {
      await results(page).getByText('Current state matches; original response unconfirmed.', {exact: true}).waitFor()
      await page.getByRole('button', {name: 'Explicitly resume not-attempted groups', exact: true}).click()
      await finished(page, 'Submission finished with individual outcomes')
      assert.equal(writes.length, 2); assert.match(await row(page, 'Perfume 1').innerText(), /Row result: Uncertain/)
    } else if (mode === 'unchanged') {
      await page.getByRole('button', {name: 'Retry unchanged captured revision', exact: true}).click()
      await row(page, 'Perfume 1').getByText('Row result: Saved', {exact: true}).waitFor()
      assert.equal(writes.length, 2); assert.deepEqual(writes[1].body, writes[0].body)
      await page.getByRole('button', {name: 'Explicitly resume not-attempted groups', exact: true}).click()
      await finished(page, 'All groups saved'); assert.equal(writes.length, 3)
    } else {
      await results(page).getByText(/Catalog changed. Load a fresh snapshot/).waitFor()
      assert.equal(await page.getByRole('button', {name: 'Retry unchanged captured revision', exact: true}).count(), 0)
      assert.equal(writes.length, 1)
      await page.getByRole('button', {name: 'Refresh remaining rows for a new review', exact: true}).click()
      await row(page, 'Perfume 1').getByText('Catalog revision 9', {exact: true}).waitFor()
      assert.equal(writes.length, 1, 'Fresh revision read must not silently resubmit')
      assert.equal(await page.getByRole('button', {name: 'Confirm and save reviewed changes', exact: true}).count(), 0)
      await submit(page); await finished(page, 'All groups saved')
      assert.equal(writes[1].body.expectedRevision, '9'); assert.equal(writes.length, 3)
    }
  })
}

test('Pending navigation retains uncertain/pending records, ignores delayed response and requires reconciliation', {timeout: 90000}, async t => {
  let release, started
  const gate = new Promise(resolve => {release = resolve}), dispatched = new Promise(resolve => {started = resolve})
  const {page, writes} = await fixture(t, {onWrite: async ({route, target, body, apply}) => {
    started(); await gate; apply(target, body)
    await route.fulfill({json: {data: target}}).catch(() => {}); return true
  }})
  try {
    await open(page); await select(page, 'Perfume 1'); await select(page, 'Perfume 2')
    await amount(page, 'Perfume 1', '2400.25'); await amount(page, 'Perfume 2', '2300.75')
    await submit(page); await dispatched
    page.once('dialog', dialog => dialog.dismiss())
    await page.getByRole('navigation', {name: 'Admin navigation'}).getByRole('link', {name: 'Tester Packs', exact: true}).click()
    assert.match(page.url(), /\/admin\/products$/)
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('navigation', {name: 'Admin navigation'}).getByRole('link', {name: 'Tester Packs', exact: true}).click()
    await page.getByRole('heading', {name: 'Tester Packs', exact: true}).waitFor()
    assert.equal(await page.evaluate(() => {const event = new Event('beforeunload', {cancelable: true}); window.dispatchEvent(event); return event.defaultPrevented}), true, 'Unload protection persists on the destination route')
    release()
    await page.goBack()
    await row(page, 'Perfume 1').waitFor()
    assert.match(await row(page, 'Perfume 1').innerText(), /Row result: Uncertain/)
    assert.match(await row(page, 'Perfume 2').innerText(), /Row result: Not attempted/)
    assert.equal(writes.length, 1)
    await page.getByRole('button', {name: 'Reconcile current state', exact: true}).click()
    await results(page).getByText('Current state matches; original response unconfirmed.', {exact: true}).waitFor()
  } finally {release()}
})

test('Keyboard review and mobile controls remain accessible without clipped editor controls', {timeout: 90000}, async t => {
  const {page} = await fixture(t)
  await open(page); await select(page, 'Perfume 1')
  await page.setViewportSize({width: 390, height: 844})
  const amountInput = row(page, 'Perfume 1').getByLabel('Fixed sale amount (PKR)')
  await amountInput.focus(); await page.keyboard.type('2400.25'); await page.keyboard.press('Tab')
  assert.equal(await row(page, 'Perfume 1').getByLabel('Sale start (inclusive, ISO offset)').evaluate(el => el === document.activeElement), true)
  const button = page.getByRole('button', {name: 'Review changes', exact: true})
  await button.focus(); await page.keyboard.press('Enter')
  await page.getByRole('region', {name: 'Confirm bulk review'}).waitFor()
  for (const control of await editor(page).locator('input,button').all()) {
    if (!await control.isVisible()) continue
    const box = await control.boundingBox()
    assert(box.x >= 0 && box.x + box.width <= 391, `Control clipped: ${await control.innerText()}`)
  }
  if (process.env.ROYAL_FUSION_BULK_SCREENSHOT) await page.screenshot({path: process.env.ROYAL_FUSION_BULK_SCREENSHOT, fullPage: true})
})

test('Expired pricing refreshes through detail API; failed refresh hides effective snapshot and never derives a new price', {timeout: 90000}, async t => {
  const products = [product(1)]
  Object.assign(products[0].variants[0], {salePrice: 2400.25, effectivePrice: 2400.25, saleActive: true, saleEndsAt: '2026-10-16T00:00:02Z', validUntil: '2026-10-16T00:00:02Z'})
  const {page, reads} = await fixture(t, {products})
  await open(page); await select(page, 'Perfume 1')
  await page.route(`**/api/v1/admin/products/${products[0].id}`, route => route.fulfill({status: 503, json: {error: {code: 'UNAVAILABLE'}}}))
  await row(page, 'Perfume 1').getByText(/Effective at database snapshot: Refresh required/).waitFor({timeout: 10000})
  assert.equal(reads.filter(x => x === products[0].id).length, 1)
  assert.equal(await row(page, 'Perfume 1').getByText(/Effective at database snapshot: PKR/).count(), 0)
})

test('Two explicit sibling variants serialize one product group with independent amounts', {timeout: 90000}, async t => {
  const {page, writes} = await fixture(t, {products: [product(1, {count: 2})]})
  await open(page); await select(page, 'Perfume 1')
  await page.getByRole('button', {name: 'Add Perfume 1 Size: 100 ml', exact: true}).click()
  await amount(page, 'Perfume 1', '2300.25'); await amount(page, 'Perfume 1', '2100.75', 'Size: 100 ml')
  await submit(page); await finished(page, 'All groups saved')
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].body.variants.map(v => v.salePrice), [2300.25, 2100.75])
})

test('Multiple fixed packs retain distinct amounts/windows and do not serialize memberships', {timeout: 90000}, async t => {
  const packs = [pack(3), pack(4)], {page, writes} = await fixture(t, {packs})
  await open(page, 'packs')
  for (let i = 0; i < packs.length; i++) {
    await select(page, packs[i].name, 'fixed pack')
    const selected = row(page, packs[i].name, `Fixed pack ${packs[i].id}`)
    await selected.getByLabel('Fixed sale amount (PKR)').fill(i ? '350.75' : '390.25')
    await selected.getByLabel('Sale start (inclusive, ISO offset)').fill(i ? '2099-01-02T00:00:00Z' : start)
  }
  await submit(page); await finished(page, 'All groups saved')
  assert.equal(writes.length, 2)
  assert.deepEqual(writes.map(w => w.body.definition.fixedSalePrice), [390.25, 350.75])
  assert.deepEqual(writes.map(w => w.body.definition.fixedSaleStartsAt), [start, '2099-01-02T00:00:00Z'])
  for (const write of writes) assert.deepEqual(Object.keys(write.body.definition).sort(), ['fixedSalePrice', 'fixedSaleStartsAt'])
})

test('Malformed acknowledgement is uncertain; unavailable reconciliation blocks retry until an explicit successful read', {timeout: 90000}, async t => {
  const {page, writes} = await fixture(t, {onWrite: async ({route, writes}) => {
    if (writes.length === 1) {await route.fulfill({json: {data: {}}}); return true}
  }})
  await open(page); await select(page, 'Perfume 1'); await amount(page, 'Perfume 1', '2400.25')
  await submit(page); await finished(page, 'Submissions paused')
  const pattern = `**/api/v1/admin/products/${id(100)}`
  const unavailable = route => route.request().method() === 'GET' ? route.fulfill({status: 403, json: {error: {code: 'PERMISSION_DENIED'}}}) : route.fallback()
  await page.route(pattern, unavailable)
  await page.getByRole('button', {name: 'Reconcile current state', exact: true}).click()
  await results(page).getByText('Authoritative state is unavailable. Do not retry this write.', {exact: true}).waitFor()
  assert.equal(await page.getByRole('button', {name: 'Retry unchanged captured revision', exact: true}).count(), 0)
  assert.equal(writes.length, 1)
  await page.unroute(pattern, unavailable)
  await page.getByRole('button', {name: 'Reconcile current state', exact: true}).click()
  await page.getByRole('button', {name: 'Retry unchanged captured revision', exact: true}).click()
  await finished(page, 'All groups saved')
  assert.equal(writes.length, 2); assert.deepEqual(writes[0].body, writes[1].body)
})

test('Unsupported product kind and view-only authorization cannot enter the bulk mutation workflow', {timeout: 90000}, async t => {
  const p = product(1); p.commerceKind = 'unknown'
  const {page, writes} = await fixture(t, {products: [p]})
  await open(page); await page.getByRole('button', {name: 'Choose Perfume 1', exact: true}).click()
  await editor(page).getByRole('alert').filter({hasText: 'Only standard products and standalone testers'}).waitFor()
  assert.equal(await editor(page).getByRole('article').count(), 0); assert.equal(writes.length, 0)
  const readonly = await fixture(t, {permissions: ['products.read']})
  await readonly.page.goto(`${origin}/admin/products`)
  await readonly.page.getByRole('heading', {name: 'Products', exact: true}).waitFor()
  assert.equal(await readonly.page.getByRole('button', {name: 'Bulk fixed sales', exact: true}).count(), 0)
  assert.equal(readonly.writes.length, 0)
})

test('Server expiry refresh accepts authoritative effective price without replacing reviewed financial configuration', {timeout: 90000}, async t => {
  const products = [product(1)]
  Object.assign(products[0].variants[0], {salePrice: 2400.25, effectivePrice: 2400.25, saleActive: true, saleEndsAt: '2026-10-16T00:00:03Z', validUntil: '2026-10-16T00:00:03Z'})
  const started = performance.now(), detailEvents = [], byRequest = new WeakMap()
  let detailGetCount = 0
  const elapsed = () => Math.round(performance.now() - started)
  const isDetailGet = request => request.method() === 'GET' && new URL(request.url()).pathname === `/api/v1/admin/products/${products[0].id}`
  const record = request => {
    let event = byRequest.get(request)
    if (!event) {
      event = {number: ++detailGetCount, requestedMs: elapsed()}
      byRequest.set(request, event)
      if (detailEvents.length < 8) detailEvents.push(event)
    }
    return event
  }
  const expected = products[0].variants[0]
  const {page, data, reads} = await fixture(t, {products, onDetailRead: (request, detail) => {
    const variant = detail.variants?.find(v => v.id === expected.id)
    Object.assign(record(request), {
      handledMs: elapsed(), fixturePrice: variant?.effectivePrice ?? null,
      productIdentityMatches: detail.id === products[0].id,
      variantIdentityMatches: variant?.productId === products[0].id,
      revisionMatches: detail.catalogRevision === products[0].catalogRevision,
      reviewedConfigMatches: Boolean(variant && ['regularPrice', 'salePrice', 'saleStartsAt', 'saleEndsAt'].every(key => variant[key] === expected[key])),
    })
  }})
  page.on('request', request => {if (isDetailGet(request)) record(request)})
  page.on('response', response => {const event = byRequest.get(response.request()); if (event) {event.status = response.status(); event.respondedMs = elapsed()}})
  page.on('requestfinished', request => {const event = byRequest.get(request); if (event) event.finishedMs = elapsed()})
  page.on('requestfailed', request => {const event = byRequest.get(request); if (event) event.failedMs = elapsed()})
  try {
    await page.addInitScript(() => {Date.now = () => 4102444800000})
    await open(page)
    await editor(page).getByRole('button', {name: 'Choose Perfume 1', exact: true}).click()
    const add = editor(page).getByRole('button', {name: 'Add Perfume 1 Size: 50 ml', exact: true})
    await add.waitFor()
    assert.equal(reads.filter(x => x === products[0].id).length, 1, 'Initial selection must use the expiring sale snapshot')
    Object.assign(data.get(products[0].id).variants[0], {effectivePrice: 2900, saleActive: false, pricingAt: '2026-10-16T00:00:04Z', validUntil: null})
    await add.click()
    await row(page, 'Perfume 1').getByText(/Effective at database snapshot:.*2,900.00/).waitFor({timeout: 12000})
    assert.equal(reads.filter(x => x === products[0].id).length, 2)
    assert.equal(await row(page, 'Perfume 1').getByLabel('Fixed sale amount (PKR)').inputValue(), '2400.25')
    assert.equal(await row(page, 'Perfume 1').getByLabel('Sale end (exclusive, ISO offset)').inputValue(), '2026-10-16T00:00:03Z')
  } catch (error) {
    try {
      const saleRow = row(page, 'Perfume 1'), exists = await saleRow.count(), visible = exists > 0 && await saleRow.isVisible()
      const safe = value => String(value).replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<uuid>').replace(/[0-9a-f]{64}/gi, '<hex>').replace(/\S+@\S+/g, '<email>').replace(/\s+/g, ' ').slice(0, 320)
      const text = visible ? safe(await saleRow.innerText({timeout: 500})) : ''
      const alerts = (await editor(page).locator('[role="alert"]').allInnerTexts()).slice(0, 3).map(safe)
      t.diagnostic(`BULK_EXPIRY_FAILURE ${JSON.stringify({
        elapsedMs: elapsed(), detailGetCount, detailEvents, refreshCompletedBeforeFailure: Boolean(detailEvents[1]?.finishedMs),
        rowExists: exists > 0, rowVisible: visible, rowText: text, refreshRequired: text.includes('Refresh required'),
        expectedTextInRow: /Effective at database snapshot:.*2,900\.00/.test(text),
        locatorMatches: visible ? await saleRow.getByText(/Effective at database snapshot:.*2,900\.00/).count() : 0,
        alerts,
      })}`)
    } catch {t.diagnostic('BULK_EXPIRY_FAILURE diagnostic collection was unavailable')}
    throw error
  }
})

test('Mismatched authoritative parent identity fails selection instead of editing a different product', {timeout: 90000}, async t => {
  const {page, writes} = await fixture(t)
  await page.route(`**/api/v1/admin/products/${id(100)}`, route => route.fulfill({json: {data: product(2)}}))
  await open(page); await page.getByRole('button', {name: 'Choose Perfume 1', exact: true}).click()
  await editor(page).getByRole('alert').filter({hasText: 'Authoritative detail identity does not match'}).waitFor()
  assert.equal(await editor(page).getByRole('article').count(), 0)
  assert.equal(await page.getByRole('button', {name: /^Add Perfume/}).count(), 0)
  assert.equal(writes.length, 0)
})
