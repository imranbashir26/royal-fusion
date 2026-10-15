import {ProductApiError} from './productAdminService.js'
import {scheduledWriteRequested} from '../schemas/saleSchedule.js'
import {normalizeOption,toCatalogVariants} from '../schemas/catalogVariants.js'

// Bounds omitted by a writer retain their persisted values. Inspect the same
// canonical identities as the writer, including legacy variation aliases.
export function scheduledPriceMutation(input, existing) {
  if (scheduledWriteRequested(input)) return true
  if (!existing) return false
  const changed = (prior, patch, sale, start, end) => {
    if (prior?.[start] == null && prior?.[end] == null) return false
    // Established sale clearing removes its entire window atomically in SQL.
    if (Object.hasOwn(patch,sale) && (patch[sale] == null || patch[sale] === 0)) return false
    return Object.hasOwn(patch,sale) && Number(patch[sale]) !== Number(prior[sale])
  }
  if (input.definition) return changed(existing,input.definition,'fixedSalePrice','fixedSaleStartsAt','fixedSaleEndsAt')
  let rows
  try { rows = toCatalogVariants(input) } catch {
    throw new ProductApiError(400,'INVALID_REQUEST','Variant configuration is invalid.')
  }
  if (rows) return rows.some(row => existing.variants.some(prior => {
    const matches = row.id ? row.id === prior.id :
      row.sku.toLowerCase() === prior.sku.toLowerCase() ||
      row.optionName.toLowerCase() === prior.optionName.toLowerCase() && normalizeOption(row.optionValue).toLowerCase() === normalizeOption(prior.optionValue).toLowerCase()
    return matches && changed(prior,row,'salePrice','saleStartsAt','saleEndsAt')
  }))
  return existing.variants.some(prior => changed(prior,input,'salePrice','saleStartsAt','saleEndsAt'))
}

// Called only at trusted server composition. Never read request/client configuration.
export const saleSchedulingConfigured = env => env.ADMIN_SALE_SCHEDULING_ENABLED === 'true'

export function createSaleSchedulingPolicy(client, {enabled = false} = {}) {
  const configured = enabled === true
  async function available() {
    if (!configured || !client) return false
    try {
      const {data, error} = await client.rpc('catalog_sale_prices_009', {p_variant_ids: [], p_pack_ids: []})
      return !error && Boolean(data && Number.isFinite(Date.parse(data.pricingAt))
        && Array.isArray(data.variants) && data.variants.length === 0
        && Array.isArray(data.packs) && data.packs.length === 0)
    } catch { return false }
  }
  return Object.freeze({
    available,
    async assertAllowed(input, existing) {
      if (!scheduledPriceMutation(input,existing)) return
      if (!configured) throw new ProductApiError(409, 'SALE_SCHEDULING_DISABLED', 'Scheduled-sale administration is unavailable.')
      if (!await available()) throw new ProductApiError(503, 'SALE_SCHEDULING_UNAVAILABLE', 'Scheduled-sale administration is temporarily unavailable.')
    },
  })
}
