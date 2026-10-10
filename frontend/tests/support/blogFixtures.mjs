import { makeSanityBlogDocuments, createSanityBlogClientFixture } from '../../../backend/server/tests/support/sanityBlogFixtures.js'
import { createSanityBlogV1Service } from '../../../backend/server/services/sanityBlogSource.js'

export const canonicalOrigin = 'https://shop.example.invalid'
export const configuration = Object.freeze({ canonicalOrigin, projectId: '6n1y88j4', dataset: 'production' })
export const legacyBlog = { id: 'legacy-fixture', slug: 'legacy-story', title: 'Legacy journal', excerpt: 'Historical storefront article.',
  content: ['Legacy paragraph.'], category: 'Legacy', readTime: '7 min read', publishedAt: '2026-10-08T12:00:00Z', image: 'ruby-amber' }
export function blogDocuments() {
  const records = makeSanityBlogDocuments()
  for (const row of records) {
    if (row._type === 'sanity.imageAsset') row.url = row.url.replace('/images/fixture/', '/images/6n1y88j4/')
    if (row._id === 'post-c') row.title = 'Latest fragrance story'
    if (row._id === 'post-b') row.title = 'Second fragrance story'
    if (row._id === 'post-d') row.title = 'Oldest fragrance story'
    if (row._id === 'post-a') row.body.push(
      { _type: 'block', _key: 'quote', style: 'blockquote', children: [{ _type: 'span', _key: 'quote-span', text: 'Fragrance is personal.', marks: [] }], markDefs: [] },
      { _type: 'block', _key: 'internal', style: 'normal', children: [{ _type: 'span', _key: 'internal-span', text: 'Read the second story.', marks: ['internal-link'] }], markDefs: [{ _type: 'link', _key: 'internal-link', href: '/blogs/second-article' }] },
      { _type: 'block', _key: 'escaped', style: 'normal', children: [{ _type: 'span', _key: 'escaped-span', text: '<script>alert("text")</script>', marks: [] }], markDefs: [] },
    )
  }
  return records
}
export function blogFixture(documents = blogDocuments()) {
  const source = createSanityBlogClientFixture(documents)
  const service = createSanityBlogV1Service({ environment: { CLIENT_ORIGIN: canonicalOrigin }, clientFactory: () => source.client })
  return { ...source, service }
}
export function fixtureFetch(service, calls = []) {
  return async (path, options) => {
    calls.push({ path, options })
    const url = new URL(path, 'http://fixture.invalid')
    try {
      const result = url.pathname === '/api/v1/public/blogs'
        ? await service.list(Object.fromEntries(url.searchParams)) : await service.getBySlug(url.pathname.split('/').at(-1))
      return Response.json(result)
    } catch (error) { return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status ?? 503 }) }
  }
}
