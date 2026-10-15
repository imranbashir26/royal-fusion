import {ProductApiError} from './productAdminService.js'

const unavailable=()=>new ProductApiError(503,'CATALOG_PRICING_UNAVAILABLE','Catalog pricing is temporarily unavailable.')
const iso=value=>value instanceof Date?value.toISOString():value
function amount(value){
 if(!/^\d+(\.\d{1,2})?$/.test(String(value))||!Number.isFinite(Number(value))||Number(value)<=0||Number(value)>9999999999.99)throw unavailable()
 return Number(value)
}
export function priceDto(row,pricingAt){
 const regularPrice=amount(row.regularPrice),effectivePrice=amount(row.effectivePrice)
 if(typeof row.saleActive!=='boolean'||!Number.isFinite(Date.parse(iso(pricingAt)))||
  (row.validUntil!=null&&!Number.isFinite(Date.parse(iso(row.validUntil))))||
  (row.saleActive?(effectivePrice>=regularPrice||effectivePrice!==amount(row.salePrice)):effectivePrice!==regularPrice))throw unavailable()
 return {regularPrice,effectivePrice,price:effectivePrice,salePrice:row.saleActive?effectivePrice:null,saleActive:row.saleActive,pricingAt:iso(pricingAt),validUntil:iso(row.validUntil)??null}
}
// One bounded RPC per batch, never a per-product resolver or a JavaScript sale clock.
export async function batchSalePrices(client,variantIds=[],packIds=[]){
 const variants=new Map(),packs=new Map(),instants=[],deadlines=[]
 const vs=[...new Set(variantIds)],ps=[...new Set(packIds)]
 for(let offset=0;offset<Math.max(vs.length,ps.length);offset+=100){
  const wantedV=vs.slice(offset,offset+100),wantedP=ps.slice(offset,offset+100)
  let result
  try{result=await client.rpc('catalog_sale_prices_009',{p_variant_ids:wantedV,p_pack_ids:wantedP})}catch{throw unavailable()}
  const data=result?.data
  if(result?.error||!data||!Array.isArray(data.variants)||!Array.isArray(data.packs)||!Number.isFinite(Date.parse(data.pricingAt)))throw unavailable()
  instants.push(Date.parse(data.pricingAt))
  for(const [rows,ids,key,target]of [[data.variants,wantedV,'variantId',variants],[data.packs,wantedP,'packId',packs]]){
   if(rows.length!==ids.length)throw unavailable()
   for(const row of rows){
    if(!ids.includes(row[key])||target.has(row[key]))throw unavailable()
    const value=row.mode==='configurable'?{effectivePrice:null,price:null,salePrice:null,saleActive:false,pricingAt:data.pricingAt,validUntil:null}:priceDto(row,data.pricingAt)
    target.set(row[key],value)
    if(value.validUntil)deadlines.push(Date.parse(value.validUntil))
   }
  }
 }
 // If chunking crosses any returned boundary, discard the whole response. No local repricing.
 if(deadlines.some(time=>time<=Math.max(...instants)))throw unavailable()
 return {variants,packs}
}

export class CatalogPricingService{
 constructor(client){this.client=client}
 async variants(ids){
  if(!this.client)throw unavailable()
  let result
  try{
   result=await this.client.from('storefront_variant_prices').select('id,product_id,regular_price,sale_price,effective_price,sale_active,pricing_at,valid_until')
    .in('id',ids).eq('active',true).eq('available',true).order('id',{ascending:true})
  }catch{throw unavailable()}
  if(result.error)throw unavailable()
  const rows=result.data??[],parents=[...new Set(rows.map(v=>v.product_id))]
  if(!parents.length)return {items:[],currency:'PKR'}
  let products
  try{products=await this.client.from('products').select('id').in('id',parents).in('commerce_kind',['standard','tester']).eq('status','Published').eq('active',true)}catch{throw unavailable()}
  if(products.error)throw unavailable()
  const visible=new Set((products.data??[]).map(p=>p.id))
  return {items:rows.filter(row=>visible.has(row.product_id)).map(row=>({variantId:row.id,productId:row.product_id,...priceDto({regularPrice:row.regular_price,salePrice:row.sale_price,effectivePrice:row.effective_price,saleActive:row.sale_active,validUntil:row.valid_until},row.pricing_at)})),currency:'PKR'}
 }
}
