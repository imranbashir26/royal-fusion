import assert from 'node:assert/strict'
import test from 'node:test'
import { BlogApiError, BlogRepository } from '../services/blogRepository.js'
import { BlogV1Service, blogErrorResponse } from '../services/blogV1Service.js'
import { createBlogFixtureSource, makeBlogArticle, makeBlogDocuments } from './support/blogFixtures.js'

const canonicalOrigin = 'https://shop.example.invalid'
function fixture(documents) {
  const source = createBlogFixtureSource(documents)
  const repository = new BlogRepository({ source, canonicalOrigin })
  return { source, repository, service: new BlogV1Service(repository) }
}
function apiError(code, status) {
  return error => error instanceof BlogApiError && error.code === code && error.status === status
}

test('listing pages are bounded, stable across tied dates and exclude article bodies', async () => {
  const { source, service } = fixture()
  const first = await service.list({ page: '1', pageSize: '2' })
  const second = await service.list({ page: 2, pageSize: 2 })
  assert.deepEqual(first.data.map(article => article.id), ['post-c', 'post-a'])
  assert.deepEqual(second.data.map(article => article.id), ['post-b', 'post-d'])
  assert.deepEqual(first.pagination, { page: 1, pageSize: 2, total: 4, totalPages: 2 })
  assert.deepEqual(second.pagination, { page: 2, pageSize: 2, total: 4, totalPages: 2 })
  assert.equal(new Set([...first.data, ...second.data].map(article => article.id)).size, 4)
  assert.deepEqual(source.calls, [
    { operation: 'list', offset: 0, limit: 2, order: ['publishedAt desc', '_id asc'] },
    { operation: 'list', offset: 2, limit: 2, order: ['publishedAt desc', '_id asc'] },
  ])
  assert.ok([...first.data, ...second.data].every(article => !('body' in article) && !('content' in article)))
})

test('defaults, empty lists and pages beyond the final page have explicit pagination', async () => {
  const { service, source } = fixture()
  assert.deepEqual((await service.list()).pagination, { page: 1, pageSize: 20, total: 4, totalPages: 1 })
  assert.equal(source.calls[0].limit, 20)
  assert.deepEqual(await service.list({ page: 3, pageSize: 2 }), { data: [], pagination: { page: 3, pageSize: 2, total: 4, totalPages: 2 } })
  assert.deepEqual(await fixture([]).service.list(), { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } })
})

test('maximum page and size are supported without an unbounded source request', async () => {
  const { service, source } = fixture()
  await service.list({ page: 1000, pageSize: 50 })
  assert.equal(source.calls[0].offset, 49950)
  assert.equal(source.calls[0].limit, 50)
})

test('invalid pagination and unknown filters fail before accessing the source', async () => {
  const { service, source } = fixture()
  for (const input of [null, { page: 0 }, { page: 1001 }, { pageSize: 51 }, { pageSize: -1 }, { page: 1.5 }, { page: '1e3' }, { page: ' 1' }, { page: [1] }, { pageSize: true }, { status: 'Draft' }, { token: 'PRIVATE_FIXTURE_TOKEN' }]) {
    await assert.rejects(service.list(input), apiError('INVALID_BLOG_REQUEST', 400))
  }
  assert.deepEqual(source.calls, [])
})

test('valid slugs resolve and invalid slugs never reach the source', async () => {
  const { service, source } = fixture()
  assert.equal((await service.getBySlug('fragrance-journal')).data.id, 'post-a')
  for (const slug of ['', 'UPPERCASE', 'two--hyphens', '-leading', 'trailing-', '../article', 'article/extra', '%2farticle', 'article?x=1', ' article', 'a'.repeat(97), null, ['article']]) {
    await assert.rejects(service.getBySlug(slug), apiError('INVALID_BLOG_REQUEST', 400))
  }
  assert.deepEqual(source.calls, [{ operation: 'detail', slug: 'fragrance-journal' }])
})

test('native publishing excludes draft revisions, unpublished articles and release versions', async () => {
  const { service, repository } = fixture()
  const listing = await service.list()
  assert.equal(listing.pagination.total, 4)
  assert.ok(listing.data.every(article => !article.id.includes('.')))
  const article = (await service.getBySlug('fragrance-journal')).data
  assert.equal(article.title, 'Fragrance journal')
  assert.equal(await repository.getBySlug('unpublished-article'), null)
  await assert.rejects(service.getBySlug('unpublished-article'), apiError('BLOG_NOT_FOUND', 404))
  // A custom status must not hide a document that is natively published.
  assert.equal((await service.getBySlug('oldest-article')).data.id, 'post-d')
  assert.equal('status' in article, false)
})

