import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { createPublicBlogHtmlRouter } from '../routes/blogHtml.js'
import { createBlogHtmlRenderer, BLOG_HTML_LIMITS } from '../services/blogHtmlRenderer.js'
import { blogHtmlImageUrl, projectBlogHtmlImage } from '../services/blogHtmlMedia.js'
import { createSanityBlogV1Service } from '../services/sanityBlogSource.js'
import { createPublicBlogsV1Router } from '../routes/blogsV1.js'
import { requestContext } from '../middleware/authSecurity.js'
import { createInjectedBlogDelivery } from '../services/blogDelivery.js'
import { makeSanityBlogDocuments, createSanityBlogClientFixture, blockExternalBlogTestNetwork } from './support/sanityBlogFixtures.js'

const canonicalOrigin = 'https://shop.example.invalid'
const configuration = { projectId: '6n1y88j4', dataset: 'production' }
let network
before(() => { network = blockExternalBlogTestNetwork() })
after(() => { network.restore(); assert.deepEqual(network.attempts, []) })
function fixture(change = () => {}) {
  const documents = makeSanityBlogDocuments()
  for (const row of documents) if (row._type === 'sanity.imageAsset') row.url = row.url.replace('/fixture/', '/6n1y88j4/')
  change(documents)
  const native = createSanityBlogClientFixture(documents)
  const service = createSanityBlogV1Service({ environment: { CLIENT_ORIGIN: canonicalOrigin }, clientFactory: () => native.client })
  return { ...native, service }
}
async function start(t, { state = fixture(), service = state.service, limits, limit = 400, logger } = {}) {
  const app = express()
  app.use(helmet(), requestContext, cors({ origin: canonicalOrigin, credentials: true }),
    rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false }))
  app.use('/blogs', createPublicBlogHtmlRouter({ service, canonicalOrigin, limits, logger: logger || { warn() {} } }))
  app.use('/api/v1/public/blogs', createPublicBlogsV1Router(state.service))
  app.use(express.json())
  app.get('/api/v1/unrelated-fixture', (_req, res) => res.json({ data: 'unrelated' }))
  app.get('/shop', (_req, res) => res.send('Unchanged fixture storefront'))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  return { base: `http://127.0.0.1:${server.address().port}`, state }
}

test('explicit injected composition shares service reads between HTML and JSON without constructing another client', async t => {
  const state = fixture(), app = express()
  const delivery = await createInjectedBlogDelivery({ service: state.service, canonicalOrigin, documentMode: true })
  app.use(helmet(),requestContext)
  app.use('/blogs',delivery.htmlRouter);app.use('/api/v1/public/blogs',delivery.apiRouter)
  const server=app.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  const base=`http://127.0.0.1:${server.address().port}`
  assert.equal(state.calls.length,0)
  const json=await (await fetch(base+'/api/v1/public/blogs/fragrance-journal')).json()
  const html=await (await fetch(base+'/blogs/fragrance-journal')).text()
  assert.ok(html.includes(json.data.title));assert.equal(state.calls.length,2)
  assert.ok(state.calls.every(call=>call.options.perspective==='published'))
})

test('only the fixed journal stylesheet is served with CSS MIME, HEAD parity and no filesystem exposure', async t => {
  const {base,state}=await start(t)
  const css=await fetch(base+'/blogs/_assets/journal.css'), text=await css.text()
  assert.equal(css.status,200);assert.match(css.headers.get('content-type'),/^text\/css; charset=utf-8$/)
  assert.equal(css.headers.get('x-content-type-options'),'nosniff');assert.equal(css.headers.get('cache-control'),'no-store')
  assert.doesNotMatch(text,/@import|url\(|expression\(/i)
  const head=await fetch(base+'/blogs/_assets/journal.css',{method:'HEAD'})
  assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),css.headers.get('content-length'));assert.equal(await head.text(),'')
  for(const target of ['/_assets/other.css','/_assets/journal.css?path=secret','/_assets%2Fjournal.css']) assert.equal((await fetch(base+'/blogs'+target)).status,400)
  assert.equal((await fetch(base+'/blogs/_assets/journal.css',{method:'POST'})).status,405)
  assert.equal(state.calls.length,0)
})
const content = async (base, path = '/blogs', options) => { const response = await fetch(`${base}${path}`, options); return { response, html: await response.text() } }

