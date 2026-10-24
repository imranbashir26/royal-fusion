import { z } from 'zod'
import { BLOG_SITEMAP_MAX_ARTICLES, BLOG_SITEMAP_MAX_SOURCE_BYTES, blogSlugSchema } from '../schemas/blogV1.js'
import { BlogApiError, compareArticles } from './blogRepository.js'
import { createBlogHtmlRenderer } from './blogHtmlRenderer.js'

export const BLOG_SITEMAP_MAX_XML_BYTES = 128 * 1024
const unavailable = () => new BlogApiError('BLOGS_UNAVAILABLE')
/** XML text only. Reject characters not permitted by XML 1.0.
 * @param {string} value */
export function escapeSitemapXml(value) {
  if (typeof value !== 'string') throw unavailable()
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (!(code === 9 || code === 10 || code === 13 || code >= 0x20 && code <= 0xD7FF
      || code >= 0xE000 && code <= 0xFFFD || code >= 0x10000 && code <= 0x10FFFF)) throw unavailable()
  }
  /** @type {Record<string, string>} */
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
  return value.replace(/[&<>"']/g, character => entities[character])
}

/** Inject the SAME BlogV1Service, never a new client or paginated API crawler.
 * @param {{service: Pick<import('./blogV1Service.js').BlogV1Service, 'snapshotArticles'>, canonicalOrigin: string}} options */
export function createBlogSitemap({ service, canonicalOrigin }) {
  if (!service || typeof service.snapshotArticles !== 'function') throw new TypeError('Blog sitemap configuration is invalid.')
  // Reuse exact canonical, image, body, work and HTML validation of a servable article.
  const renderer = createBlogHtmlRenderer({ canonicalOrigin })
  const origin = new URL(canonicalOrigin).origin
  return Object.freeze({
    async generate() {
      try {
        const articles = await service.snapshotArticles()
        if (!Array.isArray(articles) || articles.length > BLOG_SITEMAP_MAX_ARTICLES
          || Buffer.byteLength(JSON.stringify(articles)) > BLOG_SITEMAP_MAX_SOURCE_BYTES) throw unavailable()
        const ids = new Set(), slugs = new Set(), urls = new Set(), entries = []
        for (const [index, article] of articles.entries()) {
          if (!article || !blogSlugSchema.safeParse(article.slug).success
            || ids.has(article.id) || slugs.has(article.slug)
            || index > 0 && compareArticles({ _id: articles[index - 1].id, publishedAt: articles[index - 1].publishedAt },
              { _id: article.id, publishedAt: article.publishedAt }) > 0) throw unavailable()
          const document = renderer.renderArticle({ data: article })
          const canonical = new URL(`/blogs/${article.slug}`, origin).href
          if (new URL(article.seo.canonicalUrl).href !== canonical || urls.has(canonical)
            || !z.iso.datetime({ offset: true }).safeParse(article.updatedAt).success) throw unavailable()
          ids.add(article.id); slugs.add(article.slug); urls.add(canonical)
          if (article.seo.noIndex) {
            if (document.robots !== 'noindex,follow') throw unavailable()
            continue
          }
          if (document.robots !== 'index,follow') throw unavailable()
          entries.push(`<url><loc>${escapeSitemapXml(canonical)}</loc><lastmod>${escapeSitemapXml(new Date(article.updatedAt).toISOString())}</lastmod></url>`)
        }
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</urlset>\n`
        if (Buffer.byteLength(xml) > BLOG_SITEMAP_MAX_XML_BYTES) throw unavailable()
        return xml
      } catch { throw unavailable() }
    },
  })
}
