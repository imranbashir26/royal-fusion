import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import { readFile } from 'node:fs/promises'
import { once } from 'node:events'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { isAllowedCorsOrigin } from '../auth/config.js'
import { createClient } from '@sanity/client'
import { createBlogSanityConfig } from '../config/blogSanity.js'
import { requestContext } from '../middleware/authSecurity.js'
import { createPublicBlogsV1Router } from '../routes/blogsV1.js'
import { BLOG_ORDER } from '../schemas/blogV1.js'
import { BlogApiError, BlogRepository } from '../services/blogRepository.js'
import { BlogV1Service } from '../services/blogV1Service.js'
import { createSanityBlogSource, createSanityBlogV1Service } from '../services/sanityBlogSource.js'
import { SANITY_BLOG_DETAIL_QUERY, SANITY_BLOG_LIST_QUERY } from '../services/sanityBlogQueries.js'
import { blockExternalBlogTestNetwork, createSanityBlogClientFixture, makeSanityBlogDocuments } from './support/sanityBlogFixtures.js'

const canonicalOrigin = 'https://shop.example.invalid'
const environment = { CLIENT_ORIGIN: `${canonicalOrigin},https://second.example.invalid` }
let network
before(() => { network = blockExternalBlogTestNetwork() })
after(() => { network.restore(); assert.deepEqual(network.attempts, [], 'No external Sanity or other network requests') })
const unavailable = error => error instanceof BlogApiError && error.status === 503 && error.code === 'BLOGS_UNAVAILABLE'
const invalid = error => error instanceof BlogApiError && error.status === 400 && error.code === 'INVALID_BLOG_REQUEST'
function fixture(documents, options) {
  const state = createSanityBlogClientFixture(documents, options)
  const source = createSanityBlogSource({ client: state.client })
  const repository = new BlogRepository({ source, canonicalOrigin })
  return { ...state, source, repository, service: new BlogV1Service(repository) }
}
async function start(t, service = fixture().service) {
  const app = express()
  app.use(helmet(), requestContext)
  app.use('/api/v1/public/blogs', createPublicBlogsV1Router(service))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  return `http://127.0.0.1:${server.address().port}/api/v1/public/blogs`
}

test('environment configuration is pinned, nonsecret and uses the approved primary CLIENT_ORIGIN', () => {
  const config = createBlogSanityConfig({ ...environment, SANITY_API_TOKEN: 'PRIVATE_FIXTURE_WRITE_TOKEN', SANITY_STUDIO_API_TOKEN: 'PRIVATE_FIXTURE_TOKEN' })
  assert.deepEqual(config, { projectId: '6n1y88j4', dataset: 'production', apiVersion: '2025-01-01', canonicalOrigin, timeoutMs: 5000 })
  assert.equal(Object.isFrozen(config), true)
  assert.equal(JSON.stringify(config).includes('PRIVATE_FIXTURE'), false)
  assert.equal(createBlogSanityConfig({ ...environment, SANITY_PROJECT_ID: '', SANITY_DATASET: '', SANITY_API_VERSION: '' }).projectId, '6n1y88j4')
  for (const override of [
    { SANITY_PROJECT_ID: 'foreign' }, { SANITY_DATASET: 'drafts' }, { SANITY_API_VERSION: '2025-02-19' },
    { CLIENT_ORIGIN: '' }, { CLIENT_ORIGIN: 'http://localhost:5173' }, { CLIENT_ORIGIN: 'https://user:PRIVATE_FIXTURE@shop.example.invalid' },
    { CLIENT_ORIGIN: `${canonicalOrigin}/path` }, { CLIENT_ORIGIN: `${canonicalOrigin}?x=1` }, { CLIENT_ORIGIN: `${canonicalOrigin}#x` },
    { SANITY_BLOG_TIMEOUT_MS: '0' }, { SANITY_BLOG_TIMEOUT_MS: '49' }, { SANITY_BLOG_TIMEOUT_MS: '10001' },
    { SANITY_BLOG_TIMEOUT_MS: '1e3' }, { SANITY_BLOG_TIMEOUT_MS: '050' },
  ]) assert.throws(() => createBlogSanityConfig({ ...environment, ...override }), { message: 'Blog source configuration is invalid.' })
})

