// Disposable resolved Sanity-shaped records. These are never a production content fallback.
export function makeBlogImage() {
  return {
    _type: 'image',
    asset: {
      _id: 'image-fixture-1200x800-jpg', _type: 'sanity.imageAsset',
      url: 'https://cdn.sanity.io/images/fixture/production/fixture-1200x800.jpg',
      metadata: { dimensions: { width: 1200, height: 800 }, privateLocation: 'PRIVATE_FIXTURE_LOCATION' },
      token: 'PRIVATE_FIXTURE_ASSET_TOKEN',
    },
    alt: 'Fragrance journal editorial photograph',
    crop: { top: 0.1, bottom: 0.1, left: 0.05, right: 0.05 },
    hotspot: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    caption: 'An editorial image.',
  }
}

export function makeBlogArticle(overrides = {}) {
  return {
    _id: 'post-a', _type: 'blogPost', title: 'Fragrance journal', slug: { current: 'fragrance-journal' },
    excerpt: 'Choosing a fragrance with confidence.', publishedAt: '2026-10-08T12:00:00Z', _updatedAt: '2026-10-09T12:00:00Z',
    author: { _id: 'author-a', _type: 'author', name: 'Royal Fusion Editorial', bio: 'Fragrance education.', email: 'private@example.invalid', token: 'PRIVATE_FIXTURE_AUTHOR_TOKEN' },
    category: { _id: 'category-a', _type: 'blogCategory', title: 'Education', slug: { current: 'education' }, description: 'Editorial advice.', internalNotes: 'PRIVATE_FIXTURE_CATEGORY' },
    featuredImage: makeBlogImage(), imageAlt: 'Historical featured image alt text',
    tags: ['fragrance', 'education'], seoTitle: 'Fragrance advice', seoDescription: 'Practical fragrance education.',
    canonicalUrl: 'https://shop.example.invalid/blogs/fragrance-journal', noIndex: false, ogImage: null,
    status: 'Unpublished', token: 'PRIVATE_FIXTURE_DOCUMENT_TOKEN', internalNotes: 'PRIVATE_FIXTURE_DOCUMENT',
    body: [
      { _type: 'block', _key: 'heading', style: 'h2', children: [{ _type: 'span', _key: 'heading-text', text: 'Choosing notes', marks: [] }], markDefs: [] },
      { _type: 'block', _key: 'subheading', style: 'h3', children: [{ _type: 'span', _key: 'subheading-text', text: 'Daily wear', marks: [] }], markDefs: [] },
      { _type: 'block', _key: 'paragraph', style: 'normal', children: [{ _type: 'span', _key: 'paragraph-text', text: 'Read our advice.', marks: ['strong', 'guide-link'] }], markDefs: [{ _type: 'link', _key: 'guide-link', href: 'https://example.invalid/guide' }] },
      { _type: 'block', _key: 'bullet', style: 'normal', listItem: 'bullet', level: 1, children: [{ _type: 'span', _key: 'bullet-text', text: 'Try a sample.', marks: ['em'] }], markDefs: [] },
      { _type: 'block', _key: 'number', style: 'normal', listItem: 'number', level: 2, children: [{ _type: 'span', _key: 'number-text', text: 'Let it settle.', marks: [] }], markDefs: [] },
      { ...makeBlogImage(), _key: 'article-image' },
    ],
    ...overrides,
  }
}

export function makeBlogDocuments() {
  return [
    makeBlogArticle({ _id: 'post-b', slug: { current: 'second-article' }, canonicalUrl: null }),
    makeBlogArticle({ _id: 'drafts.post-a', title: 'PRIVATE_FIXTURE_DRAFT_REVISION', status: 'Published' }),
    makeBlogArticle({ _id: 'post-c', slug: { current: 'latest-article' }, publishedAt: '2026-10-09T12:00:00Z', canonicalUrl: null }),
    makeBlogArticle(),
    makeBlogArticle({ _id: 'drafts.never-published', slug: { current: 'unpublished-article' }, title: 'PRIVATE_FIXTURE_DRAFT', status: 'Published', canonicalUrl: null }),
    makeBlogArticle({ _id: 'versions.release.post-a', title: 'PRIVATE_FIXTURE_RELEASE', status: 'Published' }),
    makeBlogArticle({ _id: 'post-d', slug: { current: 'oldest-article' }, publishedAt: '2026-10-07T12:00:00Z', canonicalUrl: null, status: 'Draft' }),
  ]
}

export function createBlogFixtureSource(documents = makeBlogDocuments()) {
  const records = structuredClone(documents)
  const calls = []
  const published = () => records.filter(record => record._type === 'blogPost' && !record._id.includes('.'))
  return {
    calls,
    async listPublished(input) {
      calls.push({ operation: 'list', ...structuredClone(input) })
      const ordered = published().sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
        || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0))
      return structuredClone({ documents: ordered.slice(input.offset, input.offset + input.limit), total: ordered.length })
    },
    async getPublishedBySlug(slug) {
      calls.push({ operation: 'detail', slug })
      const matches = published().filter(record => record.slug.current === slug)
      if (matches.length > 1) throw new Error('Ambiguous fixture slug.')
      return matches.length ? structuredClone(matches[0]) : null
    },
  }
}
