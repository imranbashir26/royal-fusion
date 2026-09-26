const editableCollectionFields = [
  'name',
  'slug',
  'description',
  'bannerSecureUrl',
  'bannerCloudinaryPublicId',
  'bannerAltText',
  'image',
  'imageUrl',
  'displayOrder',
  'featured',
  'active',
  'status',
  'seoTitle',
  'seoDescription',
] as const

export function toCollectionPayload(form: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const field of editableCollectionFields) {
    if (Object.hasOwn(form, field)) payload[field] = form[field]
  }
  if (payload.displayOrder !== undefined && payload.displayOrder !== '') {
    payload.displayOrder = Number(payload.displayOrder)
  }
  if (payload.featured !== undefined) {
    payload.featured = Boolean(payload.featured)
  }
  if (payload.active !== undefined) {
    payload.active = Boolean(payload.active)
  }
  if (typeof payload.image === 'string' && !payload.bannerSecureUrl) {
    payload.bannerSecureUrl = payload.image
  }
  if (typeof payload.imageUrl === 'string' && !payload.bannerSecureUrl) {
    payload.bannerSecureUrl = payload.imageUrl
  }
  return payload
}

export function collectionErrorMessage(error: unknown): string {
  if (!(error instanceof Error) || !('status' in error)) {
    return error instanceof Error ? error.message : 'Collection request failed.'
  }
  const status = Number(error.status)
  const code = 'code' in error ? String((error as { code: unknown }).code) : ''
  switch (status) {
    case 400:
      return 'Check the collection fields, name, and slug before saving.'
    case 401:
      return 'Your session has expired. Sign in again to continue.'
    case 403:
      return code === 'CSRF_INVALID'
        ? 'The request could not be verified. Refresh the page and try again.'
        : 'You do not have permission to manage collections.'
    case 404:
      return 'This collection no longer exists. Refresh the list.'
    case 409:
      return 'A collection with this slug already exists. Choose a unique slug.'
    default:
      return 'The collection service is unavailable. Try again later.'
  }
}
