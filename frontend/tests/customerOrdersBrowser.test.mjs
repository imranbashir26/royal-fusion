import assert from 'node:assert/strict'
import test from 'node:test'
import { pageFixture, origin } from './support/variantBrowserHarness.mjs'

test('AccountModal My Orders tab, order cards, receipt modal and tab switching', { timeout: 90000 }, async t => {
  const { page } = await pageFixture(t)
  let authenticated = false
  const requests = []
  const customerId = '00000000-0000-4000-8000-000000000101'
  const profile = {
    id: customerId,
    name: 'Royal Customer',
    email: 'customer@example.invalid',
    phone: '03001234567',
    address: 'Street 1',
    city: 'Lahore',
    province: 'Punjab'
  }

  const order1Id = 'e1000000-0000-4000-8000-000000000001'
  const orderList = {
    data: {
      items: [
        {
          id: order1Id,
          orderNumber: 'RF-20261017-TEST0001',
          createdAt: '2026-10-17T12:00:00Z',
          status: 'Shipped',
          paymentStatus: 'Paid',
          paymentMethod: 'Cash on Delivery',
          total: 6500,
          currency: 'PKR',
          itemCount: 2,
          courier: 'TCS Logistics',
          trackingNumber: 'TCS-987654321'
        }
      ],
      page: 1,
      pageSize: 5,
      total: 1,
      totalPages: 1
    },
    meta: { requestId: 'req_list_001' }
  }

  const orderDetail = {
    data: {
      id: order1Id,
      orderNumber: 'RF-20261017-TEST0001',
      createdAt: '2026-10-17T12:00:00Z',
      status: 'Shipped',
      paymentStatus: 'Paid',
      paymentMethod: 'Cash on Delivery',
      subtotal: 6250,
      discount: 0,
      shippingFee: 250,
      total: 6500,
      currency: 'PKR',
      courier: 'TCS Logistics',
      trackingNumber: 'TCS-987654321',
      shipping: {
        name: 'Royal Customer',
        address: 'House 42, Luxury Boulevard',
        city: 'Lahore',
        province: 'Punjab',
        orderNotes: 'Call before delivery'
      },
      items: [
        {
          id: 'item-v2-fixed',
          productId: 'pack-prod-1',
          variantId: null,
          packId: 'pack-prod-1',
          kind: 'fixed_tester_pack',
          name: 'Signature Discovery Set (5 x 5ml)',
          size: '5 x 5ml',
          sku: 'TP-SIG-5X5',
          quantity: 1,
          unitPrice: 3500,
          lineTotal: 3500,
          position: 0,
          components: [
            {
              id: 'comp-1',
              name: 'Baraan',
              sku: 'TST-BAR-01',
              size: '5 ml',
              volumeMl: 5,
              quantityPerPack: 1,
              totalPhysicalQuantity: 1,
              referenceUnitPrice: 350,
              position: 0
            },
            {
              id: 'comp-2',
              name: 'Pitch Black',
              sku: 'TST-PB-01',
              size: '5 ml',
              volumeMl: 5,
              quantityPerPack: 1,
              totalPhysicalQuantity: 1,
              referenceUnitPrice: 350,
              position: 1
            }
          ]
        },
        {
          id: 'item-normal',
          productId: 'prod-bar-50',
          variantId: 'var-bar-50',
          packId: null,
          kind: 'normal_variant',
          name: 'Baraan Eau de Parfum',
          size: '50 ml',
          sku: 'RF-BAR-050',
          quantity: 1,
          unitPrice: 2750,
          lineTotal: 2750,
          position: 1,
          components: []
        }
      ]
    },
    meta: { requestId: 'req_detail_001' }
  }

  await page.context().route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    requests.push({ path, method, url: route.request().url() })

    if (path.endsWith('/auth/session')) {
      return route.fulfill({
        json: {
          data: {
            authenticated,
            csrfToken: 'trusted-csrf',
            ...(authenticated ? { identity: { id: customerId, email: profile.email, emailVerified: true } } : {})
          }
        }
      })
    }
    if (path.endsWith('/auth/signin')) {
      authenticated = true
      return route.fulfill({ json: { data: { authenticated: true } } })
    }
    if (path.endsWith('/auth/signout')) {
      authenticated = false
      return route.fulfill({ status: 204, body: '' })
    }
    if (path.endsWith('/customer/profile')) {
      return route.fulfill({ json: { data: profile } })
    }
    if (path.endsWith('/customer/orders')) {
      return route.fulfill({ json: orderList })
    }
    if (path.includes('/customer/orders/' + order1Id)) {
      return route.fulfill({ json: orderDetail })
    }
    return route.fulfill({ status: 403, json: { error: { code: 'PERMISSION_DENIED' } } })
  })

  await page.goto(origin)
  await page.getByRole('button', { name: 'Account', exact: true }).click()
  await page.getByRole('heading', { name: 'Sign in to Royal Fusion' }).waitFor()

  const modal = page.getByLabel('Customer account')
  await modal.getByLabel(/^Email address/).fill(profile.email)
  await modal.getByLabel(/^Password/).fill('FictionalPass1!')
  await modal.locator('form').getByRole('button', { name: 'Sign In', exact: true }).click()

  // Verify authenticated profile state
  await page.getByRole('heading', { name: 'Your Royal Profile' }).waitFor()
  await page.getByRole('button', { name: 'Profile', exact: true }).waitFor()
  await page.getByRole('button', { name: 'My Orders', exact: true }).waitFor()

  // Switch to My Orders tab
  await modal.getByRole('button', { name: 'My Orders', exact: true }).click()
  await page.getByRole('heading', { name: 'Your Order History' }).waitFor()

  // Verify Order Card rendered
  await modal.getByText('RF-20261017-TEST0001').waitFor()
  await modal.getByText('Shipped').waitFor()
  await modal.getByText('TCS Logistics: TCS-987654321').waitFor()

  const viewReceiptBtn = modal.getByRole('button', { name: 'View Receipt & Items', exact: true })

  // Cycle 1: Click View Receipt & Items and close with Escape
  await viewReceiptBtn.click()

  // Verify Receipt Modal opened
  const receiptModal = page.getByRole('dialog', { name: 'Order Receipt' })
  await receiptModal.waitFor()
  await receiptModal.getByRole('heading', { name: 'RF-20261017-TEST0001' }).waitFor()
  await receiptModal.getByText('Signature Discovery Set (5 x 5ml)').waitFor()
  await receiptModal.getByText('Baraan (5 ml)').waitFor()
  await receiptModal.getByText('Pitch Black (5 ml)').waitFor()
  await receiptModal.getByText('Baraan Eau de Parfum').waitFor()
  await receiptModal.getByText('House 42, Luxury Boulevard').waitFor()
  await receiptModal.getByText('Call before delivery').waitFor()

  // Verify initial focus is placed inside the dialog on the close button
  const closeBtn = receiptModal.getByRole('button', { name: 'Close order details' })
  await closeBtn.waitFor()
  await page.waitForFunction(() => {
    const active = document.activeElement
    return active && (active.getAttribute('aria-label') === 'Close order details' || active.getAttribute('role') === 'dialog')
  })

  // Press Escape to close receipt modal
  await page.keyboard.press('Escape')
  await receiptModal.waitFor({ state: 'detached' })

  // Verify parent AccountModal remained open
  assert.ok(await modal.isVisible(), 'Parent AccountModal must not close on Escape')

  // Verify focus returned to View Receipt & Items button
  await page.waitForFunction(() => {
    return document.activeElement?.textContent?.includes('View Receipt & Items')
  })
  assert.ok(await viewReceiptBtn.evaluate(el => document.activeElement === el), 'Focus must return to View Receipt button')

  // Cycle 2: Reopen and close with visible close button
  await viewReceiptBtn.click()
  await receiptModal.waitFor()
  await closeBtn.waitFor()

  // Close with visible close button
  await closeBtn.click()
  await receiptModal.waitFor({ state: 'detached' })
  assert.ok(await modal.isVisible(), 'Parent AccountModal must not close on visible close button')
  await page.waitForFunction(() => {
    return document.activeElement?.textContent?.includes('View Receipt & Items')
  })
  assert.ok(await viewReceiptBtn.evaluate(el => document.activeElement === el), 'Focus must return after close button click')

  // Cycle 3: Reopen after Escape, test focus trap with Tab key, then close with Escape
  await viewReceiptBtn.click()
  await receiptModal.waitFor()
  await closeBtn.waitFor()

  // Tab key focus trap
  await page.keyboard.press('Tab')
  assert.ok(await closeBtn.evaluate(el => document.activeElement === el), 'Focus must be trapped on close button')
  await page.keyboard.press('Shift+Tab')
  assert.ok(await closeBtn.evaluate(el => document.activeElement === el), 'Shift+Tab must keep focus within dialog')

  // Close with Escape again
  await page.keyboard.press('Escape')
  await receiptModal.waitFor({ state: 'detached' })
  assert.ok(await modal.isVisible(), 'Parent AccountModal remains open')

  // Cycle 4: Mobile viewport check (375x667)
  await page.setViewportSize({ width: 375, height: 667 })
  await viewReceiptBtn.click()
  await receiptModal.waitFor()
  await page.keyboard.press('Escape')
  await receiptModal.waitFor({ state: 'detached' })
  assert.ok(await modal.isVisible(), 'Parent AccountModal remains open on mobile')
  await page.setViewportSize({ width: 1280, height: 800 })

  // Switch back to Profile tab
  await modal.getByRole('button', { name: 'Profile', exact: true }).click()
  await page.getByRole('heading', { name: 'Your Royal Profile' }).waitFor()
  assert.equal(await modal.getByLabel(/^Full name/).inputValue(), 'Royal Customer')

  // Logout
  await modal.getByRole('button', { name: 'Logout' }).click()
  await page.getByRole('heading', { name: 'Sign in to Royal Fusion' }).waitFor()

  // Confirm API requests made
  assert.ok(requests.some(r => r.path.endsWith('/customer/orders')), 'List orders API must be called')
  assert.ok(requests.some(r => r.path.includes('/customer/orders/' + order1Id)), 'Detail order API must be called')
})