test('composition verifies installed SDK/API compatibility without fetching or accepting credentials', async () => {
  const state = createSanityBlogClientFixture()
  let sdkConfig
  const service = createSanityBlogV1Service({ environment: { ...environment, SANITY_API_TOKEN: 'PRIVATE_FIXTURE_TOKEN' },
    clientFactory(options) {
      sdkConfig = createClient(options).config() // Native constructor/config only; injected fetch remains authoritative in tests.
      return state.client
    },
  })
  assert.equal(sdkConfig.apiVersion, '2025-01-01')
  assert.equal(sdkConfig.projectId, '6n1y88j4')
  assert.equal(sdkConfig.dataset, 'production')
  assert.equal(sdkConfig.perspective, 'published')
  assert.equal(sdkConfig.useCdn, false)
  assert.equal(sdkConfig.timeout, 5000)
  assert.equal(sdkConfig.maxRetries, 0)
  assert.equal(sdkConfig.token, undefined)
  assert.equal(sdkConfig.stega.enabled, false)
  assert.equal(state.calls.length, 0)
  assert.equal((await service.list()).pagination.total, 4)
  assert.throws(() => createSanityBlogV1Service({ environment, clientFactory() { throw new Error('PRIVATE_FIXTURE_TOKEN') } }), { message: 'Blog source configuration is invalid.' })
})

test('real GROQ pages/counts the same published population and summaries never retrieve bodies', async () => {
  const state = fixture()
  const first = await state.service.list({ page: 1, pageSize: 2 })
  const second = await state.service.list({ page: 2, pageSize: 2 })
  assert.deepEqual(first.data.map(value => value.id), ['post-c', 'post-a'])
  assert.deepEqual(second.data.map(value => value.id), ['post-b', 'post-d'])
  assert.deepEqual(first.pagination, { page: 1, pageSize: 2, total: 4, totalPages: 2 })
  assert.deepEqual(state.calls.map(call => call.params), [{ offset: 0, end: 2 }, { offset: 2, end: 4 }])
  assert.ok(state.calls.every(call => call.query === SANITY_BLOG_LIST_QUERY && call.options.perspective === 'published'
    && call.options.useCdn === false && call.options.signal instanceof AbortSignal && call.options.stega === false))
  assert.equal(/\bbody\b|\bcontent\b|\bstatus\b/.test(SANITY_BLOG_LIST_QUERY), false)
  assert.ok(first.data.every(value => !('body' in value) && !('_slugMatchCount' in value)))
})

test('empty, beyond-final and maximum pages stay bounded and have precise totals', async () => {
  const state = fixture()
  assert.deepEqual((await state.service.list()).pagination, { page: 1, pageSize: 20, total: 4, totalPages: 1 })
  assert.deepEqual(await state.service.list({ page: 3, pageSize: 2 }), { data: [], pagination: { page: 3, pageSize: 2, total: 4, totalPages: 2 } })
  await state.service.list({ page: 1000, pageSize: 50 })
  assert.deepEqual(state.calls.at(-1).params, { offset: 49950, end: 50000 })
  assert.deepEqual(await fixture([]).service.list(), { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } })
})

test('chronological ordering preserves the domain contract for offset dates and tied native IDs', async () => {
  const documents = makeSanityBlogDocuments()
  documents.find(value => value._id === 'post-b').publishedAt = '2026-10-09T16:00:00+05:00'
  const output = await fixture(documents).service.list()
  assert.deepEqual(output.data.map(value => value.id), ['post-c', 'post-b', 'post-a', 'post-d'])
  assert.equal(output.data[1].publishedAt, '2026-10-09T11:00:00.000Z')
})

