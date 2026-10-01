import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { productId, variantId, secondVariantId, productRow, variantRow } from './variantFixtures.mjs'

// Uses an installed Playwright package or the desktop's bundled runtime; no downloads.
const require = createRequire(import.meta.url)
let playwright
try { playwright = require('playwright') } catch {
  try {
    playwright = require(process.env.ROYAL_FUSION_PLAYWRIGHT_PATH
      ?? path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))
  } catch {
    throw new Error('Browser tests require an external Playwright runtime. Set ROYAL_FUSION_PLAYWRIGHT_PATH to the installed playwright package directory. Use its Chromium runtime or install Google Chrome. No browser or dependency is downloaded by this test.')
  }
}
let server, browser, origin
const otherId = 'b4035721-28fc-4539-a988-a08264c5a862'
const otherProduct = { ...productRow, id: otherId, slug: 'royal-test', name: 'Royal Test', price: 4500 }
const otherVariant = { ...variantRow, id: secondVariantId, product_id: otherId, option_value: '100 ml', regular_price: 4500 }

before(async () => {
  server = await createServer({
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    cacheDir: 'node_modules/.vite-variants-browser',
    envFile: false, logLevel: 'silent',
    plugins: [{
      name: 'phase2-refresh-harness',
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith('/__phase2/')) return next()
          res.setHeader('Content-Type', 'text/html')
          res.end(await vite.transformIndexHtml(req.url, '<div id="root"></div><script type="module" src="/@id/phase2-harness"></script>'))
        })
      },
      resolveId(id) { if (id === 'phase2-harness') return id },
      load(id) {
        if (id !== 'phase2-harness') return
        return `
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
          import { StorefrontProvider, useStorefront } from '/src/storefront/StorefrontProvider.tsx';
          import { ProductDetailsPage } from '/src/pages/ProductDetailsPage.tsx';
          import { CartPage } from '/src/pages/CartPage.tsx';
          import { CheckoutPage } from '/src/pages/CheckoutPage.tsx';
          import { CartDrawer } from '/src/components/layout/CartDrawer.tsx';
          import { useCartStore } from '/src/store/cartStore.ts';
          const h = React.createElement;
          function Harness() {
            const { refresh, isLoading, catalogError, products } = useStorefront();
            const navigate = useNavigate();
            return h(React.Fragment, null,
              h('button', { 'data-testid': 'refresh', disabled: isLoading, onClick: refresh }, 'Refresh catalog'),
              h('output', { 'data-testid': 'catalog' }, isLoading ? 'loading' : catalogError ?? 'success:' + products.length),
              h('button', { onClick: () => navigate('/__phase2/product/royal-test') }, 'Change product'),
              h('button', { onClick: () => useCartStore.getState().openCart() }, 'Open test cart'),
              h('main', null, h(Routes, null,
                h(Route, { path: '/__phase2/product/:slug', element: h(ProductDetailsPage) }),
                h(Route, { path: '/__phase2/cart', element: h(CartPage) }),
                h(Route, { path: '/__phase2/checkout', element: h(CheckoutPage) })
              )), h(CartDrawer));
          }
          createRoot(document.getElementById('root')).render(h(StorefrontProvider, null, h(BrowserRouter, null, h(Harness))));
        `
      },
    }],
    define: {
      'import.meta.env.PROD': 'true',
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://catalog.invalid'),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('sb_publishable_test_fixture'),
      'import.meta.env.VITE_API_URL': JSON.stringify('/api'),
      'import.meta.env.VITE_SANITY_PROJECT_ID': JSON.stringify(''),
      'import.meta.env.VITE_SANITY_DATASET': JSON.stringify(''),
    },
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  await server.listen()
  origin = `http://127.0.0.1:${server.httpServer.address().port}`
  try { browser = await playwright.chromium.launch({ headless: true, timeout: 15000 }) }
  catch {
    try { browser = await playwright.chromium.launch({ headless: true, timeout: 15000, channel: 'chrome' }) }
    catch { throw new Error('Cannot launch browser tests. Provide Playwright Chromium or install Google Chrome, then rerun npm run test:variants:browser.') }
  }
}, { timeout: 60000 })

