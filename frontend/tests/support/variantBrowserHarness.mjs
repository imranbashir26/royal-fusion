import assert from 'node:assert/strict'
import { before, after } from 'node:test'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { productId, secondVariantId, productRow, variantRow } from '../variantFixtures.mjs'

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
let server, browser; export let origin
export const otherId = 'b4035721-28fc-4539-a988-a08264c5a862'
const otherProduct = { ...productRow, id: otherId, slug: 'royal-test', name: 'Royal Test', price: 4500 }
export const otherVariant = { ...variantRow, id: secondVariantId, product_id: otherId, option_value: '100 ml', regular_price: 4500 }

before(async () => {
  server = await createServer({
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
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

export async function pageFixture(t, { webLocks = true, checkout = null, variants = [variantRow, otherVariant], legacy, wishlist = false, products = [productRow, otherProduct], variantError = false } = {}) {
  const catalog = { products, variants, variantError, productError: false }
  const context = await browser.newContext({ serviceWorkers: 'block' })
  t.after(() => context.close())
  await context.addInitScript(({ webLocks, legacy, wishlist, productId }) => {
    if (!webLocks) Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    sessionStorage.setItem('royal-fusion-intro-played', 'true')
    if (legacy && !sessionStorage.getItem('cart-fixture-seeded')) {
      localStorage.setItem('royal-fusion-cart', JSON.stringify(legacy))
      sessionStorage.setItem('cart-fixture-seeded', 'true')
    }
    if (wishlist) localStorage.setItem('royal-fusion-wishlist', JSON.stringify({ state: { productIds: [productId] }, version: 0 }))
  }, { webLocks, legacy, wishlist, productId })
  const orders = [], variantReads = [], errors = []
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.includes('/rpc/')) { orders.push(url.pathname); return route.abort() }
    if (url.pathname.endsWith('/public/orders')) {
      if (!checkout) { orders.push(url.pathname); return route.abort() }
      const body = route.request().postDataJSON(); orders.push(body)
      if (checkout.pending) await checkout.pending
      if (checkout.mode === 'network') return route.abort()
      if (checkout.mode === 'stock') return route.fulfill({ status: 409, json: { error: { code: 'INSUFFICIENT_STOCK', message: 'Not enough stock.' } } })
      const subtotal = body.items.reduce((sum, item) => sum + item.quantity * 2900, 0), shippingFee = checkout.shippingFee ?? 777
      return route.fulfill({ json: { data: checkout.mode === 'malformed' ? { id: 'bad' } : {
        id: body.idempotencyKey, idempotencyKey: body.idempotencyKey, orderNumber: 'RF-20261002-1234ABCD', status: 'Pending', paymentStatus: 'Unpaid',
        paymentMethod: body.paymentMethod, subtotal, discount: 0, shippingFee, total: subtotal + shippingFee, currency: 'PKR', idempotent: orders.slice(0, -1).some((previous) => previous.idempotencyKey === body.idempotencyKey),
      } } })
    }
    if (url.pathname.endsWith('/v1/auth/session')) return route.fulfill({ json: { data: { authenticated: false, csrfToken: 'fixture-csrf' } } })
    if (url.pathname.endsWith('/checkout/quote') && checkout) {
      const body = route.request().postDataJSON(); checkout.quotes ??= []; checkout.quotes.push(body)
      const subtotal = body.items.reduce((sum, item) => sum + item.quantity * 2900, 0), shippingFee = checkout.shippingFee ?? 777
      return route.fulfill({ json: { data: { subtotal, discount: 0, shippingFee, total: subtotal + shippingFee, currency: 'PKR', shippingMethodId: '60000000-0000-4000-8000-000000000001', paymentMethods: ['Cash on Delivery'], orderingEnabled: checkout.orderingEnabled !== false } } })
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
  t.after(() => { assert.deepEqual(errors, []); if (!checkout) assert.deepEqual(orders, []) })
  return { page, orders, variantReads, catalog }
}

export async function storedCart(page) {
  return page.evaluate(async () => {
    const saved = JSON.parse(localStorage.getItem('royal-fusion-cart'))
    if (!saved) return saved
    // The canonical persisted cart includes a base snapshot plus durable entry deltas.
    const { useCartStore } = await import('/src/store/cartStore.ts')
    useCartStore.getState().syncFromStorage()
    const { items, selectedLineIds, lineInstances, lineAppliedUnits } = useCartStore.getState()
    return { ...saved, state: { ...saved.state, items, selectedLineIds, lineInstances, lineAppliedUnits } }
  })
}