const customerId = '00000000-0000-4000-8000-000000000101'
const firstId = 'e1000000-0000-4000-8000-000000000001'
const secondId = 'e1000000-0000-4000-8000-000000000002'
const profile = { id: customerId, name: 'History Customer', email: 'history@example.invalid', phone: '', address: '', city: '', province: '' }
const summary = id => ({ id, orderNumber: id === firstId ? 'RF-OLD-ORDER' : 'RF-PACK-ORDER', createdAt: '2026-10-17T12:00:00Z',
  status: 'Delivered', paymentStatus: 'Paid', paymentMethod: 'Cash on Delivery', total: 1250.50, currency: 'PKR', itemCount: 2,
  courier: null, trackingNumber: null })
const detail = id => ({ ...summary(id), subtotal: 1000.50, discount: 0, shippingFee: 250,
  shipping: { name: profile.name, address: 'Frozen shipping street', city: 'Attock', province: 'Punjab', orderNotes: '' },
  items: [{ id: 'frozen-item', productId: null, variantId: null, packId: id === firstId ? null : 'pack',
    kind: id === firstId ? 'normal_variant' : 'configurable_tester_pack', name: id === firstId ? 'Archived fragrance' : 'Recorded custom pack',
    size: id === firstId ? '50 ml' : 'Tester pack', sku: '', quantity: 2, unitPrice: 500.25, lineTotal: 1000.50, position: null,
    components: id === firstId ? [] : [{ id: 'frozen-component', name: 'Archived tester', sku: 'OLD', size: '5 ml', volumeMl: 5,
      quantityPerPack: 3, totalPhysicalQuantity: 6, referenceUnitPrice: 12.25, position: 0 }] }] })

