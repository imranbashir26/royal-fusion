import type { SupabaseProductRow } from './productionMappers'
interface NormalQuery extends PromiseLike<{ data: SupabaseProductRow[] | null; error: unknown }> {
  in(column: string, values: string[]): NormalQuery
  eq(column: string, value: string | boolean): NormalQuery
  order(column: string, options: { ascending: boolean }): NormalQuery
}
interface NormalCatalogClient { from(table: 'products'): { select(columns: '*'): NormalQuery } }
// The same explicit query is used by the live storefront and the contract tests.
export async function loadNormalProductRows(client: unknown): Promise<SupabaseProductRow[]> {
  const source = client as NormalCatalogClient
  const { data, error } = await source.from('products').select('*')
    .in('commerce_kind', ['standard', 'tester'])
    .eq('status', 'Published').eq('active', true)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}
