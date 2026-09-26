import path from 'node:path'

export const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024 // 5 MB

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

export const ALLOWED_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
])

export class MediaSecurityError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

/**
 * Validates binary signature (magic bytes) for image buffers.
 * PNG: 89 50 4E 47 0D 0A 1A 0A
 * JPEG: FF D8 FF
 * WebP: RIFF (bytes 0-3) and WEBP (bytes 8-11)
 */
export function validateImageSignature(buffer, mimetype) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 12) {
    return false
  }

  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a

  // JPEG magic bytes: FF D8 FF
  const isJpeg =
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff

  // WebP magic bytes: RIFF (bytes 0-3) and WEBP (bytes 8-11)
  const isWebp =
    buffer.length >= 12 &&
    buffer[0] === 0x52 && // 'R'
    buffer[1] === 0x49 && // 'I'
    buffer[2] === 0x46 && // 'F'
    buffer[3] === 0x46 && // 'F'
    buffer[8] === 0x57 && // 'W'
    buffer[9] === 0x45 && // 'E'
    buffer[10] === 0x42 && // 'B'
    buffer[11] === 0x50 // 'P'

  if (mimetype === 'image/png') return isPng
  if (mimetype === 'image/jpeg') return isJpeg
  if (mimetype === 'image/webp') return isWebp

  return false
}

export function validateImageFile({ buffer, originalname, mimetype, size }) {
  const actualSize = size ?? buffer?.length ?? 0
  if (actualSize > MAX_IMAGE_FILE_SIZE) {
    throw new MediaSecurityError(413, 'FILE_TOO_LARGE', 'Image exceeds maximum allowed size of 5MB.')
  }

  if (actualSize === 0) {
    throw new MediaSecurityError(400, 'EMPTY_FILE', 'Uploaded image file is empty.')
  }

  const ext = path.extname(originalname || '').toLowerCase()
  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    throw new MediaSecurityError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only JPEG, PNG, and WebP images are allowed.')
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimetype)) {
    throw new MediaSecurityError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported image MIME type.')
  }

  const extMatchesMime =
    ((ext === '.jpg' || ext === '.jpeg') && mimetype === 'image/jpeg') ||
    (ext === '.png' && mimetype === 'image/png') ||
    (ext === '.webp' && mimetype === 'image/webp')

  if (!extMatchesMime) {
    throw new MediaSecurityError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Image file extension and MIME type do not match.')
  }

  if (!validateImageSignature(buffer, mimetype)) {
    throw new MediaSecurityError(415, 'INVALID_IMAGE_BYTES', 'File content does not match a valid image signature.')
  }

  return true
}
