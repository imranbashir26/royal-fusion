import assert from 'node:assert/strict'
import test from 'node:test'
import { pageFixture, origin } from './support/variantBrowserHarness.mjs'

// Mock tester options
const sampleTesters = [
  {
    testerVariantId: '11111111-1111-4111-8111-111111111111',
    productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Royal Oud 5 ml',
    sku: 'RF-OUD-5ML',
    volumeMl: 5,
    regularPrice: 500,
    salePrice: 450,
    effectivePrice: 450,
    saleActive: true,
    stockQuantity: 10,
    displayOrder: 1,
  },
  {
    testerVariantId: '22222222-2222-4222-8222-222222222222',
    productId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Velvet Rose 5 ml',
    sku: 'RF-ROSE-5ML',
    volumeMl: 5,
    regularPrice: 400,
    salePrice: null,
    effectivePrice: 400,
    saleActive: false,
    stockQuantity: 5,
    displayOrder: 2,
  },
  {
    testerVariantId: '33333333-3333-4333-8333-333333333333',
    productId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    name: 'Amber Night 5 ml',
    sku: 'RF-AMBER-5ML',
    volumeMl: 5,
    regularPrice: 600,
    salePrice: null,
    effectivePrice: 600,
    saleActive: false,
    stockQuantity: 5,
    displayOrder: 3,
  },
]

// Mock fixed pack
const fixedPack = {
  id: '44444444-4444-4444-8444-444444444444',
  packId: '44444444-4444-4444-8444-444444444444',
  commerceKind: 'tester_pack',
  name: 'Signature Trio Discovery Set',
  slug: 'signature-trio-discovery-set',
  sku: 'RF-PACK-TRIO',
  image: '',
  gallery: [],
  description: 'Three authentic 5 ml testers of our signature perfumes.',
  shortDescription: 'Curated 3-fragrance discovery set.',
  scentFamily: 'Oriental Woody',
  categoryId: null,
  status: 'Published',
  active: true,
  catalogRevision: '2',
  definitionRevision: '1',
  mode: 'fixed',
  minimumUnits: null,
  maximumUnits: null,
  fixedRegularPrice: 1400,
  fixedSalePrice: 1250,
  regularPrice: 1400,
  salePrice: 1250,
  effectivePrice: 1250,
  saleActive: true,
  manualAvailable: true,
  available: true,
  availablePackCount: 8,
  components: [
    { ...sampleTesters[0], quantityPerPack: 1 },
    { ...sampleTesters[1], quantityPerPack: 1 },
    { ...sampleTesters[2], quantityPerPack: 1 },
  ],
  allowedVariants: [],
}

// Mock configurable pack
const configurablePack = {
  id: '55555555-5555-4555-8555-555555555555',
  packId: '55555555-5555-4555-8555-555555555555',
  commerceKind: 'tester_pack',
  name: 'Bespoke Discovery Set',
  slug: 'bespoke-discovery-set',
  sku: 'RF-PACK-BESPOKE',
  image: '',
  gallery: [],
  description: 'Choose any 3 to 5 fragrances to build your custom discovery set.',
  shortDescription: 'Build your own 3 to 5 tester pack.',
  scentFamily: 'Custom Discovery',
  categoryId: null,
  status: 'Published',
  active: true,
  catalogRevision: '3',
  definitionRevision: '2',
  mode: 'configurable',
  minimumUnits: 3,
  maximumUnits: 5,
  fixedRegularPrice: null,
  fixedSalePrice: null,
  regularPrice: null,
  salePrice: null,
  effectivePrice: null,
  saleActive: false,
  manualAvailable: true,
  available: true,
  availablePackCount: null,
  components: [],
  allowedVariants: sampleTesters,
}

async function setupTesterPackMock(page) {
  await page.route('**/api/v2/public/tester-packs*', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname

    if (path.includes(fixedPack.id)) {
      return route.fulfill({ json: { data: fixedPack } })
    }
    if (path.includes(configurablePack.id)) {
      return route.fulfill({ json: { data: configurablePack } })
    }
    // List request
    return route.fulfill({
      json: {
        data: {
          items: [fixedPack, configurablePack],
          total: 2,
          totalPages: 1,
        },
      },
    })
  })
}

