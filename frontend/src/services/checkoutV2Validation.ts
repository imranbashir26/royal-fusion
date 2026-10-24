import type { PurchaseLineV2Request } from '../types/index.ts'
import { isVariantId } from './productVariants.ts'
import { moneyCents } from './checkoutPricing.ts'

const hash = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2147483647
const object = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
function composition(selections: { variantId: string; quantityPerPack: number }[]) {
  const grouped = new Map<string, number>()
  for (const selection of selections) {
    if (!isVariantId(selection.variantId) || !positive(selection.quantityPerPack)) throw new Error('Invalid selection')
    const id = selection.variantId.toLowerCase()
    grouped.set(id, (grouped.get(id) ?? 0) + selection.quantityPerPack)
  }
  return [...grouped].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
}
function identity(line: PurchaseLineV2Request): unknown[] {
  return line.kind === 'normal_variant' ? [line.kind, line.variantId.toLowerCase()]
    : line.kind === 'fixed_tester_pack' ? [line.kind, line.packId.toLowerCase(), line.definitionRevision]
    : [line.kind, line.packId.toLowerCase(), line.definitionRevision, composition(line.selections)]
}

/** Bind server snapshots to the requested logical lines before accepting pack quotes or consuming a cart. */
export function matchesV2Checkout(value: unknown, requested: PurchaseLineV2Request[], receiptFingerprint?: string): boolean {
  try {
    if (!object(value) || value.contractVersion !== 2 || !hash(value.quoteFingerprint)
      || !Array.isArray(value.lines) || !value.lines.length || value.lines.length > 100) return false
    const receipt = receiptFingerprint !== undefined
    if (receipt && (value.snapshotVersion !== 2 || !hash(value.requestFingerprint) || value.quoteFingerprint !== receiptFingerprint
      || value.pricingOutcome && value.pricingOutcome.acceptedQuoteFingerprint !== receiptFingerprint)) return false
    const expected = new Map<string, number>()
    for (const line of requested) {
      const key = JSON.stringify(identity(line))
      expected.set(key, (expected.get(key) ?? 0) + line.quantity)
    }
    if (value.lines.length !== expected.size) return false
    const seen = new Set<string>(), ids = new Set<string>()
    let componentCount = 0
    for (const [position, line] of value.lines.entries()) {
      if (!object(line) || !Array.isArray(line.identity) || !hash(line.identityHash) || line.position !== position
        || !isVariantId(line.productId) || typeof line.name !== 'string' || !line.name
        || !Array.isArray(line.components) || !positive(line.quantity)) return false
      const key = JSON.stringify(identity(line as PurchaseLineV2Request))
      if (key !== JSON.stringify(line.identity) || seen.has(key) || expected.get(key) !== line.quantity) return false
      seen.add(key)
      if (receipt) {
        if (!isVariantId(line.id) || ids.has(line.id)) return false
        ids.add(line.id)
      }
      if (line.kind === 'normal_variant') {
        if (line.components.length) return false
        continue
      }
      if (line.productId !== line.packId || !hash(line.definitionFingerprint) || !line.components.length || line.components.length > 100) return false
      const variants = new Set<string>()
      for (const [index, component] of line.components.entries()) {
        if (!object(component) || !isVariantId(component.testerVariantId) || !isVariantId(component.testerProductId)
          || variants.has(component.testerVariantId) || component.position !== index || component.size !== '5 ml' || component.volumeMl !== 5
          || !positive(component.quantityPerPack) || !positive(component.totalPhysicalQuantity)
          || BigInt(component.totalPhysicalQuantity) !== BigInt(component.quantityPerPack) * BigInt(line.quantity)
          || (moneyCents(component.referenceUnitPrice) ?? 0n) <= 0n || typeof component.testerName !== 'string' || !component.testerName) return false
        variants.add(component.testerVariantId)
        if (receipt) {
          if (!isVariantId(component.id) || ids.has(component.id)) return false
          ids.add(component.id)
        }
        componentCount++
      }
      if (line.kind === 'configurable_tester_pack' && JSON.stringify(composition(line.components.map(c => ({
        variantId: c.testerVariantId, quantityPerPack: c.quantityPerPack,
      })))) !== JSON.stringify(line.identity[3])) return false
    }
    return componentCount <= 2000
  } catch { return false }
}
