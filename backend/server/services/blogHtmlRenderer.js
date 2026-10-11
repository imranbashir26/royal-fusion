import { toHTML } from '@portabletext/to-html'
import { BLOG_MAX_PAGE, blogListInputSchema, blogSourceArticleSchema, blogSourceSummarySchema } from '../schemas/blogV1.js'
import { BlogApiError, compareArticles } from './blogRepository.js'
import { blogHtmlImageUrl, projectBlogHtmlImage, validateBlogHtmlMediaConfiguration } from './blogHtmlMedia.js'

/** @type {Readonly<{maxHtmlBytes: number, maxTextBytes: number, maxSpans: number, maxWorkUnits: number}>} */
export const BLOG_HTML_LIMITS = Object.freeze({ maxHtmlBytes: 2 * 1024 * 1024, maxTextBytes: 1024 * 1024, maxSpans: 10000, maxWorkUnits: 100000 })
const invalid = () => new TypeError('Blog HTML rendering failed.')
/** @param {unknown} value @returns {Record<string, unknown>} */
const record = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  return /** @type {Record<string, unknown>} */ (value)
}
/** @type {Record<string, string>} */
const characters = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** @param {unknown} value */
const escapeText = value => String(value).replace(/[&<>"']/g, character => characters[character])
/** @param {unknown} value */
const escapeAttribute = value => escapeText(value)
/** @param {unknown} value */
const safeLink = value => {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s<>\\]/.test(value)) throw invalid()
  if (value.startsWith('/') && !value.startsWith('//')) return value
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) throw invalid()
  return url.href
}
/** @param {import('../../../shared/contracts/blogV1.js').BlogImage} image */
const sourceImage = image => ({ _type: 'image', asset: { _id: image.asset._ref, _type: 'sanity.imageAsset', url: image.asset.url,
  metadata: { dimensions: { width: image.asset.width, height: image.asset.height } } }, alt: image.alt, crop: image.crop, hotspot: image.hotspot, caption: image.caption })

/** Explicit trusted configuration only; never reads environment or request headers.
 * @param {{canonicalOrigin: string, projectId?: string, dataset?: string, limits?: Partial<Record<'maxHtmlBytes'|'maxTextBytes'|'maxSpans'|'maxWorkUnits', number>>}} options */