test('missing article and upstream failure have distinct safe responses', async () => {
  const { service } = fixture()
  await assert.rejects(service.getBySlug('missing-article'), apiError('BLOG_NOT_FOUND', 404))
  const source = {
    async listPublished() { throw new Error('PRIVATE_FIXTURE_TOKEN https://private.example.invalid/query') },
    async getPublishedBySlug() { throw new Error('PRIVATE_FIXTURE_TOKEN upstream failure') },
  }
  const unavailable = new BlogV1Service(new BlogRepository({ source, canonicalOrigin }))
  await assert.rejects(unavailable.list(), apiError('BLOGS_UNAVAILABLE', 503))
  await assert.rejects(unavailable.getBySlug('valid-slug'), apiError('BLOGS_UNAVAILABLE', 503))
  const requestId = 'req_00000000-0000-4000-8000-000000000001'
  assert.deepEqual(blogErrorResponse(new Error('PRIVATE_FIXTURE_TOKEN'), requestId), {
    status: 503, body: { error: { code: 'BLOGS_UNAVAILABLE', message: 'Articles are temporarily unavailable.', requestId } },
  })
  assert.equal(blogErrorResponse(new BlogApiError('BLOG_NOT_FOUND')).status, 404)
  assert.equal(blogErrorResponse(new BlogApiError('INVALID_BLOG_REQUEST')).status, 400)
  assert.equal(JSON.stringify(blogErrorResponse(new Error('PRIVATE_FIXTURE_TOKEN'), 'PRIVATE_FIXTURE_TOKEN')).includes('PRIVATE_FIXTURE'), false)
  await assert.rejects(new BlogRepository({ canonicalOrigin }).list(), apiError('BLOGS_UNAVAILABLE', 503))
})

test('blog error correlation preserves server ID format and rejects malformed metadata', () => {
  const requestId = 'req_00000000-0000-4000-8000-000000000001'
  for (const code of ['INVALID_BLOG_REQUEST', 'BLOG_NOT_FOUND', 'BLOGS_UNAVAILABLE']) {
    assert.equal(blogErrorResponse(new BlogApiError(code), requestId).body.error.requestId, requestId)
  }
  for (const value of [undefined, null, {}, 'a'.repeat(64), requestId.slice(4), `${requestId}/secret`, `${requestId}\n`, 'req_not-a-uuid']) {
    assert.equal('requestId' in blogErrorResponse(new Error('PRIVATE_FIXTURE_TOKEN'), value).body.error, false)
  }
})

test('public projection preserves references, dates, featured image geometry and SEO', async () => {
  const article = (await fixture().service.getBySlug('fragrance-journal')).data
  assert.deepEqual(article.author, { id: 'author-a', name: 'Royal Fusion Editorial', bio: 'Fragrance education.' })
  assert.deepEqual(article.category, { id: 'category-a', title: 'Education', slug: 'education', description: 'Editorial advice.' })
  assert.deepEqual(article.featuredImage, {
    asset: { _type: 'reference', _ref: 'image-fixture-1200x800-jpg', url: 'https://cdn.sanity.io/images/fixture/production/fixture-1200x800.jpg', width: 1200, height: 800 },
    alt: 'Fragrance journal editorial photograph', crop: { top: 0.1, bottom: 0.1, left: 0.05, right: 0.05 },
    hotspot: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }, caption: 'An editorial image.',
  })
  assert.equal(article.publishedAt, '2026-10-08T12:00:00.000Z')
  assert.equal(article.updatedAt, '2026-10-09T12:00:00.000Z')
  assert.deepEqual(article.tags, ['fragrance', 'education'])
  assert.deepEqual(article.seo, { title: 'Fragrance advice', description: 'Practical fragrance education.', canonicalUrl: `${canonicalOrigin}/blogs/fragrance-journal`, noIndex: false, ogImage: null })
})

