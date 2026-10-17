import type { CanonicalOrderRequest } from '../types/index.ts'
import { isVariantId } from '../services/productVariants.ts'
import { getConfigurablePackLineId, getFixedPackLineId } from './cartPersistence.ts'

export interface StandardPurchasedLine { lineId: string; entryId: string; variantId: string; quantity: number; kind?: 'normal_variant' }
export interface FixedPackPurchasedLine { lineId: string; entryId: string; packId: string; definitionRevision: string; quantity: number; kind: 'fixed_tester_pack'; variantId?: null }
export interface ConfigurablePackPurchasedLine { lineId: string; entryId: string; packId: string; definitionRevision: string; selections: Array<{ variantId: string; quantityPerPack: number }>; quantity: number; kind: 'configurable_tester_pack'; variantId?: null }
export type PurchasedLine = StandardPurchasedLine | FixedPackPurchasedLine | ConfigurablePackPurchasedLine

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

export function aggregateRequestLines(value: unknown): Map<string, number> | null {
  if (!Array.isArray(value) || !value.length || value.length > 100) return null
  const grouped = new Map<string, number>()
  for (const line of value) {
    if (!object(line) || typeof line.kind !== 'string') return null
    if (line.kind === 'normal_variant') {
      if (!isVariantId(line.variantId) || !Number.isInteger(line.quantity) || Number(line.quantity) < 1 || Number(line.quantity) > 99) return null
      const id = JSON.stringify(['normal_variant', (line.variantId as string).toLowerCase()])
      const current = (grouped.get(id) ?? 0) + Number(line.quantity)
      if (current > 99) return null
      grouped.set(id, current)
    } else if (line.kind === 'fixed_tester_pack') {
      if (!isVariantId(line.packId) || typeof line.definitionRevision !== 'string' || !/^[1-9][0-9]{0,18}$/.test(line.definitionRevision)
        || !Number.isInteger(line.quantity) || Number(line.quantity) < 1 || Number(line.quantity) > 99) return null
      const id = getFixedPackLineId(line.packId as string, line.definitionRevision)
      grouped.set(id, (grouped.get(id) ?? 0) + Number(line.quantity))
    } else if (line.kind === 'configurable_tester_pack') {
      if (!isVariantId(line.packId) || typeof line.definitionRevision !== 'string' || !/^[1-9][0-9]{0,18}$/.test(line.definitionRevision)
        || !Number.isInteger(line.quantity) || Number(line.quantity) < 1 || Number(line.quantity) > 99
        || !Array.isArray(line.selections) || !line.selections.length || line.selections.length > 100) return null
      for (const s of line.selections) {
        if (!object(s) || !isVariantId(s.variantId) || !Number.isInteger(s.quantityPerPack) || Number(s.quantityPerPack) < 1) return null
      }
      const id = getConfigurablePackLineId(line.packId as string, line.definitionRevision, line.selections as Array<{ variantId: string; quantityPerPack: number }>)
      grouped.set(id, (grouped.get(id) ?? 0) + Number(line.quantity))
    } else return null
  }
  return grouped
}