export function createBlogHtmlRenderer({ canonicalOrigin, projectId = '6n1y88j4', dataset = 'production', limits = {} }) {
  if (typeof canonicalOrigin !== 'string' || canonicalOrigin.length > 2048 || /[<>\s]/.test(canonicalOrigin)) throw invalid()
  const origin = new URL(canonicalOrigin)
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw invalid()
  const configuration = Object.freeze({ canonicalOrigin: origin.origin, projectId, dataset })
  validateBlogHtmlMediaConfiguration(configuration)
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)
    || Object.entries(limits).some(([key, value]) => !Object.hasOwn(BLOG_HTML_LIMITS, key)
      || !Number.isInteger(value) || value < 1 || value > BLOG_HTML_LIMITS[/** @type {keyof typeof BLOG_HTML_LIMITS} */ (key)])) throw invalid()
  const budget = Object.freeze({ ...BLOG_HTML_LIMITS, ...limits })

  /** @param {unknown[]} rows */
  function checkWork(rows, article = false) {
    let work = 0, spans = 0, bytes = 0
    /** @param {unknown} value */
    const count = (value, units = 1) => {
      work += units
      if (typeof value === 'string') {
        if (value.length > budget.maxTextBytes) throw invalid()
        bytes += Buffer.byteLength(value)
      }
      if (work > budget.maxWorkUnits || bytes > budget.maxTextBytes) throw invalid()
    }
    for (const value of rows) {
      const row = record(value), author = record(row.author), category = record(row.category), seo = record(row.seo)
      for (const field of [row.title, row.excerpt, author.name, author.bio, category.title, category.description,
        seo.title, seo.description, seo.canonicalUrl, row.readTime]) count(field)
      if (Array.isArray(row.tags)) {
        if (row.tags.length > 30) throw invalid()
        for (const tag of row.tags) count(tag)
      }
      if (!article) continue
      if (!Array.isArray(row.body) || !row.body.length || row.body.length > 1000) throw invalid()
      for (const raw of row.body) {
        const node = record(raw)
        count(node._key)
        if (node._type === 'image') { count(node.alt); count(node.caption); continue }
        if (node._type !== 'block' || !Array.isArray(node.children) || node.children.length > 1000
          || !Array.isArray(node.markDefs) || node.markDefs.length > 100) throw invalid()
        for (const rawChild of node.children) {
          const child = record(rawChild)
          if (++spans > budget.maxSpans || !Array.isArray(child.marks) || child.marks.length > 30) throw invalid()
          count(child.text, 1 + child.marks.length)
        }
        for (const mark of node.markDefs) count(mark.href)
      }
    }
  }

  /** @param {unknown} value */
  function summary(value) {
    const row = record(value), author = record(row.author), category = record(row.category), seo = record(row.seo)
    if (!Array.isArray(row.tags) || typeof seo.noIndex !== 'boolean' || typeof seo.canonicalUrl !== 'string'
      || !(author.bio === null || typeof author.bio === 'string') || !(category.description === null || typeof category.description === 'string')
      || !(seo.title === null || typeof seo.title === 'string') || !(seo.description === null || typeof seo.description === 'string')) throw invalid()
    const featuredImage = projectBlogHtmlImage(row.featuredImage, configuration)
    const ogImage = seo.ogImage === null ? null : projectBlogHtmlImage(seo.ogImage, configuration)
    // Reuse the existing source contract for field validation, not a second publication model.
    const source = blogSourceSummarySchema.parse({ _id: row.id, _type: 'blogPost', title: row.title, slug: { current: row.slug },
      excerpt: row.excerpt, publishedAt: row.publishedAt, _updatedAt: row.updatedAt, readTime: row.readTime,
      author: { _id: author.id, _type: 'author', name: author.name, bio: author.bio },
      category: { _id: category.id, _type: 'blogCategory', title: category.title, slug: { current: category.slug }, description: category.description },
      featuredImage: sourceImage(featuredImage), tags: row.tags, seoTitle: seo.title, seoDescription: seo.description,
      canonicalUrl: seo.canonicalUrl, noIndex: seo.noIndex, ogImage: ogImage ? sourceImage(ogImage) : null })
    if (typeof source.canonicalUrl !== 'string') throw invalid()
    const canonical = new URL(source.canonicalUrl)
    if (canonical.origin !== configuration.canonicalOrigin || canonical.pathname !== `/blogs/${source.slug.current}`) throw invalid()
    return { source, featuredImage, ogImage, canonical: canonical.href }
  }

  /** @param {{page: number, pageSize: number}} input */
  const listingPath = ({ page, pageSize }) => `/blogs${page === 1 && pageSize === 20 ? ''
    : `?${[page > 1 ? `page=${page}` : '', pageSize !== 20 ? `pageSize=${pageSize}` : ''].filter(Boolean).join('&')}`}`
  /** @param {string} name @param {string} value */
  const meta = (name, value, property = false) => `<meta ${property ? 'property' : 'name'}="${name}" content="${escapeAttribute(value)}">`
  /** @param {string} href @param {string} label */
  const anchor = (href, label) => `<a href="${escapeAttribute(safeLink(href))}">${escapeText(label)}</a>`
  /** @param {{publishedAt: string, _updatedAt: string}} source */
  const dates = source => `<p>Published <time datetime="${escapeAttribute(new Date(source.publishedAt).toISOString())}">${escapeText(new Date(source.publishedAt).toISOString().slice(0, 10))}</time> · Updated <time datetime="${escapeAttribute(new Date(source._updatedAt).toISOString())}">${escapeText(new Date(source._updatedAt).toISOString().slice(0, 10))}</time></p>`
  /** @param {unknown} value @param {number} [width] @param {number} [height] */
  function image(value, width = 1200, height, eager = false) {
    const projected = projectBlogHtmlImage(value, configuration)
    const cropWidth = projected.asset.width * (1 - (projected.crop?.left ?? 0) - (projected.crop?.right ?? 0))
    const cropHeight = projected.asset.height * (1 - (projected.crop?.top ?? 0) - (projected.crop?.bottom ?? 0))
    const renderedHeight = height ?? Math.round(width * cropHeight / cropWidth)
    if (!Number.isSafeInteger(renderedHeight) || renderedHeight < 1 || renderedHeight > 100000) throw invalid()
    return `<figure><img src="${escapeAttribute(blogHtmlImageUrl(projected, configuration, width, height))}" alt="${escapeAttribute(projected.alt)}" width="${width}" height="${renderedHeight}" loading="${eager ? 'eager' : 'lazy'}" decoding="async">${projected.caption ? `<figcaption>${escapeText(projected.caption)}</figcaption>` : ''}</figure>`
  }
  /** @param {{title: string, description: string, canonical?: string, robots: string, ogType?: string,
   * ogImage?: import('../../../shared/contracts/blogV1.js').BlogImage|null, publishedAt?: string, updatedAt?: string}} metadata
   * @param {string} content */
  function document({ title, description, canonical, robots, ogType = 'website', ogImage, publishedAt, updatedAt }, content) {
    const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeText(title)}</title>`
      + meta('description', description) + meta('robots', robots)
      + (canonical ? `<link rel="canonical" href="${escapeAttribute(canonical)}">` + meta('og:title', title, true)
        + meta('og:description', description, true) + meta('og:url', canonical, true) + meta('og:type', ogType, true) : '')
      + (ogImage ? meta('og:image', blogHtmlImageUrl(ogImage, configuration, 1200, 630), true) + meta('og:image:alt', ogImage.alt, true)
        + meta('og:image:width', '1200', true) + meta('og:image:height', '630', true) : '')
      + (publishedAt ? meta('article:published_time', new Date(publishedAt).toISOString(), true) : '')
      + (updatedAt ? meta('article:modified_time', new Date(updatedAt).toISOString(), true) : '')
    return { html: `<!doctype html><html lang="en"><head>${head}<link rel="stylesheet" href="/blogs/_assets/journal.css"></head><body><a class="skip-link" href="#main">Skip to content</a><header class="site-header"><nav aria-label="Main navigation">${anchor('/', 'Royal Fusion')} ${anchor('/shop', 'Shop')} ${anchor('/blogs', 'Journal')}</nav></header><main id="main">${content}</main><footer class="site-footer">${anchor('/', 'Home')} ${anchor('/shop', 'Shop')} ${anchor('/blogs', 'Back to Journal')}</footer></body></html>`, robots }
  }
  /** @param {{html: string, robots: string}} result */
  function bounded(result) {
    if (Buffer.byteLength(result.html) > budget.maxHtmlBytes) throw invalid()
    return result
  }

  return Object.freeze({
    /** @param {unknown} result @param {import('../../../shared/contracts/blogV1.js').BlogListInput} [input] */
    renderListing(result, input = {}) {
      const selected = blogListInputSchema.parse(input), envelope = record(result), pagination = record(envelope.pagination)
      if (!Array.isArray(envelope.data) || envelope.data.length > selected.pageSize
        || pagination.page !== selected.page || pagination.pageSize !== selected.pageSize
        || typeof pagination.total !== 'number' || !Number.isSafeInteger(pagination.total) || pagination.total < 0
        || pagination.totalPages !== Math.ceil(pagination.total / selected.pageSize)
        || envelope.data.length !== Math.min(selected.pageSize, Math.max(0, pagination.total - (selected.page - 1) * selected.pageSize))) throw invalid()
      checkWork(envelope.data)
      const rows = envelope.data.map(summary)
      if (new Set(rows.map(row => row.source._id)).size !== rows.length || new Set(rows.map(row => row.source.slug.current)).size !== rows.length
        || rows.some((row, i) => i > 0 && compareArticles(rows[i - 1].source, row.source) > 0)) throw invalid()
      if (selected.page > 1 && !rows.length) throw new BlogApiError('BLOG_NOT_FOUND')
      const canonical = new URL(listingPath(selected), configuration.canonicalOrigin).href
      const cards = rows.map(({ source, featuredImage }) => `<article><h2>${anchor(`/blogs/${source.slug.current}`, source.title)}</h2><p>${escapeText(source.excerpt)}</p><p>By ${escapeText(source.author.name)} · ${escapeText(source.category.title)}</p>${dates(source)}${image(featuredImage, 800, 500)}${anchor(`/blogs/${source.slug.current}`, 'Read article')}</article>`).join('')
      const previous = selected.page > 1 ? anchor(listingPath({ ...selected, page: selected.page - 1 }), 'Previous page') : ''
      const next = selected.page < pagination.totalPages && selected.page < BLOG_MAX_PAGE ? anchor(listingPath({ ...selected, page: selected.page + 1 }), 'Next page') : ''
      const navigation = rows.length ? `<nav aria-label="Journal pagination">${previous}<span>Page ${selected.page} of ${pagination.totalPages}</span>${next}</nav>` : ''
      return bounded(document({ title: `Royal Fusion Journal${selected.page > 1 ? ` | Page ${selected.page}` : ''}`,
        description: 'Stories, education and fragrance insights from Royal Fusion.', canonical, robots: rows.length ? 'index,follow' : 'noindex,follow' },
      `<h1>Royal Fusion Journal</h1>${rows.length ? `<section aria-label="Articles">${cards}</section>` : '<p>No articles have been published yet.</p>'}${navigation}`))
    },
    /** @param {unknown} result */
    renderArticle(result) {
      const row = record(record(result).data)
      checkWork([row], true)
      const projected = summary(row)
      if (!Array.isArray(row.body)) throw invalid()
      const body = row.body.map(node => node._type === 'image' ? { ...sourceImage(projectBlogHtmlImage(node, configuration)), _key: node._key } : node)
      const source = blogSourceArticleSchema.parse({ ...projected.source, body })
      const renderedBody = source.body.map(node => node._type === 'image' ? { _type: 'image', _key: node._key,
        asset: { _type: 'reference', _ref: node.asset._id, url: node.asset.url, ...node.asset.metadata.dimensions },
        alt: node.alt, crop: node.crop ?? null, hotspot: node.hotspot ?? null, caption: node.caption ?? null } : node)
      const content = toHTML(renderedBody, { onMissingComponent: () => { throw invalid() }, components: {
        escapeHTML: escapeText,
        block: { normal: ({ children }) => `<p>${children}</p>`, h2: ({ children }) => `<h2>${children}</h2>`,
          h3: ({ children }) => `<h3>${children}</h3>`, blockquote: ({ children }) => `<blockquote>${children}</blockquote>` },
        marks: { strong: ({ children }) => `<strong>${children}</strong>`, em: ({ children }) => `<em>${children}</em>`,
          code: ({ children }) => `<code>${children}</code>`, underline: ({ children }) => `<u>${children}</u>`, 'strike-through': ({ children }) => `<del>${children}</del>`,
          link: ({ children, value }) => { const href = safeLink(value?.href); return `<a href="${escapeAttribute(href)}"${href.startsWith('/') ? '' : ' rel="noopener noreferrer"'}>${children}</a>` } },
        types: { image: ({ value }) => image(value) },
      } })
      return bounded(document({ title: source.seoTitle || source.title, description: source.seoDescription || source.excerpt,
        canonical: projected.canonical, robots: source.noIndex ? 'noindex,follow' : 'index,follow', ogType: 'article',
        ogImage: projected.ogImage || projected.featuredImage, publishedAt: source.publishedAt, updatedAt: source._updatedAt },
      `<article><header><h1>${escapeText(source.title)}</h1><p>${escapeText(source.excerpt)}</p><p>By ${escapeText(source.author.name)} · ${escapeText(source.category.title)}</p>${dates(source)}${source.readTime ? `<p>${escapeText(source.readTime)}</p>` : ''}</header>${image(projected.featuredImage, 1200, undefined, true)}<div>${content}</div>${source.author.bio ? `<aside aria-label="About the author"><h2>About ${escapeText(source.author.name)}</h2><p>${escapeText(source.author.bio)}</p></aside>` : ''}</article>`))
    },
    /** @param {number} status */
    renderError(status) {
      /** @type {Record<number, [string, string]>} */
      const messages = { 400: ['Invalid journal request', 'Please check the article address or pagination.'],
        404: ['Journal page not found', 'This journal page is not available.'], 405: ['Method not allowed', 'This journal supports read-only requests.'],
        503: ['Journal temporarily unavailable', 'Please try again later.'] }
      const [title, description] = messages[status] || messages[503]
      // Static error documents do not inherit content or a caller's lowered rendering budget.
      return document({ title, description, robots: 'noindex,follow' }, `<h1>${title}</h1><p>${description}</p>`)
    },
  })
}