test('detail GROQ uses a validated slug parameter and resolves published author/category/asset references', async () => {
  const state = fixture()
  const { data } = await state.service.getBySlug('fragrance-journal')
  assert.equal(state.calls[0].query, SANITY_BLOG_DETAIL_QUERY)
  assert.deepEqual(state.calls[0].params, { slug: 'fragrance-journal' })
  assert.equal(SANITY_BLOG_DETAIL_QUERY.includes('fragrance-journal'), false)
  assert.deepEqual(data.author, { id: 'author-a', name: 'Royal Fusion Editorial', bio: 'Fragrance education.' })
  assert.equal(data.category.slug, 'education')
  assert.equal(data.featuredImage.asset._ref, 'image-fixture-1200x800-jpg')
  assert.deepEqual(data.featuredImage.crop, { top: 0.1, bottom: 0.1, left: 0.05, right: 0.05 })
  assert.deepEqual(data.featuredImage.hotspot, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 })
  assert.equal(data.featuredImage.alt, 'Fragrance journal editorial photograph')
  assert.equal(data.seo.canonicalUrl, `${canonicalOrigin}/blogs/fragrance-journal`)
  assert.equal(data.seo.title, 'Fragrance advice')
  assert.equal(data.seo.description, 'Practical fragrance education.')
})

test('Portable Text headings, lists, marks, links and inline images retain structured metadata', async () => {
  const { data } = await fixture().service.getBySlug('fragrance-journal')
  assert.deepEqual(data.body.map(node => node._type), ['block', 'block', 'block', 'block', 'block', 'image'])
  assert.equal(data.body[0].style, 'h2')
  assert.equal(data.body[1].style, 'h3')
  assert.deepEqual(data.body[2].children[0].marks, ['strong', 'guide-link'])
  assert.deepEqual(data.body[2].markDefs, [{ _type: 'link', _key: 'guide-link', href: 'https://example.invalid/guide' }])
  assert.equal(data.body[3].listItem, 'bullet')
  assert.equal(data.body[4].listItem, 'number')
  assert.equal(data.body[4].level, 2)
  assert.equal(data.body[5]._key, 'article-image')
  assert.deepEqual(data.body[5].asset, data.featuredImage.asset)
})

test('real missing optional fields map into existing defaults and historical featured alt text', async () => {
  const documents = makeSanityBlogDocuments(), post = documents.find(value => value._id === 'post-a')
  for (const key of ['noIndex', 'tags', 'seoTitle', 'seoDescription', 'canonicalUrl', 'ogImage']) delete post[key]
  delete post.featuredImage.alt
  delete post.featuredImage.crop
  delete post.featuredImage.hotspot
  delete post.body[0].style
  delete post.body[0].markDefs
  delete post.body[0].children[0].marks
  const { data } = await fixture(documents).service.getBySlug('fragrance-journal')
  assert.equal(data.featuredImage.alt, 'Historical featured image alt text')
  assert.equal(data.featuredImage.crop, null)
  assert.equal(data.featuredImage.hotspot, null)
  assert.deepEqual(data.tags, [])
  assert.deepEqual(data.seo, { title: null, description: null, canonicalUrl: `${canonicalOrigin}/blogs/fragrance-journal`, noIndex: false, ogImage: null })
  assert.equal(data.body[0].style, 'normal')
  assert.deepEqual(data.body[0].children[0].marks, [])
  assert.deepEqual(data.body[0].markDefs, [])
})

test('editorial reading time survives native queries, JSON list/detail and complete snapshots without estimation', async t => {
  const documents = makeSanityBlogDocuments()
  documents.find(row => row._id === 'post-a').readTime = '4 Minutes'
  const state = fixture(documents), base = await start(t, state.service)
  const list = await (await fetch(base)).json(), detail = await (await fetch(`${base}/fragrance-journal`)).json()
  assert.equal(list.data.find(row => row.id === 'post-a').readTime, '4 Minutes')
  assert.equal(detail.data.readTime, '4 Minutes')
  assert.equal((await state.service.snapshotArticles()).find(row => row.id === 'post-a').readTime, '4 Minutes')
  assert.equal(detail.data.publishedAt, '2026-10-08T12:00:00.000Z')
  assert.equal(list.data.some(row => 'body' in row), false)
  assert.ok(state.calls.every(call => call.options.perspective === 'published'))
})