async function accountFixture(t) {
  const result = await pageFixture(t)
  const state = { authenticated: true, pages: [], listError: false, expired: false, detailExpired: false,
    listGate: null, detailGate: null, empty: false }
  await result.page.context().route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname
    const reply = json => route.fulfill({ json }).catch(() => {})
    if (path.endsWith('/auth/session')) return reply({ data: { authenticated: state.authenticated, csrfToken: 'csrf',
      ...(state.authenticated ? { identity: { id: customerId, emailVerified: true } } : {}) } })
    if (path.endsWith('/auth/signout')) { state.authenticated = false; return route.fulfill({ status: 204, body: '' }) }
    if (path.endsWith('/auth/signin')) { state.authenticated = true; return reply({ data: { authenticated: true } }) }
    if (path.endsWith('/customer/profile')) return reply({ data: profile })
    if (path.endsWith('/customer/orders')) {
      const page = Number(url.searchParams.get('page')); state.pages.push(page)
      if (state.listGate) await state.listGate
      if (state.expired) return route.fulfill({ status: 401, json: { error: { code: 'SESSION_EXPIRED', message: 'Your session has expired.' } } }).catch(() => {})
      if (page === 2 && state.listError) return route.fulfill({ status: 503, json: { error: { code: 'CUSTOMER_ORDER_UNAVAILABLE', message: 'Order history unavailable.' } } })
      return reply({ data: { items: state.empty ? [] : [summary(page === 1 ? firstId : secondId)], page, pageSize: 5, total: state.empty ? 0 : 6, totalPages: state.empty ? 0 : 2 } })
    }
    if (path.includes('/customer/orders/')) {
      if (state.detailGate) await state.detailGate
      if (state.detailExpired) return route.fulfill({ status: 403, json: { error: { code: 'PERMISSION_DENIED', message: 'Account access changed.' } } }).catch(() => {})
      return reply({ data: detail(path.split('/').at(-1)) })
    }
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } })
  })
  await result.page.goto(origin)
  await result.page.getByRole('button', { name: 'Account', exact: true }).click()
  const account = result.page.getByRole('dialog', { name: 'Customer account', exact: true })
  await account.getByText('Account overview', { exact: true }).waitFor()
  return { ...result, state, account }
}

