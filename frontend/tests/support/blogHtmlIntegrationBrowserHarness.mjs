import assert from 'node:assert/strict'
import { before, after } from 'node:test'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import { createServer } from 'vite'
import { requestContext } from '../../../backend/server/middleware/authSecurity.js'
import { createInjectedBlogDelivery } from '../../../backend/server/services/blogDelivery.js'
import { blockExternalBlogTestNetwork } from '../../../backend/server/tests/support/sanityBlogFixtures.js'
import { blogFixture, configuration, legacyBlog } from './blogFixtures.mjs'
import { productRow, variantRow, productId, variantId, secondVariantId } from '../variantFixtures.mjs'

const require = createRequire(import.meta.url)
let playwright
try { playwright = require('playwright') } catch { playwright = require(process.env.ROYAL_FUSION_PLAYWRIGHT_PATH
  ?? path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')) }
let vite, browser, network, current
export let origin
export { configuration, productId, variantId, secondVariantId }
export const customer = { id: '00000000-0000-4000-8000-000000000101', name: 'Fixture Customer', email: 'customer@example.invalid', phone: '', address: '', city: '', province: '' }
export const lineId = JSON.stringify([productId, variantId])
export const entryId = '00000000-0000-4000-8000-000000000201'
export const consumedKey = `royal-fusion-consumed-units-v1:${entryId}`
export const historicalKey = 'royal-fusion-consumption-v1:00000000-0000-4000-8000-000000000301'
export const intentKey = 'royal-fusion-checkout-intent-v1'
export const savedCart = { version: 2, state: {
  items: [{ lineId, productId, variantId, identity: 'canonical', size: '50 ml', quantity: 2 }],
  selectedLineIds: [lineId], lineInstances: { [lineId]: entryId }, lineAppliedUnits: { [lineId]: 1 },
} }
const csrf = 'fixture-csrf'
before(async () => {
  network = blockExternalBlogTestNetwork()
  const app = express()
  // Only this HTTP loopback fixture omits HTTPS upgrade. No application middleware changes.
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }), requestContext,
    cors({ origin: configuration.canonicalOrigin, credentials: true }),
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 400, standardHeaders: true, legacyHeaders: false }))
  app.use((req, res, next) => {
    if (!current) return res.status(503).end()
    current.requests.push({ path: req.originalUrl, method: req.method, cookie: req.headers.cookie || '', csrf: req.get('X-RF-CSRF') || '' })
    next()
  })
  app.use('/blogs', (req, res, next) => current.delivery.htmlRouter ? current.delivery.htmlRouter(req, res, next) : next())
  app.use('/api/v1/public/blogs', (req, res, next) => current.delivery.apiRouter(req, res, next))
  // Mock auth and order endpoints only. Never import index.js, SQL services or real env.
  app.use(cookieParser(), express.json())
  app.get('/api/v1/auth/session', (req, res) => {
    const role = req.cookies['fixture-session']
    const authenticated = ['customer', 'admin'].includes(role)
    res.json({ data: { authenticated, csrfToken: csrf, ...(authenticated ? { identity: { id: customer.id, email: customer.email, emailVerified: true } } : {}),
      ...(role === 'admin' ? { administrator: { userId: customer.id, name: 'Fixture Administrator', role: 'Administrator', roleKey: 'admin', permissions: ['orders.read'] } } : {}) } })
  })
  app.post('/api/v1/auth/signin', (req, res) => {
    if (req.get('X-RF-CSRF') !== csrf) return res.status(403).json({ error: { code: 'CSRF_INVALID' } })
    res.cookie('fixture-session', 'customer', { httpOnly: true, sameSite: 'lax', path: '/' })
    res.json({ data: { authenticated: true } })
  })
  app.post('/api/v1/auth/signout', (req, res) => {
    if (req.get('X-RF-CSRF') !== csrf) return res.status(403).json({ error: { code: 'CSRF_INVALID' } })
    res.clearCookie('fixture-session', { httpOnly: true, sameSite: 'lax', path: '/' }); res.status(204).end()
  })
  app.get('/api/v1/customer/profile', (req, res) => req.cookies['fixture-session'] === 'customer'
    ? res.json({ data: customer }) : res.status(403).json({ error: { code: 'PERMISSION_DENIED' } }))
  app.post('/api/v1/public/checkout/quote', (req, res) => {
    const subtotal = req.body.items.reduce((total, item) => total + item.quantity * 2900, 0), shippingFee = 777
    res.json({ data: { subtotal, discount: 0, shippingFee, total: subtotal + shippingFee, currency: 'PKR',
      shippingMethodId: '60000000-0000-4000-8000-000000000001', paymentMethods: ['Cash on Delivery'], orderingEnabled: current.orderingEnabled } })
  })
  app.post('/api/v1/public/orders', (req, res) => {
    const body = req.body, previous = current.receipts.get(body.idempotencyKey)
    current.orders.push(body)
    if (!current.orderingEnabled) return res.status(503).json({ error: { code: 'ORDERING_UNAVAILABLE' } })
    if (previous && JSON.stringify(previous.request) !== JSON.stringify(body)) return res.status(409).json({ error: { code: 'IDEMPOTENCY_CONFLICT' } })
    const subtotal = body.items.reduce((total, item) => total + item.quantity * 2900, 0)
    const receipt = previous?.receipt ?? { id: body.idempotencyKey, idempotencyKey: body.idempotencyKey, orderNumber: 'RF-20261011-1234ABCD',
      status: 'Pending', paymentStatus: 'Unpaid', paymentMethod: body.paymentMethod, subtotal, discount: 0, shippingFee: 777, total: subtotal + 777, currency: 'PKR' }
    if (!previous) current.receipts.set(body.idempotencyKey, { request: structuredClone(body), receipt })
    // Physical socket loss is reserved for the separate transport diagnostic.
    if (current.destroyResponse) return res.destroy()
    res.json({ data: { ...receipt, idempotent: Boolean(previous) } })
  })
  app.get('/api/public/storefront', (_req, res) => res.json({ products: [], categories: [], collections: [], blogs: [legacyBlog], settings: {}, homepage: {}, shipping: {}, payments: [], seo: [] }))
  app.use('/api', (_req, res) => res.json({ data: [] }))
  vite = await createServer({ root: path.resolve('frontend'), envDir: false, cacheDir: 'node_modules/.vite-blog-html-integration', logLevel: 'silent',
    plugins: [{ name: 'injected-blog-document-integration',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const pathname = new URL(req.url, 'http://fixture.invalid').pathname
          if (pathname.startsWith('/api/') || current?.documentMode && /^\/blogs(?:\/|$)/.test(pathname)) return app(req, res, next)
          next()
        })
        server.middlewares.use(async (req, res, next) => {
          if (!req.headers.accept?.includes('text/html')) return next()
          res.setHeader('Content-Type', 'text/html')
          res.end(await server.transformIndexHtml(req.url, '<div id="root"></div><script type="module" src="/@id/blog-html-integration"></script>'))
        })
      },
      resolveId(id) { if (id === 'blog-html-integration') return id },
      load(id) {
        if (id !== 'blog-html-integration') return
        return `import React,{StrictMode} from 'react'; import {createRoot} from 'react-dom/client';
          import {BrowserRouter} from 'react-router-dom'; import App from '/src/App.tsx'; import '/src/index.css';
          import {createPublicBlogClient} from '/src/services/publicBlogsApi.ts';
          import {sanityContentService} from '/src/services/sanityContentService.ts';
          sanityContentService.getBlogs=async()=>{window.__legacyBlogReads=(window.__legacyBlogReads||0)+1;return [${JSON.stringify(legacyBlog)}]};
          const configuration=${JSON.stringify(configuration)};
          const integration=window.__nativeBlogs ? {enabled:true,documentMode:window.__documentMode===true,client:createPublicBlogClient({configuration,baseUrl:'/api'})} : undefined;
          window.__reactDocument=crypto.randomUUID();
          createRoot(document.getElementById('root')).render(React.createElement(StrictMode,null,React.createElement(BrowserRouter,null,React.createElement(App,{blogIntegration:integration}))));`
      },
    }], define: { 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_API_URL': JSON.stringify('/api'),
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://catalog.invalid'), 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('sb_publishable_test_fixture'),
      'import.meta.env.VITE_SANITY_PROJECT_ID': JSON.stringify(''), 'import.meta.env.VITE_SANITY_DATASET': JSON.stringify('') },
    server: { host: '127.0.0.1', port: 0, hmr: false },
  })
  await vite.listen(); origin = `http://127.0.0.1:${vite.httpServer.address().port}`
  try { browser = await playwright.chromium.launch({ headless: true, timeout: 15000 }) }
  catch { browser = await playwright.chromium.launch({ headless: true, timeout: 15000, channel: 'chrome' }) }
}, { timeout: 60000 })
after(async () => { await browser?.close(); await vite?.close(); network.restore(); assert.deepEqual(network.attempts, []) })