test('Customer can explore discovery packs, filter by mode, and view details', async (t) => {
  const { page } = await pageFixture(t)
  page.on('console', (msg) => console.log('BROWSER LOG:', msg.text()))
  page.on('pageerror', (err) => console.log('BROWSER ERROR:', err))
  page.on('requestfailed', (req) => console.log('REQ FAILED:', req.url(), req.failure()?.errorText))
  page.setDefaultTimeout(15000)
  await setupTesterPackMock(page)

  // 1. Navigate to Discovery Packs page
  await page.goto(`${origin}/discovery-packs`)
  await page.getByRole('heading', { name: 'Discovery Tester Packs', level: 1 }).waitFor()

  // 2. Both pack cards should be visible
  await page.getByText('Signature Trio Discovery Set').waitFor()
  await page.getByText('Bespoke Discovery Set').waitFor()
  assert.ok(await page.locator('article').filter({ hasText: 'Signature Trio Discovery Set' }).getByText('Curated Set', { exact: true }).isVisible())
  assert.ok(await page.locator('article').filter({ hasText: 'Bespoke Discovery Set' }).getByText('Build Your Own', { exact: true }).isVisible())

  // 3. Test filter pills
  await page.getByRole('button', { name: /Curated Sets/i }).click()
  await page.getByText('Signature Trio Discovery Set').waitFor()
  assert.equal(await page.getByText('Bespoke Discovery Set').isVisible(), false)

  await page.getByRole('button', { name: /Build Your Own/i }).click()
  await page.getByText('Bespoke Discovery Set').waitFor()
  assert.equal(await page.getByText('Signature Trio Discovery Set').isVisible(), false)

  await page.getByRole('button', { name: /All Packs/i }).click()
  await page.getByText('Signature Trio Discovery Set').waitFor()
  await page.getByText('Bespoke Discovery Set').waitFor()
})

test('Fixed pack view displays components, quantity controls, and adds to cart with drawer feedback', async (t) => {
  const { page } = await pageFixture(t)
  page.on('console', (msg) => console.log('T2 LOG:', msg.text()))
  page.on('pageerror', (err) => console.log('T2 ERROR:', err))
  page.on('requestfailed', (req) => console.log('T2 REQ FAILED:', req.url(), req.failure()?.errorText))
  page.setDefaultTimeout(15000)
  await setupTesterPackMock(page)

  // Navigate to fixed pack details
  await page.goto(`${origin}/discovery-packs/signature-trio-discovery-set`)
  await page.getByRole('heading', { name: 'Signature Trio Discovery Set', level: 1 }).waitFor()

  // Check price and inclusions
  await page.getByText(/1,250\.00/).first().waitFor()
  await page.getByText('Included in This Discovery Set').waitFor()
  await page.getByText('Royal Oud 5 ml').waitFor()
  await page.getByText('Velvet Rose 5 ml').waitFor()
  await page.getByText('Amber Night 5 ml').waitFor()

  // Click Add Set to Cart
  await page.getByRole('button', { name: 'Add Set to Cart' }).click()

  // Verify success feedback
  await page.getByText('Curated discovery set added to your cart!').waitFor()

  // Cart drawer opens and displays the fixed pack
  const drawer = page.locator('aside[aria-label="Cart drawer"]')
  await drawer.waitFor()
  assert.ok(await drawer.isVisible())
  await drawer.getByText('Signature Trio Discovery Set', { exact: true }).waitFor()
  await drawer.getByText('Tester pack', { exact: true }).waitFor()
})

