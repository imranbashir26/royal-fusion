import { paymentMethods, parseCheckout, quoteRequestSchema } from '../schemas/ordersV1.js'

export class CheckoutApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}
export const unavailable = () => new CheckoutApiError(503, 'CHECKOUT_UNAVAILABLE', 'Ordering is temporarily unavailable. Your cart has been saved.')
// PostgreSQL numeric(12,2) arithmetic: integer minor units avoid floating-point rounding drift.
export function cents(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value))
  if (!match) throw unavailable()
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
}
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
    const products = await this.read('products', 'id,status,active', [['in', 'id', [...new Set(variants.map((row) => row.product_id))]], ['in','commerce_kind',['standard','tester']]])
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
    if (!this.client) throw unavailable()
    let result
    try { result = await this.client.rpc('quote_checkout_v1_checked', { p_request: input, p_customer_id: customerId }) }
    catch { this.diagnostic('rpc', 'quote_checkout_v1_checked', 'TRANSPORT_FAILURE'); throw unavailable() }
    if (result?.error) {
      this.diagnostic('rpc', 'quote_checkout_v1_checked', normalizedCheckoutCategory(result.error, 'RPC_FAILURE'))
      const error = result.error
      if (error.code === '23503' && error.message === 'Customer account is unavailable.') throw new CheckoutApiError(403, 'CUSTOMER_UNAVAILABLE', 'Your customer account is unavailable.')
      if (error.code === '22023' || error.code === '22P02' || error.message === 'V2_INVALID_REQUEST') throw new CheckoutApiError(400, 'INVALID_CHECKOUT_REQUEST', 'Please check your checkout information.')
      if (/Coupon|coupon/.test(error.message ?? '')) throw new CheckoutApiError(422, 'INVALID_COUPON', 'This coupon cannot be applied to your order.')
      if (/variants.*unavailable|variants.*enough stock/.test(error.message ?? '')) {
        try { await this.variants(input.items) } catch (diagnostic) { if (diagnostic instanceof CheckoutApiError && diagnostic.status !== 503) throw diagnostic }
        throw new CheckoutApiError(409, 'VARIANT_UNAVAILABLE', 'A selected variant is no longer available.')
      }
      throw unavailable()
    }
    const data = result?.data
    if (!data || typeof data !== 'object' || Array.isArray(data) || !/^[0-9a-f]{64}$/.test(data.quoteFingerprint ?? '')
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.idempotencyKey ?? '')
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.shippingMethodId ?? '') || data.currency !== 'PKR'
      || !Array.isArray(data.paymentMethods) || !data.paymentMethods.length || data.paymentMethods.some(method => !paymentMethods.includes(method))) throw unavailable()
    const values = Object.fromEntries(['subtotal','discount','shippingFee','total'].map(key => [key,cents(data[key])]))
    if (values.subtotal <= 0n || values.discount > values.subtotal || values.total !== values.subtotal - values.discount + values.shippingFee) throw unavailable()
    return { ...Object.fromEntries(Object.entries(values).map(([key,value]) => [key,Number(value)/100])), currency:'PKR',
      shippingMethodId:data.shippingMethodId, paymentMethods:[...data.paymentMethods], quoteFingerprint:data.quoteFingerprint, idempotencyKey:data.idempotencyKey }
  }
}
export function normalizedCheckoutCategory(error, fallback = 'RELATIONAL_READ_FAILURE') {
  return typeof error?.code === 'string' && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(error.code) ? error.code : fallback
}