test('valid listing is complete initial HTML with summaries, native ordering, public references and no body query', async t => {
  const { base, state } = await start(t)
  const { response, html } = await content(base)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /^text\/html; charset=utf-8$/)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('etag'), null)
  assert.match(html, /^<!doctype html><html lang="en"><head>/)
  assert.match(html, /<main id="main"><h1>Royal Fusion Journal<\/h1>/)
  assert.ok(html.indexOf('/blogs/latest-article') < html.indexOf('/blogs/fragrance-journal'))
  assert.match(html, /By Royal Fusion Editorial · Education/)
  assert.doesNotMatch(html, /Choosing notes|PRIVATE_FIXTURE|<script|\bonerror=/)
  assert.equal(state.calls.length, 1)
  assert.doesNotMatch(state.calls[0].query, /body\[\]/)
  assert.equal((html.match(/rel="canonical"/g) || []).length, 1)
  assert.match(html, /rel="canonical" href="https:\/\/shop.example.invalid\/blogs"/)
})

test('article renders supported Portable Text including nested lists, quotes, decorators, safe links and image captions', async t => {
  const state = fixture(documents => {
    const post = documents.find(row => row._id === 'post-a')
    post.body.push({ _type: 'block', _key: 'quote', style: 'blockquote', children: [{ _type: 'span', _key: 'q', text: 'A considered choice.', marks: [] }], markDefs: [] },
      { _type: 'block', _key: 'styles', style: 'normal', children: [{ _type: 'span', _key: 's', text: 'Decorated text', marks: ['code', 'underline', 'strike-through'] }], markDefs: [] },
      { _type: 'block', _key: 'local', style: 'normal', children: [{ _type: 'span', _key: 'l', text: 'Visit our shop', marks: ['local-link'] }], markDefs: [{ _type: 'link', _key: 'local-link', href: '/shop?guide=1&sample=2' }] })
  })
  const { base } = await start(t, { state })
  const { response, html } = await content(base, '/blogs/fragrance-journal')
  assert.equal(response.status, 200)
  for (const pattern of [/<h2>Choosing notes<\/h2>/, /<h3>Daily wear<\/h3>/, /<strong>/, /<em>/,
    /<ul>.*<ol>.*Let it settle.*<\/ol>.*<\/ul>/s, /<blockquote>A considered choice.<\/blockquote>/,
    /<code>/, /<u>/, /<del>/, /href="\/shop\?guide=1&amp;sample=2"/, /rel="noopener noreferrer"/,
    /alt="Fragrance journal editorial photograph"/, /width="1200" height="711"/, /<figcaption>An editorial image.<\/figcaption>/]) assert.match(html, pattern)
  assert.doesNotMatch(html, /style=|PRIVATE_FIXTURE|<script|iframe/)
})