test('missing, null and blank reading time keep old DTOs unchanged; editorial text is bounded and trimmed', async () => {
  const baseline = (await fixture().service.getBySlug('fragrance-journal')).data
  for (const value of [undefined, null, '', '   ']) {
    const documents = makeSanityBlogDocuments()
    documents.find(row => row._id === 'post-a').readTime = value
    const state = fixture(documents), detail = (await state.service.getBySlug('fragrance-journal')).data
    assert.deepEqual(detail, baseline)
    assert.equal('readTime' in (await state.service.list()).data.find(row => row.id === 'post-a'), false)
  }
  for (const [value, expected] of [[' 4 Minutes ', '4 Minutes'], ['x'.repeat(80), 'x'.repeat(80)]]) {
    const documents = makeSanityBlogDocuments()
    documents.find(row => row._id === 'post-a').readTime = value
    assert.equal((await fixture(documents).service.getBySlug('fragrance-journal')).data.readTime, expected)
  }
})

test('malformed and overlong reading time fail safely in native list/detail/snapshot and HTTP responses', async t => {
  for (const value of [4, false, [], { text: 'PRIVATE_READING_TIME' }, 'x'.repeat(81)]) {
    const documents = makeSanityBlogDocuments()
    documents.find(row => row._id === 'post-a').readTime = value
    const state = fixture(documents)
    await assert.rejects(state.service.list(), unavailable)
    await assert.rejects(state.service.getBySlug('fragrance-journal'), unavailable)
    await assert.rejects(state.service.snapshotArticles(), unavailable)
  }
  const documents = makeSanityBlogDocuments()
  documents.find(row => row._id === 'post-a').readTime = { secret: 'PRIVATE_READING_TIME' }
  const base = await start(t, fixture(documents).service)
  const response = await fetch(`${base}/fragrance-journal`)
  assert.equal(response.status, 503)
  assert.doesNotMatch(await response.text(), /PRIVATE_READING_TIME|secret|stack/)
})

test('OG image geometry/alt and canonical/noIndex metadata survive their approved projections', async () => {
  const documents = makeSanityBlogDocuments(), post = documents.find(value => value._id === 'post-a')
  post.ogImage = structuredClone(post.featuredImage)
  post.ogImage.alt = 'OG editorial image'
  post.noIndex = true
  const { data } = await fixture(documents).service.getBySlug('fragrance-journal')
  assert.equal(data.seo.noIndex, true)
  assert.equal(data.seo.ogImage.alt, 'OG editorial image')
  assert.deepEqual(data.seo.ogImage.hotspot, data.featuredImage.hotspot)
})

test('native publication excludes drafts/releases even if an injected client ignores perspective', async () => {
  const state = fixture(undefined, { honorPerspective: false })
  const output = await state.service.list()
  assert.equal(output.pagination.total, 4)
  assert.equal(JSON.stringify(output).includes('PRIVATE_FIXTURE'), false)
  assert.equal((await state.service.getBySlug('fragrance-journal')).data.title, 'Fragrance journal')
  assert.equal(await state.repository.getBySlug('unpublished-article'), null)
  assert.equal((await state.service.getBySlug('oldest-article')).data.id, 'post-d') // Historical custom status ignored.
})

test('unpublish removes the published snapshot immediately without cache, draft fallback or stale authority', async () => {
  const state = fixture()
  assert.equal((await state.service.getBySlug('fragrance-journal')).data.id, 'post-a')
  state.records.splice(state.records.findIndex(value => value._id === 'post-a'), 1)
  await assert.rejects(state.service.getBySlug('fragrance-journal'), error => error.code === 'BLOG_NOT_FOUND')
  assert.equal((await state.service.list()).pagination.total, 3)
  assert.ok(state.calls.every(call => call.options.useCdn === false))
})

test('future descriptive dates and historical status fields never override native publication', async () => {
  const documents = makeSanityBlogDocuments(), post = documents.find(value => value._id === 'post-d')
  post.publishedAt = '2030-01-01T00:00:00Z'
  post.status = 'Unpublished'
  const state = fixture(documents)
  assert.equal((await state.service.list()).data[0].id, 'post-d')
  assert.equal((await state.service.getBySlug('oldest-article')).data.publishedAt, '2030-01-01T00:00:00.000Z')
})

