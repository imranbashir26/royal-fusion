import assert from 'node:assert/strict'
import test from 'node:test'
import { withHtmlPage, origin, canonicalOrigin, frontendImages, mediaConfiguration } from './support/blogHtmlBrowserHarness.mjs'
import { blogHtmlImageUrl, projectBlogHtmlImage } from '../../backend/server/services/blogHtmlMedia.js'

test('server article and SEO are readable with JavaScript disabled and no application bundle', async t => {
  const { page, state } = await withHtmlPage(t)
  const response = await page.goto(`${origin}/blogs/fragrance-journal`)
  assert.equal(response.status(), 200)
  assert.equal(await page.title(), 'Fragrance advice')
  assert.equal(await page.getByRole('heading', { name: 'Fragrance journal', exact: true }).count(), 1)
  assert.equal(await page.getByRole('heading', { name: 'Choosing notes' }).count(), 1)
  assert.equal(await page.getByRole('heading', { name: 'Daily wear' }).count(), 1)
  assert.equal(await page.locator('script').count(), 0)
  assert.equal(await page.locator('link[rel="canonical"]').count(), 1)
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `${canonicalOrigin}/blogs/fragrance-journal`)
  assert.equal(await page.locator('meta[property="og:type"]').getAttribute('content'), 'article')
  assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'), `${canonicalOrigin}/blogs/fragrance-journal`)
  assert.equal(await page.locator('time').first().getAttribute('datetime'), '2026-10-08T12:00:00.000Z')
  assert.ok(state.images.length > 0)
})

test('plain HTML pagination links reach independently canonicalized pages without JavaScript', async t => {
  const { page } = await withHtmlPage(t)
  await page.goto(`${origin}/blogs?pageSize=2`)
  await page.getByRole('link', { name: 'Next page' }).click()
  assert.equal(new URL(page.url()).searchParams.get('page'), '2')
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `${canonicalOrigin}/blogs?page=2&pageSize=2`)
  await page.getByRole('link', { name: 'Previous page' }).click()
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `${canonicalOrigin}/blogs?pageSize=2`)
  await page.goto(`${origin}/blogs?page=1&pageSize=20`)
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `${canonicalOrigin}/blogs`)
})

test('article links and shop/home navigation remain ordinary same-origin anchors', async t => {
  const { page } = await withHtmlPage(t)
  await page.goto(`${origin}/blogs`)
  const articleLink = page.locator('main h2 a[href="/blogs/fragrance-journal"]')
  assert.equal(await articleLink.count(), 1)
  await articleLink.click()
  assert.equal(new URL(page.url()).pathname, '/blogs/fragrance-journal')
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Shop', exact: true }).click()
  assert.equal(await page.getByRole('heading', { name: 'Unrelated storefront fixture' }).count(), 1)
  await page.getByRole('link', { name: 'Journal', exact: true }).click()
  await page.getByRole('link', { name: 'Royal Fusion', exact: true }).click()
  assert.equal(await page.getByRole('heading', { name: 'Unrelated home fixture' }).count(), 1)
})

test('parsed DOM proves editorial payloads remain text and attribute values rather than executable elements', async t => {
  const payload = '<script>window.PRIVATE_EXECUTION=1</script>'
  const { page } = await withHtmlPage(t, { change(documents) {
    const post = documents.find(row => row._id === 'post-a')
    post.title = payload; post.seoTitle = payload; post.seoDescription = '" onmouseover="PRIVATE_EXECUTION'
    post.featuredImage.alt = '" onerror="PRIVATE_EXECUTION'; post.featuredImage.caption = payload
    post.body[2].children[0].text = payload
  } })
  const response = await page.goto(`${origin}/blogs/fragrance-journal`)
  assert.equal(response.status(), 200)
  assert.equal(await page.title(), payload)
  assert.equal(await page.locator('main h1').textContent(), payload)
  assert.equal(await page.locator('meta[name="description"]').getAttribute('content'), '" onmouseover="PRIVATE_EXECUTION')
  assert.equal(await page.locator('main img').first().getAttribute('alt'), '" onerror="PRIVATE_EXECUTION')
  assert.equal(await page.locator('script, iframe, [onerror], [onmouseover]').count(), 0)
  assert.equal(await page.locator('figcaption').first().textContent(), payload)
})

test('missing, unpublished, invalid and failed pages have actual HTTP errors and no stale article metadata', async t => {
  const { page } = await withHtmlPage(t)
  await page.goto(`${origin}/blogs/fragrance-journal`)
  for (const [path, status] of [['/blogs/missing-article', 404], ['/blogs/unpublished-article', 404], ['/blogs?page=1000', 404], ['/blogs?page=0', 400]]) {
    const response = await page.goto(`${origin}${path}`)
    assert.equal(response.status(), status)
    assert.equal(await page.locator('link[rel="canonical"], meta[property^="og:"]').count(), 0)
    assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex,follow')
    assert.doesNotMatch(await page.locator('body').textContent(), /PRIVATE_FIXTURE|Choosing notes/)
  }
})

test('budget failures are complete server-visible 503 documents with safe metadata', async t => {
  const { page } = await withHtmlPage(t, { limits: { maxSpans: 1 } })
  const response = await page.goto(`${origin}/blogs/fragrance-journal`)
  assert.equal(response.status(), 503)
  assert.equal(await page.getByRole('heading', { name: 'Journal temporarily unavailable' }).count(), 1)
  assert.equal(await page.locator('link[rel="canonical"], meta[property^="og:"], main img').count(), 0)
})

test('editorial noindex, author/category text, body image alt/caption and nested lists survive browser parsing', async t => {
  const { page } = await withHtmlPage(t, { change(documents) { documents.find(row => row._id === 'post-a').noIndex = true } })
  await page.goto(`${origin}/blogs/fragrance-journal`)
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex,follow')
  assert.match(await page.locator('main').textContent(), /By Royal Fusion Editorial · Education/)
  assert.equal(await page.locator('main ul ol').count(), 1)
  assert.equal(await page.locator('main img').first().getAttribute('width'), '1200')
  assert.equal(await page.locator('main img').first().getAttribute('height'), '711')
  assert.equal(await page.locator('main img').first().getAttribute('alt'), 'Fragrance journal editorial photograph')
  assert.equal(await page.locator('main figcaption').first().textContent(), 'An editorial image.')
  assert.doesNotMatch(await page.content(), /PRIVATE_FIXTURE/)
})

test('server and unchanged frontend image helpers agree on valid geometry, URLs and rejection cases', async t => {
  const { state } = await withHtmlPage(t)
  const image = (await state.service.getBySlug('fragrance-journal')).data.featuredImage
  assert.deepEqual(projectBlogHtmlImage(image, mediaConfiguration), frontendImages.projectBlogImage(image, mediaConfiguration))
  for (const [width, height] of [[800, 500], [1200, undefined], [1200, 630]]) {
    assert.equal(blogHtmlImageUrl(image, mediaConfiguration, width, height), frontendImages.blogImageUrl(image, mediaConfiguration, width, height))
  }
  for (const change of [value => { value.asset.url = value.asset.url.replace('/6n1y88j4/', '/foreign/') },
    value => { value.crop.left = 1 }, value => { value.hotspot.x = -1 }, value => { value.asset.width = 2 }]) {
    const broken = structuredClone(image); change(broken)
    assert.throws(() => projectBlogHtmlImage(broken, mediaConfiguration))
    assert.throws(() => frontendImages.projectBlogImage(broken, mediaConfiguration))
  }
})
