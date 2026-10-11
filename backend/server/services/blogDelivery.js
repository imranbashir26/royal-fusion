import { createPublicBlogsV1Router } from '../routes/blogsV1.js'

/** Shared injected composition for activation and disposable fixtures.
 * All enabled routers share one trusted service. No source/client construction occurs here.
 * @param {{service: import('./blogV1Service.js').BlogV1Service, canonicalOrigin?: string, jsonApi?: boolean, documentMode?: boolean, sitemapMode?: boolean, limits?: object, logger?: Pick<Console, 'warn'>}} options */
export async function createInjectedBlogDelivery({ service, canonicalOrigin, jsonApi = true, documentMode = false, sitemapMode = false, limits, logger = console }) {
  const apiRouter = jsonApi === true ? createPublicBlogsV1Router(service) : undefined
  const htmlRouter = documentMode === true
    ? (await import('../routes/blogHtml.js')).createPublicBlogHtmlRouter({ service, canonicalOrigin: canonicalOrigin ?? '', limits, logger })
    : undefined
  const sitemapRouter = sitemapMode === true
    ? (await import('../routes/blogSitemap.js')).createPublicBlogSitemapRouter({ service, canonicalOrigin: canonicalOrigin ?? '', logger })
    : undefined
  return Object.freeze({ apiRouter, htmlRouter, sitemapRouter })
}
