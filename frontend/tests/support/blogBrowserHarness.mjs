import assert from 'node:assert/strict'
import { before, after } from 'node:test'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { createServer } from 'vite'
import { createPublicBlogsV1Router } from '../../../backend/server/routes/blogsV1.js'
import { requestContext } from '../../../backend/server/middleware/authSecurity.js'
import { blockExternalBlogTestNetwork } from '../../../backend/server/tests/support/sanityBlogFixtures.js'
import { blogFixture, configuration, legacyBlog } from './blogFixtures.mjs'
import { productRow, variantRow } from '../variantFixtures.mjs'

const require = createRequire(import.meta.url)
let playwright
try { playwright = require('playwright') } catch { playwright = require(process.env.ROYAL_FUSION_PLAYWRIGHT_PATH
  ?? path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')) }
let server, browser, network, current
export let origin
before(async () => {
  network = blockExternalBlogTestNetwork()
  const api = express()
  api.use(helmet(), requestContext, cors(), rateLimit({ windowMs: 15 * 60 * 1000, limit: 400, standardHeaders: true, legacyHeaders: false }))
  api.use('/api/v1/public/blogs', async (req, res, next) => {
    const selected = current
    if (!selected) return res.status(503).json({ error: { code: 'BLOGS_UNAVAILABLE' } })
    selected.requests.push({ path: req.originalUrl, method: req.method, headers: req.headers })
    res.on('close', () => { if (!res.writableEnded) selected.cancelled.push(req.originalUrl) })
    const gate = [...selected.gates].find(([suffix]) => req.path === suffix)?.[1]
    if (gate) { gate.startedResolve(); await gate.pending }
    if (res.destroyed) return
    if (selected.mode === 'network') return res.destroy()
    if (selected.mode === 'rate') return res.status(429).send('Fixture rate limit')
    if (selected.mode === 'unavailable') return res.status(503).json({ error: { code: 'BLOGS_UNAVAILABLE', message: 'PRIVATE_FIXTURE_SERVER_STACK' } })
    if (selected.mode === 'malformed') return res.json({ data: [{ html: '<script>unsafe()</script>' }] })
    return createPublicBlogsV1Router(selected.fixture.service)(req, res, next)
  })
  // Unrelated public/auth fixtures are memory-only and cannot write orders or access a database.
  api.get('/api/v1/auth/session', (_req, res) => res.json({ data: { authenticated: false, csrfToken: 'fixture-csrf' } }))
  api.get('/api/public/storefront', (_req, res) => res.json({ products: [], categories: [], collections: [], blogs: [legacyBlog], settings: {}, homepage: {}, shipping: {}, payments: [], seo: [] }))
  api.get(/^\/api\//, (_req, res) => res.json({ data: [] }))
  server = await createServer({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), envDir: false,
    cacheDir: 'node_modules/.vite-blogs-browser', logLevel: 'silent',
    plugins: [{ name: 'fixture-only-blog-integration',
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => req.url?.startsWith('/api/') ? api(req, res, next) : next())
        vite.middlewares.use(async (req, res, next) => {
          if (!req.headers.accept?.includes('text/html')) return next()
          res.setHeader('Content-Type', 'text/html')
          res.end(await vite.transformIndexHtml(req.url, '<div id="root"></div><script type="module" src="/@id/blog-harness"></script>'))
        })
      },
      resolveId(id) { if (id === 'blog-harness') return id },
      load(id) {
        if (id !== 'blog-harness') return
        return `
          import React, {StrictMode, useState} from 'react'; import {createRoot} from 'react-dom/client';
          import {BrowserRouter, Link} from 'react-router-dom'; import App from '/src/App.tsx';
          import {createPublicBlogClient} from '/src/services/publicBlogsApi.ts';
          import {sanityContentService} from '/src/services/sanityContentService.ts';
          const h = React.createElement;
          sanityContentService.getBlogs = async () => {window.__legacyBlogReads = (window.__legacyBlogReads || 0) + 1; return [${JSON.stringify(legacyBlog)}]};
          function Harness() {
            const [client] = useState(() => {
              if (!window.__enableBlogFixture) return undefined;
              const base = createPublicBlogClient({configuration:${JSON.stringify(configuration)}, baseUrl:'/api'});
              if (!window.__ignoreBlogCancellation) return base;
              return {configuration:base.configuration,list:input=>base.list(input),getBySlug:async slug=>{
                const result = await base.getBySlug(slug); (window.__deliveredBlogSlugs ||= []).push(slug); return result;
              }};
            });
            return h(React.Fragment, null,
              h('nav', {'aria-label':'Fixture navigation'},
                h(Link,{to:'/blogs/fragrance-journal'},'Fixture first article'),
                h(Link,{to:'/blogs/second-article'},'Fixture second article'),
                h(Link,{to:'/blogs'},'Fixture journal'),h(Link,{to:'/shop'},'Fixture shop'),h(Link,{to:'/product/baraan'},'Fixture product')),
              h(App, {blogIntegration:client ? {enabled:true,client} : undefined}));
          }
          createRoot(document.getElementById('root')).render(h(StrictMode,null,h(BrowserRouter,null,h(Harness))));
        `
      },
    }],
    define: { 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_API_URL': JSON.stringify('/api'),
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://catalog.invalid'), 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('sb_publishable_test_fixture'),
      'import.meta.env.VITE_SANITY_PROJECT_ID': JSON.stringify(''), 'import.meta.env.VITE_SANITY_DATASET': JSON.stringify('') },
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  await server.listen(); origin = `http://127.0.0.1:${server.httpServer.address().port}`
  try { browser = await playwright.chromium.launch({ headless: true, timeout: 15000 }) }
  catch { browser = await playwright.chromium.launch({ headless: true, timeout: 15000, channel: 'chrome' }) }
}, { timeout: 60000 })
after(async () => { await browser?.close(); await server?.close(); network.restore(); assert.deepEqual(network.attempts, []) })

export async function blogPage(t, { enabled = true, mode = 'normal', documents, ignoreCancellation = false } = {}) {
  const state = { fixture: blogFixture(documents), mode, requests: [], cancelled: [], gates: new Map() }
  current = state
  state.hold = suffix => {
    let release, startedResolve
    const gate = { pending: new Promise(resolve => { release = resolve }), started: new Promise(resolve => { startedResolve = resolve }), startedResolve: () => startedResolve() }
    state.gates.set(suffix, gate)
    return { started: gate.started, release: () => { state.gates.delete(suffix); release() } }
  }
  const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' })
  const errors = [], unexpected = [], writes = [], attempts = []
  let page
  t.after(async () => {
    state.legacyReads = await page.evaluate(() => window.__legacyBlogReads || 0)
    await context.close()
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); assert.deepEqual(writes, [])
    if (enabled) assert.equal(await state.legacyReads, 0)
  })
  await context.addInitScript(({ enabled, ignoreCancellation }) => { window.__enableBlogFixture = enabled; window.__ignoreBlogCancellation = ignoreCancellation; sessionStorage.setItem('royal-fusion-intro-played', 'true'); document.cookie = 'fixture-private-cookie=must-not-be-sent; path=/' }, { enabled, ignoreCancellation })
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()); attempts.push({ path: url.pathname, method: req.method() })
    if (req.method() !== 'GET' && req.method() !== 'HEAD' && req.method() !== 'OPTIONS') { writes.push(url.pathname); return route.abort() }
    const fulfill = body => route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } })
    if (url.hostname === 'catalog.invalid') {
      const table = url.pathname.split('/').at(-1)
      if (table === 'products') return fulfill([productRow])
      if (table === 'product_variants') return fulfill([variantRow])
      if (table === 'categories') return fulfill([{ id: 'category', name: 'Eau de Parfum', slug: 'eau-de-parfum' }])
      if (table === 'public_site_settings') return fulfill([{ key: 'shipping', value: { defaultShippingFee: 250, freeShippingAbove: 7000 } }, { key: 'payments', value: [{ id: 'cod', name: 'Cash on Delivery', active: true }] }])
      return fulfill([])
    }
    if (url.origin === origin) return route.continue()
    if (req.resourceType() === 'image' && (url.hostname === 'cdn.sanity.io' && url.pathname.startsWith('/images/6n1y88j4/production/')
      || url.href === productRow.main_image_url || url.href === productRow.card_image_url)) {
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#fff"/></svg>' })
    }
    if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.fulfill({ body: '', contentType: 'text/css' })
    unexpected.push(url.href); return route.abort()
  })
  page = await context.newPage(); page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  state.legacyReads = 0
  return { page, state, attempts }
}
