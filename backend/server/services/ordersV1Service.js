import { orderRequestSchema, parseCheckout } from '../schemas/ordersV1.js'
import { CheckoutApiError, CheckoutQuoteService, cents, normalizedCheckoutCategory, unavailable, publicV1Lines, publicPricingOutcome } from './checkoutQuoteService.js'

export class OrdersV1Service {
  constructor(client, { logger = console, quoteService = new CheckoutQuoteService(client, { logger }) } = {}) {
    this.client = client; this.logger = logger; this.quoteService = quoteService
  }
  async create(raw, customerId = null, requestId = '') {
    const input = parseCheckout(orderRequestSchema, raw)
    const scopedQuote = this.quoteService.withRequestId(requestId)
    if (!this.client) { scopedQuote.diagnostic('configuration', 'orders_v1', 'CLIENT_UNAVAILABLE'); throw unavailable() }
    // SQL owns UUID equivalence, ambiguity, frozen intent and commerce eligibility.
    // Neither current catalog reads nor textual lookups precede committed replay.
    const args = {
      p_idempotency_key: 'checkout:' + input.idempotencyKey, p_items: input.items, p_contact: input.contact, p_shipping: input.shipping,
      p_payment_method: input.paymentMethod, p_coupon_code: input.couponCode || null,
      p_shipping_method_id: null, p_customer_id: customerId,
      p_quote_fingerprint: input.quoteFingerprint ?? null,
    }
    let result
    for (let attempt = 0; attempt < 3; attempt++) {
      try { result = await this.client.rpc('create_order_transaction_v1_checked', args) }
      catch { scopedQuote.diagnostic('rpc', 'create_order_transaction_v1_checked', 'TRANSPORT_FAILURE'); throw unavailable() }
      // This known collision rolled back. Never replace the checkout token.
      if (!(result?.error?.code === '23505' && result.error.message?.includes('orders_order_number_key'))) break
    }
    if (result?.error) {
      scopedQuote.diagnostic('rpc', 'create_order_transaction_v1_checked', normalizedCheckoutCategory(result.error, 'RPC_FAILURE'))
      throw await this.mapError(result.error, input, scopedQuote)
    }
    const data = result?.data
    if (data?.outcome !== undefined) {
      // Only a normal, committed RPC result authorizes replacement. SQL errors,
      // malformed envelopes and lost responses retain the original attempt.
      if (data && !Array.isArray(data) && Object.keys(data).length === 3
          && data.outcome === 'retired' && data.code === 'QUOTE_CHANGED'
          && data.idempotencyKey === input.idempotencyKey) {
        throw new CheckoutApiError(409, 'QUOTE_CHANGED', 'Checkout prices or charges changed. Review the updated total and confirm again.')
      }
      throw unavailable()
    }
    return receipt(data, input)
  }
  async mapError(error, input, quoteService = this.quoteService) {
    if (error.code === 'P0001') {
      if (['V1_QUOTE_CHANGED', 'V1_QUOTE_REQUIRED', 'V1_ATTEMPT_UNAVAILABLE'].includes(error.message)) return unavailable()
      if (error.message === 'V2_IDEMPOTENCY_CONFLICT') return new CheckoutApiError(409, 'IDEMPOTENCY_CONFLICT', 'This checkout token belongs to a different request.')
      if (error.message === 'V2_IDEMPOTENCY_AMBIGUOUS') return new CheckoutApiError(409, 'IDEMPOTENCY_AMBIGUOUS', 'This checkout cannot be matched safely. Contact support before starting another attempt.')
      if (error.message === 'V2_INVALID_REQUEST') return new CheckoutApiError(400, 'INVALID_CHECKOUT_REQUEST', 'Please check your checkout information.')
      if (error.message === 'V1_PAYMENT_UNAVAILABLE') return new CheckoutApiError(422, 'INVALID_PAYMENT_METHOD', 'This payment method is unavailable.')
      if (error.message === 'V1_CONFIGURATION_UNAVAILABLE') return unavailable()
      if (/variants.*unavailable|variants.*enough stock/.test(error.message ?? '')) {
        // Diagnostics after SQL rejection only; this cannot authorize replay.
        try { await quoteService.variants(input.items) } catch (diagnostic) {
          if (diagnostic instanceof CheckoutApiError && diagnostic.status !== 503) return diagnostic
        }
        return new CheckoutApiError(409, 'VARIANT_UNAVAILABLE', 'A selected variant is no longer available.')
      }
      if (/Coupon|coupon/.test(error.message ?? '')) return new CheckoutApiError(422, 'INVALID_COUPON', 'This coupon cannot be applied to your order.')
      if (/shipping (?:method|rate)/i.test(error.message ?? '')) return unavailable()
    }
    if (['22023', '22P02'].includes(error.code)) return new CheckoutApiError(400, 'INVALID_CHECKOUT_REQUEST', 'Please check your checkout information.')
    if (error.code === '23503' && error.message === 'Customer account is unavailable.') return new CheckoutApiError(403, 'CUSTOMER_UNAVAILABLE', 'Your customer account is unavailable.')
    if (['42501', '23503', '23505', '57014', '40001', '40P01'].includes(error.code)) return unavailable()
    return new CheckoutApiError(500, 'CHECKOUT_FAILED', 'Your order could not be confirmed. Retry this checkout attempt.')
  }
}
function receipt(data, input) {
  if (!data || typeof data !== 'object' || Array.isArray(data)
      || typeof data.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id)
      || data.idempotencyKey !== input.idempotencyKey || typeof data.idempotent !== 'boolean'
      || typeof data.orderNumber !== 'string' || !data.orderNumber || typeof data.status !== 'string' || !data.status
      || typeof data.paymentStatus !== 'string' || !data.paymentStatus || data.paymentMethod !== input.paymentMethod || data.currency !== 'PKR') throw unavailable()
  const amounts = Object.fromEntries(['subtotal', 'discount', 'shippingFee', 'total'].map(key => [key, cents(data[key])]))
  if(amounts.discount>amounts.subtotal||amounts.total!==amounts.subtotal-amounts.discount+amounts.shippingFee||(data.pricingOutcome!=null&&!Array.isArray(data.lines)))throw unavailable()
  return { ...publicV1Lines(data.lines,data.subtotal,null,true), ...publicPricingOutcome(data.pricingOutcome,data,input.quoteFingerprint), id: data.id, idempotencyKey: data.idempotencyKey, orderNumber: data.orderNumber, status: data.status,
    paymentStatus: data.paymentStatus, paymentMethod: data.paymentMethod,
    ...Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, Number(value) / 100])), currency: data.currency, idempotent: data.idempotent }
}
