const editableFields = [
  'name', 'slug', 'sku', 'shortDescription', 'description', 'price', 'salePrice',
  'oldPrice', 'stockQuantity', 'categoryId', 'collection', 'gender',
  'scentFamily', 'notes', 'bottleSize', 'concentration', 'longevity',
  'sillage', 'occasion', 'inspiredBy', 'image', 'gallery', 'imageAlt',
  'badge', 'tags', 'variations', 'isFeatured', 'isBestSeller',
  'isNewArrival', 'isPremium', 'isAttar', 'status', 'seoTitle',
  'seoDescription', 'cardImage', 'cardHoverImage', 'cardBackgroundColor', 'expectedRevision',
] as const

export function toProductPayload(form: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const field of editableFields) {
    if (Object.hasOwn(form, field)) payload[field] = form[field]
  }
  if (payload.categoryId === '') payload.categoryId = null
  if (payload.salePrice === '') payload.salePrice = null
  if (payload.oldPrice === '') payload.oldPrice = null
  if (!payload.image && Array.isArray(payload.gallery)) payload.image = payload.gallery[0] ?? ''
  if (!payload.cardBackgroundColor) payload.cardBackgroundColor = '#E7C78F'
  return payload
}

export function productErrorMessage(error: unknown): string {
  if (!(error instanceof Error) || !('status' in error)) {
    return error instanceof Error ? error.message : 'Product request failed.'
  }
  const status = Number(error.status)
  const code = 'code' in error ? error.code : ''
  switch (status) {
    case 400: return code === 'INVALID_CATEGORY'
      ? 'Select an available category.' : 'Check the product fields, image URLs, prices, and stock before saving.'
    case 401: return 'Your session has expired. Sign in again to continue.'
    case 403: return code === 'CSRF_INVALID'
      ? 'The request could not be verified. Refresh the page and try again.'
      : 'You do not have permission to manage products.'
    case 404: return 'This product no longer exists. Refresh the list.'
    case 409: return code === 'CATALOG_STALE' ? 'Catalog or stock changed. Close this form and reopen the product before saving.' : 'A product with this slug or SKU already exists. Choose a unique slug and SKU.'
    default: return 'The product service is unavailable. Try again later.'
  }
}
