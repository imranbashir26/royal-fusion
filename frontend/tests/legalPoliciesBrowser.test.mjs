import assert from 'node:assert/strict'
import test from 'node:test'
import { pageFixture, origin } from './support/variantBrowserHarness.mjs'
import { productId, variantId } from './variantFixtures.mjs'

const lineId = JSON.stringify([productId, variantId])
const cartFixture = {
  version: 2,
  state: {
    items: [
      { lineId, productId, variantId, identity: 'canonical', size: '50 ml', quantity: 1 }
    ],
    selectedLineIds: [lineId]
  }
}

async function setup(t, options = {}) {
  const { page } = await pageFixture(t, options)
  page.setDefaultTimeout(20000)
  return page
}

test('all four policy pages render in desktop Chromium with semantic headings and contact concierge', async (t) => {
  const page = await setup(t)
  await page.setViewportSize({ width: 1280, height: 800 })

  // 1. Privacy Policy
  await page.goto(`${origin}/privacy-policy`)
  await page.getByRole('heading', { level: 1, name: 'Privacy Policy' }).waitFor()
  assert.equal(await page.title(), 'Privacy Policy | Royal Fusion')
  assert.ok(await page.getByText('Shop #544, Saddar Bazar, Attock Cantt, Pakistan').first().isVisible())
  assert.ok(await page.getByText('billing@royal-fusion.com').first().isVisible())
  assert.ok(await page.getByText('+92 3278647667').first().isVisible())

  // Check sub-navigation pill switching
  await page.getByRole('link', { name: 'Terms & Conditions' }).first().click()
  await page.waitForURL('**/terms-and-conditions')
  await page.getByRole('heading', { level: 1, name: 'Terms and Conditions' }).waitFor()
  assert.equal(await page.title(), 'Terms and Conditions | Royal Fusion')
  assert.ok(await page.getByText('120 seconds (2 minutes)').isVisible())

  // Switch to Shipping & Delivery
  await page.getByRole('link', { name: 'Shipping & Delivery' }).first().click()
  await page.waitForURL('**/shipping-policy')
  await page.getByRole('heading', { level: 1, name: 'Shipping & Delivery Policy' }).waitFor()
  assert.equal(await page.title(), 'Shipping & Delivery Policy | Royal Fusion')
  assert.ok(await page.getByText('PKR 200').first().isVisible())
  assert.ok(await page.getByText('over PKR 5,000').isVisible())
  assert.ok(await page.getByText('3–4 days').isVisible())

  // Switch to Returns & Exchanges
  await page.getByRole('link', { name: 'Returns & Exchanges' }).first().click()
  await page.waitForURL('**/returns-refunds')
  await page.getByRole('heading', { level: 1, name: 'Returns, Refunds & Exchanges' }).waitFor()
  assert.equal(await page.title(), 'Returns, Refunds & Exchanges | Royal Fusion')
  assert.ok(await page.getByText('15 days').first().isVisible())
  assert.ok(await page.getByText('97–98% perfume remaining').isVisible())
  assert.ok(await page.getByText('above PKR 10,000').isVisible())
  assert.ok(await page.getByText('Bank Wire Transfer').isVisible())
})

test('policy pages render cleanly on mobile viewport (390x844) without horizontal scrolling', async (t) => {
  const page = await setup(t)
  await page.setViewportSize({ width: 390, height: 844 })

  await page.goto(`${origin}/returns-refunds`)
  await page.getByRole('heading', { level: 1, name: 'Returns, Refunds & Exchanges' }).waitFor()

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
  assert.equal(scrollWidth <= clientWidth, true, 'Mobile page must not cause horizontal scrolling')

  assert.ok(await page.getByText('97–98% perfume remaining').isVisible())
  assert.ok(await page.getByText('Royal Fusion Customer Concierge').isVisible())
})

test('footer provides direct navigation to policy pages from the storefront home', async (t) => {
  const page = await setup(t)
  await page.goto(`${origin}/`)

  const footer = page.locator('footer')
  await footer.scrollIntoViewIfNeeded()

  const shippingLink = footer.getByRole('link', { name: 'Shipping Policy' })
  assert.ok(await shippingLink.isVisible())
  await shippingLink.click()

  await page.waitForURL('**/shipping-policy')
  await page.getByRole('heading', { level: 1, name: 'Shipping & Delivery Policy' }).waitFor()
})

test('checkout page renders accessible links to all four policies before submission', async (t) => {
  const page = await setup(t, { legacy: cartFixture })
  await page.goto(`${origin}/checkout`)

  // Wait for the checkout form to mount
  const form = page.locator('main form')
  await form.waitFor()

  // Verify the policy links are present within the checkout form
  const termsLink = form.getByRole('link', { name: 'Terms and Conditions' })
  const privacyLink = form.getByRole('link', { name: 'Privacy Policy' })
  const shippingLink = form.getByRole('link', { name: 'Shipping', exact: true })
  const returnsLink = form.getByRole('link', { name: 'Returns & Exchanges' })

  assert.ok(await termsLink.isVisible())
  assert.ok(await privacyLink.isVisible())
  assert.ok(await shippingLink.isVisible())
  assert.ok(await returnsLink.isVisible())

  assert.equal(await termsLink.getAttribute('href'), '/terms-and-conditions')
  assert.equal(await privacyLink.getAttribute('href'), '/privacy-policy')
  assert.equal(await shippingLink.getAttribute('href'), '/shipping-policy')
  assert.equal(await returnsLink.getAttribute('href'), '/returns-refunds')
})
