import { createPublicBlogsV1Router } from '../routes/blogsV1.js'

/** Explicit injected composition only; production activation never imports it.
 * Both routers share one trusted service. No source/client construction occurs here.
 * @param {{service: import('./blogV1Service.js').BlogV1Service, canonicalOrigin?: string, documentMode?: boolean, limits?: object, logger?: Pick<Console, 'warn'>}} options */
export async function createInjectedBlogDelivery({ service, canonicalOrigin, documentMode = false, limits, logger = console }) {
  const apiRouter = createPublicBlogsV1Router(service)
  const htmlRouter = documentMode === true
    ? (await import('../routes/blogHtml.js')).createPublicBlogHtmlRouter({ service, canonicalOrigin: canonicalOrigin ?? '', limits, logger })
    : undefined
  return Object.freeze({ apiRouter, htmlRouter })
}
