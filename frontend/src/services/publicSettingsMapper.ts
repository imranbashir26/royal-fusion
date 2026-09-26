import type { StorefrontData, WebsiteSettings } from '../types/admin'

type JsonObject = Record<string, unknown>

export interface PublicSettingsRow {
  key: string
  value: unknown
}

const publicDefaults: WebsiteSettings = {
  brandName: 'Royal Fusion',
  logo: '',
  favicon: '',
  currency: 'PKR',
  whatsappNumber: '',
  phoneNumber: '',
  emailAddress: '',
  businessAddress: '',
  instagramLink: '',
  facebookLink: '',
  tiktokLink: '',
  youtubeLink: '',
  footerDescription: '',
  copyrightText: '',
  announcementEnabled: false,
  announcementText: '',
  announcementCtaLabel: '',
  announcementCtaUrl: '',
  googleMapsUrl: '',
}

export function mapPublicSettingsRows(rows: PublicSettingsRow[]): Pick<StorefrontData, 'settings' | 'shipping' | 'payments' | 'homepage'> {
  const byKey = new Map(rows.map((row) => [row.key, row.value]))
  const settings = objectValue(byKey.get('settings'))
  const branding = objectValue(byKey.get('branding'))
  const contact = objectValue(byKey.get('contact'))
  const commerce = objectValue(byKey.get('commerce'))
  const shipping = objectValue(byKey.get('shipping'))
  const payments = byKey.get('payments')
  const homepage = objectValue(byKey.get('homepage'))

  return {
    settings: {
      ...publicDefaults,
      brandName: publicText(branding.brandName ?? settings.brandName) || publicDefaults.brandName,
      logo: safeLink(branding.logoUrl ?? settings.logo),
      favicon: safeLink(branding.faviconUrl ?? settings.favicon),
      currency: (branding.currency ?? settings.currency) === 'PKR' ? 'PKR' : publicDefaults.currency,
      whatsappNumber: safePhone(contact.whatsapp ?? settings.whatsappNumber),
      phoneNumber: safePhone(contact.phone ?? settings.phoneNumber),
      emailAddress: safeEmail(contact.email ?? settings.emailAddress),
      businessAddress: safeAddress(contact.businessAddress ?? settings.businessAddress),
      instagramLink: safeSocial(contact.instagram ?? settings.instagramLink, ['instagram.com']),
      facebookLink: safeSocial(contact.facebook ?? settings.facebookLink, ['facebook.com', 'fb.com']),
      tiktokLink: safeSocial(contact.tiktok ?? settings.tiktokLink, ['tiktok.com']),
      youtubeLink: safeSocial(contact.youtube ?? settings.youtubeLink, ['youtube.com', 'youtu.be']),
      footerDescription: publicText(settings.footerDescription),
      copyrightText: publicText(settings.copyrightText),
      announcementEnabled: (commerce.announcementEnabled ?? settings.announcementEnabled) === true,
      announcementText: publicText(commerce.announcementText ?? settings.announcementText),
      announcementCtaLabel: publicText(commerce.announcementCtaLabel ?? settings.announcementCtaLabel),
      announcementCtaUrl: safeLink(commerce.announcementCtaUrl ?? settings.announcementCtaUrl),
      googleMapsUrl: safeHttps(settings.googleMapsUrl),
    },
    shipping: {
      defaultShippingFee: nonnegativeAmount(shipping.defaultShippingFee ?? commerce.shippingFee, 250),
      freeShippingAbove: nonnegativeAmount(shipping.freeShippingAbove ?? commerce.shippingThreshold, 7000),
      deliveryTimeText: publicText(shipping.deliveryTimeText),
      shippingPolicyText: publicText(shipping.shippingPolicyText),
      returnPolicyText: publicText(shipping.returnPolicyText),
    },
    payments: Array.isArray(payments)
      ? payments.filter((value): value is JsonObject => isObject(value))
          .filter((value) => value.name === 'Cash on Delivery' || value.name === 'Bank Transfer')
          .map((value) => ({
            id: value.name === 'Cash on Delivery' ? 'pay-cod' : 'pay-bank',
            name: value.name,
            active: value.active === true,
          }))
      : [
          { id: 'pay-cod', name: 'Cash on Delivery', active: commerce.codEnabled !== false },
          { id: 'pay-bank', name: 'Bank Transfer', active: commerce.bankTransferEnabled !== false },
        ],
    homepage: publicHomepage(homepage),
  }
}

function publicHomepage(source: JsonObject): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of [
    'heroEyebrow', 'heroHeading', 'heroSubtitle', 'heroImageAlt', 'primaryCtaText',
    'secondaryCtaText', 'collectionTitle', 'collectionText', 'promotionalBannerText', 'newsletterTitle',
  ]) {
    if (typeof source[key] === 'string') result[key] = publicText(source[key])
  }
  for (const key of ['heroImage', 'primaryCtaLink', 'secondaryCtaLink']) {
    if (typeof source[key] === 'string') result[key] = safeLink(source[key])
  }
  for (const key of ['featuredProductIds', 'bestSellerProductIds', 'featuredCategoryIds']) {
    if (Array.isArray(source[key])) result[key] = (source[key] as unknown[])
      .filter((value): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value))
  }
  return result
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function objectValue(value: unknown): JsonObject {
  return isObject(value) ? value : {}
}

function publicText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function safePhone(value: unknown): string {
  const phone = publicText(value)
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15 && !/(\d)\1{6,}$/.test(digits) ? phone : ''
}

function safeEmail(value: unknown): string {
  const email = publicText(value)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.toLowerCase().endsWith('.invalid') && email.toLowerCase() !== 'hello@royalfusion.pk'
    ? email : ''
}

function safeAddress(value: unknown): string {
  const address = publicText(value)
  return address.toLowerCase() === 'karachi, pakistan' || /^fictional address/i.test(address) ? '' : address
}

function safeLink(value: unknown): string {
  const link = publicText(value)
  if (link.startsWith('/') && !link.startsWith('//') && !link.includes('\\') && !Array.from(link).some((char) => char.charCodeAt(0) < 32)) return link
  if (link.includes('replace-cloud-name')) return ''
  return safeHttps(link)
}

function safeHttps(value: unknown): string {
  try {
    const url = new URL(publicText(value))
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function safeSocial(value: unknown, domains: string[]): string {
  const link = safeHttps(value)
  if (!link) return ''
  const url = new URL(link)
  const host = url.hostname.replace(/^www\./, '')
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`)) && url.pathname.length > 1
    ? link : ''
}

function nonnegativeAmount(value: unknown, fallback: number): number {
  const amount = typeof value === 'number' ? value : Number(value)
  return value !== null && value !== '' && Number.isFinite(amount) && amount >= 0 ? amount : fallback
}
