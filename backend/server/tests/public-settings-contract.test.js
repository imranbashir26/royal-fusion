import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { mapPublicSettingsRows } from '../../../frontend/src/services/publicSettingsMapper.ts'
import { publicPrototypeSettings } from '../utils/publicStorefrontSettings.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

test('seeded public keys map into storefront settings without publishing example contact details', () => {
  const result = mapPublicSettingsRows([
    { key: 'branding', value: { brandName: 'Royal Fusion', currency: 'PKR', logoUrl: 'https://res.cloudinary.com/replace-cloud-name/logo.webp' } },
    { key: 'contact', value: { email: 'support@example.invalid', phone: '+92 300 0000000', businessAddress: 'Fictional address, Pakistan' } },
    { key: 'commerce', value: { announcementEnabled: false, announcementText: '' } },
  ])
  assert.equal(result.settings.brandName, 'Royal Fusion')
  assert.equal(result.settings.currency, 'PKR')
  assert.equal(result.settings.logo, '')
  assert.equal(result.settings.phoneNumber, '')
  assert.equal(result.settings.emailAddress, '')
  assert.equal(result.settings.businessAddress, '')
  assert.equal(result.settings.announcementEnabled, false)
  assert.equal(result.settings.whatsappNumber, '')
  assert.equal(result.settings.instagramLink, '')
})

test('configured public values reach all existing consumer fields and private values are discarded', () => {
  const result = mapPublicSettingsRows([
    { key: 'branding', value: { brandName: 'Royal Fusion', currency: 'PKR', logoUrl: 'https://cdn.example.com/logo.webp', apiKey: 'secret' } },
    { key: 'contact', value: { phone: '+92 321 1234567', whatsapp: '+92 321 1234567', email: 'care@royalfusion.pk', businessAddress: 'Lahore', instagram: 'https://www.instagram.com/royalfusion/', facebook: 'https://facebook.com/royalfusion', tiktok: 'https://tiktok.com/@royalfusion', youtube: 'https://youtube.com/@royalfusion', contactReceiverEmail: 'private@example.com' } },
    { key: 'commerce', value: { announcementEnabled: true, announcementText: 'Free shipping', announcementCtaLabel: 'Shop', announcementCtaUrl: '/shop', shippingFee: 300, shippingThreshold: 8000, paymentSecret: 'private' } },
    { key: 'shipping', value: { deliveryTimeText: '3–5 days', shippingPolicyText: 'Shipping policy', returnPolicyText: 'Return policy', internalCost: 1 } },
    { key: 'payments', value: [
      { name: 'Cash on Delivery', active: true, credentials: 'secret' },
      { name: 'Bank Transfer', active: false, accountNumber: 'secret' },
      { name: 'Card', active: true },
    ] },
    { key: 'private', value: { token: 'secret' } },
  ])
  assert.equal(result.settings.logo, 'https://cdn.example.com/logo.webp')
  assert.equal(result.settings.whatsappNumber, '+92 321 1234567')
  assert.equal(result.settings.phoneNumber, '+92 321 1234567')
  assert.equal(result.settings.emailAddress, 'care@royalfusion.pk')
  assert.equal(result.settings.businessAddress, 'Lahore')
  assert.equal(result.settings.instagramLink, 'https://www.instagram.com/royalfusion/')
  assert.equal(result.settings.facebookLink, 'https://facebook.com/royalfusion')
  assert.equal(result.settings.tiktokLink, 'https://tiktok.com/@royalfusion')
  assert.equal(result.settings.youtubeLink, 'https://youtube.com/@royalfusion')
  assert.equal(result.settings.announcementEnabled, true)
  assert.equal(result.settings.announcementText, 'Free shipping')
  assert.equal(result.settings.announcementCtaUrl, '/shop')
  assert.equal(result.shipping.defaultShippingFee, 300)
  assert.equal(result.shipping.freeShippingAbove, 8000)
  assert.equal(result.shipping.returnPolicyText, 'Return policy')
  assert.deepEqual(result.payments.map(({ name, active }) => [name, active]), [
    ['Cash on Delivery', true], ['Bank Transfer', false],
  ])
  assert.equal(JSON.stringify(result).includes('secret'), false)
  assert.equal(JSON.stringify(result).includes('private@example.com'), false)
})

test('unsafe links and disabled announcements remain inactive', () => {
  const result = mapPublicSettingsRows([
    { key: 'contact', value: { instagram: 'javascript:alert(1)', whatsapp: '' } },
    { key: 'commerce', value: { announcementEnabled: false, announcementCtaUrl: 'data:text/html,unsafe' } },
  ])
  assert.equal(result.settings.instagramLink, '')
  assert.equal(result.settings.announcementEnabled, false)
  assert.equal(result.settings.announcementCtaUrl, '')
  assert.equal(result.settings.whatsappNumber, '')
})

test('commerce display flags preserve disabled payment methods', () => {
  const result = mapPublicSettingsRows([
    { key: 'commerce', value: { codEnabled: false, bankTransferEnabled: true } },
  ])
  assert.deepEqual(result.payments.map(({ active }) => active), [false, true])
})

test('prototype API sanitizes settings, shipping, and payment display fields', () => {
  const result = publicPrototypeSettings({
    settings: { brandName: 'Royal Fusion', contactReceiverEmail: 'private@example.com', apiSecret: 'secret' },
    shipping: { defaultShippingFee: 250, internalCost: 50 },
    payments: [{ id: 'cod', name: 'Cash on Delivery', active: true, credentials: 'secret' }, { id: 'card', name: 'Card', active: true }],
  })
  assert.deepEqual(result.settings, { brandName: 'Royal Fusion' })
  assert.deepEqual(result.shipping, { defaultShippingFee: 250 })
  assert.deepEqual(result.payments, [{ id: 'cod', name: 'Cash on Delivery', active: true }])
})

test('migration grants anonymous active public reads and denies private settings reads', () => {
  const sql = readFileSync(path.join(root, 'backend/supabase/migrations/002_launch_schema_foundation.sql'), 'utf8')
  assert.match(sql, /create policy rf_public_settings_read on public\.public_site_settings\s+for select to anon, authenticated using \(active\)/i)
  assert.match(sql, /grant select on public\.categories,[\s\S]*?public\.public_site_settings,[\s\S]*?to anon, authenticated;/i)
  assert.match(sql, /revoke all on public\.site_settings, public\.admin_audit_logs from anon;/i)
  const browserService = readFileSync(path.join(root, 'frontend/src/services/supabaseStorefrontService.ts'), 'utf8')
  assert.match(browserService, /\.from\('public_site_settings'\)/)
  assert.doesNotMatch(browserService, /\.from\('site_settings'\)/)
})
