import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parseNewsletterResponse } from '../src/services/newsletterResponse.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('confirmed subscription and duplicate response provide genuine feedback', () => {
  assert.equal(parseNewsletterResponse(true, { data: { message: 'Thank you for subscribing.' } }).message, 'Thank you for subscribing.')
  assert.equal(parseNewsletterResponse(true, { data: { message: "You're already subscribed." } }).message, "You're already subscribed.")
})

test('failed, malformed, or unavailable API never produces subscription success', () => {
  assert.throws(() => parseNewsletterResponse(false, { error: { message: 'Please wait.' } }), /Please wait/)
  assert.throws(() => parseNewsletterResponse(false, null), /temporarily unavailable/)
  assert.throws(() => parseNewsletterResponse(true, {}), /temporarily unavailable/)
  assert.throws(() => parseNewsletterResponse(true, { data: { message: '' } }), /temporarily unavailable/)
})

test('Footer submits only through production newsletter service and Admin uses production API', () => {
  const footer = readFileSync(path.join(root, 'src/components/layout/Footer.tsx'), 'utf8')
  const service = readFileSync(path.join(root, 'src/services/newsletterService.ts'), 'utf8')
  const routes = readFileSync(path.join(root, 'src/admin/AdminRoutes.tsx'), 'utf8')
  assert.match(footer, /await newsletterService\.subscribe\(trimmedEmail\)/)
  assert.match(footer, /setFeedback\(\{ kind: 'success', message: response\.message \}\)/)
  assert.match(footer, /setFeedback\(\{ kind: 'error', message \}\)/)
  assert.match(service, /\/v1\/public\/newsletter/)
  assert.doesNotMatch(service, /'\/public\/newsletter'/)
  assert.match(routes, /path="newsletter" element=\{<AdminNewsletterPage/)
})
