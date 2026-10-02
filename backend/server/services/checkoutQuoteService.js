import { paymentMethods, parseCheckout, quoteRequestSchema } from '../schemas/ordersV1.js'

export class CheckoutApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}
export const unavailable = () => new CheckoutApiError(503, 'CHECKOUT_UNAVAILABLE', 'Ordering is temporarily unavailable. Your cart has been saved.')
const couponError = () => new CheckoutApiError(422, 'INVALID_COUPON', 'This coupon cannot be applied to your order.')
const min = (a, b) => a < b ? a : b
// PostgreSQL numeric(12,2) arithmetic: integer minor units avoid floating-point rounding drift.
export function cents(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value))
  if (!match) throw unavailable()
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
}
const money = (value) => Number(value) / 100
export const checkoutCalendarDate = (instant) => instant.toISOString().slice(0, 10)

export class CheckoutQuoteService {
  constructor(client, { clock = () => new Date(), logger = console, requestId = '' } = {}) {
    this.client = client; this.clock = clock; this.logger = logger; this.requestId = requestId
  }
  withRequestId(requestId) { return new CheckoutQuoteService(this.client, { clock: this.clock, logger: this.logger, requestId }) }
  diagnostic(operation, subsystem, category) {
    this.logger.warn?.({ event: 'checkout.internal_failure', requestId: this.requestId, operation, subsystem, category })
  }
  async read(table, columns, filters = []) {
    if (!this.client) { this.diagnostic('configuration', 'relational_checkout', 'CLIENT_UNAVAILABLE'); throw unavailable() }
    const orderKeys = { public_site_settings: ['key'], product_categories: ['product_id', 'category_id'], coupon_products: ['coupon_id', 'product_id'], coupon_categories: ['coupon_id', 'category_id'] }
    const rows = []
    for (let offset = 0; ; offset += 500) {
      let query = this.client.from(table).select(columns)
      for (const [method, ...args] of filters) query = query[method](...args)
      for (const key of orderKeys[table] ?? ['id']) query = query.order(key, { ascending: true })
      let result
      try { result = await query.range(offset, offset + 499) }
      catch { this.diagnostic('relational_read', table, 'TRANSPORT_FAILURE'); throw unavailable() }
      const { data, error } = result
      if (error) { this.diagnostic('relational_read', table, normalizedCheckoutCategory(error)); throw unavailable() }
      rows.push(...(data ?? []))
      if (!data || data.length < 500) return rows
    }
  }
  async enabledPayments() {
    const [privateRows, publicRows] = await Promise.all([
      this.read('site_settings', 'payments', [['eq', 'id', 'site']]),
      this.read('public_site_settings', 'key,value', [['in', 'key', ['payments', 'commerce']]]),
    ])
    const publicPayments = publicRows.find((row) => row.key === 'payments')?.value
    const commerce = publicRows.find((row) => row.key === 'commerce')?.value ?? {}
    const enabled = paymentMethods.filter((name) => {
      const privateValue = privateRows[0]?.payments?.find?.((row) => row.name === name)?.active
      const publicValue = Array.isArray(publicPayments) ? publicPayments.find((row) => row.name === name)?.active : undefined
      const configured = privateValue ?? publicValue ?? commerce[name === 'Cash on Delivery' ? 'codEnabled' : 'bankTransferEnabled']
      return configured === true
    })
    if (!enabled.length) { this.diagnostic('configuration', 'payments', 'NO_ENABLED_METHOD'); throw unavailable() }
    return enabled
  }
  async redemptionCount(couponId, customerId, email) {
    const filters = []
    if (customerId) filters.push(`customer_id.eq.${customerId}`)
    // Quoted PostgREST values prevent an email from becoming filter syntax.
    if (email) filters.push(`customer_email.ilike.${JSON.stringify(email.replace(/[\\%_*]/g, '\\$&'))}`)
    let result
    try {
      result = await this.client.from('coupon_redemptions').select('id', { count: 'exact', head: true })
        .eq('coupon_id', couponId).or(filters.join(','))
    } catch { this.diagnostic('redemption_count', 'coupon_redemptions', 'TRANSPORT_FAILURE'); throw unavailable() }
    const { count, error } = result
    if (error || count === null) { this.diagnostic('redemption_count', 'coupon_redemptions', normalizedCheckoutCategory(error)); throw unavailable() }
    return count
  }
  async variants(items) {
    const variants = await this.read('product_variants', 'id,product_id,option_value,sku,regular_price,sale_price,stock_quantity,active,available', [['in', 'id', items.map((item) => item.variantId)]])
    const products = await this.read('products', 'id,status,active', [['in', 'id', [...new Set(variants.map((row) => row.product_id))]]])
    return items.map((item) => {
      const variant = variants.find((row) => row.id === item.variantId)
      if (!variant) throw new CheckoutApiError(404, 'VARIANT_NOT_FOUND', 'A selected variant no longer exists.')
      const parent = products.find((row) => row.id === variant.product_id)
      if (!variant.active || !parent?.active || parent.status !== 'Published') throw new CheckoutApiError(409, 'VARIANT_UNAVAILABLE', 'A selected variant is no longer available.')
      if (variant.stock_quantity === 0) throw new CheckoutApiError(409, 'OUT_OF_STOCK', 'A selected variant is out of stock.')
      if (!variant.available) throw new CheckoutApiError(409, 'VARIANT_UNAVAILABLE', 'A selected variant is no longer available.')
      if (variant.stock_quantity < item.quantity) throw new CheckoutApiError(409, 'INSUFFICIENT_STOCK', 'The requested quantity is no longer available.')
      const regular = cents(variant.regular_price), sale = variant.sale_price === null ? null : cents(variant.sale_price)
      if (regular <= 0n || (sale !== null && (sale <= 0n || sale >= regular))) throw unavailable()
      return { ...variant, quantity: item.quantity, price: sale ?? regular }
    })
  }
  async validateCustomer(customerId) {
    if (!customerId) return
    const profiles = await this.read('profiles', 'id,status', [['eq', 'id', customerId]])
    if (profiles[0]?.status !== 'Active') throw new CheckoutApiError(403, 'CUSTOMER_UNAVAILABLE', 'Your customer account is unavailable.')
  }
  async quote(raw, customerId = null) {
    const input = parseCheckout(quoteRequestSchema, raw)
    await this.validateCustomer(customerId)
    const [variants, methods, enabled] = await Promise.all([
      this.variants(input.items),
      this.read('shipping_methods', 'id,base_fee,free_shipping_threshold,display_order,created_at', [['eq', 'active', true]]),
      this.enabledPayments(),
    ])
    const method = methods.sort((a, b) => a.display_order - b.display_order || String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id))[0]
    if (!method) { this.diagnostic('configuration', 'shipping_methods', 'NO_ACTIVE_METHOD'); throw unavailable() }
    const subtotal = variants.reduce((sum, row) => sum + row.price * BigInt(row.quantity), 0n)
    let discount = 0n, freeShipping = false
    if (input.couponCode) {
      const coupons = await this.read('coupons', 'id,code,type,discount_value,minimum_order_amount,start_date,end_date,usage_limit,used_count,per_customer_usage_limit,status,max_discount_amount', [['ilike', 'code', input.couponCode.replace(/[\\%_*]/g, '\\$&')]])
      const coupon = coupons.find((row) => row.code.toUpperCase() === input.couponCode)
      const today = checkoutCalendarDate(this.clock())
      if (!coupon || coupon.status !== 'Active' || (coupon.start_date && today < coupon.start_date) || (coupon.end_date && today > coupon.end_date)
        || subtotal < cents(coupon.minimum_order_amount) || (coupon.usage_limit > 0 && coupon.used_count >= coupon.usage_limit)) throw couponError()
      const [scopedProducts, scopedCategories, categories, usage] = await Promise.all([
        this.read('coupon_products', 'product_id', [['eq', 'coupon_id', coupon.id]]),
        this.read('coupon_categories', 'category_id', [['eq', 'coupon_id', coupon.id]]),
        this.read('product_categories', 'product_id,category_id', [['in', 'product_id', variants.map((row) => row.product_id)]]),
        coupon.per_customer_usage_limit > 0 && (customerId || input.email) ? this.redemptionCount(coupon.id, customerId, input.email) : 0,
      ])
      if (coupon.per_customer_usage_limit > 0 && ((!customerId && !input.email) || usage >= coupon.per_customer_usage_limit)) throw couponError()
      const base = variants.filter((row) => (!scopedProducts.length || scopedProducts.some((scope) => scope.product_id === row.product_id))
        && (!scopedCategories.length || categories.some((category) => category.product_id === row.product_id && scopedCategories.some((scope) => scope.category_id === category.category_id))))
        .reduce((sum, row) => sum + row.price * BigInt(row.quantity), 0n)
      if (base <= 0n) throw couponError()
      if (coupon.type === 'Percentage') discount = (base * cents(coupon.discount_value) + 5000n) / 10000n
      else if (coupon.type === 'Fixed Amount') discount = min(base, cents(coupon.discount_value))
      else if (coupon.type === 'Free Shipping') freeShipping = true
      else throw couponError()
      if (coupon.max_discount_amount !== null && coupon.max_discount_amount !== undefined) discount = min(discount, cents(coupon.max_discount_amount))
    }
    const afterDiscount = subtotal - discount
    const rates = await this.read('shipping_rates', 'scope_type,scope_value,fee,minimum_subtotal', [['eq', 'shipping_method_id', method.id], ['eq', 'active', true]])
    const priority = { city: 1, province: 2, default: 3 }
    const applicable = rates.filter((row) => cents(row.minimum_subtotal) <= afterDiscount && (row.scope_type === 'default'
      || row.scope_type === 'city' && row.scope_value.toLowerCase() === input.shipping.city.toLowerCase()
      || row.scope_type === 'province' && row.scope_value.toLowerCase() === input.shipping.province.toLowerCase()))
      .sort((a, b) => priority[a.scope_type] - priority[b.scope_type] || Number(cents(b.minimum_subtotal) - cents(a.minimum_subtotal)))
    const winner = applicable[0]
    const tied = winner && applicable.filter((row) => priority[row.scope_type] === priority[winner.scope_type]
      && cents(row.minimum_subtotal) === cents(winner.minimum_subtotal))
    // Reject all ties, including equal fees: exactly the same policy as the RPC.
    if (tied && tied.length > 1) {
      this.diagnostic('configuration', 'shipping_rates', 'AMBIGUOUS_APPLICABLE_RATES')
      throw unavailable()
    }
    let shipping = cents(winner?.fee ?? method.base_fee)
    if (freeShipping || method.free_shipping_threshold !== null && afterDiscount >= cents(method.free_shipping_threshold)) shipping = 0n
    return { subtotal: money(subtotal), discount: money(discount), shippingFee: money(shipping), total: money(afterDiscount + shipping), currency: 'PKR', shippingMethodId: method.id, paymentMethods: enabled }
  }
}
export function normalizedCheckoutCategory(error, fallback = 'RELATIONAL_READ_FAILURE') {
  return typeof error?.code === 'string' && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(error.code) ? error.code : fallback
}
