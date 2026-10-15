import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import cookieParser from 'cookie-parser'
import {randomUUID} from 'node:crypto'
import {createAuthConfig} from '../auth/config.js'
import {getAuthCookieNames,getSessionCsrfToken} from '../auth/cookies.js'
import {requestContext,authErrorHandler} from '../middleware/authSecurity.js'
import {createAdminProductsV1Router} from '../routes/adminProductsV1.js'
import {createTesterPacksV2Router} from '../routes/testerPacksV2.js'
import {createCatalogPricesV2Router} from '../routes/catalogPricesV2.js'
import {ProductAdminService} from '../services/productAdminService.js'
import {TesterCatalogService} from '../services/testerCatalogService.js'
import {testerSqlClient} from './support/testerCatalogDatabase.js'
import {salesFixture,updateStandard,updateTester,updatePack,variantInput,deadline,waitClock,v1Request,quoteV1,placeV1,committed} from './support/scheduledSalesDatabase.js'
import {quoteV2,quoteRequest,normalLine,configuredLine,requestV2,orderV2} from './support/checkoutV2Database.js'
import {state014} from './support/fulfillmentV2Database.js'
import {timestampMicros} from '../schemas/saleSchedule.js'

const future='2099-01-01T00:00:00Z',past='2000-01-01T00:00:00Z',origin='https://sale-api.example.invalid'
async function harness(t){
 const f=await salesFixture(t),baseClient=testerSqlClient(f.db),calls=[]
 const client={...baseClient,from(table){
  const q=baseClient.from(table)
  if(table==='admin_audit_logs')q.insert=async row=>{
   try{await f.db.query('insert into admin_audit_logs(admin_id,action,resource,resource_id,permission_key,request_id,metadata) values($1,$2,$3,$4,$5,$6,$7::jsonb)',[row.admin_id,row.action,row.resource,row.resource_id,row.permission_key,row.request_id,JSON.stringify(row.metadata)]);return {error:null}}
   catch(error){return {error}}
  }
  return q
 },async rpc(name,args){calls.push({name,args});return baseClient.rpc(name,args)}}
 const config=createAuthConfig({NODE_ENV:'test',CLIENT_ORIGIN:origin,AUTH_CSRF_SECRET:'synthetic-sale-api-csrf-secret-123456789',ADMIN_AUTH_PROVIDER:'prototype',CUSTOMER_AUTH_PROVIDER:'prototype',ENABLE_ADMIN_MFA:'false'})
 const names=getAuthCookieNames(config),reader=randomUUID()
 const runtime={config,repository:{client},sessionService:{restore:async({accessToken})=>{
  if(!accessToken)throw Object.assign(new Error('Required'),{code:'AUTH_REQUIRED'})
  return {record:{sessionClass:accessToken==='customer'?'customer':'administrator',mfaAssurance:'aal2'},identity:{id:accessToken,assuranceLevel:'aal2'}}
 }},adminAuthorization:{resolve:async id=>id===f.admin?{userId:id,permissions:['*']}:id===reader?{userId:id,permissions:['products.read']}:null}}
 const app=express();app.use(requestContext,express.json({limit:'32kb'}),cookieParser())
 app.use('/products',createAdminProductsV1Router(runtime,{logger:{warn(){},error(){}}}))
 app.use('/packs',createTesterPacksV2Router(runtime,{logger:{error(){}}}))
 app.use('/public-packs',createTesterPacksV2Router(runtime,{publicOnly:true,logger:{error(){}}}))
 app.use('/catalog',createCatalogPricesV2Router(runtime))
 app.use(authErrorHandler(config));app.use((e,req,res,_next)=>res.status(e.status??500).json({error:{code:'SAFE_FAILURE',requestId:req.requestId}}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)))
 const root='http://127.0.0.1:'+server.address().port
 async function http(path,{method='GET',actor,body,csrf=true,requestOrigin=origin}={}){
  const headers={'Content-Type':'application/json','X-Request-ID':'scheduled-api-native-request'}
  if(actor){const token=getSessionCsrfToken('synthetic-handle',config);headers.Cookie=`${names.access}=${actor}; ${names.refresh}=refresh; ${names.session}=synthetic-handle; ${names.csrf}=${token}`;if(csrf)headers['X-RF-CSRF']=token}
  if(method!=='GET')headers.Origin=requestOrigin
  const res=await fetch(root+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)})
  return {status:res.status,headers:res.headers,body:await res.json()}
 }
 return {...f,client,calls,http,reader,products:new ProductAdminService(client,{warn(){},error(){}}),packs:new TesterCatalogService(client,{error(){}})}
}

