import type { SupabaseClient } from '@supabase/supabase-js'
import { mapProductVariant, type SupabaseVariantRow } from './productionMappers.ts'
import type { ProductVariant } from '../types/index.ts'

/** Chunk IDs and page rows to avoid silently truncating at the public API row limit. */
export async function loadPublicVariants(client: SupabaseClient, productIds: string[]): Promise<ProductVariant[]> {
  const variants: ProductVariant[] = []
  const ids = [...new Set(productIds)]
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100)
    for (let page = 0; ; page += 1) {
      const { data, error } = await client.from('product_variants')
        .select('id,product_id,option_name,option_value,sku,regular_price,sale_price,stock_quantity,active,available,display_order')
        .in('product_id', batch).eq('active', true).eq('available', true)
        .order('product_id', { ascending: true }).order('display_order', { ascending: true })
        .order('id', { ascending: true }).range(page * 500, page * 500 + 499)
      if (error) throw error
      const rows = (data ?? []) as SupabaseVariantRow[]
      variants.push(...rows.map(mapProductVariant))
      if (rows.length < 500) break
    }
  }
  return variants
}
