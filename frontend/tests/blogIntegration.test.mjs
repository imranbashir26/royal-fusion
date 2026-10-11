import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { blogFixture, fixtureFetch, configuration, canonicalOrigin, legacyBlog } from './support/blogFixtures.mjs'
import { blockExternalBlogTestNetwork } from '../../backend/server/tests/support/sanityBlogFixtures.js'

let server, api, images, seo, activation, network
before(async () => {
  network = blockExternalBlogTestNetwork()
  server = await createServer({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), configFile: false,
    server: { middlewareMode: true, hmr: false }, appType: 'custom', envDir: false, optimizeDeps: { noDiscovery: true } })
  api = await server.ssrLoadModule('/src/services/publicBlogsApi.ts')
  images = await server.ssrLoadModule('/src/services/blogImages.ts')
  seo = await server.ssrLoadModule('/src/services/storefrontSeo.ts')
  activation = await server.ssrLoadModule('/src/services/blogIntegrationConfig.ts')
})
after(async () => { await server?.close(); network.restore(); assert.deepEqual(network.attempts, []) })
const client = (fetcher = fixtureFetch(blogFixture().service), options = {}) => api.createPublicBlogClient({ configuration, fetcher, baseUrl: '/api', ...options })
const failure = kind => error => error instanceof api.PublicBlogError && error.kind === kind && !/PRIVATE|stack|credential/.test(error.message)

test('entry point constructs activation once outside React and existing default blog behavior remains wired', async () => {
  const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8')
  assert.ok(main.includes('<App blogIntegration={blogIntegration} />'))
  assert.equal(main.match(/createBlogIntegration\(import.meta.env\)/g).length, 1)
  assert.ok(main.indexOf('createBlogIntegration(import.meta.env)') < main.indexOf('createRoot('))
  const load = await server.ssrLoadModule('/src/services/storefrontService.ts')
  const sanity = await server.ssrLoadModule('/src/services/sanityContentService.ts')
  const transport = await server.ssrLoadModule('/src/services/apiClient.ts')
  const originalBlogs = sanity.sanityContentService.getBlogs, originalRequest = transport.apiClient.request
  let legacyReads = 0
  sanity.sanityContentService.getBlogs = async () => { legacyReads++; return [legacyBlog] }
  transport.apiClient.request = async () => ({ ...load.fallbackStorefrontData })
  try {
    assert.deepEqual((await load.storefrontService.getStorefrontData()).blogs, [legacyBlog])
    assert.equal(legacyReads, 1)
    assert.deepEqual((await load.storefrontService.getStorefrontData({ legacyBlogs: false })).blogs, [])
    assert.equal(legacyReads, 1)
  } finally { sanity.sanityContentService.getBlogs = originalBlogs; transport.apiClient.request = originalRequest }
})
test('default-disabled and non-exact build flags do not construct a client or read invalid canonical configuration', () => {
  let constructions = 0
  for (const flag of [undefined, 'false', 'TRUE', ' true ', '1', true]) {
    assert.equal(activation.createBlogIntegration({ VITE_ENABLE_SANITY_BLOGS: flag, VITE_BLOG_CANONICAL_ORIGIN: 'PRIVATE_INVALID' },
      { clientFactory() { constructions++; throw new Error('Unexpected construction') }, report() { assert.fail('Unexpected diagnostic') } }), undefined)
  }
  assert.equal(constructions, 0)
})
test('explicit frontend activation creates one stable token-free client without fetching at construction', async () => {
  let constructions = 0; const calls = []
  const integration = activation.createBlogIntegration({ VITE_ENABLE_SANITY_BLOGS: 'true', VITE_BLOG_CANONICAL_ORIGIN: canonicalOrigin }, {
    clientFactory({ configuration: approved }) { constructions++; assert.deepEqual(approved, configuration); return client(fixtureFetch(blogFixture().service, calls)) },
  })
  assert.equal(integration.enabled, true); assert.ok(Object.isFrozen(integration)); assert.equal(constructions, 1); assert.equal(calls.length, 0)
  await integration.client.list(); await integration.client.getBySlug('fragrance-journal')
  assert.equal(constructions, 1); assert.equal(calls.length, 2)
})

