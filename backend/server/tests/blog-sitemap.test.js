import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { requestContext } from '../middleware/authSecurity.js'
import { BlogApiError, BlogRepository } from '../services/blogRepository.js'
import { BlogV1Service } from '../services/blogV1Service.js'
import { createSanityBlogSource } from '../services/sanityBlogSource.js'
import { SANITY_BLOG_SNAPSHOT_QUERY } from '../services/sanityBlogQueries.js'
import { createBlogSitemap, escapeSitemapXml } from '../services/blogSitemap.js'
import { createPublicBlogHtmlRouter } from '../routes/blogHtml.js'
import { createPublicBlogSitemapRouter } from '../routes/blogSitemap.js'
import { createPublicBlogsV1Router } from '../routes/blogsV1.js'
import { blockExternalBlogTestNetwork, createSanityBlogClientFixture, makeSanityBlogDocuments } from './support/sanityBlogFixtures.js'

const canonicalOrigin = 'https://shop.example.invalid'
let network
before(() => { network = blockExternalBlogTestNetwork() })
after(() => { network.restore(); assert.deepEqual(network.attempts, []) })
const unavailable = error => error instanceof BlogApiError && error.status === 503 && error.message === 'Articles are temporarily unavailable.'
const locations = xml => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])
function fixture({ change = () => {}, transform = value => value, timeoutMs = 5000 } = {}) {
  const documents = makeSanityBlogDocuments()
  for (const row of documents) if (row._type === 'sanity.imageAsset') row.url = row.url.replace('/fixture/', '/6n1y88j4/')
  change(documents)
  const native = createSanityBlogClientFixture(documents, { honorPerspective: false })
  const source = createSanityBlogSource({ client: { async fetch(...args) { return transform(await native.client.fetch(...args)) } }, timeoutMs })
  const repository = new BlogRepository({ source, canonicalOrigin }), service = new BlogV1Service(repository)
  return { ...native, source, repository, service, sitemap: createBlogSitemap({ service, canonicalOrigin }) }
}
function population(count) {
  return rows => {
    const template = structuredClone(rows.find(row => row._id === 'post-a'))
    rows.splice(0, rows.length, ...rows.filter(row => row._type !== 'blogPost'))
    for (let index = 0; index < count; index++) rows.push({ ...structuredClone(template), _id: `post-${String(index).padStart(3, '0')}`,
      slug: { current: `article-${index}` }, canonicalUrl: null })
  }
}
async function start(t, { state = fixture(), service = state.service, limit = 400, logger = { warn() {} } } = {}) {
  const app = express()
  app.use(helmet(), requestContext, cors({ origin: canonicalOrigin }), rateLimit({ windowMs: 60000, limit, standardHeaders: true, legacyHeaders: false }))
  app.use('/blog-sitemap.xml', createPublicBlogSitemapRouter({ service, canonicalOrigin, logger }))
  app.use('/blogs', createPublicBlogHtmlRouter({ service: state.service, canonicalOrigin, logger }))
  app.use('/api/v1/public/blogs', createPublicBlogsV1Router(state.service))
  app.use(express.json())
  app.get('/unrelated', (_req, res) => res.json({ unchanged: true }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  return { base: `http://127.0.0.1:${server.address().port}`, state }
}

test('complete published collection yields deterministic XML namespace, HTTPS URLs and actual modification dates', async () => {
  const state = fixture(), xml = await state.sitemap.generate()
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/)
  assert.ok(xml.endsWith('</urlset>\n'))
  assert.deepEqual(locations(xml), ['latest-article', 'fragrance-journal', 'second-article', 'oldest-article'].map(slug => `${canonicalOrigin}/blogs/${slug}`))
  assert.equal((xml.match(/<lastmod>2026-10-09T12:00:00.000Z<\/lastmod>/g) || []).length, 4)
  assert.doesNotMatch(xml, /PRIVATE|token|DOCTYPE|ENTITY|<title>|<body>|changefreq|priority/)
  assert.equal(await state.sitemap.generate(), xml)
})

test('one bounded query shares the existing client, projection and published options without API pagination', async () => {
  const state = fixture(); await state.sitemap.generate()
  assert.equal(state.calls.length, 1)
  const call = state.calls[0]
  assert.equal(call.query, SANITY_BLOG_SNAPSHOT_QUERY); assert.deepEqual(call.params, {})
  assert.equal(call.options.perspective, 'published'); assert.equal(call.options.useCdn, false)
  assert.equal(call.options.stega, false); assert.equal(call.options.resultSourceMap, false)
  assert.ok(call.options.signal instanceof AbortSignal)
})

test('native draft, unpublished, release and noIndex content stay out even when a client ignores perspective', async () => {
  const state = fixture({ change: rows => { rows.find(row => row._id === 'post-a').noIndex = true } })
  const xml = await state.sitemap.generate()
  assert.equal(locations(xml).length, 3)
  assert.doesNotMatch(xml, /fragrance-journal|unpublished|PRIVATE|drafts|versions/)
})

test('a genuinely empty published collection succeeds, distinct from an unavailable source', async () => {
  const state = fixture({ change: population(0) })
  assert.deepEqual(locations(await state.sitemap.generate()), [])
  assert.equal(state.calls.length, 1)
})

test('all 50 articles at the query boundary are enumerated once with no missing last article', async () => {
  const state = fixture({ change: population(50) }), xml = await state.sitemap.generate()
  assert.equal(locations(xml).length, 50); assert.equal(new Set(locations(xml)).size, 50)
  assert.equal(locations(xml).at(-1), `${canonicalOrigin}/blogs/article-49`)
  assert.equal(state.calls.length, 1)
})

test('51 published articles fail before body retrieval, even if the extra article is noIndex', async () => {
  let raw
  const state = fixture({ change: rows => { population(51)(rows); rows.find(row => row._id === 'post-050').noIndex = true }, transform: value => { raw = value; return value } })
  await assert.rejects(state.sitemap.generate(), unavailable)
  assert.equal(raw.total, 51); assert.deepEqual(raw.documents, []); assert.equal(state.calls.length, 1)
})

test('malicious or invalid slugs fail the complete generation instead of producing injected XML', async () => {
  for (const slug of ['../secret', 'Upper', 'a/b', 'a?x=1', 'a#x', '<loc>evil</loc>', 'two--hyphens', 'a'.repeat(97)]) {
    await assert.rejects(fixture({ change: rows => { rows.find(row => row._id === 'post-a').slug.current = slug } }).sitemap.generate(), unavailable)
  }
})

test('unsafe, credentialed, foreign, query, hash and mismatched canonical values fail closed', async () => {
  for (const value of ['javascript:alert(1)', 'http://shop.example.invalid/blogs/fragrance-journal',
    'https://user:PRIVATE@shop.example.invalid/blogs/fragrance-journal', 'https://foreign.example.invalid/blogs/fragrance-journal',
    `${canonicalOrigin}/blogs/fragrance-journal?x=1`, `${canonicalOrigin}/blogs/fragrance-journal#x`, `${canonicalOrigin}/blogs/other`]) {
    await assert.rejects(fixture({ change: rows => { rows.find(row => row._id === 'post-a').canonicalUrl = value } }).sitemap.generate(), unavailable)
  }
})

test('XML escaping handles all five entities and rejects illegal XML characters and lone surrogates', () => {
  assert.equal(escapeSitemapXml('&<>"\''), '&amp;&lt;&gt;&quot;&apos;')
  assert.equal(escapeSitemapXml('Fragrance 🌹'), 'Fragrance 🌹')
  for (const value of ['\0', '\u0001', '\uFFFF', '\uD800', '\uDC00']) assert.throws(() => escapeSitemapXml(value), unavailable)
})

test('editorial XML markup and private fields are never serialized into sitemap XML', async () => {
  const state = fixture({ change: rows => { const row = rows.find(row => row._id === 'post-a'); row.title = '<!DOCTYPE x><url>Injected & "title"</url>'; row.body[0].children[0].text = '<script>PRIVATE_XML_INJECTION</script>' } })
  assert.doesNotMatch(await state.sitemap.generate(), /Injected|DOCTYPE|script|PRIVATE|title/)
})

test('ambiguous duplicate slugs including a noIndex collision are rejected rather than silently deduplicated', async () => {
  const state = fixture({ change: rows => { const row = rows.find(row => row._id === 'post-b'); row.slug.current = 'fragrance-journal'; row.noIndex = true } })
  await assert.rejects(state.sitemap.generate(), unavailable)
})

test('a repeated publication identity is rejected, never emitted as duplicate URLs or hidden omissions', async () => {
  const state = fixture({ change: rows => { rows.push(structuredClone(rows.find(row => row._id === 'post-a'))) } })
  await assert.rejects(state.sitemap.generate(), unavailable)
})

test('wrong totals, short/extra pages, inconsistent ordering and missing envelopes are rejected', async () => {
  for (const transform of [value => ({ ...value, total: value.total + 1 }), value => ({ ...value, total: value.total - 1 }),
    value => ({ ...value, documents: value.documents.slice(1) }), value => ({ ...value, documents: [...value.documents].reverse() }),
    () => ({ documents: [], total: -1 }), () => null, () => '<html>PRIVATE_UPSTREAM</html>']) {
    await assert.rejects(fixture({ transform }).sitemap.generate(), unavailable)
  }
})

test('invalid dates, missing publication date, private references and invalid body structures fail safely', async () => {
  for (const change of [row => { row._updatedAt = 'not-a-date' }, row => { row._updatedAt = '2026-02-30T12:00:00Z' },
    row => { delete row.publishedAt }, row => { row.author._ref = 'drafts.author-a' }, row => { row.category._ref = 'versions.release.category-a' },
    row => { row.body[0]._type = 'html' }]) {
    await assert.rejects(fixture({ change: rows => change(rows.find(row => row._id === 'post-a')) }).sitemap.generate(), unavailable)
  }
})

test('query-side excessive body work produces a failure sentinel, not truncated valid content', async () => {
  let raw
  const state = fixture({ change: rows => { const row = rows.find(row => row._id === 'post-a'); row.body = Array.from({ length: 1001 }, (_, index) => ({ ...structuredClone(row.body[0]), _key: `block-${index}` })) },
    transform: value => { raw = value; return value } })
  await assert.rejects(state.sitemap.generate(), unavailable)
  assert.ok(raw.documents.some(row => row._sitemapOverflow === true))
})

test('snapshot byte budget rejects excessive upstream data before source projection', async () => {
  const state = fixture({ transform: value => { value.documents[0].unexpected = 'x'.repeat(8 * 1024 * 1024); return value } })
  await assert.rejects(state.sitemap.generate(), unavailable)
})

test('the existing HTML renderer work budget rejects excessive article content without returning XML', async () => {
  const state = fixture({ change: rows => { const row = rows.find(row => row._id === 'post-a'); row.body = Array.from({ length: 110 }, (_, index) => ({ _type: 'block', _key: `b-${index}`, style: 'normal',
    children: [{ _type: 'span', _key: 's', marks: [], text: 'x'.repeat(10000) }], markDefs: [] })) } })
  await assert.rejects(state.sitemap.generate(), unavailable)
})

test('upstream cancellation deadline also bounds a client that never settles', async () => {
  let signal
  const source = createSanityBlogSource({ timeoutMs: 50, client: { fetch(_query, _params, options) { signal = options.signal; return new Promise(() => {}) } } })
  const service = new BlogV1Service(new BlogRepository({ source, canonicalOrigin }))
  await assert.rejects(createBlogSitemap({ service, canonicalOrigin }).generate(), unavailable)
  assert.equal(signal.aborted, true)
})

test('legacy injected sources without snapshot support fail rather than treating a page as the whole collection', async () => {
  const service = new BlogV1Service(new BlogRepository({ source: { async listPublished() { throw new Error('Must not page') }, async getPublishedBySlug() { return null } }, canonicalOrigin }))
  await assert.rejects(createBlogSitemap({ service, canonicalOrigin }).generate(), unavailable)
})

test('every emitted URL agrees with served HTML canonical, robots and updated date; noIndex HTML is excluded', async t => {
  const { base, state } = await start(t, { state: fixture({ change: rows => { rows.find(row => row._id === 'post-b').noIndex = true } }) })
  const xml = await (await fetch(base + '/blog-sitemap.xml')).text()
  for (const location of locations(xml)) {
    const response = await fetch(base + new URL(location).pathname), html = await response.text()
    assert.equal(response.status, 200); assert.equal(response.headers.get('x-robots-tag'), 'index,follow')
    assert.ok(html.includes(`<link rel="canonical" href="${location}">`))
    assert.match(html, /article:modified_time.*2026-10-09T12:00:00.000Z/)
  }
  const noIndex = await fetch(base + '/blogs/second-article')
  assert.equal(noIndex.status, 200); assert.equal(noIndex.headers.get('x-robots-tag'), 'noindex,follow')
  assert.ok(!locations(xml).some(value => value.endsWith('/second-article')))
  assert.equal((await (await fetch(base + '/api/v1/public/blogs')).json()).pagination.total, 4)
  assert.equal((await fetch(base + '/blogs/missing-article')).status, 404)
  assert.equal((await fetch(base + '/blogs/unpublished-article')).status, 404)
  assert.equal((await fetch(base + '/blogs/Upper')).status, 400)
  assert.equal(state.service.repository.source.snapshotPublished instanceof Function, true)
})

test('GET/HEAD use UTF-8 XML, security headers, exact lengths and unchanged statuses under conditional/Host headers', async t => {
  const { base } = await start(t)
  const get = await fetch(base + '/blog-sitemap.xml', { headers: { 'X-Forwarded-Host': 'PRIVATE_FOREIGN', 'If-None-Match': '*' } }), xml = await get.text()
  assert.equal(get.status, 200); assert.equal(get.headers.get('content-type'), 'application/xml; charset=utf-8')
  assert.equal(get.headers.get('content-length'), String(Buffer.byteLength(xml))); assert.equal(get.headers.get('cache-control'), 'no-store')
  assert.equal(get.headers.get('x-content-type-options'), 'nosniff'); assert.ok(get.headers.get('content-security-policy'))
  assert.doesNotMatch(xml, /PRIVATE_FOREIGN|127\.0\.0\.1/)
  const head = await fetch(base + '/blog-sitemap.xml', { method: 'HEAD' })
  assert.equal(head.status, 200); assert.equal(await head.text(), '')
  assert.equal(head.headers.get('content-length'), get.headers.get('content-length'))
})

test('methods, query parameters and extra paths are denied before source access or JSON parsing', async t => {
  const { base, state } = await start(t)
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(base + '/blog-sitemap.xml', { method, headers: { 'Content-Type': 'application/json' }, body: 'invalid-json' })
    assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET, HEAD, OPTIONS')
  }
  assert.equal((await fetch(base + '/blog-sitemap.xml', { method: 'OPTIONS' })).status, 204)
  for (const suffix of ['?token=PRIVATE', '/extra', '?page=2']) assert.equal((await fetch(base + '/blog-sitemap.xml' + suffix)).status, 400)
  assert.deepEqual(state.calls, [])
})

