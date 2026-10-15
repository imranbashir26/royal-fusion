import assert from 'node:assert/strict'
import test from 'node:test'
import {randomUUID} from 'node:crypto'
import {catalogVariantSchema,toCatalogVariants} from '../schemas/catalogVariants.js'
import {createProductSchema,updateProductSchema} from '../schemas/productAdmin.js'
import {createPackSchema,updatePackSchema} from '../schemas/testerCatalog.js'
import {timestampMicros} from '../schemas/saleSchedule.js'
import {assertSchedulingDisabled,ProductAdminService} from '../services/productAdminService.js'
import {batchSalePrices,priceDto} from '../services/catalogPricingService.js'
import {toProductColumns} from '../mappers/productAdminMapper.js'

const start='2099-01-01T00:00:00Z',end='2099-02-01T00:00:00+00:00'
const variant=(changes={})=>({optionName:'Size',optionValue:'50 ml',sku:'RF-SCHEDULE',regularPrice:2900,salePrice:2450,stockQuantity:12,...changes})
const product={name:'Sale',slug:'sale',sku:'RF-SALE',price:2900,scentFamily:'Woody',image:'/fixture.webp'}
const {price:_legacyProductPrice,...packProduct}=product
const fixed=(changes={})=>({product:packProduct,definition:{mode:'fixed',fixedRegularPrice:2900,fixedSalePrice:2450,...changes}})
for(const [name,window]of [['indefinite',{}],['future',{saleStartsAt:start,saleEndsAt:end}],['start only',{saleStartsAt:start}],['end only',{saleEndsAt:end}],['offset',{saleStartsAt:'2099-01-01T05:00:00+05:00',saleEndsAt:end}],['microseconds',{saleStartsAt:'2099-01-01T00:00:00.000001Z',saleEndsAt:'2099-01-01T00:00:00.000002Z'}]]){
 test('Schedule validation preserves '+name,()=>{
  const parsed=catalogVariantSchema.parse(variant(window))
  for(const [key,value]of Object.entries(window))assert.equal(parsed[key],value)
  assert.equal(createProductSchema.safeParse({...product,variants:[variant(window)]}).success,true)
  const dates=Object.fromEntries(Object.entries(window).map(([k,v])=>['fixed'+k[0].toUpperCase()+k.slice(1),v]))
  assert.equal(createPackSchema.safeParse(fixed(dates)).success,true)
 })
}
test('Omission and null remain distinct; legacy zero clearing and variations stay compatible',()=>{
 const omitted=catalogVariantSchema.parse(variant())
 assert.equal(Object.hasOwn(omitted,'saleStartsAt'),false)
 assert.equal(catalogVariantSchema.parse(variant({salePrice:0})).salePrice,null)
 const cleared=catalogVariantSchema.parse(variant({salePrice:null,saleStartsAt:null,saleEndsAt:null}))
 assert.deepEqual([cleared.salePrice,cleared.saleStartsAt,cleared.saleEndsAt],[null,null,null])
 const [v]=toCatalogVariants({variations:[{name:'50 ml',price:2900,salePrice:2450,saleStartsAt:start,saleEndsAt:end,sku:'RF',stock:2,active:true}]})
 assert.equal(v.saleStartsAt,start);assert.equal(updateProductSchema.safeParse({description:'Only metadata'}).success,true)
 assert.equal('saleStartsAt' in toProductColumns({variations:[{saleStartsAt:start,saleEndsAt:end,name:'50 ml'}]}).variations[0],false)
 assert.equal(updateProductSchema.safeParse({saleStartsAt:start}).success,false)
 assert.equal(timestampMicros('2099-01-01T05:00:00+05:00'),timestampMicros(start))
})
for(const value of ['2099-02-30T00:00:00Z','2099-01-01','2099-01-01T00:00:00','2099-01-01T00:00Z','2099-01-01T00:00:00.1234567Z','infinity','0000-01-01T00:00:00Z']){
 test('Invalid schedule timestamp rejects '+value,()=>assert.equal(catalogVariantSchema.safeParse(variant({saleStartsAt:value})).success,false))
}
test('Amounts, inverted windows, absent sales, and configurable own prices reject',()=>{
 for(const changes of [{salePrice:2900},{salePrice:3000},{salePrice:-1},{salePrice:2450.001},{regularPrice:0},{saleStartsAt:end,saleEndsAt:start},{saleStartsAt:start,saleEndsAt:start},{salePrice:null,saleEndsAt:end}])assert.equal(catalogVariantSchema.safeParse(variant(changes)).success,false)
 for(const changes of [{fixedSalePrice:2900},{fixedSalePrice:0},{fixedSalePrice:1.001},{fixedSaleStartsAt:end,fixedSaleEndsAt:start},{fixedSalePrice:null,fixedSaleStartsAt:start}])assert.equal(createPackSchema.safeParse(fixed(changes)).success,false)
 assert.equal(createPackSchema.safeParse({product:packProduct,definition:{mode:'configurable',fixedSaleStartsAt:start}}).success,false)
 assert.equal(updatePackSchema.safeParse({product:{},definition:{fixedSaleStartsAt:start},expectedRevision:'1',expectedDefinitionRevision:'1'}).success,true,'Partial validation can defer the stored amount to the service/SQL')
})
test('New scheduling fields cannot bypass the constant API activation gate',()=>{
 for(const input of [{variants:[variant({saleStartsAt:start})]},{variations:[{saleEndsAt:end}]},{definition:{fixedSaleStartsAt:start}},{definition:{fixedSaleEndsAt:end}}])assert.throws(()=>assertSchedulingDisabled(input),{code:'SALE_SCHEDULING_DISABLED',status:409})
 for(const input of [{name:'Metadata'},{variants:[variant()]},{variants:[variant({salePrice:null,saleStartsAt:null,saleEndsAt:null})]},{definition:{fixedSalePrice:200}}])assert.doesNotThrow(()=>assertSchedulingDisabled(input))
})
test('DTO trusts database activation; legacy salePrice exposes only an active discount',()=>{
 for(const active of [true,false]){
  const dto=priceDto({regularPrice:'2900.00',salePrice:'2450.00',effectivePrice:active?'2450.00':'2900.00',saleActive:active,validUntil:start},'2098-01-01T00:00:00Z')
  assert.equal(dto.salePrice,active?2450:null);assert.equal(dto.price,dto.effectivePrice);assert.equal(dto.regularPrice,2900)
  assert.equal('configuredSalePrice' in dto,false)
 }
 assert.throws(()=>priceDto({regularPrice:2900,salePrice:2450,effectivePrice:2450,saleActive:false},start),{code:'CATALOG_PRICING_UNAVAILABLE'})
})
test('Batched pack/component resolution is bounded and independent of product count',async()=>{
 const ids=Array.from({length:250},()=>randomUUID()),pack=randomUUID(),calls=[]
 const client={async rpc(name,args){calls.push({name,args});return {data:{pricingAt:'2098-01-01T00:00:00Z',variants:args.p_variant_ids.map(variantId=>({variantId,regularPrice:250,salePrice:200,effectivePrice:250,saleActive:false,validUntil:start})),packs:args.p_pack_ids.map(packId=>({packId,mode:'fixed',regularPrice:450,salePrice:400,effectivePrice:450,saleActive:false,validUntil:start}))},error:null}}}
 const prices=await batchSalePrices(client,ids,[pack])
 assert.equal(calls.length,3);assert(calls.every(c=>c.name==='catalog_sale_prices_009'&&c.args.p_variant_ids.length<=100&&c.args.p_pack_ids.length<=100))
 assert.equal(prices.variants.size,250);assert.equal(prices.packs.get(pack).effectivePrice,450)
})
test('Chunk-boundary crossings, incomplete pricing and privileged diagnostics fail closed',async()=>{
 let calls=0
 const ids=Array.from({length:101},()=>randomUUID())
 await assert.rejects(()=>batchSalePrices({async rpc(_name,args){calls++;return {data:{pricingAt:calls===1?'2098-01-01T00:00:00Z':start,variants:args.p_variant_ids.map(variantId=>({variantId,regularPrice:250,salePrice:200,effectivePrice:250,saleActive:false,validUntil:start})),packs:[]}}}},ids),{code:'CATALOG_PRICING_UNAVAILABLE'})
 for(const result of [{error:{message:'SECRET credential SQL'}},{data:{pricingAt:start,variants:[],packs:[]}}])await assert.rejects(()=>batchSalePrices({rpc:async()=>result},[randomUUID()]),e=>e.code==='CATALOG_PRICING_UNAVAILABLE'&&!e.message.includes('SECRET'))
})