test('history paginates, retries the failed page and displays frozen V1 and configurable pack receipts', { timeout: 90000 }, async t => {
  const { page, account, state } = await accountFixture(t)
  await account.getByRole('button', { name: 'My Orders', exact: true }).click()
  await account.getByText('RF-OLD-ORDER', { exact: true }).waitFor()
  await account.getByText('Payment:', { exact: false }).waitFor()
  await account.getByRole('button', { name: 'View Receipt & Items' }).click()
  const receipt = page.getByRole('dialog', { name: 'Order Receipt', exact: true })
  await receipt.getByText('Archived fragrance', { exact: true }).waitFor()
  await receipt.getByText(/500\.25/).waitFor()
  assert.equal(await receipt.getByText('Included 5ml Discovery Testers:').count(), 0)
  await page.keyboard.press('Escape')
  state.listError = true
  await account.getByRole('button', { name: 'Next', exact: true }).click()
  await account.getByText('Order history unavailable.', { exact: true }).waitFor()
  state.listError = false
  await account.getByRole('button', { name: 'Try Again', exact: true }).click()
  await account.getByText('RF-PACK-ORDER', { exact: true }).waitFor()
  // Development StrictMode can issue an initial read before its mount is cancelled.
  assert.ok(state.pages.slice(0, -2).every(page => page === 1))
  assert.deepEqual(state.pages.slice(-2), [2,2])
  await account.getByRole('button', { name: 'View Receipt & Items' }).click()
  await receipt.getByText('Recorded custom pack', { exact: true }).waitFor()
  await receipt.getByText('Archived tester (5 ml)', { exact: false }).waitFor()
  await receipt.getByText('3 per pack · 6 total', { exact: true }).waitFor()
  await page.setViewportSize({ width: 375, height: 667 })
  assert.equal(await receipt.evaluate(el => el.scrollWidth <= el.clientWidth), true)
  await page.keyboard.press('Escape')
  await account.getByRole('button', { name: 'Previous', exact: true }).click()
  await account.getByText('RF-OLD-ORDER', { exact: true }).waitFor()
})

