const PUBLIC_SETTING_KEYS = [
  'brandName', 'logo', 'favicon', 'currency',
  'whatsappNumber', 'phoneNumber', 'emailAddress', 'businessAddress',
  'instagramLink', 'facebookLink', 'tiktokLink', 'youtubeLink',
  'footerDescription', 'copyrightText', 'announcementEnabled',
  'announcementText', 'announcementCtaLabel', 'announcementCtaUrl',
  'googleMapsUrl',
]

const PUBLIC_SHIPPING_KEYS = [
  'defaultShippingFee', 'freeShippingAbove', 'deliveryTimeText',
  'shippingPolicyText', 'returnPolicyText',
]

export function publicPrototypeSettings(db) {
  return {
    settings: pick(db.settings, PUBLIC_SETTING_KEYS),
    shipping: pick(db.shipping, PUBLIC_SHIPPING_KEYS),
    payments: Array.isArray(db.payments)
      ? db.payments.filter((item) => item?.name === 'Cash on Delivery' || item?.name === 'Bank Transfer')
          .map((item) => ({ id: item.id, name: item.name, active: item.active === true }))
      : [],
  }
}

function pick(source, keys) {
  const result = {}
  if (!source || typeof source !== 'object' || Array.isArray(source)) return result
  for (const key of keys) {
    if (Object.hasOwn(source, key)) result[key] = source[key]
  }
  return result
}