after(async () => {
  await browser?.close()
  await server?.close()
})

async function pageFixture(t, { variants = [variantRow, otherVariant], legacy, wishlist = false, products = [productRow, otherProduct], variantError = false } = {}) {
  const catalog = { products, variants, variantError, productError: false }
  const context = await browser.newContext({ serviceWorkers: 'block' })
  t.after(() => context.close())
  await context.addInitScript(({ legacy, wishlist, productId }) => {
    sessionStorage.setItem('royal-fusion-intro-played', 'true')
    if (legacy && !sessionStorage.getItem('cart-fixture-seeded')) {
      localStorage.setItem('royal-fusion-cart', JSON.stringify(legacy))
      sessionStorage.setItem('cart-fixture-seeded', 'true')
    }
    if (wishlist) localStorage.setItem('royal-fusion-wishlist', JSON.stringify({ state: { productIds: [productId] }, version: 0 }))
  }, { legacy, wishlist, productId })
  const orders = [], variantReads = [], errors = []
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (/\/public\/orders|\/rpc\//.test(url.pathname)) {
      orders.push(url.pathname)
      return route.abort()
    }
    const fulfill = (body) => route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } })
    if (url.hostname === 'catalog.invalid') {
      const table = url.pathname.split('/').at(-1)
      if (table === 'products') {
        await new Promise((resolve) => setTimeout(resolve, 350))
        if (catalog.productError) return route.fulfill({ status: 500, json: { message: 'Product fixture failure' } })
        return fulfill(catalog.products)
      }
      if (table === 'product_variants') {
        variantReads.push(url.search)
        if (catalog.variantError) return route.fulfill({ status: 500, json: { message: 'Variant fixture failure' } })
        return fulfill(catalog.variants.filter((variant) =>
          (url.searchParams.get('active') !== 'eq.true' || variant.active)
          && (url.searchParams.get('available') !== 'eq.true' || variant.available)))
      }
      if (table === 'categories') return fulfill([{ id: 'category', name: 'Eau de Parfum', slug: 'eau-de-parfum' }])
      if (table === 'public_site_settings') return fulfill([
        { key: 'shipping', value: { defaultShippingFee: 250, freeShippingAbove: 7000 } },
        { key: 'payments', value: [{ id: 'cod', name: 'Cash on Delivery', active: true }] },
      ])
      return fulfill([])
    }
    if (url.origin === origin && url.pathname.startsWith('/api/')) return fulfill({ data: [] })
    if (url.origin === origin) return route.continue()
    return route.abort() // Every external request is intercepted; never contacts production.
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(orders, []) })
  return { page, orders, variantReads, catalog }
}

async function storedCart(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('royal-fusion-cart')))
}