test('unpublished and unresolved references fail closed without exposing draft/release names', async () => {
  for (const [field, id] of [['author', 'drafts.author-a'], ['category', 'versions.release.category-a'], ['author', 'missing-author']]) {
    const documents = makeSanityBlogDocuments()
    documents.find(value => value._id === 'post-a')[field]._ref = id
    const state = fixture(documents, { honorPerspective: false })
    await assert.rejects(state.service.getBySlug('fragrance-journal'), unavailable)
  }
})

test('duplicate slugs fail in detail and across listing page boundaries', async () => {
  const documents = makeSanityBlogDocuments()
  documents.find(value => value._id === 'post-c').slug.current = 'fragrance-journal'
  const state = fixture(documents)
  await assert.rejects(state.service.getBySlug('fragrance-journal'), unavailable)
  await assert.rejects(state.service.list({ pageSize: 1 }), unavailable)
})

test('private raw fields and SDK metadata never enter summary/detail responses', async () => {
  const documents = makeSanityBlogDocuments(), post = documents.find(value => value._id === 'post-a')
  post.body[0].token = 'PRIVATE_FIXTURE_BODY_TOKEN'
  post.body[0].children[0].secret = 'PRIVATE_FIXTURE_SPAN_TOKEN'
  post.body[2].markDefs[0].token = 'PRIVATE_FIXTURE_MARK_TOKEN'
  const state = fixture(documents)
  const text = JSON.stringify([await state.service.list(), await state.service.getBySlug('fragrance-journal'), await state.service.snapshotArticles()])
  assert.equal(/PRIVATE_FIXTURE|private@example|_slugMatchCount|"status"/.test(text), false)
  assert.deepEqual(Object.keys(state.source).sort(), ['getPublishedBySlug', 'listPublished', 'snapshotPublished'])
})

test('malformed content is unavailable rather than repaired, flattened or silently omitted', async () => {
  const changes = [
    post => { post.body = [{ _type: 'html', _key: 'unsafe', html: 'PRIVATE_FIXTURE_SCRIPT' }] },
    post => { post.body[2].markDefs[0].href = 'javascript:alert(1)' },
    post => { post.canonicalUrl = 'https://foreign.example.invalid/blogs/fragrance-journal' },
    post => { delete post.featuredImage.alt; delete post.imageAlt },
    post => { post.featuredImage.asset._ref = 'missing-asset' },
  ]
  for (const change of changes) {
    const documents = makeSanityBlogDocuments()
    change(documents.find(value => value._id === 'post-a'))
    await assert.rejects(fixture(documents).service.getBySlug('fragrance-journal'), unavailable)
  }
  for (const result of [null, {}, [null], [1], [{}, {}]]) {
    const repository = new BlogRepository({ source: createSanityBlogSource({ client: { fetch: async () => result } }), canonicalOrigin })
    await assert.rejects(repository.getBySlug('valid-slug'), unavailable)
  }
})

test('source pagination/order and slug validation fail before any upstream fetch', async () => {
  const state = fixture()
  for (const input of [{ offset: -1 }, { offset: 50000 }, { limit: 0 }, { limit: 51 }, { limit: 1.5 }, { order: ['_id asc'] }]) {
    await assert.rejects(state.source.listPublished({ offset: 0, limit: 20, order: BLOG_ORDER, ...input }), invalid)
  }
  for (const slug of ['', 'Upper', '../article', 'a--b', 'a'.repeat(97), 'x" || true']) await assert.rejects(state.source.getPublishedBySlug(slug), invalid)
  assert.deepEqual(state.calls, [])
})

test('upstream rejection and synchronous SDK exceptions are sanitized', async () => {
  for (const fetch of [async () => { throw new Error('PRIVATE_FIXTURE_WRITE_TOKEN upstream stack') }, () => { throw new Error('PRIVATE_FIXTURE_INTERNAL_ENDPOINT') }]) {
    const service = new BlogV1Service(new BlogRepository({ source: createSanityBlogSource({ client: { fetch } }), canonicalOrigin }))
    await assert.rejects(service.list(), unavailable)
    await assert.rejects(service.getBySlug('valid-slug'), unavailable)
  }
})

