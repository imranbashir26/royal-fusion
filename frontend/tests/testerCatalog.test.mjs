import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {mapProduct,mergeStorefrontData} from '../src/services/productionMappers.ts'
import {loadNormalProductRows} from '../src/services/normalCatalog.ts'
import {normalizePrototypeProducts} from '../src/services/catalogFallback.ts'
import {toProductPayload} from '../src/services/adminProductContract.ts'
import {defaultVariant,isVariantEligible} from '../src/services/productVariants.ts'
import {toPackPayload} from '../src/services/testerPackContract.ts'
const row={id:'normal',name:'Baraan',slug:'baraan',commerce_kind:'standard',price:2900,sale_price:null,main_image_url:'/baraan.webp'}
test('actual canonical query excludes packs and unknown kinds before mapping and downstream variant load',async()=>{
 const data=[row,{...row,id:'tester',commerce_kind:'tester'},{...row,id:'pack',commerce_kind:'tester_pack',price:null},{...row,id:'future',commerce_kind:'future'}],calls=[]
 const query={select(c){calls.push(['select',c]);return this},in(c,v){calls.push(['in',c,v]);this.kinds=v;return this},eq(c,v){calls.push(['eq',c,v]);return this},order(c,v){calls.push(['order',c,v]);return this},then(resolve,reject){return Promise.resolve({data:data.filter(r=>this.kinds.includes(r.commerce_kind)),error:null}).then(resolve,reject)}}
 const rows=await loadNormalProductRows({from(t){assert.equal(t,'products');return query}})
 assert.deepEqual(rows.map(r=>r.id),['normal','tester']);assert.deepEqual(calls[1],['in','commerce_kind',['standard','tester']]);assert.ok(rows.map(mapProduct).every(p=>p.price===2900))
})
test('NULL pack, unknown kind, missing relational kind and invalid normal price fail closed',()=>{
 for(const bad of [{...row,commerce_kind:'tester_pack',price:null},{...row,commerce_kind:'tester_pack',price:2900},{...row,commerce_kind:'future'},{...row,commerce_kind:undefined},{...row,price:null},{...row,price:0},{...row,price:NaN},{...row,sale_price:4000}])assert.throws(()=>mapProduct(bad),/normal product catalog/)
 assert.equal(mapProduct({...row,sale_price:0}).price,2900)
})
test('legacy JSON missing kind is standard only at the explicit fallback boundary; pack cannot reenter through merge',()=>{
 const normal=mapProduct(row),pack={...normal,id:'pack',commerceKind:'tester_pack',price:null},future={...normal,id:'future',commerceKind:'future'}
 assert.deepEqual(normalizePrototypeProducts([normal,pack,future]).map(p=>p.id),['normal'])
 const legacy={...normal};delete legacy.commerceKind;assert.equal(normalizePrototypeProducts([legacy]).length,1)
 const merged=mergeStorefrontData({products:[normal],settings:{},homepage:{},shipping:{}},{products:[normal,pack,future]});assert.deepEqual(merged.products.map(p=>p.id),['normal'])
})
test('normal purchase helpers cannot authorize a pack rejected at catalog boundary',()=>{
 assert.throws(()=>mapProduct({...row,commerce_kind:'tester_pack',price:null}));assert.equal(defaultVariant(mapProduct(row)),undefined)
 assert.equal(isVariantEligible(undefined),false)
})
test('tester Admin contract preserves structured 5 ml, independent price/stock and optional source',()=>{
 const p=toProductPayload({commerceKind:'tester',bottleSize:'50 ml',price:250,stockQuantity:7,sourceProductId:'',testerAvailable:true})
 assert.equal(p.bottleSize,'5 ml');assert.equal(p.price,250);assert.equal(p.stockQuantity,7);assert.equal(p.sourceProductId,null)
 assert.equal(p.testerAvailable,true)
 assert.equal(toProductPayload({commerceKind:'tester',stockQuantity:0,testerAvailable:true}).testerAvailable,true)
 assert.equal(toProductPayload({commerceKind:'tester',stockQuantity:9,testerAvailable:false}).testerAvailable,false)
 assert.equal(Object.hasOwn(toProductPayload({commerceKind:'tester',stockQuantity:3}),'testerAvailable'),false)
 assert.throws(()=>toProductPayload({commerceKind:'tester_pack',price:null}),/Tester Packs/)
})
test('Admin pack foundation has revision-aware API and no normal add-to-cart, quote or order action',()=>{
 const api=readFileSync(new URL('../src/services/testerPacksApi.ts',import.meta.url),'utf8'),ui=readFileSync(new URL('../src/admin/AdminTesterPacksPage.tsx',import.meta.url),'utf8')
 assert.match(api,/expectedDefinitionRevision/);assert.match(api,/\/v2\/admin\/tester-packs/);assert.match(ui,/members.length>=100/)
 assert.doesNotMatch(api+ui,/create_order_transaction|cartStore|addItem\(|\/public\/orders|\/checkout\/quote/)
})
test('pack editor preserves untouched membership order and revisions; configurable maximum remains nullable',()=>{
 const draft={id:'pack',name:'Pack',slug:'pack',sku:'pack',image:'/pack.webp',gallery:'',description:'',shortDescription:'',scentFamily:'Woody',categoryId:'',status:'Draft',mode:'fixed',regular:'500',sale:'',maximum:'',manualAvailable:true,members:[{testerVariantId:'variant',quantityPerPack:2,displayOrder:10}],catalogRevision:'3',definitionRevision:'2'}
 const p=toPackPayload(draft);assert.equal(p.definition.components[0].displayOrder,10);assert.equal(p.expectedRevision,'3');assert.equal(p.expectedDefinitionRevision,'2');assert.equal(p.product.price,undefined)
 const configurable=toPackPayload({...draft,mode:'configurable',members:[{testerVariantId:'variant',active:false,displayOrder:20}]})
 assert.equal(configurable.definition.minimumUnits,2);assert.equal(configurable.definition.maximumUnits,null);assert.equal(configurable.definition.fixedRegularPrice,undefined);assert.equal(configurable.definition.allowedVariants[0].active,false)
 assert.throws(()=>toPackPayload({...draft,members:Array(101).fill(draft.members[0])}),/at most 100/)
 assert.throws(()=>toPackPayload({...draft,description:'x'.repeat(33000)}),/32 KiB/)
})