test('Configurable pack builder tracks slots, enforces limits, calculates price, and adds to cart', async (t) => {
  const { page } = await pageFixture(t)
  page.setDefaultTimeout(15000)
  await setupTesterPackMock(page)

  // Navigate to configurable pack builder
  await page.goto(`${origin}/discovery-packs/bespoke-discovery-set`)
  await page.getByRole('heading', { name: 'Bespoke Discovery Set', level: 1 }).waitFor()
  await page.getByText('Interactive Pack Builder').waitFor()

  // Initial state: 0 of 5 selected, Add to Cart disabled
  await page.getByText('0 of 5 Testers Selected').waitFor()
  await page.getByText('Select your first fragrance').waitFor()
  const addToCartBtn = page.getByRole('button', { name: /Select at least 3 testers|Add Custom Pack to Cart/i }).first()
  assert.equal(await addToCartBtn.isDisabled(), true)

  // Increment Royal Oud to 2
  const plusOud = page.getByRole('button', { name: 'Increase Royal Oud 5 ml quantity in pack, currently 0' })
  await plusOud.click()
  await page.getByText('1 of 5 Testers Selected').waitFor()
  await page.getByText('Add 2 more to reach minimum').waitFor()

  const plusOud2 = page.getByRole('button', { name: 'Increase Royal Oud 5 ml quantity in pack, currently 1' })
  await plusOud2.click()
  await page.getByText('2 of 5 Testers Selected').waitFor()

  // Increment Velvet Rose to 1 -> Total = 3 (minimum reached!)
  const plusRose = page.getByRole('button', { name: 'Increase Velvet Rose 5 ml quantity in pack, currently 0' })
  await plusRose.click()
  await page.getByText('3 of 5 Testers Selected').waitFor()
  await page.getByText(/Pack Ready/i).waitFor()

  // Real-time price: 2x 450 + 1x 400 = 1,300
  await page.getByText(/1,300\.00/).first().waitFor()

  // Add to cart button is now enabled
  const enabledBtn = page.getByRole('button', { name: 'Add Custom Pack to Cart' }).first()
  assert.equal(await enabledBtn.isDisabled(), false)

  // Increment Amber Night to 2 -> Total = 5 (maximum reached!)
  const plusAmber = page.getByRole('button', { name: 'Increase Amber Night 5 ml quantity in pack, currently 0' })
  await plusAmber.click()
  await page.getByText('4 of 5 Testers Selected').waitFor()

  const plusAmber2 = page.getByRole('button', { name: 'Increase Amber Night 5 ml quantity in pack, currently 1' })
  await plusAmber2.click()
  await page.getByText('5 of 5 Testers Selected').waitFor()
  await page.getByText(/Pack Complete/i).waitFor()

  // Subtotal: 2x 450 (900) + 1x 400 (400) + 2x 600 (1200) = PKR 2,500.00
  await page.getByText(/2,500\.00/).first().waitFor()

  // Click Add to Cart
  await enabledBtn.click()

  // Success alert
  await page.getByText('Your bespoke discovery pack has been added to your cart!').waitFor()

  // Cart drawer opens and displays selections
  const drawer = page.locator('aside[aria-label="Cart drawer"]')
  await drawer.waitFor()
  await drawer.getByText('Bespoke Discovery Set', { exact: true }).waitFor()
  await drawer.getByText('Included: 2x Royal Oud 5 ml, 1x Velvet Rose 5 ml, 2x Amber Night 5 ml').waitFor()
})

test('Navbar links and redirects integrate discovery packs seamlessly', async (t) => {
  const { page } = await pageFixture(t)
  page.setDefaultTimeout(15000)
  await setupTesterPackMock(page)

  // 1. Visit homepage
  await page.goto(`${origin}/`)

  // 2. Click Discovery Packs in Navbar
  await page.locator('nav[aria-label="Primary navigation"]').getByRole('link', { name: 'Discovery Packs' }).click()
  await page.waitForURL('**/discovery-packs')
  await page.getByRole('heading', { name: 'Discovery Tester Packs', level: 1 }).waitFor()

  // 3. Test legacy / alias redirect /tester-packs
  await page.goto(`${origin}/tester-packs`)
  await page.waitForURL('**/discovery-packs')
  await page.getByRole('heading', { name: 'Discovery Tester Packs', level: 1 }).waitFor()

  // 4. Test alias redirect /tester-packs/bespoke-discovery-set
  await page.goto(`${origin}/tester-packs/bespoke-discovery-set`)
  await page.waitForURL('**/discovery-packs/bespoke-discovery-set')
  await page.getByRole('heading', { name: 'Bespoke Discovery Set', level: 1 }).waitFor()
})