export async function integrationPage(t, { documentMode = true, nativeBlogs = true, auth = '', seedCart = false, orderingEnabled = true, javaScriptEnabled = true, observeCheckout = false, change = () => {} } = {}) {
  const fixture = blogFixture(); change(fixture.records)
  const diagnostics = []
  const delivery = await createInjectedBlogDelivery({ service: fixture.service, canonicalOrigin: configuration.canonicalOrigin, documentMode, logger: { warn: value => diagnostics.push(value) } })
  const state = { fixture, delivery, documentMode, diagnostics, requests: [], orders: [], receipts: new Map(), orderingEnabled, lostResponse: false, destroyResponse: false, unexpected: [], errors: [],
    checkout: { uiEvents: [], applicationFetches: [], browserRequests: [], controlledLosses: [] } }
  current = state
  const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce', javaScriptEnabled })
  if (auth) await context.addCookies([{ name: 'fixture-session', value: auth, url: origin, httpOnly: true, sameSite: 'Lax' }])
  if (javaScriptEnabled) await context.addInitScript(({ documentMode, nativeBlogs, seedCart, savedCart, consumedKey, historicalKey, origin }) => {
    if (location.origin !== origin) return
    window.__documentMode = documentMode; window.__nativeBlogs = nativeBlogs
    sessionStorage.setItem('royal-fusion-intro-played', 'true')
    if (seedCart && !sessionStorage.getItem('journal-cart-seeded')) {
      localStorage.setItem('royal-fusion-cart', JSON.stringify(savedCart))
      localStorage.setItem(consumedKey, JSON.stringify({ version: 1, entryId: savedCart.state.lineInstances[savedCart.state.items[0].lineId], quantity: 1 }))
      localStorage.setItem(historicalKey, 'preserved-fixture-consumption-record')
      sessionStorage.setItem('journal-cart-seeded', 'true')
    }
  }, { documentMode, nativeBlogs, seedCart, savedCart, consumedKey, historicalKey, origin })
  if (observeCheckout) {
    await context.exposeBinding('__recordCheckoutObservation', (_source, { type, ...value }) => state.checkout[type].push(value))
    await context.addInitScript(({ origin }) => {
      if (location.origin !== origin) return
      const record = (type, value) => { void window.__recordCheckoutObservation({ type, ...value, time: new Date().toISOString() }) }
      document.addEventListener('click', event => {
        const label = event.target.closest?.('button')?.textContent.trim()
        if (['Place Order', 'Retry saved attempt'].includes(label)) record('uiEvents', { event: 'click', trusted: event.isTrusted, label })
      }, true)
      document.addEventListener('submit', event => {
        if (event.target.matches('main form')) record('uiEvents', { event: 'submit', trusted: event.isTrusted })
      }, true)
      const originalFetch = window.fetch
      window.fetch = function (input, init) {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href)
        if (url.origin === origin && url.pathname === '/api/v1/public/orders') record('applicationFetches', {
          method: init?.method ?? 'GET', idempotencyKey: JSON.parse(init.body).idempotencyKey,
        })
        return originalFetch.call(this, input, init)
      }
    }, { origin })
    context.on('request', request => {
      const url = new URL(request.url())
      if (url.origin === origin && url.pathname === '/api/v1/public/orders') state.checkout.browserRequests.push({
        method: request.method(), idempotencyKey: request.postDataJSON().idempotencyKey,
      })
    })
  }
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    const fulfill = value => route.fulfill({ json: value, headers: { 'access-control-allow-origin': '*' } })
    if (url.origin === origin) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !['/api/v1/auth/signin','/api/v1/auth/signout','/api/v1/public/checkout/quote','/api/v1/public/orders'].includes(url.pathname)) {
        state.unexpected.push(`${method} ${url.pathname}`); return route.abort()
      }
      if (state.lostResponse && method === 'POST' && url.pathname === '/api/v1/public/orders') {
        // Complete one upstream mock operation, then withhold its response from the
        // browser. Socket destruction can replay POSTs across Chrome's warm pool.
        const response = await route.fetch({ maxRetries: 0, maxRedirects: 0 })
        assert.equal(response.status(), 200, 'controlled loss requires a completed mock order')
        const receipt = (await response.json()).data
        assert.equal(receipt.idempotencyKey, request.postDataJSON().idempotencyKey)
        state.checkout.controlledLosses.push({ idempotencyKey: receipt.idempotencyKey, orderCount: state.orders.length, receiptCount: state.receipts.size })
        await response.dispose()
        return route.abort()
      }
      return route.continue()
    }
    if (url.hostname === 'catalog.invalid' && method === 'GET' && !url.pathname.includes('/rpc/')) {
      const table = url.pathname.split('/').at(-1)
      if (table === 'products') return fulfill([productRow])
      if (table === 'product_variants') return fulfill([variantRow, { ...variantRow, id: secondVariantId, option_value: '100 ml', display_order: 1 }])
      if (table === 'categories') return fulfill([{ id: 'category', name: 'Eau de Parfum', slug: 'eau-de-parfum' }])
      if (table === 'public_site_settings') return fulfill([{ key: 'shipping', value: { defaultShippingFee: 250, freeShippingAbove: 7000 } }, { key: 'payments', value: [{ id: 'cod', name: 'Cash on Delivery', active: true }] }])
      return fulfill([])
    }
    if (request.resourceType() === 'image' && url.origin === 'https://cdn.sanity.io' && url.pathname.startsWith('/images/6n1y88j4/production/')) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') })
    if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.fulfill({ body: '', contentType: 'text/css' })
    state.unexpected.push(url.href); return route.abort()
  })
  context.on('page', page => page.on('pageerror', error => state.errors.push(error.message)))
  const page = await context.newPage(); page.setDefaultTimeout(20000)
  t.after(async () => { await context.close(); assert.deepEqual(state.errors, []); assert.deepEqual(state.unexpected, []) })
  return { page, context, state }
}

export async function storageSnapshot(page) {
  return page.evaluate(({ consumedKey, historicalKey, intentKey }) => ({ cart: localStorage.getItem('royal-fusion-cart'), consumed: localStorage.getItem(consumedKey), historical: localStorage.getItem(historicalKey), intent: sessionStorage.getItem(intentKey) }), { consumedKey, historicalKey, intentKey })
}
export async function projectedCart(page) {
  return page.evaluate(async () => {
    const { useCartStore } = await import('/src/store/cartStore.ts')
    useCartStore.getState().syncFromStorage()
    const { items, selectedLineIds, lineInstances, lineAppliedUnits } = useCartStore.getState()
    return { items, selectedLineIds, lineInstances, lineAppliedUnits }
  })
}
export async function fillCheckout(page) {
  for (const [label,value] of [['Full Name','Fixture Customer'],['Email','customer@example.invalid'],['Phone','00000000000'],['Address','Fixture Address'],['City','Lahore'],['Province / Region','Punjab']]) await page.getByLabel(label,{exact:true}).fill(value)
  await page.waitForFunction(() => { const button = [...document.querySelectorAll('button')].find(button => button.textContent.includes('Place Order')); return Boolean(button && !button.disabled) })
}