test('article metadata uses approved canonicals, SEO overrides, OG fallback and UTC publication/modification dates', async t => {
  const { base } = await start(t)
  const { response, html } = await content(base, '/blogs/fragrance-journal', { headers: { Host: 'evil.example.invalid', 'X-Forwarded-Host': 'evil.example.invalid' } })
  assert.equal(response.status, 200)
  assert.match(html, /<title>Fragrance advice<\/title>/)
  assert.match(html, /name="description" content="Practical fragrance education."/)
  assert.match(html, /property="og:url" content="https:\/\/shop.example.invalid\/blogs\/fragrance-journal"/)
  assert.match(html, /property="og:type" content="article"/)
  assert.match(html, /property="og:image" content="https:\/\/cdn.sanity.io\/images\/6n1y88j4\/production\//)
  assert.match(html, /property="article:published_time" content="2026-10-08T12:00:00.000Z"/)
  assert.match(html, /property="article:modified_time" content="2026-10-09T12:00:00.000Z"/)
  assert.equal((html.match(/rel="canonical"/g) || []).length, 1)
  assert.doesNotMatch(html, /evil.example|PRIVATE_FIXTURE/)
})

test('SEO fallbacks, editorial noindex and distinct OG image are preserved', async t => {
  const state = fixture(documents => {
    const post = documents.find(row => row._id === 'post-a')
    post.seoTitle = null; post.seoDescription = null; post.canonicalUrl = null; post.noIndex = true
    post.ogImage = { ...structuredClone(post.featuredImage), alt: 'Dedicated social image' }
  })
  const { base } = await start(t, { state })
  const { response, html } = await content(base, '/blogs/fragrance-journal')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-robots-tag'), 'noindex,follow')
  assert.match(html, /<title>Fragrance journal<\/title>/)
  assert.match(html, /name="description" content="Choosing a fragrance with confidence."/)
  assert.match(html, /property="og:image:alt" content="Dedicated social image"/)
})

test('page-one defaults normalize and later pages retain their own page/pageSize canonicals and anchors', async t => {
  const { base } = await start(t)
  const first = await content(base, '/blogs?page=1&pageSize=20')
  assert.match(first.html, /rel="canonical" href="https:\/\/shop.example.invalid\/blogs"/)
  const page = await content(base, '/blogs?page=2&pageSize=2')
  assert.equal(page.response.status, 200)
  assert.match(page.html, /rel="canonical" href="https:\/\/shop.example.invalid\/blogs\?page=2&amp;pageSize=2"/)
  assert.match(page.html, /href="\/blogs\?pageSize=2">Previous page/)
  const one = await content(base, '/blogs?pageSize=2')
  assert.match(one.html, /href="\/blogs\?page=2&amp;pageSize=2">Next page/)
  const renderer = createBlogHtmlRenderer({ canonicalOrigin })
  const last = await fixture().service.list({ page: 1, pageSize: 1 })
  last.pagination = { page: 1000, pageSize: 1, total: 1001, totalPages: 1001 }
  const capped = renderer.renderListing(last, { page: 1000, pageSize: 1 })
  assert.doesNotMatch(capped.html, /page=1001/)
})

test('empty first page is 200, nonexistent HTML pages are 404 and the JSON API keeps its existing empty-200 contract', async t => {
  const state = fixture(documents => { documents.splice(0, documents.length) })
  const { base } = await start(t, { state })
  const first = await content(base)
  assert.equal(first.response.status, 200); assert.match(first.html, /No articles have been published yet/)
  const beyond = await content(base, '/blogs?page=2')
  assert.equal(beyond.response.status, 404); assert.doesNotMatch(beyond.html, /rel="canonical"|property="og:/)
  const api = await fetch(`${base}/api/v1/public/blogs?page=2`)
  assert.equal(api.status, 200); assert.deepEqual((await api.json()).data, [])
})

test('invalid pagination and unknown/duplicate parameters return 400 before any source reads', async t => {
  const { base, state } = await start(t)
  for (const query of ['page=0', 'page=1001', 'page=01', 'page=1.5', 'page=1e2', 'page=true', 'page=1&page=2', 'page[0]=1', 'pageSize=51', 'perspective=raw', 'token=PRIVATE_FIXTURE_TOKEN']) {
    const { response, html } = await content(base, `/blogs?${query}`)
    assert.equal(response.status, 400, query); assert.doesNotMatch(html, /PRIVATE|rel="canonical"|property="og:/)
  }
  assert.deepEqual(state.calls, [])
})

test('invalid slugs, malformed URI escapes, extra segments and detail queries are rejected without reads', async t => {
  const { base, state } = await start(t)
  for (const path of ['/Upper', '/two--hyphens', `/${'a'.repeat(97)}`, '/%2farticle', '/%ZZ', '/valid/extra', '/fragrance-journal?page=1']) {
    const { response } = await content(base, `/blogs${path}`)
    assert.equal(response.status, 400, path)
  }
  assert.deepEqual(state.calls, [])
})

test('native unpublished and missing articles are 404 without draft/release or stale metadata leakage', async t => {
  const { base } = await start(t)
  for (const slug of ['missing-article', 'unpublished-article']) {
    const { response, html } = await content(base, `/blogs/${slug}`)
    assert.equal(response.status, 404)
    assert.match(html, /Journal page not found/)
    assert.doesNotMatch(html, /PRIVATE|Fragrance advice|rel="canonical"|property="og:|article:published_time/)
  }
})

test('mutation denial and OPTIONS are read-only, even with malformed request bodies', async t => {
  const { base, state } = await start(t)
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const { response } = await content(base, '/blogs/fragrance-journal', { method, headers: { 'Content-Type': 'application/json' }, body: '{broken' })
    assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET, HEAD, OPTIONS')
  }
  const options = await fetch(`${base}/blogs`, { method: 'OPTIONS' })
  assert.equal(options.status, 204); assert.deepEqual(state.calls, [])
})

test('HEAD preserves GET success/error headers and actual status without bodies or automatic ETags', async t => {
  const { base } = await start(t)
  for (const path of ['/blogs', '/blogs/fragrance-journal', '/blogs/missing-article', '/blogs?page=0']) {
    const get = await content(base, path), head = await fetch(`${base}${path}`, { method: 'HEAD' })
    assert.equal(head.status, get.response.status)
    for (const header of ['content-type', 'content-length', 'cache-control', 'x-robots-tag']) assert.equal(head.headers.get(header), get.response.headers.get(header))
    assert.equal(await head.text(), ''); assert.equal(head.headers.get('etag'), null)
  }
})

test('upstream and deadline failures are safe 503 HTML and do not capture sibling routes', async t => {
  for (const fetcher of [async () => { throw new Error('PRIVATE_FIXTURE_TOKEN stack') }, async () => new Promise(() => {})]) {
    const service = createSanityBlogV1Service({ environment: { CLIENT_ORIGIN: canonicalOrigin, SANITY_BLOG_TIMEOUT_MS: '50' }, clientFactory: () => ({ fetch: fetcher }) })
    const diagnostics = [], { base } = await start(t, { service, logger: { warn: value => diagnostics.push(value) } })
    const { response, html } = await content(base, '/blogs/fragrance-journal')
    assert.equal(response.status, 503); assert.equal(response.headers.get('retry-after'), '60')
    assert.match(html, /Journal temporarily unavailable/); assert.doesNotMatch(html, /PRIVATE|stack|rel="canonical"|property="og:/)
    assert.deepEqual(diagnostics, [{ event: 'blog.html.unavailable', status: 503 }])
    assert.deepEqual(await (await fetch(`${base}/api/v1/unrelated-fixture`)).json(), { data: 'unrelated' })
    assert.equal((await fetch(`${base}/shop`)).status, 200)
  }
})

test('missing references, malformed records and cross-page duplicate slugs fail closed as 503', async t => {
  for (const change of [documents => { documents.find(row => row._id === 'post-a').author = { _type: 'reference', _ref: 'missing' } },
    documents => { documents.find(row => row._id === 'post-a').title = null },
    documents => { const row = structuredClone(documents.find(value => value._id === 'post-a')); row._id = 'post-duplicate'; documents.push(row) }]) {
    const { base } = await start(t, { state: fixture(change) })
    assert.equal((await content(base, '/blogs/fragrance-journal')).response.status, 503)
    assert.equal((await content(base, '/blogs?pageSize=1&page=2')).response.status, 503)
  }
})

test('HTML rendering failures remain full 503 documents without a partially successful article', async t => {
  const valid = await fixture().service.getBySlug('fragrance-journal')
  const broken = structuredClone(valid); broken.data.body.push({ _type: 'embed', _key: 'unsafe', html: '<script>PRIVATE_EXECUTION()</script>' })
  const { base } = await start(t, { service: { list: async () => ({}), getBySlug: async () => broken } })
  const { response, html } = await content(base, '/blogs/fragrance-journal')
  assert.equal(response.status, 503); assert.match(html, /^<!doctype html>/)
  assert.doesNotMatch(html, /Choosing notes|Fragrance journal|PRIVATE_EXECUTION|<script/)
})

test('editorial text and attribute payloads stay escaped, including metadata, body, links and captions', async t => {
  const payload = '<script>alert("x")</script>'
  const state = fixture(documents => {
    const post = documents.find(row => row._id === 'post-a')
    post.title = payload; post.seoTitle = payload; post.seoDescription = '" onmouseover="alert(1)'; post.author.name = payload
    post.featuredImage.alt = '" onerror="alert(1)'; post.featuredImage.caption = payload
    post.body[2].children[0].text = payload
    post.body[2].markDefs[0].href = 'https://example.invalid/guide?a="quoted"&b=2'
  })
  const { base } = await start(t, { state })
  const { response, html } = await content(base, '/blogs/fragrance-journal')
  assert.equal(response.status, 200)
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/)
  assert.match(html, /alt="&quot; onerror=&quot;alert\(1\)"/)
  assert.doesNotMatch(html, /<script|<img[^>]*\sonerror="|<meta[^>]*\sonmouseover="/)
})

test('unsafe links and unsupported Portable Text fail without silently dropping content', async t => {
  for (const change of [post => { post.body[2].markDefs[0].href = 'javascript:alert(1)' },
    post => { post.body[2].markDefs[0].href = '//evil.example.invalid' },
    post => { post.body[2].markDefs[0].href = 'https://user:secret@example.invalid' },
    post => { post.body[0].style = 'h4' }, post => { post.body[0].children[0].marks = ['unknown'] },
    post => { post.body.push({ _type: 'iframe', _key: 'embed', url: 'https://example.invalid' }) }]) {
    const state = fixture(documents => change(documents.find(row => row._id === 'post-a'))), { base } = await start(t, { state })
    const { response, html } = await content(base, '/blogs/fragrance-journal')
    assert.equal(response.status, 503); assert.doesNotMatch(html, /evil.example|secret|<iframe|Choosing notes/)
  }
})

test('foreign canonical origins or paths fail rather than acquiring canonical authority', async t => {
  for (const canonical of ['https://evil.example.invalid/blogs/fragrance-journal', `${canonicalOrigin}/blogs/other`, `${canonicalOrigin}/blogs/fragrance-journal?tracking=1`]) {
    const { base } = await start(t, { state: fixture(documents => { documents.find(row => row._id === 'post-a').canonicalUrl = canonical }) })
    assert.equal((await content(base, '/blogs/fragrance-journal')).response.status, 503)
  }
  for (const origin of ['http://localhost', 'https://user:secret@example.invalid', `${canonicalOrigin}/path`, `${canonicalOrigin}?x=1`]) {
    assert.throws(() => createBlogHtmlRenderer({ canonicalOrigin: origin }))
  }
})

test('image namespace, asset dimensions and geometry are validated before generating credential-free URLs', async () => {
  const image = (await fixture().service.getBySlug('fragrance-journal')).data.featuredImage
  assert.deepEqual(projectBlogHtmlImage(image, configuration), image)
  const url = new URL(blogHtmlImageUrl(image, configuration, 1200, 630))
  assert.equal(url.origin, 'https://cdn.sanity.io'); assert.equal(url.searchParams.get('w'), '1200')
  assert.equal(url.searchParams.get('h'), '630'); assert.ok(url.searchParams.get('rect'))
  for (const change of [value => { value.asset.url = value.asset.url.replace('/6n1y88j4/', '/foreign/') },
    value => { value.asset.width = 1199 }, value => { value.asset._ref = 'image-fixture-invalid-jpg' },
    value => { value.crop.top = 1 }, value => { value.hotspot.width = 2 }, value => { value.asset.url += '?token=PRIVATE_FIXTURE_TOKEN' },
    value => { value.alt = '' }, value => { value.caption = 'x'.repeat(301) }]) {
    const changed = structuredClone(image); change(changed)
    assert.throws(() => blogHtmlImageUrl(changed, configuration, 1200))
  }
  assert.throws(() => blogHtmlImageUrl(image, { ...configuration, dataset: 'private' }, 1200))
  assert.throws(() => blogHtmlImageUrl(image, configuration, 2401))
})

test('foreign images fail the complete document rather than reaching HTML or browsers', async t => {
  const state = fixture(documents => { documents.find(row => row._type === 'sanity.imageAsset').url = 'https://cdn.sanity.io/images/foreign/production/fixture-1200x800.jpg' })
  const { base } = await start(t, { state }), { response, html } = await content(base, '/blogs/fragrance-journal')
  assert.equal(response.status, 503); assert.doesNotMatch(html, /foreign|<img|Choosing notes/)
})

test('rendering work, span, text and output budgets fail safely and cannot be raised beyond reviewed maxima', async t => {
  for (const limits of [{ maxSpans: 1 }, { maxWorkUnits: 1 }, { maxTextBytes: 1 }, { maxHtmlBytes: 512 }]) {
    const { base } = await start(t, { limits }), { response, html } = await content(base, '/blogs/fragrance-journal')
    assert.equal(response.status, 503); assert.match(html, /Journal temporarily unavailable/)
    assert.doesNotMatch(html, /Choosing notes/)
  }
  for (const limits of [{ maxSpans: BLOG_HTML_LIMITS.maxSpans + 1 }, { maxHtmlBytes: 0 }, { arbitrary: 1 }]) assert.throws(() => createBlogHtmlRenderer({ canonicalOrigin, limits }))
})

test('injected middleware keeps the existing limiter, headers and safe sibling routing', async t => {
  const { base } = await start(t, { limit: 1 })
  const first = await fetch(`${base}/blogs`), second = await fetch(`${base}/blogs`)
  assert.equal(first.status, 200); assert.equal(second.status, 429)
  assert.ok(first.headers.get('content-security-policy')); assert.equal(first.headers.get('x-content-type-options'), 'nosniff')
  assert.match(first.headers.get('content-security-policy'), /script-src 'none'/)
  assert.match(first.headers.get('content-security-policy'), /img-src https:\/\/cdn.sanity.io\/images\/6n1y88j4\/production\//)
  assert.match(first.headers.get('content-security-policy'), /upgrade-insecure-requests/)
  assert.equal(first.headers.get('access-control-allow-origin'), canonicalOrigin)
})

test('response-route mismatches and failing diagnostics remain isolated unavailable responses', async t => {
  const response = await fixture().service.getBySlug('second-article')
  const { base } = await start(t, { service: { list: async () => ({}), getBySlug: async () => response }, logger: { warn() { throw new Error('PRIVATE_LOGGER_FAILURE') } } })
  const result = await content(base, '/blogs/fragrance-journal')
  assert.equal(result.response.status, 503); assert.doesNotMatch(result.html, /second-article|PRIVATE/)
})

test('HTML renderer/router remain absent from production startup and activation modules', async () => {
  for (const file of ['../index.js', '../services/blogActivation.js']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /blogHtml|createPublicBlogHtmlRouter|createBlogHtmlRenderer/)
  }
})
