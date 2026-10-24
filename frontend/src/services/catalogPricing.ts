import type { ProductVariant } from '../types/index.ts'

export interface PublicPrice {
  variantId: string; productId: string; regularPrice: number; effectivePrice: number
  price: number; salePrice: number | null; saleActive: boolean; pricingAt: string; validUntil: string | null
  pricingExpiresAt: number
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const money = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 9999999999.99 && Math.abs(value * 100 - Math.round(value * 100)) < 0.001
const unavailable = () => new Error('Current prices are unavailable. Please refresh pricing.')

/** Deduplicates in-flight reads only; never caches an expired response. */
export function createVariantPriceLoader(request: (ids: string[]) => Promise<unknown>, now = () => performance.now()) {
  const pending = new Map<string, Promise<Map<string, PublicPrice>>>()
  return (requested: string[]): Promise<Map<string, PublicPrice>> => {
    const ids = [...new Set(requested)].sort()
    if (!ids.every(uuid)) return Promise.reject(unavailable())
    const key = ids.join(',')
    const existing = pending.get(key)
    if (existing) return existing
    const work = (async () => {
      const result = new Map<string, PublicPrice>()
      for (let offset = 0; offset < ids.length; offset += 100) {
        const batch = ids.slice(offset, offset + 100), started = now()
        const body = await request(batch) as { data?: { currency?: string; items?: PublicPrice[] } }
        if (body?.data?.currency !== 'PKR' || !Array.isArray(body.data.items)) throw unavailable()
        for (const row of body.data.items) {
          if (!row || !batch.includes(row.variantId) || result.has(row.variantId) || !uuid(row.productId)
            || !money(row.regularPrice) || !money(row.effectivePrice) || row.price !== row.effectivePrice
            || typeof row.saleActive !== 'boolean' || typeof row.pricingAt !== 'string' || !Number.isFinite(Date.parse(row.pricingAt))
            || (row.validUntil !== null && (typeof row.validUntil !== 'string' || !Number.isFinite(Date.parse(row.validUntil))))
            || (row.saleActive ? row.salePrice !== row.effectivePrice || row.effectivePrice >= row.regularPrice : row.salePrice !== null || row.effectivePrice !== row.regularPrice)) throw unavailable()
          // Request-start plus the DATABASE interval is conservative under latency
          // and independent of the customer's wall clock. No local price switching.
          const pricingExpiresAt = row.validUntil === null ? Infinity : started + Date.parse(row.validUntil) - Date.parse(row.pricingAt)
          result.set(row.variantId, {...row, pricingExpiresAt})
        }
      }
      if ([...result.values()].some(row => row.pricingExpiresAt <= now())) throw unavailable()
      return result
    })()
    pending.set(key, work)
    void work.finally(() => { if (pending.get(key) === work) pending.delete(key) }).catch(() => {})
    return work
  }
}

export const loadVariantPrices = createVariantPriceLoader(async ids => {
  const base = import.meta.env?.VITE_API_URL || '/api'
  const response = await fetch(`${base}/v2/public/catalog/variant-prices?ids=${ids.join(',')}`, {cache: 'no-store'})
  if (!response.ok) throw unavailable()
  return response.json()
})

export function applyVariantPrices(variants: ProductVariant[], prices: Map<string, PublicPrice>): ProductVariant[] {
  return variants.flatMap(variant => {
    const price = prices.get(variant.id)
    // Public omissions are authoritative, including newly hidden parents.
    if (!price) return []
    if (price.productId !== variant.productId) throw unavailable()
    return [{...variant, regularPrice: price.regularPrice, salePrice: price.salePrice,
      effectivePrice: price.effectivePrice, saleActive: price.saleActive, pricingAt: price.pricingAt,
      validUntil: price.validUntil, pricingExpiresAt: price.pricingExpiresAt, pricingStale: false}]
  })
}