// Pure DTO/error/batching fixtures. Real pricing, RBAC, and RPC ACLs are checked
// separately in scheduled-sales-api-native.test.js against owned PostgreSQL 17.
function adminPricingFixture({count=1,reply,revise=false,status='Draft',active=false}={}) {
 const id=randomUUID(),calls=[]
 const product={id,commerce_kind:'standard',price:2900,status,active,catalog_revision:'7'}
 const variants=Array.from({length:count},(_,display_order)=>({id:randomUUID(),product_id:id,
  option_name:'Size',option_value:String(display_order),sku:randomUUID(),regular_price:2900,sale_price:2450.25,
  sale_starts_at:start,sale_ends_at:end,stock_quantity:0,active:false,available:false,
  standard_manual_available:false,display_order}))
 let batches=0
 const client={from(table){
  calls.push({table})
  const filters=[]
  const q={select(){return q},eq(key,value){filters.push(row=>row[key]===value);return q},
   in(key,values){filters.push(row=>values.includes(row[key]));return q},order(){return q},
   maybeSingle(){q.single=true;return q},then(resolve,reject){
    const rows=(table==='products'?[{...product,catalog_revision:revise&&batches?'8':'7'}]:variants).filter(row=>filters.every(f=>f(row)))
    return Promise.resolve({data:q.single?rows[0]??null:rows,error:null}).then(resolve,reject)
   }}
  return q
 },async rpc(name,args){
  calls.push({name,args});batches++
  if(reply)return reply(args,batches)
  return {data:{pricingAt:`2098-01-01T00:00:0${batches}Z`,packs:[],variants:args.p_variant_ids.map(variantId=>({
   variantId,regularPrice:2900,salePrice:2450.25,effectivePrice:2900,saleActive:false,validUntil:start,
  }))}}
 }}
 return {id,variants,calls,service:new ProductAdminService(client)}
}