test('an independent bounded deadline aborts even an upstream fixture that ignores its signal', { timeout: 3000 }, async () => {
  let signal
  const source = createSanityBlogSource({ timeoutMs: 50, client: { fetch(_query, _params, options) { signal = options.signal; return new Promise(() => {}) } } })
  await assert.rejects(source.getPublishedBySlug('valid-slug'), unavailable)
  assert.equal(signal.aborted, true)
})

test('GET list/detail and HEAD expose only existing versioned DTOs with no-store headers', async t => {
  const base = await start(t), listing = await fetch(`${base}?page=1&pageSize=2`)
  assert.equal(listing.status, 200)
  assert.equal(listing.headers.get('cache-control'), 'no-store')
  const output = await listing.json()
  assert.deepEqual(Object.keys(output).sort(), ['data', 'pagination'])
  assert.equal(output.data.length, 2)
  assert.equal('body' in output.data[0], false)
  const detail = await fetch(`${base}/fragrance-journal`)
  assert.equal(detail.status, 200)
  assert.equal((await detail.json()).data.body[0].style, 'h2')
  const head = await fetch(`${base}/fragrance-journal`, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
})

test('HTTP invalid pagination, duplicates and unknown query keys never call Sanity', async t => {
  const state = fixture(), base = await start(t, state.service)
  for (const query of ['page=0', 'page=1001', 'pageSize=51', 'page=01', 'page=1.5', 'page=1e2', 'page=-1', 'page=true', 'page=1&page=2', 'page[0]=1', 'drafts=true', 'perspective=raw', 'token=PRIVATE_FIXTURE_TOKEN']) {
    const response = await fetch(`${base}?${query}`)
    assert.equal(response.status, 400, query)
    assert.equal((await response.json()).error.code, 'INVALID_BLOG_REQUEST')
  }
  assert.deepEqual(state.calls, [])
})

test('HTTP invalid slugs, malformed URI escapes and detail query parameters have safe 400 envelopes', async t => {
  const state = fixture(), base = await start(t, state.service)
  for (const path of ['/Upper', '/two--hyphens', `/${'a'.repeat(97)}`, '/%2farticle', '/%ZZ', '/valid/extra', '/fragrance-journal?perspective=drafts']) {
    const response = await fetch(`${base}${path}`)
    assert.equal(response.status, 400, path)
    assert.deepEqual((await response.json()).error, { code: 'INVALID_BLOG_REQUEST', message: 'Blog request is invalid.' })
  }
  assert.deepEqual(state.calls, [])
})

test('HTTP missing/unpublished content is 404, upstream failure is 503 and valid request IDs remain safe', async t => {
  const base = await start(t)
  for (const slug of ['missing-article', 'unpublished-article']) {
    const response = await fetch(`${base}/${slug}`)
    assert.equal(response.status, 404)
    assert.deepEqual((await response.json()).error, { code: 'BLOG_NOT_FOUND', message: 'Article not found.' })
  }
  const source = createSanityBlogSource({ client: { fetch: async () => { throw new Error('PRIVATE_FIXTURE_TOKEN stack endpoint') } } })
  const failed = await start(t, new BlogV1Service(new BlogRepository({ source, canonicalOrigin })))
  const id = '00000000-0000-4000-8000-000000000001'
  const response = await fetch(failed, { headers: { 'X-Request-ID': id } })
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { error: { code: 'BLOGS_UNAVAILABLE', message: 'Articles are temporarily unavailable.', requestId: id } })
})

test('HTTP timeout returns 503 without a draft or stale fallback', { timeout: 3000 }, async t => {
  const source = createSanityBlogSource({ timeoutMs: 50, client: { fetch: async () => new Promise(() => {}) } })
  const base = await start(t, new BlogV1Service(new BlogRepository({ source, canonicalOrigin })))
  const response = await fetch(`${base}/valid-slug`)
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: { code: 'BLOGS_UNAVAILABLE', message: 'Articles are temporarily unavailable.' } })
})

