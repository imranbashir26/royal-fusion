import type { CheckoutPaymentMethod, CheckoutQuoteResponse } from '../types/index.ts'
import { CheckoutClientError, isCheckedQuote } from './checkoutClient.ts'

export function quoteAcceptanceKey(signature: string, quote: CheckoutQuoteResponse | null, payment: CheckoutPaymentMethod): string | null {
  if (!isCheckedQuote(quote) || !quote.paymentMethods.includes(payment)) return null
  return JSON.stringify([signature, quote.quoteFingerprint, payment, quote.subtotal, quote.discount, quote.shippingFee, quote.total, quote.currency])
}

export function isDefinitiveQuoteRejection(error: unknown): boolean {
  return error instanceof CheckoutClientError && !error.unknownOutcome && error.status === 409
    && ['QUOTE_CHANGED', 'QUOTE_REQUIRED'].includes(error.code)
}
