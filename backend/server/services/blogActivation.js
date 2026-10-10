import { createPublicBlogsV1Router } from '../routes/blogsV1.js'
import { blogSlugSchema } from '../schemas/blogV1.js'
import { BlogApiError } from './blogRepository.js'

/** Mount only after the existing security middleware and before body parsing.
 * Disabled configuration never imports the Sanity-dependent service module chain.
 * @param {import('express').Express} app
 * @param {{environment?: NodeJS.ProcessEnv, clientFactory?: NonNullable<Parameters<typeof import('./sanityBlogSource.js').createSanityBlogV1Service>[0]>['clientFactory'], logger?: Pick<Console, 'warn'>}} [options]
 */
export async function mountSanityBlogApi(app, { environment = process.env, clientFactory, logger = console } = {}) {
  if (environment.ENABLE_SANITY_BLOG_API !== 'true') return Object.freeze({ status: 'disabled' })
  let service, status = 'configured'
  const diagnose = event => {
    // Diagnostics are fixed metadata only; even a failing logger must not interrupt other APIs.
    try { logger.warn({ event, status: 503 }) } catch { /* Diagnostic transport only. */ }
  }
  let initializationEvent = 'blog.module.unavailable'
  try {
    const { createSanityBlogV1Service } = await import('./sanityBlogSource.js')
    initializationEvent = 'blog.configuration.invalid'
    service = createSanityBlogV1Service({ environment, clientFactory })
  }
  catch {
    status = 'unavailable'
    diagnose(initializationEvent)
    service = {
      async list() { throw new BlogApiError('BLOGS_UNAVAILABLE') },
      async getBySlug(slug) {
        if (!blogSlugSchema.safeParse(slug).success) throw new BlogApiError('INVALID_BLOG_REQUEST')
        throw new BlogApiError('BLOGS_UNAVAILABLE')
      },
    }
  }
  const read = async operation => {
    try { return await operation() }
    catch (error) {
      if (!(error instanceof BlogApiError) || error.status === 503) diagnose('blog.request.unavailable')
      throw error
    }
  }
  app.use('/api/v1/public/blogs', createPublicBlogsV1Router({
    list: input => read(() => service.list(input)),
    getBySlug: slug => read(() => service.getBySlug(slug)),
  }))
  return Object.freeze({ status })
}
