export interface UploadMediaResult {
  url: string
  secureUrl: string
  publicId: string
  mediaType: string
  width?: number
  height?: number
  format?: string
  productId: string | null
  uploadToken?: string
}

export interface UploadMediaOptions {
  productId?: string
  mediaType: 'main' | 'gallery' | 'card' | 'cardHover'
  altText?: string
  displayOrder?: number
}

export interface DeleteMediaOptions {
  productId: string
  mediaId?: string
  secureUrl?: string
}

export function secureMediaUrl(result: UploadMediaResult): string {
  if (!/^https:\/\/res\.cloudinary\.com\//.test(result.secureUrl || '')) {
    throw new Error('Upload did not return a secure Cloudinary URL.')
  }
  return result.secureUrl
}

export function mediaErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const err = error as { status?: number; code?: string; message?: string }
    if (err.code === 'CSRF_INVALID') return 'Security token expired. Please refresh the page.'
    if (err.code === 'CLOUDINARY_NOT_CONFIGURED') return 'Cloudinary is not configured on this server.'
    if (err.code === 'INVALID_IMAGE_BYTES') return 'Invalid image file. The file signature does not match.'
    if (err.status === 401) return 'Session expired. Please sign in again.'
    if (err.status === 403) return 'You do not have permission to manage media.'
    if (err.status === 404) return 'The specified product or media was not found.'
    if (err.status === 413) return 'Image file exceeds the 5MB size limit.'
    if (err.status === 415) return 'Invalid image file. Only JPEG, PNG, and WebP images are supported.'
    return err.message || 'Media operation failed.'
  }
  if (error instanceof Error) return error.message
  return 'A media error occurred. Please try again.'
}
