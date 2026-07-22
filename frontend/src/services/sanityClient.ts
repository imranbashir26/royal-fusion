import { createClient, type SanityClient } from '@sanity/client'

let browserClient: SanityClient | null | undefined

export function getSanityClient() {
  if (browserClient !== undefined) return browserClient

  const projectId = import.meta.env.VITE_SANITY_PROJECT_ID
  const dataset = import.meta.env.VITE_SANITY_DATASET
  const apiVersion = import.meta.env.VITE_SANITY_API_VERSION ?? '2025-01-01'

  browserClient = projectId && dataset
    ? createClient({
        projectId,
        dataset,
        apiVersion,
        useCdn: true,
        perspective: 'published',
      })
    : null

  return browserClient
}

export function isSanityConfigured() {
  return Boolean(import.meta.env.VITE_SANITY_PROJECT_ID && import.meta.env.VITE_SANITY_DATASET)
}
