import { adminAuthClient } from './adminAuthClient'
import type {AdminSaleSnapshot} from './saleSchedule'
import {bulkSaleRequestOptions} from './bulkSaleContract.ts'
import type {FixedPackId, FixedPackSalePayload} from './bulkSaleContract'
export interface TesterOption extends AdminSaleSnapshot { testerVariantId: string; productId: string; name: string; sku: string; price: number; stockQuantity: number; publicEligible: boolean; sourceProductId?: string | null }
export interface PackMember { testerVariantId: string; quantityPerPack?: number; active?: boolean; displayOrder: number; name?: string; stockQuantity?: number }
export interface TesterPack extends AdminSaleSnapshot {
  id: string; name: string; slug: string; sku: string; image: string; gallery: string[]; description: string; shortDescription: string; scentFamily: string;
  categoryId: string | null; status: string; active: boolean; mode: 'fixed' | 'configurable';
  catalogRevision: string; definitionRevision: string; minimumUnits: number | null; maximumUnits: number | null;
  fixedRegularPrice: number | null; fixedSalePrice: number | null; manualAvailable: boolean; available: boolean; availablePackCount: number | null;
  fixedSaleStartsAt?: string | null; fixedSaleEndsAt?: string | null; configuredSalePrice?: number | null
  components: PackMember[]; allowedVariants: PackMember[]; diagnostics: { structurallyComplete: boolean; hiddenOrInactiveCount: number }
}
export interface PackSave { product: Record<string, unknown>; definition: Record<string, unknown>; expectedRevision?: string; expectedDefinitionRevision?: string }
const base='/v2/admin/tester-packs'
export const testerPacksApi={
 list(page=1) { return adminAuthClient.protectedRequest<{items:TesterPack[];totalPages:number}>(`${base}?page=${page}&pageSize=25`) },
 get(id:string,options?:{signal?:AbortSignal}) { return adminAuthClient.protectedRequest<TesterPack>(`${base}/${encodeURIComponent(id)}`,options) },
 testers() { return adminAuthClient.protectedRequest<TesterOption[]>(`${base}/tester-options`) },
 save(id:string|null,body:PackSave) { return adminAuthClient.protectedRequest<TesterPack>(id?`${base}/${encodeURIComponent(id)}`:base,{method:id?'PATCH':'POST',body:JSON.stringify(body)}) },
 updateSalePricing(id:FixedPackId,body:FixedPackSalePayload,options?:{requestId?:string;signal?:AbortSignal}) {
  const d=body.definition
  return adminAuthClient.protectedRequest<TesterPack>(`${base}/${encodeURIComponent(id)}`,{...bulkSaleRequestOptions(options),method:'PATCH',body:JSON.stringify({
   product:{},definition:{fixedSalePrice:d.fixedSalePrice,...(Object.hasOwn(d,'fixedSaleStartsAt')?{fixedSaleStartsAt:d.fixedSaleStartsAt}:{}),...(Object.hasOwn(d,'fixedSaleEndsAt')?{fixedSaleEndsAt:d.fixedSaleEndsAt}:{})},
   expectedRevision:body.expectedRevision,expectedDefinitionRevision:body.expectedDefinitionRevision,
  })})
 },
  archive(pack:TesterPack) { return adminAuthClient.protectedRequest<TesterPack>(`${base}/${encodeURIComponent(pack.id)}/archive`,{method:'POST',body:JSON.stringify({expectedRevision:pack.catalogRevision,expectedDefinitionRevision:pack.definitionRevision})}) },
}

const publicBase = `${import.meta.env?.VITE_API_URL || '/api'}/v2/public/tester-packs`

export interface PublicTesterOption {
  testerVariantId: string
  productId: string
  name: string
  sku: string
  image?: string
  volumeMl: number
  regularPrice: number
  salePrice: number | null
  effectivePrice?: number
  saleActive?: boolean
  stockQuantity: number
  quantityPerPack?: number
  active?: boolean
  displayOrder: number
}

export interface PublicTesterPack {
  id: string
  packId: string
  commerceKind: 'tester_pack'
  name: string
  slug: string
  sku: string
  image: string
  gallery: string[]
  description: string
  shortDescription: string
  scentFamily: string
  categoryId: string | null
  status: 'Published'
  active: boolean
  catalogRevision: string
  definitionRevision: string
  mode: 'fixed' | 'configurable'
  minimumUnits: number | null
  maximumUnits: number | null
  fixedRegularPrice: number | null
  fixedSalePrice: number | null
  regularPrice: number | null
  salePrice?: number | null
  effectivePrice?: number
  saleActive?: boolean
  manualAvailable: boolean
  available: boolean
  availablePackCount: number | null
  components: PublicTesterOption[]
  allowedVariants: PublicTesterOption[]
}

export const publicTesterPacksApi = {
  async list(page = 1, pageSize = 25): Promise<{ items: PublicTesterPack[]; total: number; totalPages: number }> {
    const res = await fetch(`${publicBase}?page=${page}&pageSize=${pageSize}`)
    if (!res.ok) throw new Error('Failed to load tester packs')
    const json = await res.json()
    return json.data
  },
  async get(id: string): Promise<PublicTesterPack> {
    const res = await fetch(`${publicBase}/${encodeURIComponent(id)}`)
    if (!res.ok) throw new Error('Failed to load tester pack')
    const json = await res.json()
    return json.data
  },
}
