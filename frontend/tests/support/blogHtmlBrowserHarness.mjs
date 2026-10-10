import assert from 'node:assert/strict'
import { before, after } from 'node:test'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { createServer } from 'vite'
import { createPublicBlogHtmlRouter } from '../../../backend/server/routes/blogHtml.js'
import { createSanityBlogV1Service } from '../../../backend/server/services/sanityBlogSource.js'
import { requestContext } from '../../../backend/server/middleware/authSecurity.js'
import { makeSanityBlogDocuments, createSanityBlogClientFixture, blockExternalBlogTestNetwork } from '../../../backend/server/tests/support/sanityBlogFixtures.js'

const require = createRequire(import.meta.url)
let playwright
try { playwright = require('playwright') } catch { playwright = require(process.env.ROYAL_FUSION_PLAYWRIGHT_PATH
  ?? path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')) }
export const canonicalOrigin = 'https://shop.example.invalid'
export const mediaConfiguration = { projectId: '6n1y88j4', dataset: 'production' }
export let origin, frontendImages
let server, vite, browser, network, current
before(async () => {
  network = blockExternalBlogTestNetwork()
  vite = await createServer({ root: path.resolve('frontend'), configFile: false, envDir: false, appType: 'custom',
    server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true } })
  frontendImages = await vite.ssrLoadModule('/src/services/blogImages.ts')
  const app = express()
  // HTTP loopback fixture only. Keep other Helmet controls; real HTTPS upgrades are not weakened by the router.
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }), requestContext,
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 400, standardHeaders: true, legacyHeaders: false }))
  app.use('/blogs', (req, res, next) => current ? current.router(req, res, next) : res.status(503).end())
  app.get('/shop', (_req, res) => res.type('html').send('<!doctype html><html lang="en"><head><title>Fixture shop</title></head><body><h1>Unrelated storefront fixture</h1><a href="/blogs">Journal</a></body></html>'))
  app.get('/', (_req, res) => res.type('html').send('<!doctype html><html lang="en"><head><title>Fixture home</title></head><body><h1>Unrelated home fixture</h1><a href="/blogs">Journal</a></body></html>'))
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  origin = `http://127.0.0.1:${server.address().port}`
  // Match existing Royal Fusion harnesses: use installed Chrome if bundled Chromium is absent.
  try { browser = await playwright.chromium.launch({ headless: true, timeout: 15000 }) }
  catch { browser = await playwright.chromium.launch({ headless: true, timeout: 15000, channel: 'chrome' }) }
})
after(async () => {
  await browser?.close(); await vite?.close()
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  network.restore(); assert.deepEqual(network.attempts, [])
})

/** A no-JavaScript browser, native-shaped memory source and synthetic media only. */
export async function withHtmlPage(t, { change = () => {}, limits } = {}) {
  const documents = makeSanityBlogDocuments()
  for (const row of documents) if (row._type === 'sanity.imageAsset') row.url = row.url.replace('/fixture/', '/6n1y88j4/')
  change(documents)
  const fixture = createSanityBlogClientFixture(documents)
  const service = createSanityBlogV1Service({ environment: { CLIENT_ORIGIN: canonicalOrigin }, clientFactory: () => fixture.client })
  const state = { ...fixture, service, external: [], images: [], diagnostics: [] }
  state.router = createPublicBlogHtmlRouter({ service, canonicalOrigin, limits, logger: { warn: value => state.diagnostics.push(value) } })
  current = state
  const context = await browser.newContext({ javaScriptEnabled: false }), page = await context.newPage()
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin === origin) return route.continue()
    if (url.origin === 'https://cdn.sanity.io' && url.pathname.startsWith('/images/6n1y88j4/production/')) {
      state.images.push(url.href)
      return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') })
    }
    state.external.push(url.href); return route.abort()
  })
  t.after(async () => { await context.close(); assert.deepEqual(state.external, []) })
  return { page, state }
}
