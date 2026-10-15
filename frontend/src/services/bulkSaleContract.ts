import {saleTimestampMicros, validatedSalePatch} from './saleSchedule.ts'

type Identity<T extends string> = string & {readonly identity: T}
export type ProductId = Identity<'product'>
export type VariantId = Identity<'variant'>
export type FixedPackId = Identity<'fixed-pack'>
export type CatalogRevision = Identity<'catalog-revision'>
export type DefinitionRevision = Identity<'definition-revision'>
export type CommerceKind = 'standard' | 'tester'
export interface SaleConfiguration {
  readonly regularPrice: number
  readonly salePrice: number | null
  readonly saleStartsAt: string | null
  readonly saleEndsAt: string | null
}
export interface SalePricingSnapshot extends SaleConfiguration {
  readonly effectivePrice: number
  readonly saleActive: boolean
  readonly pricingAt: string
  readonly validUntil: string | null
}
export interface ReviewedVariant extends SalePricingSnapshot {
  readonly id: VariantId
  readonly optionName: string
  readonly optionValue: string
  readonly sku: string
  readonly stockQuantity: number
  readonly active: boolean
  readonly displayOrder: number
  readonly standardManualAvailable?: boolean
}
export interface ReviewedProduct {
  readonly id: ProductId
  readonly commerceKind: CommerceKind
  readonly catalogRevision: CatalogRevision
  readonly testerAvailable?: boolean
  readonly variants: readonly ReviewedVariant[]
}
export interface ReviewedFixedPack extends SalePricingSnapshot {
  readonly id: FixedPackId
  readonly commerceKind: 'tester_pack'
  readonly mode: 'fixed'
  readonly catalogRevision: CatalogRevision
  readonly definitionRevision: DefinitionRevision
  readonly fixedRegularPrice: number
  readonly fixedSalePrice: number | null
  readonly fixedSaleStartsAt: string | null
  readonly fixedSaleEndsAt: string | null
}
export interface SaleEdit {
  // Text preserves the input format: percentages/exponents are never coerced.
  readonly salePrice?: string | null
  readonly saleStartsAt?: string | null
  readonly saleEndsAt?: string | null
}
export type BulkSaleIdentity =
  | {readonly kind: 'variant'; readonly productId: ProductId; readonly variantId: VariantId; readonly commerceKind: CommerceKind}
  | {readonly kind: 'fixed-pack'; readonly packId: FixedPackId; readonly commerceKind: 'tester_pack'}
export type BulkSaleSelection = BulkSaleIdentity & {readonly edit: SaleEdit}
export interface CanonicalSaleVariant {
  readonly id: VariantId
  readonly optionName: string
  readonly optionValue: string
  readonly sku: string
  readonly regularPrice: number
  readonly salePrice: number | null
  readonly saleStartsAt?: string | null
  readonly saleEndsAt?: string | null
  readonly stockQuantity: number
  readonly active: boolean
  readonly displayOrder: number
  readonly standardManualAvailable?: boolean
  readonly available?: boolean // Tester manual intent only; never standard derived availability.
}
export interface ProductSalePayload {
  readonly variants: readonly CanonicalSaleVariant[]
  readonly expectedRevision: CatalogRevision
}
export interface FixedPackSalePayload {
  readonly product: Readonly<Record<string, never>>
  readonly definition: {
    readonly fixedSalePrice: number | null
    readonly fixedSaleStartsAt?: string | null
    readonly fixedSaleEndsAt?: string | null
  }
  readonly expectedRevision: CatalogRevision
  readonly expectedDefinitionRevision: DefinitionRevision
}
export interface PlannedSaleRow {
  readonly key: string
  readonly identity: BulkSaleIdentity
  readonly before: SalePricingSnapshot
  readonly intended: SaleConfiguration
}
interface GroupBase {
  readonly key: string
  readonly rows: readonly PlannedSaleRow[]
  readonly requiresScheduling: boolean
}
export type BulkSaleGroup =
  | (GroupBase & {readonly kind: 'product'; readonly id: ProductId; readonly commerceKind: CommerceKind; readonly payload: ProductSalePayload})
  | (GroupBase & {readonly kind: 'fixed-pack'; readonly id: FixedPackId; readonly payload: FixedPackSalePayload})
export interface BulkSalePlan {readonly groups: readonly BulkSaleGroup[]; readonly rowCount: number}
export type SaleReconciliation = {readonly kind: 'matches' | 'retry-allowed' | 'review-required'; readonly message: string}

