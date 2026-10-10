/** Nonsecret, server-side read configuration. Loading this module initializes no client.
 * @param {NodeJS.ProcessEnv} [environment] */
export function createBlogSanityConfig(environment = process.env) {
  try {
    const projectId = environment.SANITY_PROJECT_ID?.trim() || '6n1y88j4'
    const dataset = environment.SANITY_DATASET?.trim() || 'production'
    const apiVersion = environment.SANITY_API_VERSION?.trim() || '2025-01-01'
    if (projectId !== '6n1y88j4' || dataset !== 'production' || apiVersion !== '2025-01-01') throw new Error()
    // CLIENT_ORIGIN's first entry is already the repository's canonical storefront contract.
    const origin = new URL(environment.CLIENT_ORIGIN?.split(',')[0].trim() || '')
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error()
    const timeout = environment.SANITY_BLOG_TIMEOUT_MS?.trim() || '5000'
    if (!/^[1-9]\d*$/.test(timeout) || Number(timeout) < 50 || Number(timeout) > 10000) throw new Error()
    return Object.freeze({ projectId, dataset, apiVersion, canonicalOrigin: origin.origin, timeoutMs: Number(timeout) })
  } catch { throw new TypeError('Blog source configuration is invalid.') }
}
