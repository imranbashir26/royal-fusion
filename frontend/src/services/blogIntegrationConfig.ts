import type { BlogIntegration } from '../blog/PublicBlogProvider'
import { createPublicBlogClient, validatePublicBlogConfiguration } from './publicBlogsApi'

interface BlogEnvironment {
  readonly VITE_ENABLE_SANITY_BLOGS?: unknown
  readonly VITE_BLOG_CANONICAL_ORIGIN?: unknown
}

/** Called once by the entry point, outside React. No URL/storage/runtime switch. */
export function createBlogIntegration(environment: BlogEnvironment, {
  clientFactory = createPublicBlogClient,
  report = (diagnostic: { event: string }) => console.warn(diagnostic),
}: { clientFactory?: typeof createPublicBlogClient; report?: (diagnostic: { event: string }) => void } = {}): BlogIntegration | undefined {
  if (environment.VITE_ENABLE_SANITY_BLOGS !== 'true') return undefined
  try {
    if (typeof environment.VITE_BLOG_CANONICAL_ORIGIN !== 'string') throw new TypeError()
    const configuration = validatePublicBlogConfiguration({ projectId: '6n1y88j4', dataset: 'production',
      canonicalOrigin: environment.VITE_BLOG_CANONICAL_ORIGIN })
    return Object.freeze({ enabled: true, client: clientFactory({ configuration }) })
  } catch {
    try { report({ event: 'blog.configuration.invalid' }) } catch { /* Diagnostic transport only. */ }
    // Retain the new authority boundary without inventing a canonical origin or loading legacy articles.
    return Object.freeze({ enabled: true, unavailable: true })
  }
}
