import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { mapPublicSettingsRows } from '../src/services/publicSettingsMapper.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('public projection preserves explicit false and zero without exposing private payment values', () => {
  const result = mapPublicSettingsRows([
    { key: 'commerce', value: { announcementEnabled: false, announcementCtaUrl: 'javascript:alert(1)', paymentSecret: 'secret' } },
    { key: 'shipping', value: { defaultShippingFee: 0, freeShippingAbove: 0, internalCost: 10 } },
    { key: 'payments', value: [
      { name: 'Cash on Delivery', active: false, instructions: 'private' },
      { name: 'Bank Transfer', active: false, accountNumber: 'private' },
      { name: 'Card', active: true },
    ] },
    { key: 'contact', value: { whatsapp: 'invalid', email: 'support@example.invalid' } },
  ])
  assert.equal(result.settings.announcementEnabled, false)
  assert.equal(result.settings.announcementCtaUrl, '')
  assert.equal(result.settings.whatsappNumber, '')
  assert.equal(result.settings.emailAddress, '')
  assert.equal(result.shipping.defaultShippingFee, 0)
  assert.equal(result.shipping.freeShippingAbove, 0)
  assert.deepEqual(result.payments.map((item) => [item.name, item.active]), [
    ['Cash on Delivery', false], ['Bank Transfer', false],
  ])
  assert.equal(JSON.stringify(result).includes('private'), false)
  assert.equal(JSON.stringify(result).includes('Card'), false)
})

test('public homepage projection is allowlisted and sanitizes unsafe URLs', () => {
  const result = mapPublicSettingsRows([{ key: 'homepage', value: {
    heroHeading: 'Royal Fusion', primaryCtaLink: 'data:text/html,unsafe',
    secondaryCtaLink: '/shop', privateToken: 'secret',
  } }])
  assert.equal(result.homepage.heroHeading, 'Royal Fusion')
  assert.equal(result.homepage.primaryCtaLink, '')
  assert.equal(result.homepage.secondaryCtaLink, '/shop')
  assert.equal(JSON.stringify(result.homepage).includes('secret'), false)
})

test('Admin Settings uses cookie/CSRF API and saves only dirty sections without losing values on errors', () => {
  const page = readFileSync(path.join(root, 'src/admin/AdminSettingsPage.tsx'), 'utf8')
  const api = readFileSync(path.join(root, 'src/services/adminSettingsApi.ts'), 'utf8')
  assert.match(page, /adminSettingsApi\.get\(\)/)
  assert.match(page, /adminSettingsApi\.update\(section, dirty\[section\]\)/)
  assert.match(page, /setError\(`/)
  assert.doesNotMatch(page, /adminApi\.updateSettings|adminApi\.list.*payments/)
  assert.match(api, /adminAuthClient\.protectedRequest/)
  assert.match(api, /\/v1\/admin\/settings/)
})

test('Checkout does not re-enable disabled COD or Bank Transfer methods', () => {
  const checkout = readFileSync(path.join(root, 'src/pages/CheckoutPage.tsx'), 'utf8')
  assert.match(checkout, /const activePaymentMethods = configuredPaymentMethods/)
  assert.doesNotMatch(checkout, /configuredPaymentMethods\.length \? configuredPaymentMethods : paymentMethods/)
  assert.match(checkout, /disabled=\{checkoutBlocked \|\| isSubmitting \|\| activePaymentMethods\.length === 0\}/)
})
