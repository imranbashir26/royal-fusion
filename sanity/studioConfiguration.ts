export interface StudioEnvironment {
  projectId?: string
  dataset?: string
  apiVersion?: string
  canonicalOrigin?: string
}

/** Public configuration only. This workspace is pinned to the reviewed existing project. */
export function resolveStudioConfiguration(environment: StudioEnvironment = {}) {
  const projectId = environment.projectId || '6n1y88j4'
  const dataset = environment.dataset || 'production'
  const apiVersion = environment.apiVersion || '2025-01-01'
  if (projectId !== '6n1y88j4' || dataset !== 'production') {
    throw new Error('Royal Fusion Studio requires the reviewed project and production dataset.')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(apiVersion)
    || !Number.isFinite(Date.parse(apiVersion)) || new Date(apiVersion).toISOString().slice(0, 10) !== apiVersion) {
    throw new Error('Studio API version must be a valid YYYY-MM-DD date.')
  }
  let canonicalOrigin: string | undefined
  if (environment.canonicalOrigin) {
    const url = new URL(environment.canonicalOrigin)
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Studio canonical origin must be an exact approved HTTPS origin.')
    }
    canonicalOrigin = url.origin
  }
  return { projectId, dataset, apiVersion, canonicalOrigin }
}

export const studioConfiguration = resolveStudioConfiguration({
  projectId: process.env.SANITY_STUDIO_PROJECT_ID,
  dataset: process.env.SANITY_STUDIO_DATASET,
  apiVersion: process.env.SANITY_STUDIO_API_VERSION,
  canonicalOrigin: process.env.SANITY_STUDIO_CANONICAL_ORIGIN,
})