test('Scheduled sales backend and HTTP contracts against owned native PG17',{timeout:180000},async t=>{
 async function scenario(name,fn){let ok=false;await t.test(name,{timeout:30000},async s=>{await fn(s);ok=true});if(!ok)throw Error('Critical backend verification failure: '+name)}
 await scenario('Authorized product detail retains configured prices and resolves no, future, active and expired sales through PostgreSQL',async s=>{
  const f=await harness(s)
  for(const [window,effective,active,until]of [
   [{salePrice:null,saleStartsAt:null,saleEndsAt:null},2900,false,null],
   [{salePrice:2450.25,saleStartsAt:future,saleEndsAt:null},2900,false,future],
   [{salePrice:2450.25,saleStartsAt:past,saleEndsAt:future},2450.25,true,future],
   [{salePrice:2450.25,saleStartsAt:past,saleEndsAt:'2001-01-01T00:00:00Z'},2900,false,null],
  ]){
   await updateStandard(f,window)
   const configured=await f.products.get(f.normal.product),before=await state014(f.db)
   f.calls.length=0
   const response=await f.http('/products/'+f.normal.product,{actor:f.reader}),dto=response.body.data,v=dto?.variants[0]
   assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store')
   assert.deepEqual([v.id,v.regularPrice,v.salePrice,v.effectivePrice,v.saleActive],[f.normal.variant,2900,window.salePrice,effective,active])
   assert.equal(dto.catalogRevision,configured.catalogRevision)
   for(const key of ['saleStartsAt','saleEndsAt'])assert.equal(v[key]==null?null:timestampMicros(v[key]),window[key]==null?null:timestampMicros(window[key]))
   assert.equal(v.validUntil==null?null:timestampMicros(v.validUntil),until==null?null:timestampMicros(until))
   const resolved=(await f.db.query('select public.effective_sale_price_009(regular_price,sale_price,sale_starts_at,sale_ends_at,$2::timestamptz)::text amount from product_variants where id=$1',[v.id,v.pricingAt])).rows[0]
   assert.equal(Number(resolved.amount),v.effectivePrice)
   assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].args,{p_variant_ids:[f.normal.variant],p_pack_ids:[]})
   assert.deepEqual(await state014(f.db),before,'Pricing reads must not mutate catalog, inventory, audits or commerce')
  }
  await updateTester(f,f.tester,{salePrice:200.25,saleStartsAt:future})
  const response=await f.http('/products/'+f.tester.product.id,{actor:f.admin}),v=response.body.data.variants[0]
  assert.equal(response.status,200);assert.deepEqual([v.id,v.regularPrice,v.salePrice,v.effectivePrice,v.saleActive],[f.tester.tester.variant_id,250,200.25,250,false])
  assert.equal(Object.hasOwn(v,'standardManualAvailable'),false)
 })
 await scenario('Detail pricing remains behind read permission and covers hidden, inactive, unavailable and out-of-stock variants without public disclosure',async s=>{
  const f=await harness(s),path='/products/'+f.normal.product
  for(const actor of [undefined,'customer',randomUUID()])assert.equal((await f.http(path,{actor})).status,actor?403:401)
  assert.equal(f.calls.length,0,'Unauthorized reads must not execute privileged pricing')
  await updateStandard(f,{salePrice:2450.25,saleStartsAt:future})
  // Published products must retain an active variant. Keep a second option active
  // while testing that the requested first option can be inspected when inactive.
  const configured=await f.products.get(f.normal.product)
  await f.products.update(f.normal.product,{expectedRevision:configured.catalogRevision,variants:[{
   optionName:'Size',optionValue:'100 ml',sku:randomUUID(),regularPrice:4500,stockQuantity:3,active:true,displayOrder:1,
  }]},{userId:f.admin,requestId:'inactive-variant-fixture'})
  for(const [product,variant]of [
   [{status:'Draft',active:true},{}],
   [{status:'Published',active:false},{}],
   [{status:'Published',active:true},{active:false}],
   [{status:'Published',active:true},{active:true,available:false}],
   [{status:'Published',active:true},{available:true,stockQuantity:0}],
  ]){
   await f.db.query('update products set status=$2,active=$3 where id=$1',[f.normal.product,product.status,product.active])
   await updateStandard(f,variant)
   const before=await state014(f.db),response=await f.http(path,{actor:f.reader})
   assert.equal(response.status,200);assert.equal(response.body.data.variants[0].effectivePrice,2900)
   const visible=await f.http('/catalog/variant-prices?ids='+f.normal.variant)
   assert.equal(visible.status,200);assert.deepEqual(visible.body.data.items,[])
   assert.deepEqual(await state014(f.db),before)
  }
  await f.db.query("update products set status='Published',active=true where id=$1",[f.normal.product])
  await updateStandard(f,{active:true,available:true,stockQuantity:12})
  assert.equal((await f.http('/catalog/variant-prices?ids='+f.normal.variant)).body.data.items.length,1)
  for(const role of ['anon','authenticated']){
   await f.db.query('set role '+role)
   try{await assert.rejects(()=>f.db.query('select catalog_sale_prices_009()'),e=>e.code==='42501')}finally{await f.db.query('reset role')}
  }
 })
 await scenario('Unavailable authoritative pricing produces a sanitized 503 with no partial detail or mutations',async s=>{
  const f=await harness(s),before=await state014(f.db)
  f.client.rpc=async()=>({error:{message:'private SQL credentials must never escape'}})
  const response=await f.http('/products/'+f.normal.product,{actor:f.admin})
  assert.equal(response.status,503);assert.equal(response.body.error.code,'CATALOG_PRICING_UNAVAILABLE')
  assert.equal('data' in response.body,false);assert.doesNotMatch(JSON.stringify(response.body),/private|SQL|credentials/)
  assert.deepEqual(await state014(f.db),before)
 })
 await scenario('Public variant prices activate and expire at database boundaries; active legacy mapping only',async s=>{
  const f=await harness(s),{http,db}=f,path='/catalog/variant-prices?ids='+f.normal.variant
  const at=await deadline(db);await updateStandard(f,{salePrice:2450,saleStartsAt:at})
  let response=await http(path),row=response.body.data.items[0]
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store')
  assert.deepEqual([row.regularPrice,row.effectivePrice,row.salePrice,row.saleActive],[2900,2900,null,false]);assert.equal(Date.parse(row.validUntil),Date.parse(at))
  await waitClock(db,at);row=(await http(path)).body.data.items[0]
  assert.deepEqual([row.effectivePrice,row.salePrice,row.saleActive],[2450,2450,true])
  const end=await deadline(db);await updateStandard(f,{saleStartsAt:null,saleEndsAt:end})
  await waitClock(db,end);row=(await http(path)).body.data.items[0]
  assert.deepEqual([row.regularPrice,row.effectivePrice,row.salePrice,row.saleActive,row.validUntil],[2900,2900,null,false,null])
  assert.equal('saleStartsAt' in row,false);assert.equal('configuredSalePrice' in row,false)
 })
 await scenario('Admin authentication, RBAC, origin, CSRF and disabled schedule writes have no effects',async s=>{
  const f=await harness(s),before=await state014(f.db)
  const normal=await variantInput(f.db,f.normal.variant,{salePrice:2450,saleStartsAt:future})
  const tester=await variantInput(f.db,f.tester.tester.variant_id,{salePrice:200,saleStartsAt:future});delete tester.standardManualAvailable
  const requests=[['/products/'+f.normal.product,'PUT',{variants:[normal]}],['/products/'+f.tester.product.id,'PUT',{variants:[tester]}],['/packs/'+f.fixed.product.id,'PATCH',{product:{},definition:{fixedSalePrice:400,fixedSaleStartsAt:future},expectedRevision:String(f.fixed.product.catalog_revision),expectedDefinitionRevision:String(f.fixed.definition.definition_revision)}]]
  for(const [path,method,body]of requests){
   assert.equal((await f.http(path,{method,body})).status,401)
   for(const actor of ['customer',f.reader])assert.equal((await f.http(path,{method,body,actor})).status,403)
   assert.equal((await f.http(path,{method,body,actor:f.admin,csrf:false})).status,403)
   assert.equal((await f.http(path,{method,body,actor:f.admin,requestOrigin:'https://evil.example.invalid'})).status,403)
   const gated=await f.http(path,{method,body,actor:f.admin})
   assert.equal(gated.status,409);assert.equal(gated.body.error.code,'SALE_SCHEDULING_DISABLED')
  }
  assert.deepEqual(await state014(f.db),before);assert.equal(f.calls.length,0)
 })
 await scenario('Scheduled catalog metadata preserves bounds; zero clearing, stable IDs, stock and audit remain intact',async s=>{
  const f=await harness(s),actor={userId:f.admin,requestId:'scheduled-metadata'}
  await updateStandard(f,{salePrice:2450,saleStartsAt:future})
  const before=await f.products.get(f.normal.product),v=before.variants[0]
  assert.equal(Date.parse(v.saleStartsAt),Date.parse(future));assert.equal(v.salePrice,2450)
  const after=await f.products.update(before.id,{description:'Metadata',expectedRevision:before.catalogRevision},actor)
  // pg returns Date/UTC; JSON RPCs preserve the server's offset. Compare exact instants.
  const comparable=rows=>rows.map(v=>({...v,saleStartsAt:v.saleStartsAt==null?null:timestampMicros(v.saleStartsAt),saleEndsAt:v.saleEndsAt==null?null:timestampMicros(v.saleEndsAt)}))
  assert.deepEqual(comparable(after.variants),comparable(before.variants))
  const {saleStartsAt,saleEndsAt,...input}=after.variants[0]
  const cleared=await f.http('/products/'+before.id,{method:'PUT',actor:f.admin,body:{variants:[{...input,salePrice:0}],expectedRevision:after.catalogRevision}})
  assert.equal(cleared.status,200)
  const result=cleared.body.data.variants[0]
  assert.deepEqual([result.id,result.salePrice,result.saleStartsAt,result.saleEndsAt,result.stockQuantity,result.standardManualAvailable],[v.id,null,null,null,12,true])
  const audit=(await f.db.query("select admin_id,request_id from admin_audit_logs where action='product.update' order by created_at desc limit 1")).rows[0]
  assert.equal(audit.admin_id,f.admin);assert.equal(audit.request_id,'scheduled-api-native-request')
  const payload=f.calls.find(c=>c.name==='save_catalog_product').args.p_variants
  assert.equal(payload,null,'Metadata never synthesizes a variant mutation')
 })
 await scenario('Tester metadata retains its independent schedule and pack schedule-only clearing changes no inventory',async s=>{
  const f=await harness(s),actor={userId:f.admin,requestId:'tester-metadata'}
  await updateTester(f,f.tester,{salePrice:200,saleStartsAt:future})
  const before=await f.products.get(f.tester.product.id),changed=await f.products.update(before.id,{description:'Tester copy',expectedRevision:before.catalogRevision},actor)
  assert.equal(Date.parse(changed.variants[0].saleStartsAt),Date.parse(future));assert.equal(changed.variants[0].salePrice,200)
  f.fixed=await updatePack(f,f.fixed,{fixedSalePrice:400,fixedSaleStartsAt:future})
  const pack=await f.packs.get(f.fixed.product.id),physical=(await f.db.query('select * from product_variants order by id')).rows
  const edited=await f.packs.save(pack.id,{product:{description:'Pack copy'},definition:{},expectedRevision:pack.catalogRevision,expectedDefinitionRevision:pack.definitionRevision},actor)
  assert.equal(edited.fixedSaleStartsAt,pack.fixedSaleStartsAt);assert.equal(edited.definitionRevision,pack.definitionRevision)
  const cleared=await f.packs.save(pack.id,{product:{},definition:{fixedSalePrice:null},expectedRevision:edited.catalogRevision,expectedDefinitionRevision:edited.definitionRevision},actor)
  assert.deepEqual([cleared.fixedRegularPrice,cleared.fixedSalePrice,cleared.fixedSaleStartsAt,cleared.fixedSaleEndsAt],[450,null,null,null])
  assert.equal(cleared.manualAvailable,pack.manualAvailable)
  assert.deepEqual((await f.db.query('select * from product_variants order by id')).rows,physical)
 })
 await scenario('Concurrent stale revisions and multi-variant price ownership fail safely',async s=>{
  const f=await harness(s),id=f.normal.product,rev=(await f.products.get(id)).catalogRevision
  const results=await Promise.all([1,2].map(n=>f.http('/products/'+id,{method:'PUT',actor:f.admin,body:{description:'Edit '+n,expectedRevision:rev}})))
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409])
  const current=await f.products.get(id),first=current.variants[0]
  const second={optionName:'Size',optionValue:'100 ml',sku:randomUUID(),regularPrice:4500,salePrice:4000,stockQuantity:3,active:true,displayOrder:1}
  let response=await f.http('/products/'+id,{method:'PUT',actor:f.admin,body:{variants:[first,second],expectedRevision:current.catalogRevision}})
  assert.equal(response.status,200);assert.equal(response.body.data.variants.length,2);assert.equal(response.body.data.variants[0].id,first.id)
  response=await f.http('/products/'+id,{method:'PUT',actor:f.admin,body:{price:3100,expectedRevision:response.body.data.catalogRevision}})
  assert.equal(response.status,400)
  assert.deepEqual((await f.products.get(id)).variants.map(v=>v.regularPrice),[2900,4500])
 })
 await scenario('Public pack prices are authoritative, batched, independently owned, and hide unpublished data',async s=>{
  const f=await harness(s)
  await updateTester(f,f.tester,{salePrice:200})
  f.fixed=await updatePack(f,f.fixed,{fixedSalePrice:400,fixedSaleStartsAt:future})
  f.calls.length=0
  const response=await f.http('/public-packs'),items=response.body.data.items,fixed=items.find(p=>p.id===f.fixed.product.id),configurable=items.find(p=>p.id===f.configurable.product.id)
  assert.equal(response.status,200);assert.equal(fixed.price,450);assert.equal(fixed.fixedSalePrice,null);assert.equal(fixed.saleActive,false)
  assert.equal(fixed.components[0].price,200);assert.equal(fixed.components[0].salePrice,200)
  assert.equal(configurable.effectivePrice,null)
  const selected=configurable.allowedVariants.find(v=>v.testerVariantId===f.tester.tester.variant_id)
  assert.equal((await quoteV2(f.db,quoteRequest([configuredLine(f)]))).subtotal,selected.effectivePrice*2)
  const pricing=f.calls.filter(c=>c.name==='catalog_sale_prices_009')
  assert.equal(pricing.length,1);assert.equal(pricing[0].args.p_variant_ids.length,2);assert.equal(pricing[0].args.p_pack_ids.length,2)
  const text=JSON.stringify(items);for(const key of ['sourceProductId','configuredSalePrice','definition_fingerprint','diagnostics'])assert.equal(text.includes('"'+key+'"'),false)
  await f.db.query("update products set status='Unpublished' where id=$1",[f.normal.product])
  assert.deepEqual((await f.http('/catalog/variant-prices?ids='+f.normal.variant)).body.data.items,[])
  await f.db.query("update products set status='Unpublished' where id=$1",[f.second.product.id])
  const hidden=await f.http('/public-packs/'+f.configurable.product.id)
  assert.equal(JSON.stringify(hidden.body).includes(f.second.tester.variant_id),false)
  await assert.rejects(()=>f.db.query("update products set status='Unpublished' where id=$1",[f.fixed.product.id]),/TESTER_DEFINITION_INVALID/)
  const own=await f.packs.get(f.fixed.product.id)
  await f.packs.save(own.id,{product:{status:'Unpublished'},definition:{},expectedRevision:own.catalogRevision,expectedDefinitionRevision:own.definitionRevision},{userId:f.admin,requestId:'canonical-unpublish-fixture'})
  assert.equal((await f.http('/public-packs/'+f.fixed.product.id)).status,404)
 })
 await scenario('Immediate API sale editing preserves checked V1/V2 financials and native RPC restrictions',async s=>{
  const f=await harness(s),current=await f.products.get(f.normal.product)
  const saved=await f.http('/products/'+current.id,{method:'PUT',actor:f.admin,body:{variants:[{...current.variants[0],salePrice:2450}],expectedRevision:current.catalogRevision}})
  assert.equal(saved.status,200)
  const r=v1Request(f.normal.variant),q=await quoteV1(f.db,r),order=await placeV1(f.db,q,r)
  assert.equal(q.subtotal,2450);await committed(f.db,order.id,q)
  const v2quote=await quoteV2(f.db,quoteRequest([normalLine(f.normal.variant)])),body=await requestV2(f.db,[normalLine(f.normal.variant)]),v2=await orderV2(f.db,body)
  await committed(f.db,v2.id,v2quote)
  for(const role of ['anon','authenticated']){
   await f.db.query('set role '+role)
   try{await assert.rejects(()=>f.db.query('select catalog_sale_prices_009()'),e=>e.code==='42501')}finally{await f.db.query('reset role')}
  }
  for(const query of ['','?ids=bad','?ids='+f.normal.variant+','+f.normal.variant,'?ids='+f.normal.variant+'&pricingAt='+future])assert.equal((await f.http('/catalog/variant-prices'+query)).status,400)
 })
})
