import type { CartItem, Product } from '../types/index.ts'
import { isVariantId } from '../services/productVariants.ts'

export interface PersistedCartState {
  items: CartItem[]
  selectedLineIds: string[]
}

export const CART_VERSION = 2
export const getCartLineId = (productId: string, variantId: string) => JSON.stringify([productId, variantId])

/** Restore identity and selection without trusting malformed localStorage data. */
export function restoreCartState(value: unknown, version = 1): PersistedCartState {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const selected = Array.isArray(input.selectedLineIds) ? new Set(input.selectedLineIds) : null
  const items: CartItem[] = []
  const selectedLineIds = new Set<string>()
  for (const [index, raw] of (Array.isArray(input.items) ? input.items : []).entries()) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    if (typeof row.productId !== 'string' || !row.productId || typeof row.size !== 'string'
      || !Number.isInteger(row.quantity) || Number(row.quantity) < 1) continue
    const variantId = isVariantId(row.variantId) ? row.variantId : null
    const identity: CartItem['identity'] = variantId ? 'canonical'
      : row.identity === 'legacy' && row.variantId === null ? 'legacy'
      : !Object.hasOwn(row, 'variantId') && version < 2 ? 'legacy' : 'corrupt'
    const oldId = typeof row.lineId === 'string' ? row.lineId : JSON.stringify([row.productId, row.size])
    const lineId = variantId ? getCartLineId(row.productId, variantId)
      : JSON.stringify([identity, row.productId, row.size, index])
    const item = { lineId, productId: row.productId, variantId, identity, size: row.size, quantity: Number(row.quantity) }
    const existing = items.find((candidate) => candidate.lineId === lineId)
    if (existing) existing.quantity += item.quantity
    else items.push(item)
    if (!selected || selected.has(oldId)) selectedLineIds.add(lineId)
  }
  return { items, selectedLineIds: [...selectedLineIds] }
}

/** Refresh canonical labels by exact UUID only. Legacy/corrupted lines require re-addition. */
export function reconcileCartState(state: PersistedCartState, products: Product[]): PersistedCartState {
  const selected = new Set(state.selectedLineIds)
  const items: CartItem[] = []
  const selectedLineIds = new Set<string>()
  for (const item of state.items) {
    const product = products.find((candidate) => candidate.id === item.productId)
    const variant = product && isVariantId(item.variantId) && item.identity !== 'legacy' && item.identity !== 'corrupt'
      ? product.variants?.find((candidate) => candidate.id === item.variantId && candidate.productId === product.id) : undefined
    const next = variant ? { ...item, identity: 'canonical' as const, size: variant.optionValue,
      lineId: getCartLineId(item.productId, variant.id) } : { ...item }
    const existing = items.find((candidate) => candidate.lineId === next.lineId)
    if (existing) existing.quantity += next.quantity
    else items.push(next)
    if (selected.has(item.lineId)) selectedLineIds.add(next.lineId)
  }
  // Preserve excessive quantities for explicit correction; never silently lose units.
  return { items, selectedLineIds: [...selectedLineIds] }
}

export function sameCartState(a: PersistedCartState, b: PersistedCartState): boolean {
  return a.items.length === b.items.length && a.items.every((item, index) => {
    const other = b.items[index]
    return item.lineId === other.lineId && item.productId === other.productId
      && item.variantId === other.variantId && item.identity === other.identity
      && item.size === other.size && item.quantity === other.quantity
  }) && a.selectedLineIds.length === b.selectedLineIds.length
    && a.selectedLineIds.every((id, index) => id === b.selectedLineIds[index])
}