test('HTML document navigation requires an exact build flag plus valid native integration and canonical origin', () => {
  let constructions = 0; const diagnostics = []
  const options = { clientFactory() { constructions++; return client() }, report: value => diagnostics.push(value) }
  for (const flag of [undefined, '', 'false', 'TRUE', ' true ', '1', true]) {
    const integration = activation.createBlogIntegration({ VITE_ENABLE_SANITY_BLOGS: 'true',
      VITE_ENABLE_BLOG_HTML: flag, VITE_BLOG_CANONICAL_ORIGIN: canonicalOrigin }, options)
    assert.equal(integration.enabled, true); assert.equal(integration.documentMode, undefined)
  }
  const before = constructions
  for (const flag of [undefined, '', 'false', 'TRUE', ' true ', true]) {
    assert.equal(activation.createBlogIntegration({ VITE_ENABLE_SANITY_BLOGS: flag,
      VITE_ENABLE_BLOG_HTML: 'true', VITE_BLOG_CANONICAL_ORIGIN: canonicalOrigin }, options), undefined)
  }
  assert.equal(constructions, before)
  assert.deepEqual(diagnostics, Array.from({ length: 6 }, () => ({ event: 'blog.document.dependency.invalid' })))
  const integration = activation.createBlogIntegration({ VITE_ENABLE_SANITY_BLOGS: 'true',
    VITE_ENABLE_BLOG_HTML: 'true', VITE_BLOG_CANONICAL_ORIGIN: canonicalOrigin }, options)
  assert.equal(integration.documentMode, true); assert.ok(Object.isFrozen(integration))
  assert.equal(constructions, before + 1)
  for (const canonicalOrigin of [undefined, 'http://shop.example.invalid', 'https://user:PRIVATE@shop.example.invalid',
    'https://shop.example.invalid/path', 'https://shop.example.invalid?query=1', 'https://shop.example.invalid#hash']) {
    assert.deepEqual(activation.createBlogIntegration({ VITE_ENABLE_SANITY_BLOGS: 'true', VITE_ENABLE_BLOG_HTML: 'true',
      VITE_BLOG_CANONICAL_ORIGIN: canonicalOrigin }, options), { enabled: true, unavailable: true })
  }
  assert.equal(constructions, before + 1)
  assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE|stack|https:/)
})
test('invalid enabled origins and construction failures remain explicitly unavailable without inventing an origin', () => {
  let constructions = 0; const diagnostics = []
  for (const canonicalOrigin of [undefined, '', 'http://localhost:5173', 'https://user:PRIVATE_TOKEN@shop.example.invalid',
    'https://shop.example.invalid/path', 'https://shop.example.invalid?query=1', 'https://shop.example.invalid#hash', 'malformed', 42]) {
    const result = activation.createBlogIntegration({ VITE_ENABLE_SANITY_BLOGS: 'true', VITE_BLOG_CANONICAL_ORIGIN: canonicalOrigin }, {
      clientFactory() { constructions++; throw new Error('Unexpected construction') }, report: value => diagnostics.push(value),
    })
    assert.deepEqual(result, { enabled: true, unavailable: true }); assert.ok(Object.isFrozen(result))
  }
  assert.equal(constructions, 0); assert.equal(/PRIVATE|localhost|stack/.test(JSON.stringify(diagnostics)), false)
  assert.deepEqual(activation.createBlogIntegration({ VITE_ENABLE_SANITY_BLOGS: 'true', VITE_BLOG_CANONICAL_ORIGIN: canonicalOrigin }, {
    clientFactory() { throw new Error('PRIVATE_CONSTRUCTION_TOKEN') }, report() { throw new Error('Diagnostic failure') },
  }), { enabled: true, unavailable: true })
})
test('real Phase 4D fixture API returns bounded summary pages without bodies or private metadata', async () => {
  const calls = [], source = blogFixture(), service = client(fixtureFetch(source.service, calls))
  const first = await service.list({ pageSize: 2 }), second = await service.list({ page: 2, pageSize: 2 })
  assert.deepEqual(first.data.map(row => row.id), ['post-c', 'post-a']); assert.deepEqual(second.data.map(row => row.id), ['post-b', 'post-d'])
  assert.deepEqual(first.pagination, { page: 1, pageSize: 2, total: 4, totalPages: 2 })
  assert.equal(first.data.some(row => 'body' in row || 'content' in row), false)
  assert.equal(/PRIVATE|private@example|readTime/.test(JSON.stringify(first)), false)
  assert.ok(calls.every(call => call.options.method === 'GET' && call.options.credentials === 'omit' && call.options.cache === 'no-store'
    && !('Authorization' in call.options.headers) && !('X-RF-CSRF' in call.options.headers)))
})
test('detail retrieval is independent of listings and preserves editorial structures', async () => {
  const calls = [], output = await client(fixtureFetch(blogFixture().service, calls)).getBySlug('fragrance-journal')
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/api/v1/public/blogs/fragrance-journal')
  assert.equal(output.data.author.name, 'Royal Fusion Editorial'); assert.equal(output.data.category.title, 'Education')
  assert.ok(output.data.body.some(node => node.style === 'h2')); assert.ok(output.data.body.some(node => node.style === 'blockquote'))
  assert.ok(output.data.body.some(node => node.listItem === 'number' && node.level === 2))
  assert.equal(output.data.featuredImage.alt, 'Fragrance journal editorial photograph')
  assert.equal(/PRIVATE|private@example/.test(JSON.stringify(output)), false)
})
test('invalid pagination, unknown/duplicate queries and slugs are rejected before fetching', async () => {
  let calls = 0; const source = client(async () => { calls++; throw new Error('Unexpected request') })
  for (const input of [null, [], { page: null }, { pageSize: null }, { page: 0 }, { page: 1001 }, { pageSize: 51 }, { page: '01' }, { page: '1e2' }, { page: 1.5 }, { extra: true }]) await assert.rejects(source.list(input), failure('invalid'))
  for (const query of ['page=1&page=2', 'page[0]=1', 'perspective=drafts']) assert.throws(() => api.publicBlogSearchInput(new URLSearchParams(query)), failure('invalid'))
  for (const slug of ['', 'Upper', '../article', 'a--b', 'a'.repeat(97)]) await assert.rejects(source.getBySlug(slug), failure('invalid'))
  assert.equal(calls, 0)
})
test('400/404/429/503, non-JSON middleware responses and network errors have safe distinct outcomes', async () => {
  for (const [status, code, expected] of [[400, 'INVALID_BLOG_REQUEST', 'invalid'], [404, 'BLOG_NOT_FOUND', 'not-found'], [429, undefined, 'rate-limited'], [503, 'BLOGS_UNAVAILABLE', 'unavailable'], [404, undefined, 'unavailable']]) {
    await assert.rejects(client(async () => Response.json({ error: { code, message: 'PRIVATE credential stack' } }, { status })).list(), failure(expected))
  }
  await assert.rejects(client(async () => new Response('PRIVATE stack', { status: 429 })).list(), failure('rate-limited'))
  await assert.rejects(client(async () => { throw new Error('PRIVATE credential stack') }).list(), failure('unavailable'))
})
test('empty/beyond-final pages are precise and malformed successful envelopes fail closed', async () => {
  assert.deepEqual((await client(fixtureFetch(blogFixture([]).service)).list()).pagination, { page: 1, pageSize: 20, total: 0, totalPages: 0 })
  assert.deepEqual((await client().list({ page: 1000, pageSize: 50 })).data, [])
  const good = await blogFixture().service.list({ pageSize: 2 })
  for (const mutation of [value => { value.pagination.totalPages = 99 }, value => { value.data.reverse() }, value => { value.data[1] = value.data[0] }, value => { value.data[0].author = null }, value => { value.data[0].featuredImage.asset.url = 'https://foreign.invalid/image.jpg' }]) {
    const value = structuredClone(good); mutation(value)
    await assert.rejects(client(async () => Response.json(value)).list({ pageSize: 2 }), failure('unavailable'))
  }
})
test('unsafe bodies, wrong slugs and foreign canonicals cannot reach the renderer', async () => {
  const good = await blogFixture().service.getBySlug('fragrance-journal')
  for (const mutation of [value => { value.data.slug = 'other-slug' }, value => { value.data.body[2].markDefs[0].href = 'javascript:alert(1)' },
    value => { value.data.body[0]._type = 'html' }, value => { value.data.seo.canonicalUrl = 'https://foreign.invalid/blogs/fragrance-journal' },
    value => { value.data.featuredImage.asset.url = value.data.featuredImage.asset.url.replace('6n1y88j4', 'foreign') }]) {
    const value = structuredClone(good); mutation(value)
    await assert.rejects(client(async () => Response.json(value)).getBySlug('fragrance-journal'), failure('unavailable'))
  }
})
test('public client projection discards unknown response fields at nested boundaries', async () => {
  const value = await blogFixture().service.getBySlug('fragrance-journal')
  value.data.token = 'PRIVATE'; value.data.author.email = 'private@example.invalid'; value.data.body[0].children[0].token = 'PRIVATE'
  const output = await client(async () => Response.json(value)).getBySlug('fragrance-journal')
  assert.equal(/PRIVATE|private@example/.test(JSON.stringify(output)), false)
})
test('validated image builder retains crop/hotspot and rejects other asset namespaces', async () => {
  const image = (await client().getBySlug('fragrance-journal')).data.featuredImage
  const url = new URL(images.blogImageUrl(image, configuration, 800, 500))
  assert.equal(url.origin, 'https://cdn.sanity.io'); assert.ok(url.pathname.startsWith('/images/6n1y88j4/production/'))
  assert.equal(url.searchParams.get('w'), '800'); assert.equal(url.searchParams.get('h'), '500'); assert.ok(url.searchParams.has('rect'))
  const moved = structuredClone(image); moved.hotspot = { x: 0.25, y: 0.5, width: 0.2, height: 0.5 }
  assert.notEqual(images.blogImageUrl(moved, configuration, 800, 500), url.href)
  const bad = structuredClone(image); bad.asset.url = bad.asset.url.replace('/production/', '/other/')
  assert.throws(() => images.blogImageUrl(bad, configuration, 800))
})
test('new SEO uses approved origin through ready/loading/error states and has no browser-origin fallback', async () => {
  const article = (await client().getBySlug('fragrance-journal')).data
  const ready = seo.resolvePublicBlogSeo('/blogs/fragrance-journal', { status: 'ready', data: article }, configuration)
  assert.equal(ready.title, 'Fragrance advice'); assert.equal(ready.canonical, `${canonicalOrigin}/blogs/fragrance-journal`)
  assert.equal(ready.robots, 'index,follow'); assert.ok(ready.ogImage.startsWith('https://cdn.sanity.io/images/6n1y88j4/production/'))
  article.seo.noIndex = true; assert.equal(seo.resolvePublicBlogSeo('/blogs/fragrance-journal', { status: 'ready', data: article }, configuration).robots, 'noindex,follow')
  for (const status of ['loading', 'not-found', 'unavailable', 'rate-limited']) {
    const result = seo.resolvePublicBlogSeo('/blogs/fragrance-journal', { status }, configuration)
    assert.equal(result.robots, 'noindex,follow'); assert.equal(result.ogImage, ''); assert.equal(result.canonical, status === 'loading' ? ready.canonical : '')
  }
  assert.equal(seo.resolvePublicBlogSeo('/blogs/Upper', { status: 'invalid' }, configuration).canonical, '')
  assert.throws(() => client(undefined, { configuration: { ...configuration, canonicalOrigin: 'http://localhost:5173' } }))
})
test('cancellation and deadlines settle even fixtures ignoring their AbortSignal', async () => {
  const abort = new AbortController(), hanging = client(async () => new Promise(() => {}), { timeoutMs: 50 })
  const cancelled = hanging.getBySlug('fragrance-journal', abort.signal); abort.abort()
  await assert.rejects(cancelled, error => error.name === 'AbortError')
  await assert.rejects(hanging.list(), failure('unavailable'))
})
test('unpublish is observed on fresh detail/list reads without any legacy fallback', async () => {
  const fixture = blogFixture(), source = client(fixtureFetch(fixture.service))
  assert.equal((await source.getBySlug('fragrance-journal')).data.id, 'post-a')
  fixture.records.splice(fixture.records.findIndex(row => row._id === 'post-a'), 1)
  await assert.rejects(source.getBySlug('fragrance-journal'), failure('not-found'))
  assert.equal((await source.list()).pagination.total, 3)
})

 test('React listing metadata matches HTML pagination and strict query policy', () => {
  for (const [path,search,suffix] of [['/blogs','','/blogs'],['/blogs/','?page=1&pageSize=20','/blogs'],['/blogs','?page=2','/blogs?page=2'],['/blogs/','?pageSize=2&page=2','/blogs?page=2&pageSize=2']]) {
   const result=seo.resolvePublicBlogSeo(path,{status:'ready'},configuration,search);
   assert.equal(result.canonical,canonicalOrigin+suffix); assert.equal(result.robots,'index,follow');
  }
  for(const search of ['?page=0','?page=2&page=3','?utm_source=fixture']) {
   const result=seo.resolvePublicBlogSeo('/blogs',{status:'ready'},configuration,search);
   assert.equal(result.canonical,''); assert.equal(result.robots,'noindex,follow');
  }
  assert.equal(seo.resolvePublicBlogSeo('/blogs',{status:'empty'},configuration).robots,'noindex,follow');
  assert.equal(seo.resolvePublicBlogSeo('/blogs',{status:'empty'},configuration,'?page=1000').canonical,'');
 });
