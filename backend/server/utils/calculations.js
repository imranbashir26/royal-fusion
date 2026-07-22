export function calculateShipping(shippingSettings, city, province, subtotal) {
  if (subtotal >= Number(shippingSettings.freeShippingAbove || 0)) {
    return 0
  }

  const cityMatch = shippingSettings.cityWise?.find(
    (entry) => entry.city?.toLowerCase() === city?.toLowerCase()
  )
  if (cityMatch) return Number(cityMatch.fee || shippingSettings.defaultShippingFee || 0)

  const provinceMatch = shippingSettings.provinceWise?.find(
    (entry) => entry.province?.toLowerCase() === province?.toLowerCase()
  )
  if (provinceMatch) return Number(provinceMatch.fee || shippingSettings.defaultShippingFee || 0)

  return Number(shippingSettings.defaultShippingFee || 0)
}

export function validateCoupon(coupon, { subtotal, productIds, categories }) {
  if (!coupon) return { valid: false, reason: 'Coupon not found.' }
  if (coupon.status !== 'Active') return { valid: false, reason: 'Coupon is inactive.' }

  const now = new Date()
  if (coupon.startDate && now < new Date(coupon.startDate)) {
    return { valid: false, reason: 'Coupon has not started yet.' }
  }
  if (coupon.endDate && now > new Date(coupon.endDate)) {
    return { valid: false, reason: 'Coupon has expired.' }
  }
  if (Number(coupon.usageLimit || 0) > 0 && Number(coupon.usedCount || 0) >= Number(coupon.usageLimit)) {
    return { valid: false, reason: 'Coupon usage limit reached.' }
  }
  if (subtotal < Number(coupon.minimumOrderAmount || 0)) {
    return { valid: false, reason: `Minimum order amount is ${coupon.minimumOrderAmount}.` }
  }
  if (coupon.applicableProducts?.length) {
    const hasProduct = productIds.some((id) => coupon.applicableProducts.includes(id))
    if (!hasProduct) return { valid: false, reason: 'Coupon does not apply to these products.' }
  }
  if (coupon.applicableCategories?.length) {
    const hasCategory = categories.some((category) => coupon.applicableCategories.includes(category))
    if (!hasCategory) return { valid: false, reason: 'Coupon does not apply to these categories.' }
  }

  return { valid: true }
}

export function calculateDiscount(coupon, subtotal) {
  if (!coupon) return 0
  if (coupon.type === 'Percentage') {
    return Math.round((subtotal * Number(coupon.discountValue || 0)) / 100)
  }
  if (coupon.type === 'Fixed Amount') {
    return Math.min(subtotal, Number(coupon.discountValue || 0))
  }
  return 0
}
