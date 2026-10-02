import assert from 'node:assert/strict'
import test from 'node:test'
import { pageFixture, origin } from './support/variantBrowserHarness.mjs'

const id = '90000000-0000-4000-8000-000000000001'
const variantId = 'b35b3be7-a7dd-4c70-9c14-d1a9394d4711'
function detail(overrides = {}) {
  return {
    id, orderNumber: 'RF-ADMIN-FIXTURE', customerName: 'Relational Customer', email: 'fixture@example.invalid', phone: '00000000000',
    createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', total: 6050, currency: 'PKR',
    paymentMethod: 'Cash on Delivery', paymentStatus: 'Unpaid', status: 'Pending', city: 'Karachi', province: 'Sindh',
    courier: '', trackingNumber: '', purchasedQuantity: 2, lineCount: 1, revision: '0', subtotal: 5800, discount: 0, shippingFee: 250,
    customer: { name: 'Relational Customer', email: 'fixture@example.invalid', phone: '00000000000', profileId: null, profileStatus: null },
    shipping: { address: 'Fictional Address', city: 'Karachi', province: 'Sindh', customerNotes: 'Customer shipping note' },
    items: [{ id: 'item', productId: '45852db8-8b83-425e-8d1f-4112958ed505', variantId, name: 'Baraan Snapshot', size: '50 ml', sku: 'RF-BAR-001', quantity: 2, unitPrice: 2900, lineTotal: 5800 }],
    paymentsVisible: true, canonicalPaymentId: 'payment', payments: [{ id: 'payment', provider: 'Cash on Delivery', amount: 6050, currency: 'PKR', status: 'Unpaid', reference: '', processedAt: null, createdAt: '2026-10-02T00:00:00Z' }],
    notes: [], history: [], inventory: [{ id: 'movement', variantId, quantityDelta: -2, balanceAfter: 10, reason: 'Order placed', text: '', actor: null, createdAt: '2026-10-02T00:00:00Z' }], audit: [], ...overrides,
  }
}
function adminFixture(overrides = {}, permissions = ['*']) {
  const admin = {
    order: detail(overrides), writes: [], reads: [], paths: [], mode: '', lost: false,
    session: { authenticated: true, identity: { id: 'actor', email: 'admin@example.invalid', emailVerified: true }, csrfToken: 'fixture-csrf', administrator: { userId: 'actor', name: 'Operator', role: 'Owner', roleKey: 'owner', permissions } },
    async handle(route, url) {
      const request = route.request()
      if (request.method() === 'GET') {
        admin.reads.push(url.search)
        if (admin.pending) await admin.pending
        if (admin.mode === 'read-error') return route.fulfill({ status: 503, json: { error: { code: 'ADMIN_ORDER_UNAVAILABLE', message: 'The order service is unavailable.' } } })
        if (url.pathname.endsWith('/orders')) {
          const page = Number(url.searchParams.get('page') || 1)
          return route.fulfill({ json: { data: { items: [{ ...admin.order, orderNumber: page === 1 ? 'RF-PAGE-ONE' : 'RF-PAGE-TWO' }], page, pageSize: 25, total: 26, totalPages: 2 } } })
        }
        return route.fulfill({ json: { data: admin.order } })
      }
      const body = request.postDataJSON(), action = url.pathname.split('/').at(-1)
      admin.writes.push({ action, body, csrf: request.headers()['x-rf-csrf'] })
      if (admin.mode === 'stale') {
        admin.order = { ...admin.order, revision: '7', status: 'Processing' }
        admin.mode = ''
        return route.fulfill({ status: 409, json: { error: { code: 'ORDER_STALE', message: 'This order changed. Refresh before continuing.' } } })
      }
      if (admin.pendingWrite) await admin.pendingWrite
      const previous = admin.writes.slice(0, -1).find(w => w.body.mutationId === body.mutationId)
      if (!previous) {
        const trackingCorrection = action === 'fulfillment' && admin.order.status === 'Shipped' ? {
          kind: 'tracking_correction', reason: body.reason,
          previous: { courier: admin.order.courier, trackingNumber: admin.order.trackingNumber },
          next: { courier: body.courier, trackingNumber: body.trackingNumber },
        } : null
        admin.order = { ...admin.order, revision: String(Number(admin.order.revision) + 1) }
        if (action === 'status') {
          admin.order.status = body.status
          if (body.courier) { admin.order.courier = body.courier; admin.order.trackingNumber = body.trackingNumber }
        } else if (action === 'payment') { admin.order.paymentStatus = 'Paid'; admin.order.payments[0].status = 'Paid' }
        else if (action === 'cancel') admin.order.status = 'Cancelled'
        else if (action === 'fulfillment') { admin.order.courier = body.courier; admin.order.trackingNumber = body.trackingNumber }
        else if (action === 'notes') admin.order.notes = [{ id: body.mutationId, text: body.text, actor: 'actor', createdAt: '2026-10-02T00:00:00Z' }]
        admin.order.audit = [{ id: body.mutationId, actor: 'actor', action: `order.${action}`, permission: 'orders.manage', requestId: 'req_browser_fixture', createdAt: '2026-10-02T00:00:00Z', trackingCorrection }]
      }
      if (admin.mode === 'lost-response' && !admin.lost) { admin.lost = true; return route.abort() }
      return route.fulfill({ json: { data: { id, revision: admin.order.revision, status: admin.order.status, paymentStatus: admin.order.paymentStatus, changed: !previous, replayed: Boolean(previous), refundRequired: false } } })
    },
  }
  return admin
}
async function setup(t, admin, path = `/admin/orders/${id}`) {
  const { page } = await pageFixture(t, { admin })
  page.setDefaultTimeout(15000)
  t.after(() => assert.equal(admin.paths.some(path => path.startsWith('/api/admin/')), false, 'No prototype fallback'))
  await page.goto(`${origin}${path}`)
  return page
}

