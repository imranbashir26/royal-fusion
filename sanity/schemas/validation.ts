import type { ValidationContext } from 'sanity'
import { studioConfiguration } from '../studioConfiguration.ts'

export function notBlank(value: unknown) {
  return value === undefined || (typeof value === 'string' && value.trim().length > 0)
    ? true : 'Enter nonblank text.'
}

export function validSlug(value: unknown) {
  if (value === undefined) return true
  const slug = (value as { current?: unknown } | null)?.current
  return typeof slug === 'string' && slug.length <= 96 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    ? true : 'Use lowercase letters/digits separated by single hyphens (maximum 96 characters).'
}

export function slugify(value: string, maximum: number) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, maximum).replace(/-$/g, '')
}

export function safeLink(value: unknown) {
  if (value === undefined) return true
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s<>\\]/.test(value)) return 'Use a safe HTTPS URL or a root-relative path.'
  if (value.startsWith('/') && !value.startsWith('//')) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? true : 'Use a safe HTTPS URL without credentials.'
  } catch { return 'Use a safe HTTPS URL or a root-relative path.' }
}

export function validCanonical(value: unknown, document: Record<string, unknown> | undefined, origin = studioConfiguration.canonicalOrigin) {
  if (value === undefined || value === '') return true
  if (typeof value !== 'string' || value.length > 2048) return 'Enter a valid article canonical URL (maximum 2048 characters).'
  if (!origin) return 'Canonical overrides require an approved storefront origin in local Studio configuration.'
  try {
    const url = new URL(String(value))
    const slug = (document?.slug as { current?: unknown } | undefined)?.current
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && url.origin === origin && url.pathname === `/blogs/${slug}`
      ? true : 'Use the approved storefront origin and this article path, without credentials, query or hash.'
  } catch { return 'Enter a valid article canonical URL.' }
}

/** Require the reference to resolve in the native published perspective, including weak references. */
export async function publishedReference(value: unknown, context: Pick<ValidationContext, 'getClient'>, type: 'author' | 'blogCategory') {
  if (value === undefined) return true
  const ref = (value as { _ref?: unknown } | null)?._ref
  if (typeof ref !== 'string' || !/^[A-Za-z0-9_-]+$/.test(ref)) return 'Choose a published author or category.'
  try {
    const published = await context.getClient({ apiVersion: studioConfiguration.apiVersion })
      .withConfig({ perspective: 'published', useCdn: false })
      .fetch('count(*[_id == $id && _type == $type]) > 0', { id: ref, type })
    return published === true ? true : 'Publish the referenced author or category before publishing this article.'
  } catch { return 'Unable to verify the referenced document. Try again before publishing.' }
}
