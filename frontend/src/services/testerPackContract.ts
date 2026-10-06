import type { PackMember, PackSave } from './testerPacksApi'
export interface PackDraft {
  id: string | null; name: string; slug: string; sku: string; image: string; gallery: string;
  description: string; shortDescription: string; scentFamily: string; categoryId: string; status: string;
  mode: 'fixed' | 'configurable'; regular: string; sale: string; maximum: string; manualAvailable: boolean;
  members: PackMember[]; catalogRevision?: string; definitionRevision?: string
}
export function toPackPayload(draft: PackDraft): PackSave {
  if(draft.members.length>100) throw new Error('A pack definition supports at most 100 tester memberships.')
  const definition:Record<string,unknown>={mode:draft.mode,manualAvailable:draft.manualAvailable}
  if(draft.mode==='fixed') {
    definition.fixedRegularPrice=Number(draft.regular);definition.fixedSalePrice=draft.sale?Number(draft.sale):null
    definition.components=draft.members.map(m=>({testerVariantId:m.testerVariantId,quantityPerPack:m.quantityPerPack??1,displayOrder:m.displayOrder}))
  } else {
    definition.minimumUnits=2;definition.maximumUnits=draft.maximum?Number(draft.maximum):null
    definition.allowedVariants=draft.members.map(m=>({testerVariantId:m.testerVariantId,active:m.active??true,displayOrder:m.displayOrder}))
  }
  const payload:PackSave={product:{name:draft.name,slug:draft.slug,sku:draft.sku,image:draft.image,gallery:draft.gallery.split('\n').map(v=>v.trim()).filter(Boolean),description:draft.description,shortDescription:draft.shortDescription,scentFamily:draft.scentFamily,categoryId:draft.categoryId||null,status:draft.status},definition,...(draft.id?{expectedRevision:draft.catalogRevision,expectedDefinitionRevision:draft.definitionRevision}:{})}
  if(new TextEncoder().encode(JSON.stringify(payload)).length>32768) throw new Error('Catalog request exceeds 32 KiB.')
  return payload
}