test('expired history and detail requests clear private presentation and return to sign in', { timeout: 90000 }, async t => {
  const { page, account, state } = await accountFixture(t)
  state.expired = true
  await account.getByRole('button', { name: 'My Orders', exact: true }).click()
  await account.getByText(/Your session has expired or account access changed/).waitFor()
  await account.getByRole('heading', { name: 'Sign in to Royal Fusion' }).waitFor()
  assert.equal(await account.getByText(profile.email, { exact: true }).count(), 0)
  assert.equal(await account.getByText('RF-OLD-ORDER', { exact: true }).count(), 0)
  state.expired = false
  await account.getByLabel(/^Email address/).fill(profile.email)
  await account.getByLabel(/^Password/).fill('FictionalPass1!')
  await account.locator('form').getByRole('button', { name: 'Sign In', exact: true }).click()
  await account.getByRole('button', { name: 'My Orders', exact: true }).click()
  await account.getByText('RF-OLD-ORDER', { exact: true }).waitFor()
  state.detailExpired = true
  await account.getByRole('button', { name: 'View Receipt & Items' }).click()
  await account.getByRole('heading', { name: 'Sign in to Royal Fusion' }).waitFor()
  assert.equal(await page.getByRole('dialog', { name: 'Order Receipt' }).count(), 0)
  assert.equal(await page.getByText('Frozen shipping street', { exact: true }).count(), 0)
})

test('logout during delayed history and receipt reads prevents late customer data from reappearing', { timeout: 90000 }, async t => {
  const { page, account, state } = await accountFixture(t)
  let releaseList
  state.listGate = new Promise(resolve => { releaseList = resolve })
  await account.getByRole('button', { name: 'My Orders', exact: true }).click()
  await account.getByText('Retrieving your order history...').waitFor()
  await account.getByRole('button', { name: 'Logout', exact: true }).click()
  releaseList(); state.listGate = null
  await account.getByRole('heading', { name: 'Sign in to Royal Fusion' }).waitFor()
  assert.equal(await account.getByText('RF-OLD-ORDER', { exact: true }).count(), 0)
  await account.getByLabel(/^Email address/).fill(profile.email)
  await account.getByLabel(/^Password/).fill('FictionalPass1!')
  await account.locator('form').getByRole('button', { name: 'Sign In', exact: true }).click()
  await account.getByRole('button', { name: 'My Orders', exact: true }).click()
  await account.getByText('RF-OLD-ORDER', { exact: true }).waitFor()
  let releaseDetail
  state.detailGate = new Promise(resolve => { releaseDetail = resolve })
  await account.getByRole('button', { name: 'View Receipt & Items' }).click()
  await page.getByText('Loading your order receipt...').waitFor()
  await page.evaluate(async () => { const { useCustomerAuthStore } = await import('/src/store/customerAuthStore.ts'); await useCustomerAuthStore.getState().logout() })
  releaseDetail(); state.detailGate = null
  await account.getByRole('heading', { name: 'Sign in to Royal Fusion' }).waitFor()
  assert.equal(await page.getByRole('dialog', { name: 'Order Receipt' }).count(), 0)
  assert.equal(await page.getByText('Archived fragrance', { exact: true }).count(), 0)
})

test('empty history links to shopping and account keyboard navigation stays inside the panel', { timeout: 90000 }, async t => {
  const { page, account, state } = await accountFixture(t)
  state.empty = true
  await account.getByRole('button', { name: 'My Orders', exact: true }).click()
  await account.getByRole('heading', { name: 'No Orders Yet' }).waitFor()
  await account.getByRole('button', { name: 'Logout', exact: true }).focus()
  await page.keyboard.press('Tab')
  assert.equal(await account.getByRole('button', { name: 'Close account panel' }).evaluate(el => el === document.activeElement), true)
  await account.getByRole('link', { name: 'Explore Fragrances' }).click()
  await page.waitForURL('**/shop')
  await account.waitFor({ state: 'detached' })
})
