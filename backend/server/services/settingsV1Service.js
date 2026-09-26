import {
  homepagePatchSchema, paymentsPatchSchema, settingsPatchSchema, shippingPatchSchema,
} from '../schemas/settingsV1.js'

export class SettingsApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}

const settingFields = [
  'brandName', 'logo', 'favicon', 'currency', 'whatsappNumber', 'phoneNumber', 'emailAddress',
  'businessAddress', 'googleMapsUrl', 'instagramLink', 'facebookLink', 'tiktokLink',
  'youtubeLink', 'footerDescription', 'copyrightText', 'contactReceiverEmail',
  'announcementEnabled', 'announcementText', 'announcementCtaLabel', 'announcementCtaUrl',
]
const homepageFields = [
  'heroEyebrow', 'heroHeading', 'heroSubtitle', 'heroImage', 'heroImageAlt',
  'primaryCtaText', 'primaryCtaLink', 'secondaryCtaText', 'secondaryCtaLink',
  'collectionTitle', 'collectionText', 'promotionalBannerText', 'newsletterTitle',
  'featuredProductIds', 'bestSellerProductIds', 'featuredCategoryIds',
]
const shippingFields = [
  'defaultShippingFee', 'freeShippingAbove', 'deliveryTimeText', 'courierInformation',
  'shippingPolicyText', 'returnPolicyText', 'exchangePolicyText',
]
const publicSettingMap = {
  brandName: ['branding', 'brandName'], logo: ['branding', 'logoUrl'],
  favicon: ['branding', 'faviconUrl'], currency: ['branding', 'currency'],
  whatsappNumber: ['contact', 'whatsapp'], phoneNumber: ['contact', 'phone'],
  emailAddress: ['contact', 'email'], businessAddress: ['contact', 'businessAddress'],
  instagramLink: ['contact', 'instagram'], facebookLink: ['contact', 'facebook'],
  tiktokLink: ['contact', 'tiktok'], youtubeLink: ['contact', 'youtube'],
  announcementEnabled: ['commerce', 'announcementEnabled'],
  announcementText: ['commerce', 'announcementText'],
  announcementCtaLabel: ['commerce', 'announcementCtaLabel'],
  announcementCtaUrl: ['commerce', 'announcementCtaUrl'],
  footerDescription: ['settings', 'footerDescription'],
  copyrightText: ['settings', 'copyrightText'], googleMapsUrl: ['settings', 'googleMapsUrl'],
}
const publicShippingFields = new Set([
  'defaultShippingFee', 'freeShippingAbove', 'deliveryTimeText',
  'shippingPolicyText', 'returnPolicyText',
])

export class SettingsV1Service {
  constructor(client, logger = console) { this.client = client; this.logger = logger }
  requireClient() {
    if (!this.client) throw new SettingsApiError(503, 'SETTINGS_UNAVAILABLE', 'Settings are unavailable.')
    return this.client
  }

  async get() {
    const client = this.requireClient()
    const { data: row, error } = await client.from('site_settings')
      .select('settings,shipping,payments,homepage').eq('id', 'site').maybeSingle()
    if (error) throw dbError()
    const { data: publicRows, error: publicError } = await client.from('public_site_settings')
      .select('key,value').in('key', ['settings', 'branding', 'contact', 'commerce', 'shipping', 'payments', 'homepage'])
      .eq('active', true)
    if (publicError) throw dbError()
    const byKey = Object.fromEntries((publicRows ?? []).map((item) => [item.key, item.value]))
    const publicSettings = {}
    for (const [field, [key, publicField]] of Object.entries(publicSettingMap)) {
      const value = object(byKey[key])[publicField]
      if (value !== undefined && settingsPatchSchema.safeParse({ [field]: value }).success) publicSettings[field] = value
    }
    const publicShipping = {}
    for (const field of publicShippingFields) {
      const value = object(byKey.shipping)[field]
      if (value !== undefined && shippingPatchSchema.safeParse({ [field]: value }).success) publicShipping[field] = value
    }
    for (const [field, legacyField] of [['defaultShippingFee', 'shippingFee'], ['freeShippingAbove', 'shippingThreshold']]) {
      const value = object(byKey.commerce)[legacyField]
      if (publicShipping[field] === undefined && value !== undefined && shippingPatchSchema.safeParse({ [field]: value }).success) {
        publicShipping[field] = value
      }
    }
    const publicHomepage = {}
    for (const field of homepageFields) {
      const value = object(byKey.homepage)[field]
      if (value !== undefined && homepagePatchSchema.safeParse({ [field]: value }).success) publicHomepage[field] = value
    }
    return {
      settings: { ...publicSettings, ...pick(object(row?.settings), settingFields) },
      shipping: { ...publicShipping, ...pick(object(row?.shipping), shippingFields) },
      homepage: { ...publicHomepage, ...pick(object(row?.homepage), homepageFields) },
      payments: publicPayments(row?.payments, byKey.payments, object(byKey.commerce)),
    }
  }

  async update(section, patch, actor) {
    const publicRows = project(section, patch)
    const { error } = await this.requireClient().rpc('update_site_settings_section', {
      p_section: section, p_patch: patch, p_public_rows: publicRows,
    })
    if (error) throw dbError()
    await this.audit(section, Object.keys(patch), actor)
    return this.get()
  }

  async audit(section, keys, actor) {
    try {
      const { error } = await this.requireClient().from('admin_audit_logs').insert({
        admin_id: actor.userId, action: 'settings.update', resource: 'site_settings',
        resource_id: 'site', permission_key: 'settings.manage', request_id: actor.requestId,
        metadata: { section, keys },
      })
      if (error) throw error
    } catch {
      this.logger.warn?.({ event: 'settings.audit_failed', section, requestId: actor.requestId })
    }
  }
}

export function project(section, patch) {
  const rows = {}
  if (section === 'settings') {
    for (const [field, value] of Object.entries(patch)) {
      const target = publicSettingMap[field]
      if (!target) continue
      const [key, publicField] = target
      rows[key] ??= {}
      rows[key][publicField] = value
    }
  } else if (section === 'shipping') {
    for (const [field, value] of Object.entries(patch)) {
      if (publicShippingFields.has(field)) {
        rows.shipping ??= {}
        rows.shipping[field] = value
      }
    }
  } else if (section === 'homepage') {
    rows.homepage = patch
  } else if (section === 'payments') {
    rows.payments = patch.map(({ name, active }) => ({ name, active }))
  }
  return rows
}

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function pick(source, keys) { return Object.fromEntries(keys.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]])) }
function publicPayments(privateRows, publicRows, commerce) {
  const result = ['Cash on Delivery', 'Bank Transfer'].map((name) => {
    const privateValue = Array.isArray(privateRows) ? privateRows.find((row) => row?.name === name) : null
    const publicValue = Array.isArray(publicRows) ? publicRows.find((row) => row?.name === name) : null
    const legacyValue = name === 'Cash on Delivery' ? commerce.codEnabled : commerce.bankTransferEnabled
    const selected = privateValue?.active ?? publicValue?.active ?? legacyValue
    return { name, active: typeof selected === 'boolean' ? selected : true }
  })
  return paymentsPatchSchema.parse(result)
}
function dbError() { return new SettingsApiError(500, 'SETTINGS_ERROR', 'Settings request could not be completed.') }
