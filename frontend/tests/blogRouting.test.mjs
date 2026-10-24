import assert from 'node:assert/strict'
import test from 'node:test'
import { blogPage, origin } from './support/blogBrowserHarness.mjs'

test('deployment rewrites preserve default-disabled SPA blogs, refresh, APIs and independent XML handling', { timeout: 90000 }, async t => {
  const { page, state } = await blogPage(t, { enabled: false, vercelRouting: true })
  for (const path of ['/blogs', '/blogs/']) {
    assert.equal((await page.goto(origin + path)).status(), 200)
    await page.getByRole('heading', { name: 'Royal Fusion Journal', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Legacy journal', exact: true }).waitFor()
    assert.equal(await page.getByRole('status').filter({ hasText: 'Unable to load the product catalog.' }).count(), 0)
    assert.equal((await page.reload()).status(), 200)
    await page.getByRole('heading', { name: 'Legacy journal', exact: true }).waitFor()
  }
  assert.equal((await page.goto(origin + '/blogs/legacy-story')).status(), 200)
  await page.getByText('Legacy paragraph.', { exact: true }).waitFor()
  assert.equal((await page.reload()).status(), 200)
  await page.getByText('Legacy paragraph.', { exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/blogs/legacy-story')

  assert.equal((await page.goto(origin + '/about')).status(), 200)
  await page.getByRole('heading', { name: 'A Palace-Inspired Perfume House', exact: true }).waitFor()
  assert.equal((await page.goto(origin + '/admin/login')).status(), 200)
  await page.getByRole('heading', { name: /admin/i }).waitFor()
  assert.equal((await page.goto(origin + '/cart')).status(), 200)
  await page.getByRole('heading', { name: /cart/i }).first().waitFor()
  await page.getByRole('button', { name: /account/i }).click()
  await page.getByRole('dialog').waitFor()

  const health = await page.request.get(origin + '/api/health')
  assert.equal(health.status(), 200)
  assert.deepEqual(await health.json(), { status: 'ok', fixture: 'belmo-health' })
  const sitemap = await page.request.get(origin + '/blog-sitemap.xml')
  assert.equal(sitemap.status(), 404)
  assert(!/xml/i.test(sitemap.headers()['content-type'] ?? ''), 'Missing XML must not masquerade as a valid sitemap')
  assert(!/id=["']root["']/.test(await sitemap.text()), 'Sitemap must not return the SPA shell')
  assert(state.proxyRequests.some(row => row.path === '/api/health' && row.destination.endsWith('/api/health')))
  assert(state.proxyRequests.some(row => row.path === '/blog-sitemap.xml'))
  assert(!state.proxyRequests.some(row => row.path === '/blogs' || row.path.startsWith('/blogs/')))
  assert(state.priceRequests.length > 0, 'Existing catalog fixture must supply valid pricing before storefront acceptance')
  assert(!state.proxyRequests.some(row => row.path.startsWith('/api/v1/public/blogs')))
  assert.deepEqual(state.requests, [], 'Disabled frontend must not use the new blog API')
  assert.equal(await page.evaluate(() => window.__blogClientConstructions || 0), 0)
  assert(await page.evaluate(() => window.__legacyBlogReads > 0))
})