test('rendered list paginates server data and sends bounded filters/search', async t => {
  const admin = adminFixture(), page = await setup(t, admin, '/admin/orders')
  await page.getByRole('link', { name: 'RF-PAGE-ONE' }).waitFor()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('link', { name: 'RF-PAGE-TWO' }).waitFor()
  assert.equal(new URLSearchParams(admin.reads.at(-1)).get('page'), '2')
  await page.getByLabel('Search orders').fill('Baraan')
  await page.getByLabel('Order status', { exact: true }).selectOption('Confirmed')
  await page.getByLabel('Payment status', { exact: true }).selectOption('Pending')
  await page.getByLabel('Payment method', { exact: true }).selectOption('Bank Transfer')
  await page.waitForFunction(() => document.querySelector('table')?.textContent.includes('RF-PAGE-ONE'))
  const q = new URLSearchParams(admin.reads.at(-1))
  assert.equal(q.get('page'), '1'); assert.equal(q.get('pageSize'), '25'); assert.equal(q.get('search'), 'Baraan')
  assert.equal(q.get('status'), 'Confirmed'); assert.equal(q.get('paymentStatus'), 'Pending'); assert.equal(q.get('paymentMethod'), 'Bank Transfer')
})
test('list/detail loading, safe errors and role gating are rendered', async t => {
  const admin = adminFixture(); let release
  admin.pending = new Promise(r => { release = r })
  const page = await setup(t, admin, '/admin/orders')
  await page.getByText('Loading orders...', { exact: true }).waitFor()
  admin.mode = 'read-error'; release()
  await page.getByText('The order service is unavailable.', { exact: true }).waitFor()
  admin.pending = null; admin.mode = ''
  admin.pending = new Promise(r => { release = r })
  await page.goto(`${origin}/admin/orders/${id}`)
  await page.getByText('Loading order...', { exact: true }).waitFor()
  release(); admin.pending = null
  await page.getByRole('heading', { name: 'RF-ADMIN-FIXTURE' }).waitFor()
  assert.match(await page.locator('main').innerText(), /Baraan Snapshot|RF-BAR-001/)
  assert.match(await page.locator('main').innerText(), /Customer shipping note/)
  assert.match(await page.locator('main').innerText(), new RegExp(variantId))
  admin.mode = 'read-error'; await page.reload()
  await page.getByText('The order service is unavailable.', { exact: true }).waitFor()
  const denied = adminFixture({}, ['catalog.read']), other = await setup(t, denied, '/admin/orders')
  await other.getByText('You do not have permission to read orders.').waitFor()
  assert.equal(denied.reads.length, 0); assert.equal(denied.writes.length, 0)
})
test('duplicate click blocked; lost response survives refresh and replays exact UUID/body', async t => {
  const admin = adminFixture(); admin.mode = 'lost-response'
  let release; admin.pendingWrite = new Promise(r => { release = r })
  const page = await setup(t, admin)
  const confirm = page.getByRole('button', { name: 'Confirm', exact: true })
  await confirm.click()
  assert.equal(await confirm.isDisabled(), true)
  release()
  await page.getByRole('button', { name: 'Retry saved action' }).waitFor()
  assert.equal(admin.writes.length, 1)
  await page.reload()
  await page.getByRole('button', { name: 'Retry saved action' }).click()
  await page.getByRole('button', { name: 'Start Processing' }).waitFor()
  assert.equal(admin.writes.length, 2); assert.deepEqual(admin.writes[0].body, admin.writes[1].body)
  assert.equal(admin.writes[0].csrf, 'fixture-csrf')
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), `royal-fusion-admin-order:${id}`), null)
})
test('stale conflict refreshes authoritative state before new action', async t => {
  const admin = adminFixture(); admin.mode = 'stale'
  const page = await setup(t, admin)
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await page.getByRole('button', { name: 'Mark Shipped' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Confirm', exact: true }).count(), 0)
  await page.getByLabel('Private note', { exact: true }).fill('Fresh operational note')
  await page.getByRole('button', { name: 'Add Private Note' }).click()
  await page.getByText(/Fresh operational note ·/).waitFor()
  await page.getByText('order.notes · req_browser_fixture', { exact: true }).waitFor()
  assert.equal(admin.writes[1].body.expectedRevision, '7')
})
test('cancellation requires confirmation and sends no client stock/actor fields', async t => {
  const admin = adminFixture(), page = await setup(t, admin)
  await page.getByLabel('Reason / verification note').fill('Customer requested cancellation')
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Cancel Order', exact: true }).click()
  assert.equal(admin.writes.length, 0)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Cancel Order', exact: true }).click()
  await page.getByText('This order is read-only for your role and its current state.').waitFor()
  assert.deepEqual(Object.keys(admin.writes[0].body).sort(), ['expectedRevision', 'mutationId', 'reason'])
  assert.equal(admin.order.status, 'Cancelled')
})
test('Bank verification gates Processing; shipping requires tracking and explicit delivery; COD reconciles separately', async t => {
  const admin = adminFixture({ paymentMethod: 'Bank Transfer', paymentStatus: 'Pending', status: 'Confirmed' }), page = await setup(t, admin)
  await page.getByRole('button', { name: 'Verify Bank Transfer' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Start Processing' }).count(), 0)
  await page.getByLabel('Reason / verification note').fill('Funds verified')
  await page.getByLabel('Payment reference').fill('BANK-FIXTURE-REF')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Verify Bank Transfer' }).click()
  await page.getByRole('button', { name: 'Start Processing' }).click()
  await page.getByRole('button', { name: 'Mark Shipped' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Mark Shipped' }).isDisabled(), true)
  await page.getByLabel('Courier', { exact: true }).fill('Local Courier')
  await page.getByLabel('Tracking number').fill('TRACK-FIXTURE')
  await page.getByRole('button', { name: 'Mark Shipped' }).click()
  await page.getByRole('button', { name: 'Mark Delivered' }).waitFor()
  assert.equal(admin.writes.at(-1).body.courier, 'Local Courier'); assert.equal(admin.writes.at(-1).body.trackingNumber, 'TRACK-FIXTURE')
  await page.getByLabel('Reason / verification note').fill('Tracking correction')
  await page.getByLabel('Tracking number').fill('TRACK-CORRECTED')
  await page.getByRole('button', { name: 'Correct Tracking' }).click()
  await page.getByText(/Courier: Local Courier · Tracking: TRACK-CORRECTED/).waitFor()
  const history = page.getByRole('heading', { name: 'History / Audit' }).locator('..')
  await history.getByText('Tracking correction', { exact: true }).waitFor()
  await history.getByText('Reason: Tracking correction', { exact: true }).waitFor()
  await history.getByText('Tracking: TRACK-FIXTURE → TRACK-CORRECTED', { exact: true }).waitFor()
  await history.getByText('Courier: Local Courier → Local Courier', { exact: true }).waitFor()
  assert.match(await history.innerText(), /order.fulfillment · req_browser_fixture/)
  assert.match(await history.innerText(), /actor/)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Mark Delivered' }).click()
  await page.getByText('This order is read-only for your role and its current state.').waitFor()
  const cod = adminFixture({ status: 'Delivered' }), codPage = await setup(t, cod)
  await codPage.getByRole('button', { name: 'Confirm COD Collection' }).waitFor()
  assert.equal(cod.writes.length, 0)
  await codPage.getByLabel('Reason / verification note').fill('Remittance verified')
  codPage.once('dialog', dialog => dialog.accept())
  await codPage.getByRole('button', { name: 'Confirm COD Collection' }).click()
  await codPage.getByText('This order is read-only for your role and its current state.').waitFor()
  assert.equal(cod.order.paymentStatus, 'Paid')
})
test('read-only permission hides all mutations and historical terminal states remain read-only', async t => {
  const admin = adminFixture({}, ['orders.read']), page = await setup(t, admin)
  await page.getByText('This order is read-only for your role and its current state.').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Confirm', exact: true }).count(), 0)
  for (const status of ['Returned', 'Refunded']) {
    admin.order.status = status; await page.reload()
    await page.getByText('This order is read-only for your role and its current state.').waitFor()
  }
  assert.equal(admin.writes.length, 0)
})