export function validPurchasedLines(value: unknown, itemsOrLines?: unknown): value is PurchasedLine[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) return false
  const variants = new Map<string, number>(), linesMap = new Map<string, number>(), entries = new Set<string>()
  let hasPacks = false
  for (const line of value) {
    if (!object(line) || !isVariantId(line.entryId) || entries.has(line.entryId)
      || typeof line.lineId !== 'string' || !Number.isInteger(line.quantity)
      || Number(line.quantity) < 1 || Number(line.quantity) > 99) return false
    entries.add(line.entryId)

    if (line.kind === 'fixed_tester_pack') {
      hasPacks = true
      if (!isVariantId(line.packId) || typeof line.definitionRevision !== 'string'
        || !/^[1-9][0-9]{0,18}$/.test(line.definitionRevision)
        || line.lineId !== getFixedPackLineId(line.packId, line.definitionRevision)) return false
      linesMap.set(line.lineId, (linesMap.get(line.lineId) ?? 0) + Number(line.quantity))
    } else if (line.kind === 'configurable_tester_pack') {
      hasPacks = true
      if (!isVariantId(line.packId) || typeof line.definitionRevision !== 'string'
        || !/^[1-9][0-9]{0,18}$/.test(line.definitionRevision)
        || !Array.isArray(line.selections) || !line.selections.length || line.selections.length > 100) return false
      for (const s of line.selections) {
        if (!object(s) || !isVariantId(s.variantId) || !Number.isInteger(s.quantityPerPack) || Number(s.quantityPerPack) < 1) return false
      }
      if (line.lineId !== getConfigurablePackLineId(line.packId, line.definitionRevision, line.selections as any)) return false
      linesMap.set(line.lineId, (linesMap.get(line.lineId) ?? 0) + Number(line.quantity))
    } else {
      if (!keys(line, ['lineId', 'entryId', 'variantId', 'quantity']) && !keys(line, ['kind', 'lineId', 'entryId', 'variantId', 'quantity'])) return false
      if (!isVariantId(line.variantId)) return false
      let identity: unknown
      try { identity = JSON.parse(line.lineId) } catch { return false }
      if (!Array.isArray(identity) || identity.length !== 2 || !isVariantId(identity[0]) || identity[1] !== line.variantId
        || JSON.stringify(identity) !== line.lineId || variants.has(line.variantId.toLowerCase())) return false
      variants.set(line.variantId.toLowerCase(), Number(line.quantity))
      linesMap.set(JSON.stringify(['normal_variant', (line.variantId as string).toLowerCase()]), Number(line.quantity))
    }
  }

  if (itemsOrLines === undefined) return true
  if (Array.isArray(itemsOrLines) && itemsOrLines.length > 0 && typeof itemsOrLines[0] === 'object' && itemsOrLines[0] !== null && 'kind' in itemsOrLines[0]) {
    const requested = aggregateRequestLines(itemsOrLines)
    return Boolean(requested && requested.size === linesMap.size && [...requested].every(([id, qty]) => linesMap.get(id) === qty))
  }
  if (hasPacks) return false
  const requested = aggregateRequestItems(itemsOrLines)
  return Boolean(requested && requested.size === variants.size && [...requested].every(([id, quantity]) => variants.get(id) === quantity))
}

export function validIntent(value: unknown): value is CheckoutIntent {
  if (!object(value) || !keys(value, ['request', 'lines']) || !object(value.request)) return false
  const request = value.request
  const confirmation = Object.hasOwn(request, 'quoteFingerprint')
  if (confirmation && (typeof request.quoteFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(request.quoteFingerprint))) return false

  const hasLines = Array.isArray(request.lines)
  const hasItems = Array.isArray(request.items)
  if (!hasLines && !hasItems) return false

  const expectedFields = ['idempotencyKey', hasLines ? 'lines' : 'items', 'contact', 'shipping', 'paymentMethod', 'couponCode', ...(confirmation ? ['quoteFingerprint'] : [])]
  if (!keys(request, expectedFields) || !isVariantId(request.idempotencyKey)) return false

  if (hasLines && !aggregateRequestLines(request.lines)) return false
  if (hasItems && !aggregateRequestItems(request.items)) return false

  if (!object(request.contact) || !keys(request.contact, ['name', 'email', 'phone'])
    || !text(request.contact.name, 2, 120) || !text(request.contact.phone, 7, 40)
    || !text(request.contact.email, 3, 254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(request.contact.email))
    || !object(request.shipping) || !keys(request.shipping, ['address', 'city', 'province', 'notes'])
    || !text(request.shipping.address, 4, 500) || !text(request.shipping.city, 2, 100)
    || !text(request.shipping.province, 2, 100) || !text(request.shipping.notes, 0, 1000)
    || !['Cash on Delivery', 'Bank Transfer'].includes(String(request.paymentMethod))
    || !text(request.couponCode, 0, 40) || !/^[A-Za-z0-9_-]*$/.test(String(request.couponCode))) return false

  return validPurchasedLines(value.lines, hasLines ? request.lines : request.items)
}