test('Admin detail preserves configuration, IDs, revision and manual inventory while adding only authoritative fields',async()=>{
 const f=adminPricingFixture(),dto=await f.service.getWithPricing(f.id),v=dto.variants[0]
 assert.equal(dto.catalogRevision,'7');assert.equal(dto.status,'Draft');assert.equal(dto.active,false)
 assert.deepEqual([v.id,v.regularPrice,v.salePrice,v.saleStartsAt,v.saleEndsAt],[f.variants[0].id,2900,2450.25,start,end])
 assert.deepEqual([v.effectivePrice,v.saleActive,v.pricingAt,v.validUntil],[2900,false,'2098-01-01T00:00:01Z',start])
 assert.deepEqual([v.stockQuantity,v.active,v.available,v.standardManualAvailable],[0,false,false,false])
 assert.equal('price' in v,false,'Do not add a competing editable price alias')
 assert(f.calls.every(c=>c.table==='products'||c.table==='product_variants'||c.name==='catalog_sale_prices_009'))
})

test('Admin detail keeps distinct per-batch database instants and exact product-scoped UUID batches',async()=>{
 const f=adminPricingFixture({count:205}),dto=await f.service.getWithPricing(f.id)
 const calls=f.calls.filter(c=>c.name)
 assert.deepEqual(calls.map(c=>c.args.p_variant_ids.length),[100,100,5])
 assert.deepEqual(calls.flatMap(c=>c.args.p_variant_ids),f.variants.map(v=>v.id))
 assert(calls.every(c=>c.args.p_pack_ids.length===0));assert.equal(dto.variants.length,205)
 assert.deepEqual([...new Set(dto.variants.map(v=>v.pricingAt))],['2098-01-01T00:00:01Z','2098-01-01T00:00:02Z','2098-01-01T00:00:03Z'])
})

test('Admin detail has no price fallback for errors, malformed/incomplete RPC data or mismatched regular amounts',async()=>{
 const row=args=>({variantId:args.p_variant_ids[0],regularPrice:2900,salePrice:2450.25,effectivePrice:2900,saleActive:false,validUntil:start})
 const replies=[()=>{throw Error('private SQL credential')},()=>({error:{message:'private SQL credential'}}),()=>({data:null}),
  ()=>({data:{pricingAt:start,variants:[],packs:[]}}),
  ()=>({data:{pricingAt:start,variants:[null],packs:[]}}),
  args=>({data:{pricingAt:'2098-01-01T00:00:00Z',variants:[{...row(args),variantId:randomUUID()}],packs:[]}}),
  args=>({data:{pricingAt:'2098-01-01T00:00:00Z',variants:[{...row(args),regularPrice:3000,effectivePrice:3000}],packs:[]}}),
  args=>({data:{pricingAt:'2098-01-01T00:00:00Z',variants:[{...row(args),mode:'configurable'}],packs:[]}}),
  args=>({data:{pricingAt:'invalid',variants:[row(args)],packs:[]}})]
 for(const reply of replies){
  const f=adminPricingFixture({reply})
  await assert.rejects(()=>f.service.getWithPricing(f.id),e=>e.status===503&&e.code==='CATALOG_PRICING_UNAVAILABLE'&&!/private|credential|SQL/.test(e.message))
 }
})

test('Admin detail rejects concurrent revision changes instead of returning mixed configuration and pricing',async()=>{
 const f=adminPricingFixture({revise:true})
 await assert.rejects(()=>f.service.getWithPricing(f.id),{status:503,code:'CATALOG_PRICING_UNAVAILABLE'})
})

test('Admin detail rejects cross-batch validity crossings and avoids RPCs for absent products or empty variants',async()=>{
 const f=adminPricingFixture({count:101,reply:(args,batch)=>({data:{pricingAt:batch===1?'2098-01-01T00:00:00Z':start,packs:[],variants:args.p_variant_ids.map(variantId=>({variantId,regularPrice:2900,salePrice:2450.25,effectivePrice:2900,saleActive:false,validUntil:start}))}})})
 await assert.rejects(()=>f.service.getWithPricing(f.id),{status:503,code:'CATALOG_PRICING_UNAVAILABLE'})
 const empty=adminPricingFixture({count:0})
 assert.deepEqual((await empty.service.getWithPricing(empty.id)).variants,[])
 await assert.rejects(()=>empty.service.getWithPricing(randomUUID()),{status:404,code:'PRODUCT_NOT_FOUND'})
 assert.equal(empty.calls.filter(c=>c.name).length,0)
})
