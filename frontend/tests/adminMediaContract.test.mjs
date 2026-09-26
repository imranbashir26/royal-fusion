import assert from 'node:assert/strict'
import test from 'node:test'
import { mediaErrorMessage } from '../src/services/adminMediaContract.ts'

test('mediaErrorMessage maps HTTP status codes and error codes to human-readable strings', () => {
  assert.equal(
    mediaErrorMessage({ message: 'Forbidden', code: 'PERMISSION_DENIED', status: 403 }),
    'You do not have permission to manage media.'
  )
  assert.equal(
    mediaErrorMessage({ message: 'Unauthorized', code: 'AUTH_REQUIRED', status: 401 }),
    'Session expired. Please sign in again.'
  )
  assert.equal(
    mediaErrorMessage({ message: 'Too Large', code: 'FILE_TOO_LARGE', status: 413 }),
    'Image file exceeds the 5MB size limit.'
  )
  assert.equal(
    mediaErrorMessage({ message: 'Bad format', code: 'UNSUPPORTED_MEDIA_TYPE', status: 415 }),
    'Invalid image file. Only JPEG, PNG, and WebP images are supported.'
  )
  assert.equal(
    mediaErrorMessage({ message: 'Not config', code: 'CLOUDINARY_NOT_CONFIGURED', status: 503 }),
    'Cloudinary is not configured on this server.'
  )
  assert.equal(
    mediaErrorMessage({ message: 'CSRF failure', code: 'CSRF_INVALID', status: 403 }),
    'Security token expired. Please refresh the page.'
  )
  assert.equal(
    mediaErrorMessage({ message: 'Not found', code: 'PRODUCT_NOT_FOUND', status: 404 }),
    'The specified product or media was not found.'
  )
})

test('error message falls back gracefully for unknown errors', () => {
  assert.equal(mediaErrorMessage(new Error('Custom network failure')), 'Custom network failure')
  assert.equal(mediaErrorMessage('unexpected string'), 'A media error occurred. Please try again.')
})