test('unavailable responses are sanitized non-XML 503, never empty/partial 200, with safe diagnostics and HEAD parity', async t => {
  const diagnostics = [], service = { async snapshotArticles() { throw new Error('PRIVATE_TOKEN upstream stack') } }
  const { base } = await start(t, { service, logger: { warn: value => diagnostics.push(value) } })
  const get = await fetch(base + '/blog-sitemap.xml'), body = await get.text()
  assert.equal(get.status, 503); assert.equal(get.headers.get('retry-after'), '60')
  assert.equal(body, 'Sitemap is temporarily unavailable.\n'); assert.match(get.headers.get('content-type'), /^text\/plain/)
  assert.doesNotMatch(body, /PRIVATE|stack|urlset|<loc>/)
  const head = await fetch(base + '/blog-sitemap.xml', { method: 'HEAD' })
  assert.equal(head.status, 503); assert.equal(await head.text(), ''); assert.equal(head.headers.get('content-length'), get.headers.get('content-length'))
  assert.deepEqual(diagnostics, [0, 1].map(() => ({ event: 'blog.sitemap.unavailable', status: 503 })))
  assert.deepEqual(await (await fetch(base + '/unrelated')).json(), { unchanged: true })
})

test('late invalid records fail before any response bytes are sent and diagnostic transport cannot interrupt failure', async t => {
  const state = fixture({ change: rows => { rows.find(row => row._id === 'post-d').body[0]._type = 'unsafe' } })
  const { base } = await start(t, { state, logger: { warn() { throw new Error('PRIVATE_LOG_FAILURE') } } })
  const response = await fetch(base + '/blog-sitemap.xml')
  assert.equal(response.status, 503); assert.equal(await response.text(), 'Sitemap is temporarily unavailable.\n')
})

