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
