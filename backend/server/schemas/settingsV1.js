import { z } from 'zod'

const text = (max = 500) => z.string().trim().max(max)
const safeLink = z.string().trim().max(2048).refine((value) => {
  if (!value) return true
  if (value.includes('replace-cloud-name')) return false
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') && !/[\x00-\x1f]/.test(value)) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch { return false }
}, 'Use a safe site route or HTTPS URL.')
const httpsLink = z.string().trim().max(2048).refine((value) => {
  if (!value) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch { return false }
}, 'Use an HTTPS URL.')
const social = (domains) => httpsLink.refine((value) => {
  if (!value) return true
  const url = new URL(value)
  const host = url.hostname.replace(/^www\./, '')
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`)) && url.pathname.length > 1
}, 'Use an HTTPS profile URL on the supported platform.')
const phone = text(40).refine((value) => {
  if (!value) return true
  const digits = value.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15 && !/(\d)\1{6,}$/.test(digits)
}, 'Enter a valid phone number or leave it empty.')
const email = z.union([z.literal(''), z.email().max(254)])
  .refine((value) => !value.toLowerCase().endsWith('.invalid') && value.toLowerCase() !== 'hello@royalfusion.pk', 'Use a real contact email.')
const patch = (shape) => z.strictObject(shape).partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required.')

export const settingsSectionSchema = z.enum(['settings', 'homepage', 'shipping', 'payments'])
export const settingsPatchSchema = patch({
  brandName: text(120).min(1), logo: safeLink, favicon: safeLink, currency: z.literal('PKR'),
  whatsappNumber: phone, phoneNumber: phone, emailAddress: email,
  businessAddress: text(500).refine((value) => value.toLowerCase() !== 'karachi, pakistan' && !/^fictional address/i.test(value), 'Use a real address or leave it empty.'),
  googleMapsUrl: httpsLink,
  instagramLink: social(['instagram.com']), facebookLink: social(['facebook.com', 'fb.com']),
  tiktokLink: social(['tiktok.com']), youtubeLink: social(['youtube.com', 'youtu.be']),
  footerDescription: text(2000), copyrightText: text(500), contactReceiverEmail: email,
  announcementEnabled: z.boolean(), announcementText: text(500),
  announcementCtaLabel: text(100), announcementCtaUrl: safeLink,
})
export const homepagePatchSchema = patch({
  heroEyebrow: text(160), heroHeading: text(300), heroSubtitle: text(1000),
  heroImage: safeLink, heroImageAlt: text(300), primaryCtaText: text(100),
  primaryCtaLink: safeLink, secondaryCtaText: text(100), secondaryCtaLink: safeLink,
  collectionTitle: text(200), collectionText: text(1000), promotionalBannerText: text(500),
  newsletterTitle: text(200), featuredProductIds: z.array(z.uuid()).max(30),
  bestSellerProductIds: z.array(z.uuid()).max(30), featuredCategoryIds: z.array(z.uuid()).max(30),
})
export const shippingPatchSchema = patch({
  defaultShippingFee: z.number().finite().min(0).max(100000),
  freeShippingAbove: z.number().finite().min(0).max(10000000),
  deliveryTimeText: text(500), courierInformation: text(1000),
  shippingPolicyText: text(5000), returnPolicyText: text(5000), exchangePolicyText: text(5000),
})
export const paymentsPatchSchema = z.array(z.strictObject({
  name: z.enum(['Cash on Delivery', 'Bank Transfer']),
  active: z.boolean(),
})).length(2).refine((rows) => new Set(rows.map((row) => row.name)).size === 2, 'Include both supported payment methods.')

export function validateSettingsPatch(section, body) {
  const schema = {
    settings: settingsPatchSchema, homepage: homepagePatchSchema,
    shipping: shippingPatchSchema, payments: paymentsPatchSchema,
  }[section]
  return schema.safeParse(body)
}
