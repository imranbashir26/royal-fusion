// Test-only legacy financial oracle for existing in-memory SQL transport fixtures.
// Production quotation now executes Release 007; native tests verify real SQL.
import { CheckoutQuoteService,CheckoutApiError,cents,checkoutCalendarDate,unavailable } from '../../services/checkoutQuoteService.js'
import { parseCheckout,quoteRequestSchema } from '../../schemas/ordersV1.js'
const min=(a,b)=>a<b?a:b
const money=value=>Number(value)/100
const couponError=()=>new CheckoutApiError(422,'INVALID_COUPON','This coupon cannot be applied to your order.')
export class LegacyQuoteOracle extends CheckoutQuoteService {
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
