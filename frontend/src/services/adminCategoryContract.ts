const editableCategoryFields = [
  'name',
  'slug',
  'description',
  'image',
  'imageUrl',
  'displayOrder',
  'showOnHomepage',
  'status',
  'active',
  'seoTitle',
  'seoDescription',
] as const

export function toCategoryPayload(form: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const field of editableCategoryFields) {
    if (Object.hasOwn(form, field)) payload[field] = form[field]
  }
  if (payload.displayOrder !== undefined && payload.displayOrder !== '') {
    payload.displayOrder = Number(payload.displayOrder)
  }
  if (payload.showOnHomepage !== undefined) {
    payload.showOnHomepage = Boolean(payload.showOnHomepage)
  }
  if (payload.active !== undefined) {
    payload.active = Boolean(payload.active)
  }
  if (Array.isArray(payload.image)) {
    payload.image = String(payload.image[0] ?? '')
  }
  if (typeof payload.image === 'string' && !payload.imageUrl) {
    payload.imageUrl = payload.image
  }
  return payload
}

export function selectableCategories<T extends { active: boolean; status: string }>(categories: T[]): T[] {
  return categories.filter((category) => category.active && category.status === 'Published')
}

export function categoryErrorMessage(error: unknown): string {
  if (!(error instanceof Error) || !('status' in error)) {
    return error instanceof Error ? error.message : 'Category request failed.'
  }
  const status = Number(error.status)
  const code = 'code' in error ? String((error as { code: unknown }).code) : ''
  switch (status) {
    case 400:
      return 'Check the category fields, name, and slug before saving.'
    case 401:
      return 'Your session has expired. Sign in again to continue.'
    case 403:
      return code === 'CSRF_INVALID'
        ? 'The request could not be verified. Refresh the page and try again.'
        : 'You do not have permission to manage categories.'
    case 404:
      return 'This category no longer exists. Refresh the list.'
    case 409:
      return code === 'CATEGORY_IN_USE'
        ? 'Category is referenced by existing products and has been archived instead.'
        : 'A category with this slug already exists. Choose a unique slug.'
    default:
      return 'The category service is unavailable. Try again later.'
  }
}