test('Portable Text preserves headings, lists, spans, links and image references without flattening', async () => {
  const original = makeBlogArticle()
  const article = (await fixture([original]).service.getBySlug('fragrance-journal')).data
  assert.deepEqual(article.body.slice(0, 5), original.body.slice(0, 5))
  assert.deepEqual(article.body[5], { _type: 'image', _key: 'article-image', ...article.featuredImage })
  assert.equal('content' in article, false)
})

test('unknown credentials and private metadata are removed at every projected boundary', async () => {
  const original = makeBlogArticle()
  original.body[0].token = 'PRIVATE_FIXTURE_BLOCK_TOKEN'
  original.body[0].children[0].secret = 'PRIVATE_FIXTURE_SPAN_TOKEN'
  original.body[2].markDefs[0].token = 'PRIVATE_FIXTURE_LINK_TOKEN'
  const { service } = fixture([original])
  const output = JSON.stringify([await service.list(), await service.getBySlug('fragrance-journal')])
  assert.equal(output.includes('PRIVATE_FIXTURE'), false)
  assert.equal(output.includes('private@example.invalid'), false)
  assert.deepEqual(Object.keys((await service.getBySlug('fragrance-journal')).data).sort(), ['author', 'body', 'category', 'excerpt', 'featuredImage', 'id', 'publishedAt', 'seo', 'slug', 'tags', 'title', 'updatedAt'])
})

test('optional editorial fields and historical image alt text have safe defaults', async () => {
  const original = makeBlogArticle({ tags: null, seoTitle: null, seoDescription: null, canonicalUrl: null })
  delete original.featuredImage.alt
  delete original.featuredImage.crop
  delete original.featuredImage.hotspot
  delete original.featuredImage.caption
  delete original.author.bio
  delete original.category.description
  delete original.noIndex
  const article = (await fixture([original]).service.getBySlug('fragrance-journal')).data
  assert.deepEqual(article.tags, [])
  assert.equal(article.featuredImage.alt, 'Historical featured image alt text')
  assert.equal(article.featuredImage.crop, null)
  assert.equal(article.featuredImage.hotspot, null)
  assert.equal(article.featuredImage.caption, null)
  assert.equal(article.author.bio, null)
  assert.equal(article.category.description, null)
  assert.equal(article.seo.canonicalUrl, `${canonicalOrigin}/blogs/fragrance-journal`)
  assert.equal(article.seo.noIndex, false)
})

test('optional OG image and noindex survive projection without disclosing asset metadata', async () => {
  const original = makeBlogArticle({ noIndex: true })
  original.ogImage = structuredClone(original.featuredImage)
  const article = (await fixture([original]).service.getBySlug('fragrance-journal')).data
  assert.equal(article.seo.noIndex, true)
  assert.deepEqual(article.seo.ogImage, article.featuredImage)
  assert.equal(JSON.stringify(article.seo).includes('PRIVATE_FIXTURE'), false)
})

test('publication dates describe content and do not create another publishing mechanism', async () => {
  const original = makeBlogArticle({ publishedAt: '2099-01-01T00:00:00Z', status: 'Draft' })
  const { service } = fixture([original])
  assert.equal((await service.list()).pagination.total, 1)
  assert.equal((await service.getBySlug('fragrance-journal')).data.publishedAt, '2099-01-01T00:00:00.000Z')
})

test('the fixture source is the only content dependency and performs no fetch', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let attemptedFetches = 0
  globalThis.fetch = async () => { attemptedFetches++; throw new Error('Unexpected network dependency.') }
  const { service, source } = fixture()
  await service.list()
  await service.getBySlug('fragrance-journal')
  assert.equal(attemptedFetches, 0)
  assert.equal(source.calls.length, 2)
})

test('native draft or version identities from an incorrect source fail closed, including references', async () => {
  for (const change of [article => { article._id = 'drafts.post-a' }, article => { article._id = 'versions.release.post-a' }, article => { article.author._id = 'drafts.author-a' }, article => { article.category._id = 'drafts.category-a' }]) {
    const article = makeBlogArticle(); change(article)
    const source = { async listPublished() { return { documents: [article], total: 1 } }, async getPublishedBySlug() { return article } }
    const service = new BlogV1Service(new BlogRepository({ source, canonicalOrigin }))
    await assert.rejects(service.list(), apiError('BLOGS_UNAVAILABLE', 503))
    await assert.rejects(service.getBySlug('fragrance-journal'), apiError('BLOGS_UNAVAILABLE', 503))
  }
})

