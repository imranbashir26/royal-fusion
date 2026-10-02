import { orderRequestSchema, parseCheckout, aggregateItems } from '../schemas/ordersV1.js'
import { CheckoutApiError, CheckoutQuoteService, normalizedCheckoutCategory, unavailable } from './checkoutQuoteService.js'

const orderColumns = 'id,order_number,customer_id,customer_name,customer_email,customer_phone,shipping_address,shipping_city,shipping_province,order_notes,payment_method,coupon_code,status,payment_status,subtotal,discount,shipping_fee,total,currency,idempotency_key'
const conflict = () => new CheckoutApiError(409, 'IDEMPOTENCY_CONFLICT', 'This checkout token belongs to a different request. Start a new checkout attempt.')

export class OrdersV1Service {
  constructor(client, { logger = console, quoteService = new CheckoutQuoteService(client, { logger }) } = {}) {
    this.client = client; this.logger = logger; this.quoteService = quoteService
  }
  async existing(key, quoteService = this.quoteService) {
    const rows = await quoteService.read('orders', orderColumns, [['eq', 'idempotency_key', key]])
    return rows[0] ?? null
  }
  async compare(order, input, customerId, quoteService = this.quoteService) {
    const rows = await quoteService.read('order_items', 'variant_id,quantity', [['eq', 'order_id', order.id]])
    const storedItems = aggregateItems(rows.map((row) => ({ variantId: row.variant_id, quantity: row.quantity })))
    const equal = JSON.stringify(storedItems) === JSON.stringify(input.items)
      && (order.customer_id ?? null) === customerId
      && order.customer_name === input.contact.name && order.customer_email?.toLowerCase() === input.contact.email
      && order.customer_phone === input.contact.phone
      && order.shipping_address === input.shipping.address && order.shipping_city === input.shipping.city
      && order.shipping_province === input.shipping.province && order.order_notes === input.shipping.notes
      && order.payment_method === input.paymentMethod && (order.coupon_code ?? '').toUpperCase() === input.couponCode
    if (!equal) throw conflict()
  }
  async create(raw, customerId = null, requestId = '') {
    const input = parseCheckout(orderRequestSchema, raw)
    const scopedQuote = this.quoteService.withRequestId(requestId)
    if (!this.client) { scopedQuote.diagnostic('configuration', 'orders_v1', 'CLIENT_UNAVAILABLE'); throw unavailable() }
    await scopedQuote.validateCustomer(customerId)
    const key = `checkout:${input.idempotencyKey}`
    const previous = await this.existing(key, scopedQuote)
    if (previous) { await this.compare(previous, input, customerId, scopedQuote); return receipt(previous, true) }
    let quote
    try {
      quote = await scopedQuote.quote({ items: input.items, shipping: { city: input.shipping.city, province: input.shipping.province }, email: input.contact.email, couponCode: input.couponCode }, customerId)
      if (!quote.paymentMethods.includes(input.paymentMethod)) throw new CheckoutApiError(422, 'INVALID_PAYMENT_METHOD', 'This payment method is unavailable.')
    } catch (error) {
      const committed = await this.existing(key, scopedQuote)
      if (committed) { await this.compare(committed, input, customerId, scopedQuote); return receipt(committed, true) }
      throw error
    }
    const args = {
      p_idempotency_key: key, p_items: input.items, p_contact: input.contact, p_shipping: input.shipping,
      p_payment_method: input.paymentMethod, p_coupon_code: input.couponCode || null,
      p_shipping_method_id: quote.shippingMethodId, p_customer_id: customerId,
    }
    // Retry only an order-number collision: the failed RPC transaction rolled back.
    let result
    for (let attempt = 0; attempt < 3; attempt++) {
      try { result = await this.client.rpc('create_order_transaction', args) }
      catch { scopedQuote.diagnostic('rpc', 'create_order_transaction', 'TRANSPORT_FAILURE'); throw unavailable() } // Retry SAME key.
      if (!(result.error?.code === '23505' && result.error?.message?.includes('orders_order_number_key'))) break
    }
    if (result.error) {
      scopedQuote.diagnostic('rpc', 'create_order_transaction', normalizedCheckoutCategory(result.error, 'RPC_FAILURE'))
      // A competing commit can turn preflight eligibility into a stale observation.
      const committed = await this.existing(key, scopedQuote)
      if (committed) { await this.compare(committed, input, customerId, scopedQuote); return receipt(committed, true) }
      throw await this.mapError(result.error, input, scopedQuote)
    }
    const committed = await this.existing(key, scopedQuote)
    if (!committed || committed.id !== result.data?.id) throw unavailable()
    await this.compare(committed, input, customerId, scopedQuote) // Required even if two requests both missed prelookup.
    return receipt(committed, result.data.idempotent === true)
  }
  async mapError(error, input, quoteService = this.quoteService) {
    if (error.code === 'P0001') {
      if (/variants.*unavailable|variants.*enough stock/.test(error.message ?? '')) {
        try { await quoteService.variants(input.items) } catch (diagnostic) {
          if (diagnostic instanceof CheckoutApiError && diagnostic.status !== 503) return diagnostic
        }
        return new CheckoutApiError(409, 'VARIANT_UNAVAILABLE', 'A selected variant is no longer available.')
      }
      if (/Coupon|coupon/.test(error.message ?? '')) return new CheckoutApiError(422, 'INVALID_COUPON', 'This coupon cannot be applied to your order.')
      if (/shipping (?:method|rate)/i.test(error.message ?? '')) return unavailable()
    }
    if (['42501', '23503', '23505', '57014', '40001', '40P01'].includes(error.code)) return unavailable()
    return new CheckoutApiError(500, 'CHECKOUT_FAILED', 'Your order could not be confirmed. Retry this checkout attempt.')
  }
}
function receipt(order, idempotent) {
  return { id: order.id, idempotencyKey: order.idempotency_key.slice('checkout:'.length), orderNumber: order.order_number, status: order.status, paymentStatus: order.payment_status,
    paymentMethod: order.payment_method, subtotal: Number(order.subtotal), discount: Number(order.discount),
    shippingFee: Number(order.shipping_fee), total: Number(order.total), currency: order.currency, idempotent }
}
