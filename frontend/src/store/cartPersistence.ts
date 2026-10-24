import type { CartItem, ConfigurablePackCartItem, ConfigurablePackSelection, FixedPackCartItem, NormalVariantCartItem, Product } from '../types/index.ts'
import { isVariantId } from '../services/productVariants.ts'

export interface PersistedCartState {
  items: CartItem[]
  selectedLineIds: string[]
}

export const CART_VERSION = 2
export const getCartLineId = (productId: string, variantId: string) => JSON.stringify([productId, variantId])
export const getFixedPackLineId = (packId: string, definitionRevision: string) =>
  JSON.stringify(['fixed_tester_pack', packId.toLowerCase(), String(definitionRevision)])

export function normalizeSelections(selections: Array<{ variantId: string; quantityPerPack: number }>): Array<[string, number]> {
  const grouped = new Map<string, number>()
  for (const s of selections) {
    if (isVariantId(s?.variantId) && Number.isInteger(s?.quantityPerPack) && Number(s.quantityPerPack) > 0) {
      const id = s.variantId.toLowerCase()
      grouped.set(id, (grouped.get(id) ?? 0) + Number(s.quantityPerPack))
    }
  }
  return [...grouped.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

export const getConfigurablePackLineId = (
  packId: string,
  definitionRevision: string,
  selections: Array<{ variantId: string; quantityPerPack: number }>
) => JSON.stringify(['configurable_tester_pack', packId.toLowerCase(), String(definitionRevision), normalizeSelections(selections)])

export function getAnyCartLineId(item: CartItem): string {
  if (item.kind === 'fixed_tester_pack') return getFixedPackLineId(item.packId, item.definitionRevision)
  if (item.kind === 'configurable_tester_pack') return getConfigurablePackLineId(item.packId, item.definitionRevision, item.selections)
  return isVariantId(item.variantId) ? getCartLineId(item.productId, item.variantId) : item.lineId
}

/** Restore identity and selection without trusting malformed localStorage data. */
export function restoreCartState(value: unknown, version = 1): PersistedCartState {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const selected = Array.isArray(input.selectedLineIds) ? new Set(input.selectedLineIds) : null
  const items: CartItem[] = []
  const selectedLineIds = new Set<string>()
  for (const [index, raw] of (Array.isArray(input.items) ? input.items : []).entries()) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>

    if (row.kind === 'fixed_tester_pack') {
      if (!isVariantId(row.packId) || typeof row.definitionRevision !== 'string'
        || !/^[1-9][0-9]{0,18}$/.test(row.definitionRevision)
        || !Number.isInteger(row.quantity) || Number(row.quantity) < 1) continue
      const lineId = getFixedPackLineId(row.packId, row.definitionRevision)
      const oldId = typeof row.lineId === 'string' ? row.lineId : lineId
      const item: FixedPackCartItem = {
        kind: 'fixed_tester_pack',
        lineId,
        productId: typeof row.productId === 'string' && row.productId ? row.productId : row.packId,
        packId: row.packId.toLowerCase(),
        definitionRevision: String(row.definitionRevision),
        size: typeof row.size === 'string' ? row.size : 'Tester pack',
        name: typeof row.name === 'string' ? row.name : undefined,
        image: typeof row.image === 'string' ? row.image : undefined,
        quantity: Number(row.quantity),
        identity: 'canonical',
      }
      const existing = items.find((candidate) => candidate.lineId === lineId)
      if (existing) existing.quantity += item.quantity
      else items.push(item)
      if (!selected || selected.has(oldId)) selectedLineIds.add(lineId)
      continue
    }

    if (row.kind === 'configurable_tester_pack') {
      if (!isVariantId(row.packId) || typeof row.definitionRevision !== 'string'
        || !/^[1-9][0-9]{0,18}$/.test(row.definitionRevision)
        || !Number.isInteger(row.quantity) || Number(row.quantity) < 1
        || !Array.isArray(row.selections) || row.selections.length < 1 || row.selections.length > 100) continue
      const validSelections: ConfigurablePackSelection[] = []
      let valid = true
      for (const s of row.selections) {
        if (!s || typeof s !== 'object' || !isVariantId(s.variantId)
          || !Number.isInteger(s.quantityPerPack) || Number(s.quantityPerPack) < 1) {
          valid = false; break
        }
        validSelections.push({
          variantId: s.variantId.toLowerCase(),
          quantityPerPack: Number(s.quantityPerPack),
          ...(typeof s.testerName === 'string' ? { testerName: s.testerName } : {}),
        })
      }
      if (!valid || !validSelections.length) continue
      const lineId = getConfigurablePackLineId(row.packId, row.definitionRevision, validSelections)
      const oldId = typeof row.lineId === 'string' ? row.lineId : lineId
      const item: ConfigurablePackCartItem = {
        kind: 'configurable_tester_pack',
        lineId,
        productId: typeof row.productId === 'string' && row.productId ? row.productId : row.packId,
        packId: row.packId.toLowerCase(),
        definitionRevision: String(row.definitionRevision),
        selections: validSelections,
        size: typeof row.size === 'string' ? row.size : 'Custom tester pack',
        name: typeof row.name === 'string' ? row.name : undefined,
        image: typeof row.image === 'string' ? row.image : undefined,
        quantity: Number(row.quantity),
        identity: 'canonical',
      }
      const existing = items.find((candidate) => candidate.lineId === lineId)
      if (existing) existing.quantity += item.quantity
      else items.push(item)
      if (!selected || selected.has(oldId)) selectedLineIds.add(lineId)
      continue
    }

    if (typeof row.productId !== 'string' || !row.productId || typeof row.size !== 'string'
      || !Number.isInteger(row.quantity) || Number(row.quantity) < 1) continue
    const variantId = isVariantId(row.variantId) ? row.variantId : null
    const identity: CartItem['identity'] = variantId ? 'canonical'
      : row.identity === 'legacy' && row.variantId === null ? 'legacy'
      : !Object.hasOwn(row, 'variantId') && version < 2 ? 'legacy' : 'corrupt'
    const oldId = typeof row.lineId === 'string' ? row.lineId : JSON.stringify([row.productId, row.size])
    const lineId = variantId ? getCartLineId(row.productId, variantId)
      : JSON.stringify([identity, row.productId, row.size, index])
    const item: NormalVariantCartItem = { lineId, productId: row.productId, variantId, identity, size: row.size, quantity: Number(row.quantity) }
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
    if (item.kind === 'fixed_tester_pack' || item.kind === 'configurable_tester_pack') {
      const existing = items.find((candidate) => candidate.lineId === item.lineId)
      if (existing) existing.quantity += item.quantity
      else items.push({ ...item })
      if (selected.has(item.lineId)) selectedLineIds.add(item.lineId)
      continue
    }
    const product = products.find((candidate) => candidate.id === item.productId)
    const variant = product && isVariantId(item.variantId) && item.identity !== 'legacy' && item.identity !== 'corrupt'
      ? product.variants?.find((candidate) => candidate.id === item.variantId && candidate.productId === product.id) : undefined
    const next: NormalVariantCartItem = variant ? { ...item, identity: 'canonical' as const, size: variant.optionValue,
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
    if (item.lineId !== other.lineId || item.productId !== other.productId || item.quantity !== other.quantity
      || item.identity !== other.identity || item.kind !== other.kind) return false
    if (item.kind === 'fixed_tester_pack') {
      return other.kind === 'fixed_tester_pack' && item.packId === other.packId
        && item.definitionRevision === other.definitionRevision
    }
    if (item.kind === 'configurable_tester_pack') {
      return other.kind === 'configurable_tester_pack' && item.packId === other.packId
        && item.definitionRevision === other.definitionRevision
        && JSON.stringify(normalizeSelections(item.selections)) === JSON.stringify(normalizeSelections(other.selections))
    }
    return item.variantId === other.variantId && item.size === other.size
  }) && a.selectedLineIds.length === b.selectedLineIds.length
    && a.selectedLineIds.every((id, index) => id === b.selectedLineIds[index])
}