test('invalid source ordering, counts, duplicate identities and oversized results fail closed', async () => {
  const documents = makeBlogDocuments().filter(article => !article._id.includes('.')).slice(0, 2)
  const cases = [
    { documents, total: 2 }, // Incorrectly ordered: older post-b before latest post-c.
    { documents: [documents[0], documents[0]], total: 2 },
    { documents: [], total: 1 },
    { documents: [], total: -1 },
    { documents: Array(51).fill(documents[0]), total: 51 },
  ]
  for (const result of cases) {
    const source = { async listPublished() { return result } }
    await assert.rejects(new BlogRepository({ source, canonicalOrigin }).list(), apiError('BLOGS_UNAVAILABLE', 503))
  }
})

test('wrong detail slug, ambiguous slug and malformed upstream response cannot become a public article', async () => {
  const source = { async getPublishedBySlug() { return makeBlogArticle({ slug: { current: 'different-slug' } }) } }
  await assert.rejects(new BlogRepository({ source, canonicalOrigin }).getBySlug('fragrance-journal'), apiError('BLOGS_UNAVAILABLE', 503))
  const duplicate = makeBlogArticle({ _id: 'another-id' })
  await assert.rejects(fixture([makeBlogArticle(), duplicate]).service.getBySlug('fragrance-journal'), apiError('BLOGS_UNAVAILABLE', 503))
  for (const value of [undefined, {}, 'PRIVATE_FIXTURE_TOKEN']) {
    const broken = { async getPublishedBySlug() { return value } }
    await assert.rejects(new BlogRepository({ source: broken, canonicalOrigin }).getBySlug('fragrance-journal'), apiError('BLOGS_UNAVAILABLE', 503))
  }
})

test('unsafe links, assets, geometry, canonicals and corrupt Portable Text fail closed', async () => {
  for (const change of [
    article => { article.body[2].markDefs[0].href = 'javascript:alert(1)' },
    article => { article.body[2].markDefs[0].href = '//foreign.example.invalid' },
    article => { article.body[2].markDefs[0].href = 'https://user:PRIVATE_FIXTURE_TOKEN@example.invalid' },
    article => { article.featuredImage.asset.url = 'https://foreign.example.invalid/image.jpg' },
    article => { article.featuredImage.asset.url += '?token=PRIVATE_FIXTURE_TOKEN' },
    article => { article.featuredImage.crop.left = 1 },
    article => { article.featuredImage.hotspot.x = 0 },
    article => { article.canonicalUrl = 'https://foreign.example.invalid/blogs/fragrance-journal' },
    article => { article.canonicalUrl = `${canonicalOrigin}/blogs/other-article` },
    article => { article.canonicalUrl += '?token=PRIVATE_FIXTURE_TOKEN' },
    article => { article.body[2].children[0].marks = ['missing-link'] },
    article => { article.body[1]._key = article.body[0]._key },
    article => { article.body[0]._type = 'html'; article.body[0].html = '<script>unsafe</script>' },
    article => { article.body[5].alt = '' },
    article => { article.publishedAt = 'invalid-date' },
  ]) {
    const article = makeBlogArticle(); change(article)
    await assert.rejects(fixture([article]).service.getBySlug('fragrance-journal'), apiError('BLOGS_UNAVAILABLE', 503))
  }
})

test('fixture and returned DTO mutations cannot alter another request or input records', async () => {
  const original = makeBlogArticle()
  const { service } = fixture([original])
  const before = structuredClone(original)
  original.title = 'Changed external fixture'
  const first = (await service.getBySlug('fragrance-journal')).data
  first.body[0].children[0].text = 'Changed returned DTO'
  first.featuredImage.crop.top = 0.2
  const next = (await service.getBySlug('fragrance-journal')).data
  assert.equal(next.title, before.title)
  assert.equal(next.body[0].children[0].text, before.body[0].children[0].text)
  assert.equal(next.featuredImage.crop.top, before.featuredImage.crop.top)
})

test('canonical origin is explicit and cannot contain credentials, paths or unsafe schemes', () => {
  for (const origin of ['http://shop.example.invalid', 'https://user:pass@shop.example.invalid', 'https://shop.example.invalid/path', 'https://shop.example.invalid?x=1', 'invalid']) {
    assert.throws(() => new BlogRepository({ canonicalOrigin: origin }), TypeError)
  }
})