test('mutation methods are denied, OPTIONS is read-only and no write-capable routes exist', async t => {
  const state = fixture(), base = await start(t, state.service)
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(`${base}/fragrance-journal`, { method })
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET, HEAD, OPTIONS')
    assert.equal((await response.json()).error.code, 'INVALID_BLOG_REQUEST')
  }
  const options = await fetch(base, { method: 'OPTIONS' })
  assert.equal(options.status, 204)
  assert.deepEqual(state.calls, [])
})

test('entry point delegates only default-disabled activation and preserves historical authority', async () => {
  const entry = await readFile(new URL('../index.js', import.meta.url), 'utf8')
  assert.equal(/blogsV1|sanityBlogSource|createPublicBlogsV1Router|createSanityBlogV1Service/.test(entry), false)
  assert.ok(entry.includes('mountSanityBlogApi(app)'))
  assert.ok(entry.includes("app.use('/api/public', publicRouter)"))
})

async function startComposed(t, { limit = 400 } = {}) {
  const app = express(), config = { allowedOrigins: [canonicalOrigin], environment: 'test', allowDevelopmentLoopback: true }
  app.use(helmet(), requestContext, cors({ origin(origin, callback) {
    callback(isAllowedCorsOrigin(origin, config) ? null : Object.assign(new Error('Origin denied.'), { status: 403 }), true)
  }, credentials: true, allowedHeaders: ['Content-Type', 'X-Request-ID'], methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }),
  rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false }))
  app.use('/api/v1/public/blogs', createPublicBlogsV1Router(fixture().service))
  app.use(express.json())
  app.get('/api/v1/public/unrelated-fixture', (_req, res) => res.json({ data: 'unrelated fixture' }))
  app.get('/api/public/blogs', (_req, res) => res.json({ data: 'historical fixture' }))
  app.use((error, _req, res, _next) => res.status(error.status ?? 503).json({ error: { message: 'Request denied.' } }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  return `http://127.0.0.1:${server.address().port}`
}
test('composed public middleware preserves exact-origin CORS and request-context headers', async t => {
  const base = await startComposed(t), id = '00000000-0000-4000-8000-000000000002'
  const response = await fetch(`${base}/api/v1/public/blogs`, { headers: { Origin: canonicalOrigin, 'X-Request-ID': id } })
  assert.equal(response.status, 200); assert.equal(response.headers.get('access-control-allow-origin'), canonicalOrigin)
  assert.equal(response.headers.get('x-request-id'), id); assert.equal(response.headers.get('cache-control'), 'no-store')
  const denied = await fetch(`${base}/api/v1/public/blogs`, { headers: { Origin: 'https://foreign.invalid' } })
  assert.equal(denied.status, 403); assert.equal(denied.headers.get('access-control-allow-origin'), null)
})
test('composed middleware retains global rate limiting with its safe non-blog envelope', async t => {
  const base = await startComposed(t, { limit: 1 })
  assert.equal((await fetch(`${base}/api/v1/public/blogs`)).status, 200)
  const limited = await fetch(`${base}/api/v1/public/blogs`)
  assert.equal(limited.status, 429); assert.ok(limited.headers.get('retry-after')); assert.ok(limited.headers.get('x-request-id'))
})
test('blog method denial precedes JSON parsing while HEAD and CORS preflight remain read-only', async t => {
  const base = await startComposed(t)
  const denied = await fetch(`${base}/api/v1/public/blogs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })
  assert.equal(denied.status, 405); assert.equal((await denied.json()).error.code, 'INVALID_BLOG_REQUEST')
  const head = await fetch(`${base}/api/v1/public/blogs`, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '')
  const options = await fetch(`${base}/api/v1/public/blogs`, { method: 'OPTIONS', headers: { Origin: canonicalOrigin, 'Access-Control-Request-Method': 'GET' } })
  assert.equal(options.status, 204); assert.equal(options.headers.get('access-control-allow-origin'), canonicalOrigin)
})
test('scoped blog mounting cannot capture sibling or historical public routes', async t => {
  const base = await startComposed(t)
  assert.deepEqual(await (await fetch(`${base}/api/v1/public/unrelated-fixture`)).json(), { data: 'unrelated fixture' })
  assert.deepEqual(await (await fetch(`${base}/api/public/blogs`)).json(), { data: 'historical fixture' })
})