test('rendered async Baraan detail, gallery, UUID add, reload, canonical cart and forced checkout guard', { timeout: 90000 }, async (t) => {
  const { page, variantReads } = await pageFixture(t)
  await page.goto(`${origin}/product/baraan`)
  await page.getByRole('heading', { name: 'Baraan', exact: true }).waitFor()
  await page.getByRole('button', { name: '50 ml', exact: true }).waitFor()
  assert.ok(await page.getByText('12 in stock', { exact: true }).isVisible())
  assert.match(await page.locator('main').innerText(), /2,900/)
  const gallery = page.getByRole('button', { name: 'View Baraan gallery 2' })
  await gallery.click()
  await page.getByRole('button', { name: 'Add to Cart', exact: true }).first().click()
  await page.getByRole('button', { name: 'Close cart', exact: true }).click()
  assert.equal((await storedCart(page)).state.items[0].variantId, variantId)
  await page.reload()
  await page.getByRole('heading', { name: 'Baraan', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Add to Cart', exact: true }).first().click()
  assert.equal((await storedCart(page)).state.items[0].quantity, 2)
  await page.getByRole('button', { name: 'Close cart', exact: true }).click()
  await page.goto(`${origin}/cart`)
  await page.getByRole('heading', { name: 'Baraan', exact: true }).waitFor()
  assert.match(await page.locator('main').innerText(), /5,800/)
  await page.getByRole('link', { name: 'Proceed to Checkout' }).click()
  await page.getByRole('heading', { name: 'Order Summary', exact: true }).waitFor()
  assert.match(await page.locator('main').innerText(), /5,800/)
  assert.equal(await page.getByRole('button', { name: 'Place Order' }).isDisabled(), true)
  // Invoke the form handler directly without making an order request.
  await page.locator('main form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(), /cart has been saved/)
  assert.equal((await storedCart(page)).state.items[0].quantity, 2)
  assert.ok(variantReads.length > 0)
})

test('rendered homepage/shop quick-add and product slug change retain canonical defaults', { timeout: 90000 }, async (t) => {
  const { page } = await pageFixture(t)
  await page.goto(origin)
  await page.getByRole('button', { name: 'Add Baraan to cart', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Add Baraan to cart', exact: true }).click()
  assert.equal((await storedCart(page)).state.items[0].variantId, variantId)
  await page.getByRole('button', { name: 'Close cart', exact: true }).click()
  await page.goto(`${origin}/shop`)
  await page.getByRole('button', { name: 'Add Baraan to cart', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Add Baraan to cart', exact: true }).click()
  assert.equal((await storedCart(page)).state.items[0].quantity, 2)
  await page.getByRole('button', { name: 'Close cart', exact: true }).click()
  await page.goto(`${origin}/product/baraan`)
  await page.getByRole('heading', { name: 'Baraan', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Royal Test', exact: true }).click()
  await page.getByRole('heading', { name: 'Royal Test', exact: true }).waitFor()
  await page.getByRole('button', { name: '100 ml', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Add to Cart', exact: true }).first().click()
  assert.equal((await storedCart(page)).state.items.find((item) => item.productId === otherId).variantId, secondVariantId)
})

test('rendered v1 legacy survives public loading, blocks checkout, supports separate UUID re-add and removal', { timeout: 90000 }, async (t) => {
  const { page } = await pageFixture(t, { wishlist: true, legacy: { version: 1, state: {
    items: [{ productId, size: '50ml', quantity: 2 }],
  } } })
  await page.goto(`${origin}/cart`)
  await page.getByRole('heading', { name: 'Baraan', exact: true }).waitFor()
  assert.equal((await storedCart(page)).state.items[0].variantId, null)
  assert.match(await page.locator('main').innerText(), /Requires reselection/)
  assert.doesNotMatch(await page.locator('main').innerText(), /2,900|5,800/)
  const savedLegacy = await storedCart(page)
  await page.reload()
  await page.getByRole('heading', { name: 'Baraan', exact: true }).waitFor()
  assert.deepEqual(await storedCart(page), savedLegacy)
  await page.goto(`${origin}/checkout`)
  await page.getByRole('heading', { name: 'Order Summary', exact: true }).waitFor()
  assert.match(await page.locator('main aside').innerText(), /Requires reselection/)
  assert.equal(await page.getByRole('button', { name: 'Place Order', exact: true }).isDisabled(), true)
  await page.locator('main form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await page.getByRole('alert').waitFor()
  assert.deepEqual(await storedCart(page), savedLegacy)
  await page.goto(`${origin}/wishlist`)
  await page.getByRole('button', { name: 'Move', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Move', exact: true }).click()
  const items = (await storedCart(page)).state.items
  assert.equal(items[0].variantId, null)
  assert.equal(items[0].quantity, 2)
  assert.equal(items[1].variantId, variantId)
  assert.equal(items[1].quantity, 1)
  await page.goto(`${origin}/cart`)
  await page.getByRole('heading', { name: 'Baraan', exact: true }).first().waitFor()
  await page.locator('main article').filter({ hasText: 'Requires reselection' })
    .getByRole('button', { name: 'Remove Baraan', exact: true }).click()
  assert.deepEqual((await storedCart(page)).state.items.map((item) => [item.variantId, item.quantity]), [[variantId, 1]])
})

test('rendered unavailable Baraan cannot add and never synthesizes 50ml', { timeout: 90000 }, async (t) => {
  const { page } = await pageFixture(t, { variants: [{ ...variantRow, stock_quantity: 0 }, otherVariant] })
  await page.goto(`${origin}/product/baraan`)
  await page.getByRole('heading', { name: 'Baraan', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Add to Cart', exact: true }).first().isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '50ml', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Buy Now', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '50 ml', exact: true }).isDisabled(), true)
})

test('Buy Now reaches guarded checkout with canonical UUID and blocked submit preserves cart', { timeout: 90000 }, async (t) => {
  const { page } = await pageFixture(t)
  await page.goto(`${origin}/product/baraan`)
  await page.getByRole('button', { name: 'Buy Now', exact: true }).click()
  await page.getByRole('heading', { name: 'Order Summary', exact: true }).waitFor()
  assert.ok(page.url().endsWith('/checkout'))
  assert.equal(await page.getByRole('button', { name: 'Place Order', exact: true }).isDisabled(), true)
  const before = await storedCart(page)
  assert.equal(before.state.items[0].variantId, variantId)
  await page.locator('main form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await page.getByRole('alert').waitFor()
  assert.deepEqual(await storedCart(page), before)
})

test('rendered two variants stay separate and quantity controls respect variant stock', { timeout: 90000 }, async (t) => {
  const hundredId = 'ab830eab-2f94-4125-8f4b-efdd0c0f1da9'
  const { page } = await pageFixture(t, { variants: [variantRow,
    { ...variantRow, id: hundredId, option_value: '100 ml', regular_price: 4900, stock_quantity: 2, display_order: 1 }, otherVariant] })
  await page.goto(`${origin}/product/baraan`)
  await page.getByRole('button', { name: '50 ml', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Add to Cart', exact: true }).first().click()
  await page.getByRole('button', { name: 'Close cart', exact: true }).click()
  await page.getByRole('button', { name: '100 ml', exact: true }).click()
  await page.getByRole('button', { name: 'Increase quantity', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Increase quantity', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Add to Cart', exact: true }).first().click()
  const items = (await storedCart(page)).state.items
  assert.deepEqual(items.map((item) => [item.variantId, item.quantity]), [[variantId, 1], [hundredId, 2]])
  await page.getByRole('button', { name: 'Close cart', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Add to Cart', exact: true }).first().isDisabled(), true)
})

async function refreshCatalog(page) {
  await page.getByRole('button', { name: 'Refresh catalog', exact: true }).click()
  await page.locator('[data-testid="refresh"]:enabled').waitFor()
}

test('real service/provider distinguishes populated, zero variants, zero products and failed refresh without cart writes', { timeout: 90000 }, async (t) => {
  const { page, catalog, variantReads } = await pageFixture(t)
  await page.goto(`${origin}/__phase2/product/baraan`)
  await page.getByRole('button', { name: 'Add to Cart', exact: true }).first().click()
  await page.getByRole('button', { name: 'Close cart', exact: true }).click()
  assert.equal(await page.getByTestId('catalog').innerText(), 'success:2')
  await page.evaluate(async () => {
    window.cartWrites = 0; window.cartUpdates = 0
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'royal-fusion-cart') window.cartWrites++
      return original.call(this, key, value)
    }
    const { useCartStore } = await import('/src/store/cartStore.ts')
    useCartStore.subscribe(() => window.cartUpdates++)
  })
  const before = await storedCart(page)
  catalog.variantError = true
  await refreshCatalog(page)
  assert.match(await page.getByTestId('catalog').innerText(), /Unable to load/)
  assert.equal(await page.getByRole('button', { name: '50 ml', exact: true }).count(), 1)
  assert.deepEqual(await storedCart(page), before)
  assert.deepEqual(await page.evaluate(() => [window.cartWrites, window.cartUpdates]), [0, 0])
  catalog.variantError = false; catalog.productError = true
  await refreshCatalog(page)
  assert.deepEqual(await storedCart(page), before)
  assert.deepEqual(await page.evaluate(() => [window.cartWrites, window.cartUpdates]), [0, 0])
  catalog.productError = false
  await refreshCatalog(page)
  assert.equal(await page.getByTestId('catalog').innerText(), 'success:2')
  assert.deepEqual(await page.evaluate(() => [window.cartWrites, window.cartUpdates]), [0, 0])
  catalog.variants = []
  await refreshCatalog(page)
  assert.equal(await page.getByTestId('catalog').innerText(), 'success:2')
  assert.equal(await page.getByRole('button', { name: '50 ml', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Add to Cart', exact: true }).first().isDisabled(), true)
  assert.deepEqual(await storedCart(page), before)
  const reads = variantReads.length
  catalog.products = []
  await refreshCatalog(page)
  assert.equal(await page.getByTestId('catalog').innerText(), 'success:0')
  assert.equal(variantReads.length, reads)
  assert.equal(await page.getByRole('heading', { name: 'Fragrance not found' }).count(), 1)
  assert.deepEqual(await storedCart(page), before)
})

test('initial canonical failure recovers without prototype catalog or guessing legacy identity from a public snapshot', { timeout: 90000 }, async (t) => {
  const { page, catalog } = await pageFixture(t, { variantError: true, legacy: { version: 1,
    state: { items: [{ productId, size: '50ml', quantity: 1 }] } } })
  await page.goto(`${origin}/__phase2/product/baraan`)
  await page.locator('[data-testid="refresh"]:enabled').waitFor()
  assert.match(await page.getByTestId('catalog').innerText(), /Unable to load/)
  assert.equal(await page.getByRole('button', { name: '50 ml', exact: true }).count(), 0)
  assert.equal((await storedCart(page)).state.items[0].variantId, null)
  catalog.variantError = false
  await refreshCatalog(page)
  assert.equal(await page.getByTestId('catalog').innerText(), 'success:2')
  assert.equal((await storedCart(page)).state.items[0].variantId, null)
})

test('same-product refresh preserves variant/gallery/quantity, clamps stock, falls back and resets on route change', { timeout: 90000 }, async (t) => {
  const hundredId = 'ab830eab-2f94-4125-8f4b-efdd0c0f1da9'
  const hundred = { ...variantRow, id: hundredId, option_value: '100 ml', regular_price: 4900, stock_quantity: 8, display_order: 1 }
  const { page, catalog } = await pageFixture(t, { variants: [variantRow, hundred, otherVariant] })
  await page.goto(`${origin}/__phase2/product/baraan`)
  const size = page.getByRole('button', { name: '100 ml', exact: true })
  await size.click()
  const gallery = page.getByRole('button', { name: 'View Baraan gallery 2' })
  await gallery.click()
  const plus = page.getByRole('button', { name: 'Increase quantity', exact: true })
  await plus.click(); await plus.click()
  const quantity = () => plus.locator('..').innerText()
  assert.match(await quantity(), /3/)
  await refreshCatalog(page)
  assert.match(await size.getAttribute('class'), /bg-burgundy/)
  assert.match(await gallery.getAttribute('class'), /border-burgundy/)
  assert.match(await quantity(), /3/)
  catalog.variants = [variantRow, { ...hundred, stock_quantity: 2 }, otherVariant]
  await refreshCatalog(page)
  assert.match(await quantity(), /2/)
  assert.equal(await plus.isDisabled(), true)
  catalog.variants = [variantRow, otherVariant]
  await refreshCatalog(page)
  assert.match(await page.getByRole('button', { name: '50 ml', exact: true }).getAttribute('class'), /bg-burgundy/)
  assert.match(await gallery.getAttribute('class'), /border-burgundy/)
  catalog.variants = [{ ...variantRow, available: false }, otherVariant]
  await refreshCatalog(page)
  assert.equal(await page.getByRole('button', { name: 'Add to Cart', exact: true }).first().isDisabled(), true)
  catalog.variants = [variantRow, hundred, otherVariant]
  await refreshCatalog(page)
  await page.getByRole('button', { name: 'Change product', exact: true }).click()
  await page.getByRole('heading', { name: 'Royal Test', exact: true }).waitFor()
  assert.match(await size.getAttribute('class'), /bg-burgundy/)
  assert.match(await page.getByRole('button', { name: 'View Royal Test gallery 1' }).getAttribute('class'), /border-burgundy/)
  assert.match(await quantity(), /1/)
})

test('unavailable canonical lines share unavailable amounts/removal in cart, drawer and checkout; forced and Enter submits preserve UUID', { timeout: 90000 }, async (t) => {
  const lineId = JSON.stringify([productId, variantId])
  const { page, catalog } = await pageFixture(t, { legacy: { version: 2, state: {
    items: [{ lineId, productId, variantId, size: '50 ml', quantity: 2 }], selectedLineIds: [lineId],
  } } })
  await page.goto(`${origin}/__phase2/cart`)
  await page.getByRole('heading', { name: 'Baraan', exact: true }).waitFor()
  catalog.variants = [otherVariant] // Canonical variant hidden by a subsequent public read.
  await refreshCatalog(page)
  assert.match(await page.locator('main').innerText(), /Unavailable/)
  assert.doesNotMatch(await page.locator('main').innerText(), /2,900|5,800/)
  assert.equal(await page.getByRole('button', { name: 'Remove Baraan', exact: true }).count(), 1)
  await page.getByRole('button', { name: 'Open test cart', exact: true }).click()
  const drawer = page.locator('aside[aria-label="Cart drawer"]')
  assert.match(await drawer.innerText(), /Unavailable/)
  assert.doesNotMatch(await drawer.innerText(), /2,900|5,800/)
  await page.getByRole('button', { name: 'Close cart', exact: true }).click()
  catalog.variants = [{ ...variantRow, available: false }, otherVariant]
  await page.goto(`${origin}/__phase2/checkout`)
  await page.getByRole('heading', { name: 'Order Summary', exact: true }).waitFor()
  const summary = page.locator('main aside')
  assert.match(await summary.innerText(), /Unavailable/)
  assert.doesNotMatch(await summary.innerText(), /2,900|5,800/)
  assert.equal(await page.getByRole('button', { name: 'Remove Baraan', exact: true }).count(), 1)
  assert.equal(await page.getByRole('button', { name: 'Place Order', exact: true }).isDisabled(), true)
  const before = await storedCart(page)
  await page.locator('main form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await page.getByRole('alert').waitFor()
  for (const [label, value] of [['Full Name', 'Test Customer'], ['Phone', '03001234567'], ['Email', 'fixture@example.test'],
    ['Address', 'Test Address'], ['City', 'Lahore'], ['Province / Region', 'Punjab']]) {
    await page.getByLabel(label, { exact: true }).fill(value)
  }
  // Force-enable the DOM submitter and use native Enter submission to exercise the handler guard.
  await page.getByRole('button', { name: 'Place Order', exact: true }).evaluate((button) => { button.disabled = false })
  await page.locator('main form').evaluate((form) => {
    window.nativeSubmits = 0
    form.addEventListener('submit', () => window.nativeSubmits++)
  })
  await page.getByLabel('Full Name', { exact: true }).press('Enter')
  await page.waitForFunction(() => window.nativeSubmits > 0)
  assert.deepEqual(await storedCart(page), before)
  assert.equal(before.state.items[0].variantId, variantId)
  await page.getByRole('button', { name: 'Remove Baraan', exact: true }).click()
  assert.deepEqual((await storedCart(page)).state.items, [])
})