test('global injected limiter remains authoritative before sitemap source access', async t => {
  const { base, state } = await start(t, { limit: 1 })
  assert.equal((await fetch(base + '/blog-sitemap.xml')).status, 200)
  assert.equal((await fetch(base + '/blog-sitemap.xml')).status, 429); assert.equal(state.calls.length, 1)
})

test('fresh publication and noIndex changes are observed without persistent caching', async () => {
  const state = fixture()
  assert.equal(locations(await state.sitemap.generate()).length, 4)
  state.records.splice(state.records.findIndex(row => row._id === 'post-a'), 1)
  state.records.find(row => row._id === 'post-b').noIndex = true
  const xml = await state.sitemap.generate()
  assert.equal(locations(xml).length, 2); assert.doesNotMatch(xml, /fragrance-journal|second-article/)
})

test('invalid canonical configuration is rejected before any service invocation', () => {
  const service = { async snapshotArticles() { throw new Error('Must not read') } }
  for (const canonicalOrigin of ['', 'PRIVATE', 'http://shop.example.invalid', 'https://user:PRIVATE@shop.example.invalid',
    'https://shop.example.invalid/path', 'https://shop.example.invalid?x=1', 'https://shop.example.invalid#x']) {
    assert.throws(() => createBlogSitemap({ service, canonicalOrigin }))
  }
})

test('production startup, activation and existing injected delivery do not import or mount sitemap support', async () => {
  for (const path of ['../index.js', '../services/blogActivation.js', '../services/blogDelivery.js']) {
    assert.doesNotMatch(await readFile(new URL(path, import.meta.url), 'utf8'), /blogSitemap|blog-sitemap\.xml|SANITY_BLOG_SNAPSHOT_QUERY/)
  }
})
