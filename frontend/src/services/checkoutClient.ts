import type { CanonicalOrderReceipt, CanonicalOrderRequest, CheckoutQuoteRequest, CheckoutQuoteResponse } from '../types/index.ts'
import { isVariantId } from './productVariants.ts'
import { validPricingEvidence } from './checkoutPricing.ts'
import { matchesV2Checkout } from './checkoutV2Validation.ts'

export class CheckoutClientError extends Error {
  code: string
  status: number
  unknownOutcome: boolean
  constructor(code: string, message: string, status = 0, unknownOutcome = false) {
    super(message); this.code = code; this.status = status; this.unknownOutcome = unknownOutcome
  }
}
export const isPaymentMethod = (value: unknown) => value === 'Cash on Delivery' || value === 'Bank Transfer'
function amounts(value: Record<string, unknown>): boolean {
  const fields = ['subtotal', 'discount', 'shippingFee', 'total'] as const
  if (!fields.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0)) return false
  const number = (key: typeof fields[number]) => Math.round(Number(value[key]) * 100)
  return value.currency === 'PKR' && number('discount') <= number('subtotal')
    && number('total') === number('subtotal') - number('discount') + number('shippingFee')
}
export function isOrderReceipt(value: unknown): value is CanonicalOrderReceipt {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return amounts(row) && validPricingEvidence(row,true) && isVariantId(row.id) && isVariantId(row.idempotencyKey) && typeof row.orderNumber === 'string' && /^RF-\d{8}-[A-F0-9]{8}$/.test(row.orderNumber)
    && ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned', 'Refunded'].includes(String(row.status))
    && ['Unpaid', 'Pending', 'Paid', 'Failed', 'Refunded'].includes(String(row.paymentStatus))
    && isPaymentMethod(row.paymentMethod) && typeof row.idempotent === 'boolean'
}
export function isQuote(value: unknown): value is CheckoutQuoteResponse {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return amounts(row) && validPricingEvidence(row) && isVariantId(row.shippingMethodId) && Array.isArray(row.paymentMethods)
    && row.paymentMethods.length > 0 && row.paymentMethods.every(isPaymentMethod) && typeof row.orderingEnabled === 'boolean'
    && (row.quoteFingerprint === undefined || typeof row.quoteFingerprint === 'string' && /^[0-9a-f]{64}$/.test(row.quoteFingerprint))
}
export function isCheckedQuote(value: unknown): value is CheckoutQuoteResponse & { quoteFingerprint: string; idempotencyKey?: string } {
  return isQuote(value) && typeof value.quoteFingerprint === 'string' && /^[0-9a-f]{64}$/.test(value.quoteFingerprint)
    && (value.contractVersion === 2 || isVariantId(value.idempotencyKey))
}
function canonicalLines(body: CheckoutQuoteRequest | CanonicalOrderRequest) {
  return (body.lines ?? (body.items ?? []).map(item => ({ kind: 'normal_variant' as const, variantId: item.variantId, quantity: item.quantity }))).map(line => {
    if (line.kind === 'fixed_tester_pack') return { kind: line.kind, packId: line.packId, definitionRevision: line.definitionRevision, quantity: line.quantity }
    if (line.kind === 'configurable_tester_pack') return { kind: line.kind, packId: line.packId, definitionRevision: line.definitionRevision, quantity: line.quantity,
      selections: line.selections.map(s => ({ variantId: s.variantId, quantityPerPack: s.quantityPerPack })) }
    return { kind: 'normal_variant' as const, variantId: line.variantId, quantity: line.quantity }
  })
}
export function createCheckoutClient(fetcher: typeof fetch = fetch, baseUrl = import.meta.env?.VITE_API_URL || '/api', version: 'v1' | 'v2' | 'auto' = 'v1') {
  async function request<T>(path: string, body: unknown, validate: (value: unknown) => value is T, order: boolean): Promise<T> {
    try {
      const sessionResponse = await fetcher(`${baseUrl}/v1/auth/session`, { credentials: 'include' })
      const session = await sessionResponse.json().catch(() => null)
      if (!sessionResponse.ok) throw new CheckoutClientError(session?.error?.code ?? 'CHECKOUT_UNAVAILABLE', session?.error?.message ?? 'Checkout is temporarily unavailable.', sessionResponse.status)
      const response = await fetcher(`${baseUrl}${path}`, { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-RF-CSRF': session?.data?.csrfToken ?? '' }, body: JSON.stringify(body) })
      const envelope = await response.json().catch(() => null)
      if (!response.ok) throw new CheckoutClientError(envelope?.error?.code ?? 'CHECKOUT_FAILED', envelope?.error?.message ?? 'Checkout could not be completed.', response.status, order && response.status >= 500)
      if (!validate(envelope?.data)) throw new CheckoutClientError('INVALID_RESPONSE', 'The order service returned an invalid response. Your cart has been saved.', 0, order)
      if (order && envelope.data.pricingOutcome && envelope.data.pricingOutcome.acceptedQuoteFingerprint !== (body as CanonicalOrderRequest).quoteFingerprint) throw new CheckoutClientError('INVALID_RESPONSE', 'The order service returned an invalid confirmation. Retry the same attempt.', 0, true)
      return envelope.data
    } catch (error) {
      if (error instanceof CheckoutClientError) throw error
      throw new CheckoutClientError('NETWORK_ERROR', order
        ? 'We could not confirm the result. Your cart has been saved; retry the same attempt.'
        : 'Unable to load checkout prices. Check your connection and retry. Your cart has been saved.', 0, order)
    }
  }
  return {
    quote: (body: CheckoutQuoteRequest) => {
      const hasPacks = body.lines?.some(line => line.kind !== 'normal_variant')
      if (version === 'v1' && body.lines) throw new CheckoutClientError('INVALID_CHECKOUT_REQUEST', 'Tester pack checkout requires the V2 contract.')
      if (version === 'v2' || version === 'auto' && body.lines) {
        const lines = canonicalLines(body)
        return request('/v2/public/checkout/quote', {
          contractVersion: 2,
          lines,
          shipping: { city: body.shipping.city, province: body.shipping.province },
          email: body.email,
          couponCode: body.couponCode,
        }, (value): value is CheckoutQuoteResponse => isQuote(value) && (!hasPacks || matchesV2Checkout(value, lines)), false)
      }
      return request('/v1/public/checkout/quote', {
        items: (body.items ?? []).map(({ variantId, quantity }) => ({ variantId, quantity })),
        shipping: { city: body.shipping.city, province: body.shipping.province }, email: body.email, couponCode: body.couponCode,
      }, isQuote, false)
    },
    createOrder: (body: CanonicalOrderRequest) => {
      const hasPacks = body.lines?.some(line => line.kind !== 'normal_variant')
      if (version === 'v1' && body.lines) throw new CheckoutClientError('INVALID_CHECKOUT_REQUEST', 'Tester pack checkout requires the V2 contract.')
      if (hasPacks && !/^[0-9a-f]{64}$/.test(body.quoteFingerprint ?? '')) throw new CheckoutClientError('INVALID_CHECKOUT_REQUEST', 'Review the current pack quote before ordering.')
      if (version === 'v2' || version === 'auto' && body.lines) {
        const lines = canonicalLines(body)
        return request('/v2/public/orders', {
          contractVersion: 2,
          idempotencyKey: body.idempotencyKey,
          lines,
          contact: { name: body.contact.name, email: body.contact.email, phone: body.contact.phone },
          shipping: { address: body.shipping.address, city: body.shipping.city, province: body.shipping.province, notes: body.shipping.notes },
          paymentMethod: body.paymentMethod,
          couponCode: body.couponCode,
          ...(body.quoteFingerprint !== undefined ? { quoteFingerprint: body.quoteFingerprint } : {}),
        }, (value): value is CanonicalOrderReceipt => isOrderReceipt(value)
          && value.idempotencyKey === body.idempotencyKey && value.paymentMethod === body.paymentMethod
          && (!hasPacks || matchesV2Checkout(value, lines, body.quoteFingerprint)), true)
      }
      return request('/v1/public/orders', {
        idempotencyKey: body.idempotencyKey, items: (body.items ?? []).map(({ variantId, quantity }) => ({ variantId, quantity })),
        contact: { name: body.contact.name, email: body.contact.email, phone: body.contact.phone },
        shipping: { address: body.shipping.address, city: body.shipping.city, province: body.shipping.province, notes: body.shipping.notes },
        paymentMethod: body.paymentMethod, couponCode: body.couponCode,
        ...(body.quoteFingerprint !== undefined ? { quoteFingerprint: body.quoteFingerprint } : {}),
      }, isOrderReceipt, true)
    },
  }
}
// Frozen requests retain their transport: historical items use V1, typed lines use V2.
export const checkoutClient = createCheckoutClient(fetch, import.meta.env?.VITE_API_URL || '/api', 'auto')
