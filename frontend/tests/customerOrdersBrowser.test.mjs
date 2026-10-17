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