export function bulkSaleRequestOptions(options: {requestId?: string; signal?: AbortSignal} = {}): Pick<RequestInit, 'headers' | 'signal'> {
  if (options.requestId !== undefined && !/^[A-Za-z0-9_-]{8,80}$/.test(options.requestId)) throw new BulkSaleValidationError('Invalid request correlation identifier.')
  return {signal: options.signal, headers: options.requestId ? {'X-Request-ID': options.requestId} : {}}
}

export class BulkSaleValidationError extends Error {
  readonly code = 'INVALID_BULK_SALE'
  readonly rowKey?: string
  constructor(message: string, rowKey?: string) {super(message); this.rowKey = rowKey}
}
function fail(message: string): never {throw new BulkSaleValidationError(message)}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : fail('An authoritative catalog object is required.')
function uuid<T extends string>(value: unknown): Identity<T> {
  if (typeof value !== 'string' || !/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i.test(value)) fail('A valid existing catalog UUID is required.')
  return (value as string).toLowerCase() as Identity<T>
}
function revision<T extends 'catalog-revision' | 'definition-revision'>(value: unknown): Identity<T> {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > 9223372036854775807n) fail('A captured catalog revision is required.')
  return value as Identity<T>
}
function money(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 9999999999.99 || !/^\d+(\.\d{1,2})?$/.test(String(value))) fail('Invalid catalog PKR amount.')
  return value as number
}
function timestamp(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return fail('An explicit offset-aware timestamp or null is required.')
  saleTimestampMicros(value)
  return value
}
function configuration(value: Record<string, unknown>): SaleConfiguration {
  const result = {regularPrice: money(value.regularPrice), salePrice: value.salePrice === null ? null : money(value.salePrice),
    saleStartsAt: timestamp(value.saleStartsAt), saleEndsAt: timestamp(value.saleEndsAt)}
  if (result.salePrice === null && (result.saleStartsAt !== null || result.saleEndsAt !== null)) fail('A configured schedule requires a sale price.')
  validatedSalePatch(result, {})
  return result
}
function pricing(value: Record<string, unknown>): SalePricingSnapshot {
  const config = configuration(value), effectivePrice = money(value.effectivePrice)
  if (typeof value.saleActive !== 'boolean') fail('An authoritative effective-price snapshot is required.')
  const pricingAt = timestamp(value.pricingAt)
  if (pricingAt === null) fail('A database pricing instant is required.')
  return {...config, effectivePrice, saleActive: value.saleActive as boolean, pricingAt: pricingAt as string, validUntil: timestamp(value.validUntil)}
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2147483647) fail('Invalid canonical inventory/display value.')
  return value as number
}
function label(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 80) fail('A canonical SKU/option is required.')
  return value as string
}
export function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {for (const item of Object.values(value)) immutable(item); Object.freeze(value)}
  return value
}
export function reviewProductDetail(detail: unknown): ReviewedProduct {
  const p = object(detail), id = uuid<'product'>(p.id)
  if (p.commerceKind !== 'standard' && p.commerceKind !== 'tester') fail('Only standard products and standalone testers have eligible variants.')
  if (!Array.isArray(p.variants) || !p.variants.length) fail('Canonical variants are required.')
  const kind = p.commerceKind as CommerceKind, seen = new Set<string>()
  const variants = (p.variants as unknown[]).map(raw => {
    const v = object(raw), variantId = uuid<'variant'>(v.id)
    if (seen.has(variantId) || v.productId != null && uuid<'product'>(v.productId) !== id) fail('Duplicate or foreign canonical variant.')
    seen.add(variantId)
    if (typeof v.active !== 'boolean' || kind === 'standard' && typeof v.standardManualAvailable !== 'boolean') fail('Canonical active/manual availability is required.')
    return {...pricing(v), id: variantId, optionName: label(v.optionName), optionValue: label(v.optionValue), sku: label(v.sku),
      stockQuantity: integer(v.stockQuantity), active: v.active as boolean, displayOrder: integer(v.displayOrder),
      ...(kind === 'standard' ? {standardManualAvailable: v.standardManualAvailable as boolean} : {})}
  })
  if (kind === 'tester' && (variants.length !== 1 || variants[0].optionName !== 'Size' || variants[0].optionValue !== '5 ml' || typeof p.testerAvailable !== 'boolean')) fail('A tester requires its independent 5 ml variant and manual availability.')
  return immutable({id, commerceKind: kind, catalogRevision: revision<'catalog-revision'>(p.catalogRevision), variants,
    ...(kind === 'tester' ? {testerAvailable: p.testerAvailable as boolean} : {})})
}
export function reviewFixedPackDetail(detail: unknown): ReviewedFixedPack {
  const p = object(detail)
  if (p.commerceKind !== 'tester_pack' || p.mode !== 'fixed') fail('Configurable pack parents cannot have independent sale prices.')
  const config = pricing({...p, regularPrice: p.fixedRegularPrice, salePrice: p.fixedSalePrice, saleStartsAt: p.fixedSaleStartsAt, saleEndsAt: p.fixedSaleEndsAt})
  return immutable({...config, fixedRegularPrice: config.regularPrice, fixedSalePrice: config.salePrice, fixedSaleStartsAt: config.saleStartsAt, fixedSaleEndsAt: config.saleEndsAt,
    id: uuid<'fixed-pack'>(p.id), commerceKind: 'tester_pack', mode: 'fixed', catalogRevision: revision<'catalog-revision'>(p.catalogRevision), definitionRevision: revision<'definition-revision'>(p.definitionRevision)})
}
export function parseFixedSaleAmount(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > 32 || !/^\d+(\.\d{1,2})?$/.test(value)) return fail('Enter a fixed PKR amount with at most two decimal places; percentages and scientific notation are unsupported.')
  const [whole, fraction = ''] = value.split('.'), cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (cents <= 0n || cents > 999999999999n) fail('Sale amount is outside the existing positive PKR bounds.')
  return Number(value) // Parse only; never round, discount, or calculate a price.
}
function salePatch(before: SaleConfiguration, input: SaleEdit) {
  const edit = object(input), keys = Object.keys(edit)
  if (!keys.length || keys.some(key => !['salePrice','saleStartsAt','saleEndsAt'].includes(key) || edit[key] === undefined)) fail('Provide only explicit sale price/schedule edits; omit untouched fields.')
  const patch = {...(Object.hasOwn(edit, 'salePrice') ? {salePrice: parseFixedSaleAmount(edit.salePrice)} : {}),
    ...(Object.hasOwn(edit, 'saleStartsAt') ? {saleStartsAt: timestamp(edit.saleStartsAt)} : {}),
    ...(Object.hasOwn(edit, 'saleEndsAt') ? {saleEndsAt: timestamp(edit.saleEndsAt)} : {})}
  const result = validatedSalePatch(before, patch), intended = {...before, ...result}
  const requiresScheduling = result.saleStartsAt != null || result.saleEndsAt != null ||
    (before.saleStartsAt !== null || before.saleEndsAt !== null) && result.salePrice !== null && result.salePrice !== before.salePrice
  return {patch: result, intended, requiresScheduling}
}
const order = (a: {key: string}, b: {key: string}) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0
export function prepareBulkSalePlan(selections: readonly BulkSaleSelection[], productDetails: readonly unknown[], packDetails: readonly unknown[] = []): BulkSalePlan {
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > 50) fail('Select between 1 and 50 eligible rows.')
  const products = productDetails.map(reviewProductDetail), packs = packDetails.map(reviewFixedPackDetail), owners = new Set<string>()
  const parentIds = [...products.map(p => p.id), ...packs.map(p => p.id)]
  if (new Set(parentIds).size !== parentIds.length) fail('Duplicate reviewed parent identity.')
  for (const p of products) for (const v of p.variants) {if (owners.has(v.id)) fail('Duplicate canonical variant ownership.'); owners.add(v.id)}
  const seen = new Set<string>(), groups = new Map<string, BulkSaleGroup>()
  for (const selection of selections) {
    const s = object(selection), kind = s.kind, id = uuid(kind === 'variant' ? s.variantId : s.packId), key = `${kind}:${id}`
    try {
      if (seen.has(key)) fail('Duplicate selected canonical identity.')
      seen.add(key)
      if (kind === 'variant') {
        if (Object.keys(s).some(k => !['kind','productId','variantId','commerceKind','edit'].includes(k))) fail('Unexpected variant selection field.')
        const p = products.find(p => p.id === uuid<'product'>(s.productId)), v = p?.variants.find(v => v.id === id)
        if (!p || !v || p.commerceKind !== s.commerceKind) fail('Unknown variant or mismatched declared parent/kind.')
        const {patch, intended, requiresScheduling} = salePatch(v, selection.edit), groupKey = `product:${p.id}`
        const variant: CanonicalSaleVariant = {id: v.id, optionName: v.optionName, optionValue: v.optionValue, sku: v.sku,
          regularPrice: v.regularPrice, stockQuantity: v.stockQuantity, active: v.active, displayOrder: v.displayOrder, ...patch,
          ...(p.commerceKind === 'standard' ? {standardManualAvailable: v.standardManualAvailable!} : {available: p.testerAvailable!})}
        const row: PlannedSaleRow = {key, identity: {kind: 'variant', productId: p.id, variantId: v.id, commerceKind: p.commerceKind}, before: v, intended}
        const prior = groups.get(groupKey)
        if (prior && prior.kind !== 'product') fail('Invalid group identity.')
        groups.set(groupKey, {kind: 'product', id: p.id, commerceKind: p.commerceKind, key: groupKey, requiresScheduling: Boolean(prior?.requiresScheduling || requiresScheduling),
          rows: [...prior?.rows ?? [], row].sort(order), payload: {expectedRevision: p.catalogRevision, variants: [...(prior?.kind === 'product' ? prior.payload.variants : []), variant].sort((a,b) => order({key:a.id},{key:b.id}))}})
      } else if (kind === 'fixed-pack') {
        if (s.commerceKind !== 'tester_pack' || Object.keys(s).some(k => !['kind','packId','commerceKind','edit'].includes(k))) fail('Invalid fixed-pack selection.')
        const p = packs.find(p => p.id === id)
        if (!p) fail('Unknown fixed tester pack.')
        const {patch, intended, requiresScheduling} = salePatch(p, selection.edit)
        groups.set(key, {kind: 'fixed-pack', id: p.id, key, requiresScheduling, rows: [{key, identity: {kind: 'fixed-pack', packId: p.id, commerceKind: 'tester_pack'}, before: p, intended}],
          payload: {product: {}, expectedRevision: p.catalogRevision, expectedDefinitionRevision: p.definitionRevision,
            definition: {fixedSalePrice: patch.salePrice, ...(Object.hasOwn(patch,'saleStartsAt') ? {fixedSaleStartsAt: patch.saleStartsAt} : {}), ...(Object.hasOwn(patch,'saleEndsAt') ? {fixedSaleEndsAt: patch.saleEndsAt} : {})}}})
      } else fail('Unsupported bulk sale identity.')
    } catch (error) {throw new BulkSaleValidationError(error instanceof Error ? error.message : 'Invalid sale row.', key)}
  }
  const plan = {groups: [...groups.values()].sort(order), rowCount: selections.length}
  for (const group of plan.groups) if (new TextEncoder().encode(JSON.stringify(group.payload)).length > 32768) fail('A sale group exceeds 32 KiB; reduce the selection before review.')
  return immutable(plan)
}
const sameTime = (a: string | null, b: string | null) => a === null || b === null ? a === b : saleTimestampMicros(a) === saleTimestampMicros(b)
function matches(a: SaleConfiguration, b: SaleConfiguration) {
  return a.regularPrice === b.regularPrice && a.salePrice === b.salePrice && sameTime(a.saleStartsAt,b.saleStartsAt) && sameTime(a.saleEndsAt,b.saleEndsAt)
}
export function reconcileSaleGroup(group: BulkSaleGroup, detail: unknown): SaleReconciliation {
  const current = group.kind === 'product' ? reviewProductDetail(detail) : reviewFixedPackDetail(detail)
  if (current.id !== group.id || group.kind === 'product' && current.commerceKind !== group.commerceKind) fail('Authoritative detail does not match the selected group.')
  const configs = group.rows.map(row => 'variants' in current ? current.variants.find(v => row.identity.kind === 'variant' && v.id === row.identity.variantId) : current)
  if (configs.some(config => config == null)) return {kind: 'review-required', message: 'A selected identity is no longer present. Load a fresh snapshot and review the selection.'}
  const equal = group.rows.every((row,index) => matches(configs[index]!,row.intended))
  if (equal) return {kind: 'matches', message: 'Current state matches; original response unconfirmed.'}
  const unchanged = current.catalogRevision === group.payload.expectedRevision &&
    (group.kind !== 'fixed-pack' || 'definitionRevision' in current && current.definitionRevision === group.payload.expectedDefinitionRevision)
  return unchanged ? {kind: 'retry-allowed', message: 'Captured revisions remain unchanged. An explicit retry may use the original request.'} :
    {kind: 'review-required', message: 'Catalog changed. Load a fresh snapshot, review and reconfirm; the captured revision has not been replaced.'}
}
export function assertSaleAcknowledgement(group: BulkSaleGroup, response: unknown): void {
  const data = object(response)
  if (uuid(data.id) !== group.id) fail('Unexpected mutation acknowledgement identity.')
  revision(data.catalogRevision)
  if (group.kind === 'fixed-pack') revision(data.definitionRevision)
  else if (!Array.isArray(data.variants) || group.rows.some(row => !(data.variants as unknown[]).some(v => uuid(object(v).id) === (row.identity.kind === 'variant' ? row.identity.variantId : '')))) fail('Mutation acknowledgement lacks selected variants.')
}
