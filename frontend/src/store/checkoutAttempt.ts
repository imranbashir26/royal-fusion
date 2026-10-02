import type { CanonicalOrderRequest } from '../types/index.ts'
import { isVariantId } from '../services/productVariants.ts'

export interface PurchasedLine { lineId: string; entryId: string; variantId: string; quantity: number }
export interface CheckoutIntent { request: CanonicalOrderRequest; lines: PurchasedLine[] }
export type ConsumptionResult = 'consumed' | 'already-consumed' | 'cart-replaced' | 'recovery-required'
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key))
const text = (value: unknown, min: number, max: number) => typeof value === 'string' && value === value.trim()
  && value.length >= min && value.length <= max && !/[<>]/.test(value) && !value.includes('\u0000')
export function aggregateRequestItems(value: unknown): Map<string, number> | null {
  if (!Array.isArray(value) || !value.length || value.length > 100) return null
  const grouped = new Map<string, number>()
  for (const item of value) {
    if (!object(item) || !keys(item, ['variantId', 'quantity']) || !isVariantId(item.variantId)
      || !Number.isInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 99) return null
    const id = item.variantId.toLowerCase(), quantity = (grouped.get(id) ?? 0) + Number(item.quantity)
    if (quantity > 99) return null
    grouped.set(id, quantity)
  }
  return grouped
}
export function validPurchasedLines(value: unknown, items?: unknown): value is PurchasedLine[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) return false
  const variants = new Map<string, number>(), entries = new Set<string>()
  for (const line of value) {
    if (!object(line) || !keys(line, ['lineId', 'entryId', 'variantId', 'quantity']) || !isVariantId(line.variantId)
      || !isVariantId(line.entryId) || typeof line.lineId !== 'string' || !Number.isInteger(line.quantity)
      || Number(line.quantity) < 1 || Number(line.quantity) > 99) return false
    let identity: unknown
    try { identity = JSON.parse(line.lineId) } catch { return false }
    if (!Array.isArray(identity) || identity.length !== 2 || !isVariantId(identity[0]) || identity[1] !== line.variantId
      || JSON.stringify(identity) !== line.lineId || variants.has(line.variantId.toLowerCase()) || entries.has(line.entryId)) return false
    variants.set(line.variantId.toLowerCase(), Number(line.quantity)); entries.add(line.entryId)
  }
  const requested = items === undefined ? variants : aggregateRequestItems(items)
  return Boolean(requested && requested.size === variants.size && [...requested].every(([id, quantity]) => variants.get(id) === quantity))
}
export function validIntent(value: unknown): value is CheckoutIntent {
  if (!object(value) || !keys(value, ['request', 'lines']) || !object(value.request)) return false
  const request = value.request
  if (!keys(request, ['idempotencyKey', 'items', 'contact', 'shipping', 'paymentMethod', 'couponCode'])
    || !isVariantId(request.idempotencyKey) || !aggregateRequestItems(request.items)
    || !object(request.contact) || !keys(request.contact, ['name', 'email', 'phone'])
    || !text(request.contact.name, 2, 120) || !text(request.contact.phone, 7, 40)
    || !text(request.contact.email, 3, 254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(request.contact.email))
    || !object(request.shipping) || !keys(request.shipping, ['address', 'city', 'province', 'notes'])
    || !text(request.shipping.address, 4, 500) || !text(request.shipping.city, 2, 100)
    || !text(request.shipping.province, 2, 100) || !text(request.shipping.notes, 0, 1000)
    || !['Cash on Delivery', 'Bank Transfer'].includes(String(request.paymentMethod))
    || !text(request.couponCode, 0, 40) || !/^[A-Za-z0-9_-]*$/.test(String(request.couponCode))) return false
  return validPurchasedLines(value.lines, request.items)
}
