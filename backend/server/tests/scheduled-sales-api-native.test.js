import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import cookieParser from 'cookie-parser'
import {randomUUID,createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createAuthConfig} from '../auth/config.js'
import {getAuthCookieNames,getSessionCsrfToken} from '../auth/cookies.js'
import {requestContext,authErrorHandler} from '../middleware/authSecurity.js'
import {createAdminProductsV1Router} from '../routes/adminProductsV1.js'
import {createTesterPacksV2Router} from '../routes/testerPacksV2.js'
import {createCatalogPricesV2Router} from '../routes/catalogPricesV2.js'
import {ProductAdminService} from '../services/productAdminService.js'
import {TesterCatalogService} from '../services/testerCatalogService.js'
import {testerSqlClient} from './support/testerCatalogDatabase.js'
import {salesFixture,updateStandard,updateTester,updatePack,variantInput,deadline,waitClock,v1Request,quoteV1,placeV1,committed,additional,waitBlocked} from './support/scheduledSalesDatabase.js'
import {quoteV2,quoteRequest,normalLine,configuredLine,requestV2,orderV2} from './support/checkoutV2Database.js'
import {state014,client014} from './support/fulfillmentV2Database.js'
import {connection} from './support/release005NativeFixture.js'
import {createOrdersV2Router} from '../routes/ordersV2.js'
import {timestampMicros} from '../schemas/saleSchedule.js'
import {createSaleSchedulingPolicy} from '../services/saleSchedulingPolicy.js'
import {scheduledSalesBrowser,scheduledSalesDiagnostics} from './support/scheduledSalesBrowser.js'
import {CouponsService} from '../services/adminPhase3Service.js'
import {createAdminPhase3V1Router} from '../routes/adminPhase3V1.js'
import {phase3SqlClient} from './support/phase3Database.js'
import {clientV2,fixedLine} from './support/checkoutV2Database.js'
import {CheckoutQuoteService} from '../services/checkoutQuoteService.js'
import {CheckoutQuoteV2Service} from '../services/checkoutQuoteV2Service.js'
import {OrdersV1Service} from '../services/ordersV1Service.js'
import {OrdersV2Service} from '../services/ordersV2Service.js'
import {toProductPayload} from '../../../frontend/src/services/adminProductContract.ts'

const future='2099-01-01T00:00:00Z',past='2000-01-01T00:00:00Z',origin='https://sale-api.example.invalid'
function assertAuditRequestId(response,audit){
 const requestId=response.headers.get('x-request-id')
 assert.match(requestId,/^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
 assert.equal(response.body.meta.requestId,requestId)
 assert.equal(audit.request_id,requestId)
 assert.notEqual(audit.request_id,'scheduled-api-native-request')
}
function assertV1PricingEvidence(quote,receipt,request){
 const fields=['policy','strategy','couponOutcome','requestedCouponCode','acceptedQuoteFingerprint','regularSubtotal','saleSubtotal','couponDiscount','merchandiseTotal','couponSubtotal','appliedCouponId','appliedCouponCode'].sort()
 for(const outcome of [quote.pricingOutcome,receipt.pricingOutcome]){
  assert.ok(outcome!==null&&typeof outcome==='object'&&!Array.isArray(outcome),'Pricing outcome must be a public evidence object')
  assert.deepEqual(Object.keys(outcome).sort(),fields,'Pricing outcome must contain exactly the approved public fields')
  assert.equal(outcome.policy,'GLOBAL_PERCENTAGE_V1')
 }
 const {acceptedQuoteFingerprint:quoteFingerprint,...quoteEvidence}=quote.pricingOutcome
 const {acceptedQuoteFingerprint:receiptFingerprint,...receiptEvidence}=receipt.pricingOutcome
 assert.deepEqual(receiptEvidence,quoteEvidence,'Receipt must preserve every monetary and coupon evidence field')
 assert.deepEqual([receipt.subtotal,receipt.discount,receipt.shippingFee,receipt.total],[quote.subtotal,quote.discount,quote.shippingFee,quote.total])
 assert.ok(/^[0-9a-f]{64}$/.test(request.quoteFingerprint),'Issued V1 capability must have the approved format')
 assert.ok(quote.quoteFingerprint===request.quoteFingerprint&&quoteFingerprint===request.quoteFingerprint,'Quote must retain its original issued capability')
 const verifier=createHash('sha256').update('rf:v1:capability:008:'+request.quoteFingerprint,'utf8').digest('hex')
 assert.ok(receiptFingerprint===verifier,'Receipt must contain the canonical capability verifier')
 assert.ok(receiptFingerprint!==request.quoteFingerprint,'Receipt must never expose the raw capability')
}
async function administrationState(db){
 const commerce=await state014(db)
 const packs=(await db.query(`select jsonb_build_object(
  'definitions',(select jsonb_agg(to_jsonb(d) order by product_id) from tester_packs d),
  'components',(select jsonb_agg(to_jsonb(d) order by pack_id,tester_variant_id) from tester_pack_components d),
  'allowed',(select jsonb_agg(to_jsonb(d) order by pack_id,tester_variant_id) from tester_pack_allowed_variants d)) state`)).rows[0].state
 return {commerce,packs}
}
async function diagnosticSalesFixture(t,diagnostic){
 const native=JSON.parse(await readFile(process.env.RF_RELEASE005_NATIVE_CONFIG,'utf8'))
 const {Client}= (await import(pathToFileURL(native.pgModule))).default
 const original=Client.prototype.query
 // Observe only this sequential fixture installation; preserve SQL, arguments,
 // returned promises and errors. Never print SQL, parameters or result values.
 Client.prototype.query=function(...args){
  const sql=typeof args[0]==='string'?args[0]:args[0]?.text??''
  const release=/RF_RELEASE(005|006|007|008|009)_/.exec(sql)?.[1]
  const label=/^create database\b/i.test(sql)?'fixture.database.create':release?'fixture.release'+release:'fixture.sql'
  const end=diagnostic.begin(label)
  try{const result=original.apply(this,args);result.then(()=>end(),()=>end('failed',{category:'SQL_FAILED'}));return result}
  catch(error){end('failed',{category:'SQL_FAILED'});throw error}
 }
 try{return await salesFixture(diagnostic.context)}finally{Client.prototype.query=original}
}
async function harness(t,{enabled=false,diagnostic=null}={}){
 const f=await (diagnostic?diagnostic.stage('fixture.installation',()=>diagnosticSalesFixture(t,diagnostic)):salesFixture(t)),native=JSON.parse(await readFile(process.env.RF_RELEASE005_NATIVE_CONFIG,'utf8'))
 const {types}= (await import(pathToFileURL(native.pgModule))).default
 // PostgREST delivers timestamp JSON strings. pg's default Date parser silently
 // truncates microseconds; preserve them in this native API transport fixture.
 const apiDb=Object.create(f.db)
 apiDb.query=(text,values)=>f.db.query({text,values,types:{getTypeParser(oid,format){
  return oid===1184 ? value=>value.replace(' ','T').replace(/([+-]\d{2})$/, '$1:00') : types.getTypeParser(oid,format)
 }}})
 apiDb.exec=text=>apiDb.query(text)
 const baseClient=testerSqlClient(apiDb),calls=[]
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
 if(diagnostic)app.use((req,res,next)=>{
  const label=req.path==='/products/sale-capabilities'?'backend.capability':req.path==='/products/'+f.normal.product?'backend.product':'backend.other'
  const at=performance.now(),method=['GET','PUT'].includes(req.method)?req.method:'OTHER'
  diagnostic.record(label,'request',{method})
  res.on('finish',()=>diagnostic.record(label,'response',{method,status:res.statusCode,durationMs:Math.round(performance.now()-at),...(/^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(req.requestId??'')?{requestId:req.requestId}:{})}))
  next()
 })
 const saleScheduling=createSaleSchedulingPolicy(client,{enabled})
 app.use('/products',createAdminProductsV1Router(runtime,{saleScheduling,logger:{warn(){},error(){}}}))
 app.use('/packs',createTesterPacksV2Router(runtime,{saleScheduling,logger:{error(){}}}))
 app.use('/public-packs',createTesterPacksV2Router(runtime,{publicOnly:true,logger:{error(){}}}))
 app.use('/catalog',createCatalogPricesV2Router(runtime))
 app.use(authErrorHandler(config));app.use((e,req,res,_next)=>res.status(e.status??500).json({error:{code:'SAFE_FAILURE',requestId:req.requestId}}))
 const expressReady=diagnostic?.begin('express.listen')
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));expressReady?.();t.after(()=>diagnostic?diagnostic.stage('express.cleanup',()=>new Promise(r=>server.close(r))):new Promise(r=>server.close(r)))
 const root='http://127.0.0.1:'+server.address().port
 async function http(path,{method='GET',actor,body,csrf=true,requestOrigin=origin}={}){
  const headers={'Content-Type':'application/json','X-Request-ID':'scheduled-api-native-request'}
  if(actor){const token=getSessionCsrfToken('synthetic-handle',config);headers.Cookie=`${names.access}=${actor}; ${names.refresh}=refresh; ${names.session}=synthetic-handle; ${names.csrf}=${token}`;if(csrf)headers['X-RF-CSRF']=token}
  if(method!=='GET')headers.Origin=requestOrigin
  const res=await fetch(root+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)})
  return {status:res.status,headers:res.headers,body:await res.json()}
 }
 return {...f,client,calls,http,reader,root,config,names,products:new ProductAdminService(client,{warn(){},error(){}},{saleScheduling}),packs:new TesterCatalogService(client,{error(){}},{saleScheduling})}
}

test('Combined canonical serialization persists scalar, variation and added-row edits through authorized HTTP and PG17',{timeout:60000},async t=>{
 const f=await harness(t,{enabled:true}),id=f.normal.product
 const baseline=p=>Object.fromEntries(['price','salePrice','stockQuantity','sku','bottleSize','variations'].map(key=>[key,p[key]]))
 let p=await f.products.get(id)
 const outside=(await f.db.query('select to_jsonb(v) value from product_variants v where product_id<>$1 order by id',[id])).rows
 const serialized=toProductPayload({...p,variantEditBaseline:baseline(p),price:3300,stockQuantity:5,sku:'RF-CHANGED',expectedRevision:p.catalogRevision,saleScheduleEdits:{[f.normal.variant]:{salePrice:2450.25,saleStartsAt:future}}})
 let r=await f.http('/products/'+id,{method:'PUT',actor:f.admin,body:serialized});assert.equal(r.status,200)
 p=await f.products.get(id);let v=p.variants.find(v=>v.id===f.normal.variant)
 assert.deepEqual([v.regularPrice,v.stockQuantity,v.sku,v.salePrice],[3300,5,'RF-CHANGED',2450.25]);assert.equal(Date.parse(v.saleStartsAt),Date.parse(future));assert.equal(v.standardManualAvailable,true)
 const payload=toProductPayload({...p,variantEditBaseline:baseline(p),expectedRevision:p.catalogRevision,
  variations:[{name:'100 ml',sku:'RF-100',price:4500,salePrice:3500,stock:3,active:true,saleStartsAt:future}],
  saleScheduleEdits:{[f.normal.variant]:{saleEndsAt:'2099-03-01T00:00:00Z'}}})
 r=await f.http('/products/'+id,{method:'PUT',actor:f.admin,body:payload});assert.equal(r.status,200)
 p=await f.products.get(id);assert.equal(p.variants.length,2)
 const second=p.variants.find(v=>v.id!==f.normal.variant)
 assert.deepEqual([second.optionValue,second.sku,second.regularPrice,second.salePrice,second.stockQuantity],['100 ml','RF-100',4500,3500,3]);assert.equal(Date.parse(second.saleStartsAt),Date.parse(future))
 const edited=toProductPayload({...p,variantEditBaseline:baseline(p),expectedRevision:p.catalogRevision,
  variations:[{id:second.id,name:'150 ml',sku:'RF-150',price:4800,salePrice:3600,stock:2,active:true}],
  saleScheduleEdits:{[f.normal.variant]:{saleEndsAt:'2099-04-01T00:00:00Z'}}})
 r=await f.http('/products/'+id,{method:'PUT',actor:f.admin,body:edited});assert.equal(r.status,200)
 p=await f.products.get(id);v=p.variants.find(v=>v.id===second.id)
 assert.deepEqual([v.optionValue,v.sku,v.regularPrice,v.salePrice,v.stockQuantity],['150 ml','RF-150',4800,3600,2]);assert.equal(Date.parse(v.saleStartsAt),Date.parse(future))
 assert.deepEqual((await f.db.query('select to_jsonb(v) value from product_variants v where product_id<>$1 order by id',[id])).rows,outside)
 const before=await administrationState(f.db)
 const stale=await f.http('/products/'+id,{method:'PUT',actor:f.admin,body:edited});assert.equal(stale.status,409);assert.equal(stale.body.error.code,'CATALOG_STALE');assert.deepEqual(await administrationState(f.db),before)
})

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
  assert.equal(audit.admin_id,f.admin);assertAuditRequestId(cleared,audit)
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

test('Controlled scheduled-sale administration enabled and disabled native acceptance',{timeout:180000},async t=>{
 async function scenario(name,fn){let ok=false;await t.test(name,{timeout:60000},async s=>{await fn(s);ok=true});if(!ok)throw Error('Critical activation verification failure: '+name)}
 await scenario('Chrome controls use real authorized capability, backend persistence and native PG17',async s=>{
  const diagnostic=scheduledSalesDiagnostics(s)
  await diagnostic.stage('scenario.work',async()=>{
   const f=await harness(s,{enabled:true,diagnostic});await scheduledSalesBrowser(s,f,diagnostic)
  })
 })
 await scenario('Capability is authenticated, permission-scoped, default-disabled and fails closed on RPC loss',async s=>{
  for(const enabled of [false,true]){
   const f=await harness(s,{enabled});assert.equal((await f.http('/products/sale-capabilities')).status,401)
   assert.equal((await f.http('/products/sale-capabilities',{actor:f.reader})).status,403)
   const r=await f.http('/products/sale-capabilities',{actor:f.admin});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(r.body.data,{scheduledSaleWrites:enabled})
   if(enabled){f.client.rpc=async()=>({error:{message:'private'}});assert.equal((await f.http('/products/sale-capabilities',{actor:f.admin})).body.data.scheduledSaleWrites,false)
    const before=await state014(f.db),v=await variantInput(f.db,f.normal.variant,{salePrice:2450,saleStartsAt:future})
    const r=await f.http('/products/'+f.normal.product,{method:'PUT',actor:f.admin,body:{variants:[v],expectedRevision:'0'}});assert.equal(r.status,503);assert.equal(r.body.error.code,'SALE_SCHEDULING_UNAVAILABLE');assert.deepEqual(await state014(f.db),before)
   }
  }
 })
 await scenario('Request overrides cannot enable scheduling; direct default services and legacy aliases stay guarded',async s=>{
  const f=await harness(s),before=await state014(f.db),v=await variantInput(f.db,f.normal.variant,{salePrice:2450,saleStartsAt:future})
  for(const body of [{variants:[v]},{variations:[{name:'50 ml',sku:v.sku,price:2900,salePrice:2450,saleStartsAt:future,stock:12,active:true}]},{variants:[v],scheduledSaleWrites:true}]){
   const r=await f.http('/products/'+f.normal.product+'?scheduledSaleWrites=true',{actor:f.admin,method:'PUT',body});assert([400,409].includes(r.status))
  }
  await assert.rejects(()=>new ProductAdminService(f.client).update(f.normal.product,{variants:[v]},{userId:f.admin}),{status:409})
  assert.deepEqual(await state014(f.db),before)
 })
 for(const start of [future,past])await scenario('Disabled persisted '+(start===future?'future':'active')+' windows reject price-only canonical, aliases, tester and fixed-pack mutations without any database effects',async s=>{
  const f=await harness(s)
  await updateStandard(f,{salePrice:2450.25,saleStartsAt:start,saleEndsAt:future===start?'2099-02-01T00:00:00Z':future})
  await updateTester(f,f.tester,{salePrice:200,saleStartsAt:start})
  await updatePack(f,f.fixed,{fixedSalePrice:400,fixedSaleStartsAt:start})
  const p=await f.products.get(f.normal.product),tester=await f.products.get(f.tester.product.id),pack=await f.packs.get(f.fixed.product.id)
  const v=await variantInput(f.db,f.normal.variant,{salePrice:2300.25}),tv=await variantInput(f.db,f.tester.tester.variant_id,{salePrice:190})
  const cases=[
   ['/products/'+p.id,'PUT',{variants:[v],expectedRevision:p.catalogRevision}],
   ['/products/'+p.id,'PUT',{variants:[{...v,id:undefined}],expectedRevision:p.catalogRevision}],
   ['/products/'+p.id,'PUT',{salePrice:2300.25}],
   ['/products/'+p.id,'PUT',{variations:[{id:v.id,name:v.optionValue,sku:v.sku,price:v.regularPrice,salePrice:2300.25,stock:v.stockQuantity,active:true}],expectedRevision:p.catalogRevision}],
   ['/products/'+tester.id,'PUT',{variants:[tv],expectedRevision:tester.catalogRevision}],
   ['/products/'+tester.id,'PUT',{salePrice:190,expectedRevision:tester.catalogRevision}],
   ['/packs/'+pack.id,'PATCH',{product:{},definition:{fixedSalePrice:390},expectedRevision:pack.catalogRevision,expectedDefinitionRevision:pack.definitionRevision}],
   ['/products/'+p.id,'PUT',{variants:[{...v,saleStartsAt:null,saleEndsAt:null}],expectedRevision:p.catalogRevision}],
   ['/packs/'+pack.id,'PATCH',{product:{},definition:{fixedSalePrice:390,fixedSaleStartsAt:null,fixedSaleEndsAt:null},expectedRevision:pack.catalogRevision,expectedDefinitionRevision:pack.definitionRevision}],
   ['/products/'+p.id,'PUT',{variants:[{...v,salePrice:2450.25,saleEndsAt:'2099-03-01T00:00:00Z'}],expectedRevision:p.catalogRevision}],
  ]
  const before=await administrationState(f.db)
  for(const [path,method,body]of cases){
   const r=await f.http(path,{method,body,actor:f.admin});assert.equal(r.status,409);assert.equal(r.body.error.code,'SALE_SCHEDULING_DISABLED')
   assert.deepEqual(await administrationState(f.db),before,'Rejected operation preserves prices, bounds, stock, revisions, audit and pack definitions')
  }
  for(const opts of [{actor:f.reader},{actor:'customer'},{actor:f.admin,csrf:false},{actor:f.admin,requestOrigin:'https://evil.example.invalid'}]){
   const r=await f.http('/products/'+p.id,{method:'PUT',body:{salePrice:2300.25},...opts});assert([401,403].includes(r.status));assert.deepEqual(await administrationState(f.db),before)
  }
  for(const [method,path,body]of [['PUT','/products/'+p.id,{salePrice:2300.25,scheduledSaleWrites:true}],['PATCH','/packs/'+pack.id,{product:{},definition:{fixedSalePrice:390,scheduledSaleWrites:true},expectedRevision:pack.catalogRevision,expectedDefinitionRevision:pack.definitionRevision}]]){
   assert.equal((await f.http(path+'?scheduledSaleWrites=true',{method,body,actor:f.admin})).status,400);assert.deepEqual(await administrationState(f.db),before)
  }
 })
 await scenario('Disabled metadata, same-price echoes, explicit null clearing and genuine immediate sales remain supported',async s=>{
  const f=await harness(s),actor={userId:f.admin,requestId:'disabled-controls'}
  await updateStandard(f,{salePrice:2450.25,saleStartsAt:future})
  let dto=await f.products.get(f.normal.product),v=await variantInput(f.db,f.normal.variant)
  let r=await f.http('/products/'+dto.id,{method:'PUT',actor:f.admin,body:{description:'Copy only',variants:[v],expectedRevision:dto.catalogRevision}});assert.equal(r.status,200)
  assert.equal(r.body.data.variants[0].salePrice,2450.25);assert.equal(Date.parse(r.body.data.variants[0].saleStartsAt),Date.parse(future))
  r=await f.http('/products/'+dto.id,{method:'PUT',actor:f.admin,body:{salePrice:0,expectedRevision:r.body.data.catalogRevision}});assert.equal(r.status,200)
  assert.deepEqual([r.body.data.variants[0].salePrice,r.body.data.variants[0].saleStartsAt,r.body.data.variants[0].saleEndsAt],[null,null,null])
  r=await f.http('/products/'+dto.id,{method:'PUT',actor:f.admin,body:{salePrice:2300.25}});assert.equal(r.status,200);assert.equal(r.body.data.variants[0].salePrice,2300.25)
  await updateTester(f,f.tester,{salePrice:200,saleStartsAt:future})
  dto=await f.products.get(f.tester.product.id)
  const saved=await f.products.update(dto.id,{salePrice:null,expectedRevision:dto.catalogRevision},actor)
  assert.deepEqual([saved.variants[0].salePrice,saved.variants[0].saleStartsAt,saved.variants[0].saleEndsAt],[null,null,null])
  assert.equal(saved.variants[0].regularPrice,dto.variants[0].regularPrice);assert.equal(saved.variants[0].stockQuantity,dto.variants[0].stockQuantity)
  const pack=await f.packs.get(f.fixed.product.id),physical=(await f.db.query('select to_jsonb(v) value from product_variants v order by id')).rows
  const immediate=await f.packs.save(pack.id,{product:{},definition:{fixedSalePrice:390},expectedRevision:pack.catalogRevision,expectedDefinitionRevision:pack.definitionRevision},actor)
  assert.equal(immediate.fixedSalePrice,390);assert.deepEqual((await f.db.query('select to_jsonb(v) value from product_variants v order by id')).rows,physical)
 })
 for(const kind of ['canonical','legacy without caller revision','tester','pack'])await scenario('Concurrent '+kind+' schedule change after policy read is rejected under actual PostgreSQL row locks',async s=>{
  const f=await harness(s),holder=await additional(s,f.db),observer=await additional(s,f.db)
  f.db.nativePid=(await f.db.query('select pg_backend_pid() n')).rows[0].n
  const id=kind==='tester'?f.tester.product.id:kind==='pack'?f.fixed.product.id:f.normal.product
  const dto=kind==='pack'?await f.packs.get(id):await f.products.get(id)
  const body=kind==='pack'?{product:{},definition:{fixedSalePrice:390},expectedRevision:dto.catalogRevision,expectedDefinitionRevision:dto.definitionRevision}:
   kind==='legacy without caller revision'?{salePrice:2300.25}:kind==='tester'?{salePrice:190,expectedRevision:dto.catalogRevision}:
   {variants:[await variantInput(f.db,f.normal.variant,{salePrice:2300.25})],expectedRevision:dto.catalogRevision}
  const rpc=kind==='pack'?'save_tester_pack':kind==='tester'?'save_tester_product':'save_catalog_product'
  let reach,release;const reached=new Promise(r=>reach=r),gate=new Promise(r=>release=r),original=f.client.rpc.bind(f.client)
  f.client.rpc=async(name,args)=>{if(name===rpc){reach();await gate}return original(name,args)}
  const pending=f.http((kind==='pack'?'/packs/':'/products/')+id,{method:kind==='pack'?'PATCH':'PUT',actor:f.admin,body})
  let committed=false
  try{
   await reached;await holder.query('begin')
   const hf={...f,db:holder}
   if(kind==='pack')await updatePack(hf,f.fixed,{fixedSalePrice:400,fixedSaleStartsAt:future})
   else if(kind==='tester')await updateTester(hf,f.tester,{salePrice:200,saleStartsAt:future})
   else await updateStandard(hf,{salePrice:2450.25,saleStartsAt:future})
   release();await waitBlocked(observer,f.db,holder)
   const before=await administrationState(holder)
   await holder.query('commit');committed=true
   const r=await pending;assert.equal(r.status,409);assert.equal(r.body.error.code,'CATALOG_STALE')
   assert.deepEqual(await administrationState(f.db),before,'Losing request cannot change concurrent committed schedule or audit/inventory state')
  }finally{release();if(!committed)await holder.query('rollback');await pending}
 })
 await scenario('Enabled product schedules preserve microseconds, regular prices, inventory, revisions and audit attribution',async s=>{
  const f=await harness(s,{enabled:true}),id=f.normal.product,v=await variantInput(f.db,f.normal.variant,{salePrice:2450.25,saleStartsAt:'2099-01-01T05:00:00.123456+05:00',saleEndsAt:'2099-02-01T00:00:00.654321Z'})
  let prior=await f.products.get(id),r=await f.http('/products/'+id,{method:'PUT',actor:f.admin,body:{variants:[v],expectedRevision:prior.catalogRevision}});assert.equal(r.status,200)
  assert.equal(timestampMicros(r.body.data.variants[0].saleStartsAt),timestampMicros(v.saleStartsAt),'Writer JSON preserves all microseconds')
  const stored=(await f.db.query("select to_jsonb(v)->>'sale_starts_at' value from product_variants v where id=$1",[f.normal.variant])).rows[0].value
  assert.equal(timestampMicros(stored),timestampMicros(v.saleStartsAt),'Native persisted JSON retains all microseconds')
  let dto=(await f.http('/products/'+id,{actor:f.admin})).body.data
  assert.deepEqual([dto.variants[0].regularPrice,dto.variants[0].salePrice,dto.variants[0].effectivePrice,dto.variants[0].saleActive,dto.variants[0].stockQuantity,dto.variants[0].standardManualAvailable],[2900,2450.25,2900,false,12,true])
  assert.equal(timestampMicros(dto.variants[0].saleStartsAt),timestampMicros(v.saleStartsAt));assert.equal(timestampMicros(dto.variants[0].saleEndsAt),timestampMicros(v.saleEndsAt))
  const before=await state014(f.db)
  assert.equal((await f.http('/products/'+id,{method:'PUT',actor:f.admin,body:{variants:[v],expectedRevision:prior.catalogRevision}})).status,409)
  for(const patch of [{salePrice:3000},{salePrice:2450.001},{saleStartsAt:future,saleEndsAt:past}])assert.equal((await f.http('/products/'+id,{method:'PUT',actor:f.admin,body:{variants:[{...v,...patch}],expectedRevision:dto.catalogRevision}})).status,400)
  for(const opts of [{},{actor:f.reader},{actor:'customer'},{actor:f.admin,csrf:false},{actor:f.admin,requestOrigin:'https://evil.example.invalid'}])assert([401,403].includes((await f.http('/products/'+id,{method:'PUT',body:{variants:[v],expectedRevision:dto.catalogRevision},...opts})).status))
  assert.deepEqual(await state014(f.db),before)
  r=await f.http('/products/'+id,{method:'PUT',actor:f.admin,body:{variants:[{...v,saleEndsAt:'2099-03-01T00:00:00Z'}],expectedRevision:dto.catalogRevision}});assert.equal(r.status,200)
  r=await f.http('/products/'+id,{method:'PUT',actor:f.admin,body:{variants:[{...v,salePrice:null,saleStartsAt:null,saleEndsAt:null}],expectedRevision:r.body.data.catalogRevision}});assert.equal(r.status,200);assert.deepEqual([r.body.data.variants[0].salePrice,r.body.data.variants[0].saleStartsAt,r.body.data.variants[0].saleEndsAt],[null,null,null])
  const audit=(await f.db.query("select admin_id,request_id from admin_audit_logs where action='product.update' order by created_at desc limit 1")).rows[0];assert.equal(audit.admin_id,f.admin);assertAuditRequestId(r,audit)
 })
 await scenario('Enabled tester and fixed pack schedules retain independent pricing; configurable parents reject own prices',async s=>{
  const f=await harness(s,{enabled:true}),tester=await f.products.get(f.tester.product.id),v=await variantInput(f.db,f.tester.tester.variant_id,{salePrice:200.25,saleStartsAt:past,saleEndsAt:future})
  let r=await f.http('/products/'+tester.id,{method:'PUT',actor:f.admin,body:{variants:[v],expectedRevision:tester.catalogRevision}});assert.equal(r.status,200)
  const pack=await f.packs.get(f.fixed.product.id);r=await f.http('/packs/'+pack.id,{method:'PATCH',actor:f.admin,body:{product:{},definition:{fixedSalePrice:400.25,fixedSaleStartsAt:past,fixedSaleEndsAt:future},expectedRevision:pack.catalogRevision,expectedDefinitionRevision:pack.definitionRevision}});assert.equal(r.status,200)
  assert.equal(r.body.data.effectivePrice,400.25);assert.equal((await f.products.get(tester.id)).variants[0].salePrice,200.25)
  assert.equal((await quoteV2(f.db,quoteRequest([configuredLine(f)]))).subtotal,400.50)
  const config=await f.packs.get(f.configurable.product.id),before=await state014(f.db)
  assert.equal((await f.http('/packs/'+config.id,{method:'PATCH',actor:f.admin,body:{product:{},definition:{fixedSalePrice:2,fixedSaleStartsAt:future},expectedRevision:config.catalogRevision,expectedDefinitionRevision:config.definitionRevision}})).status,400);assert.deepEqual(await state014(f.db),before)
 })
 await scenario('Enabled omitted-bound price edits persist for standard, tester and fixed-pack schedules and capability failure rejects them',async s=>{
  const f=await harness(s,{enabled:true})
  await updateStandard(f,{salePrice:2450.25,saleStartsAt:future});await updateTester(f,f.tester,{salePrice:200,saleStartsAt:past});await updatePack(f,f.fixed,{fixedSalePrice:400,fixedSaleStartsAt:future})
  for(const [id,amount]of [[f.normal.product,2300.25],[f.tester.product.id,190]]){
   const p=await f.products.get(id),prior=p.variants[0],r=await f.http('/products/'+id,{method:'PUT',actor:f.admin,body:{salePrice:amount,expectedRevision:p.catalogRevision}})
   assert.equal(r.status,200)
   const v=(await f.products.get(id)).variants[0]
   assert.deepEqual([v.salePrice,v.saleStartsAt,v.saleEndsAt,v.regularPrice,v.stockQuantity,v.standardManualAvailable],[amount,prior.saleStartsAt,prior.saleEndsAt,prior.regularPrice,prior.stockQuantity,prior.standardManualAvailable])
  }
  const pack=await f.packs.get(f.fixed.product.id),r=await f.http('/packs/'+pack.id,{method:'PATCH',actor:f.admin,body:{product:{},definition:{fixedSalePrice:390},expectedRevision:pack.catalogRevision,expectedDefinitionRevision:pack.definitionRevision}})
  assert.equal(r.status,200);assert.equal(r.body.data.fixedSalePrice,390);assert.equal(r.body.data.fixedSaleStartsAt,pack.fixedSaleStartsAt);assert.equal(r.body.data.fixedRegularPrice,450)
  const base=f.client.rpc.bind(f.client);f.client.rpc=(name,args)=>name==='catalog_sale_prices_009'?Promise.resolve({error:{message:'private capability failure'}}):base(name,args)
  const dto=await f.products.get(f.normal.product),before=await administrationState(f.db)
  const blocked=await f.http('/products/'+dto.id,{method:'PUT',actor:f.admin,body:{salePrice:2200,expectedRevision:dto.catalogRevision}})
  assert.equal(blocked.status,503);assert.equal(blocked.body.error.code,'SALE_SCHEDULING_UNAVAILABLE');assert.deepEqual(await administrationState(f.db),before)
 })
 await scenario('API-saved boundaries govern public pricing and stale V1/V2 confirmations without changing historical orders',async s=>{
  const f=await harness(s,{enabled:true}),id=f.normal.product,rq=v1Request(f.normal.variant),old=await quoteV1(f.db,rq),historical=await placeV1(f.db,old,rq)
  const oldOrder=(await f.db.query('select to_jsonb(o) value from orders o where id=$1',[historical.id])).rows[0].value
  const q1=await quoteV1(f.db,rq),request=await requestV2(f.db,[normalLine(f.normal.variant)]),dto=await f.products.get(id)
  const start=await deadline(f.db),end=new Date(Date.parse(start)+2500).toISOString(),v=await variantInput(f.db,f.normal.variant,{salePrice:2450.25,saleStartsAt:start,saleEndsAt:end})
  assert.equal((await f.http('/products/'+id,{method:'PUT',actor:f.admin,body:{variants:[v],expectedRevision:dto.catalogRevision}})).status,200)
  const beforeCheckout=await state014(f.db)
  const url='/catalog/variant-prices?ids='+f.normal.variant;assert.equal((await f.http(url)).body.data.items[0].effectivePrice,2900)
  await waitClock(f.db,start);assert.equal((await f.http(url)).body.data.items[0].effectivePrice,2450.25)
  const retired={outcome:'retired',code:'QUOTE_CHANGED',idempotencyKey:q1.idempotencyKey}
  assert.deepEqual(await placeV1(f.db,q1,rq),retired)
  assert.equal((await f.db.query('select state from checkout_v1_attempts where token=$1',['checkout:'+q1.idempotencyKey])).rows[0].state,'retired')
  assert.deepEqual(await placeV1(f.db,q1,rq),retired)
  await assert.rejects(()=>orderV2(f.db,request),/V2_QUOTE_CHANGED/)
  await waitClock(f.db,end);assert.equal((await f.http(url)).body.data.items[0].effectivePrice,2900)
  assert.deepEqual((await f.db.query('select to_jsonb(o) value from orders o where id=$1',[historical.id])).rows[0].value,oldOrder)
  assert.equal((await f.db.query('select count(*)::int n from orders')).rows[0].n,1);assert.equal((await f.db.query('select count(*)::int n from payments')).rows[0].n,1)
  assert.deepEqual(await state014(f.db),beforeCheckout)
 })
})


test('Release 010 application coupon administration, V1/V2 quotation and frozen receipt integration',{timeout:120000},async t=>{
 const f=await salesFixture(t),{db}=f,client={...phase3SqlClient(db),rpc:clientV2(db).rpc},actor={userId:f.admin,requestId:'release010-application'}
 const adminService=new CouponsService(client,{warn(){}})
 const input={code:'GLOBAL_APP20',type:'Percentage',discountValue:20,minimumOrderAmount:1000,maxDiscountAmount:null,description:'Fixture',startDate:null,endDate:null,usageLimit:100,perCustomerUsageLimit:0,status:'Active'}
 let count=0
 async function scenario(name,work){let passed=false;await t.test(name,async()=>{await work();passed=true;count++});if(!passed)throw Error('Critical Release010 application verification failure: '+name)}
 await scenario('Missing Release 010 rejects trusted creation atomically without a legacy fallback',async()=>{
  const before=await state014(db);await assert.rejects(()=>adminService.create(input,actor),e=>e.status===503);assert.deepEqual(await state014(db),before)
 })
 const legacy=[]
 for(const [type,value]of [['Percentage',10],['Fixed Amount',100],['Free Shipping',0]])legacy.push((await db.query('insert into coupons(code,type,discount_value,status) values($1,$2,$3,$4) returning *',['LEGACY_APP_'+legacy.length,type,value,'Active'])).rows[0])
 await db.query(await readFile(new URL('../../supabase/release-migrations/010_coupon_sale_comparison.sql',import.meta.url),'utf8'))
 const config=createAuthConfig({NODE_ENV:'test',CLIENT_ORIGIN:origin,AUTH_CSRF_SECRET:'application-coupon-fixture-csrf-123456789',ADMIN_AUTH_PROVIDER:'prototype',CUSTOMER_AUTH_PROVIDER:'prototype',ENABLE_ADMIN_MFA:'false'}),names=getAuthCookieNames(config)
 const runtime={config,repository:{client},sessionService:{restore:async({accessToken})=>{if(!accessToken)throw Object.assign(Error(),{code:'AUTH_REQUIRED'});return {record:{sessionClass:accessToken==='customer'?'customer':'administrator',mfaAssurance:'aal2'},identity:{id:accessToken,assuranceLevel:'aal2'}}}},adminAuthorization:{resolve:async id=>({userId:f.admin,permissions:id===f.admin?['coupons.manage']:[]})}}
 const app=express();app.use(requestContext,cookieParser());app.use('/coupons',createAdminPhase3V1Router(runtime,'coupons',{client,logger:{warn(){}}}));app.use(authErrorHandler(config))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)))
 async function http(body,{who=f.admin,csrf=true,requestOrigin=origin}={}){
  const token=getSessionCsrfToken('application-fixture',config),headers={'Content-Type':'application/json',Origin:requestOrigin}
  if(who){headers.Cookie=names.access+'='+who+'; '+names.refresh+'=refresh; '+names.session+'=application-fixture; '+names.csrf+'='+token;if(csrf)headers['X-RF-CSRF']=token}
  const r=await fetch('http://127.0.0.1:'+server.address().port+'/coupons',{method:'POST',headers,body:JSON.stringify(body)});return{status:r.status,body:await r.json()}
 }
 await scenario('HTTP authentication, RBAC, CSRF and Origin cannot bypass coupon creation',async()=>{
  const before=await state014(db)
  for(const [opts,status]of [[{who:null},401],[{who:'customer'},403],[{who:'denied'},403],[{csrf:false},403],[{requestOrigin:'https://foreign.invalid'},403]])assert.equal((await http(input,opts)).status,status)
  assert.deepEqual(await state014(db),before)
 })
 await scenario('HTTP and service reject fixed/free-shipping, policy injection and restrictions before writes',async()=>{
  for(const patch of [{type:'Fixed Amount'},{type:'Free Shipping',discountValue:0},{pricingPolicy:'LEGACY'},{pricing_policy:'LEGACY'},{productIds:[f.normal.product]},{categoryIds:[randomUUID()]},{discountValue:101}]){
   const before=await state014(db);assert.equal((await http({...input,...patch})).status,400);await assert.rejects(()=>adminService.create({...input,...patch},actor),e=>e.status===400);assert.deepEqual(await state014(db),before)
  }
 })
 await scenario('Authorized percentage creation persists explicit policy, cap/minimum and audit attribution',async()=>{
  const r=await http({...input,maxDiscountAmount:150});assert.equal(r.status,201,'Authorized coupon creation must return HTTP 201');const c=r.body.data;assert.equal(c.pricingPolicy,'GLOBAL_PERCENTAGE_V1');assert.equal(c.maxDiscountAmount,150);assert.equal(c.minimumOrderAmount,1000)
  const row=(await db.query('select * from coupons where id=$1',[c.id])).rows[0];assert.equal(row.pricing_policy,'GLOBAL_PERCENTAGE_V1');assert.equal(Number(row.max_discount_amount),150)
  assert.equal((await db.query("select count(*)::int n from admin_audit_logs where resource_id=$1 and admin_id=$2 and permission_key='coupons.manage' and action='coupon.create' and request_id is not null",[c.id,f.admin])).rows[0].n,1)
 })
 await scenario('Actual service_role can persist the trusted new policy without privilege expansion',async()=>{
  await db.query('set role service_role')
  try{const saved=await adminService.create({...input,code:'SERVICE_POLICY10'},actor);assert.equal(saved.pricingPolicy,'GLOBAL_PERCENTAGE_V1')}
  finally{await db.query('reset role')}
  const row=(await db.query("select pricing_policy from coupons where code='SERVICE_POLICY10'")).rows[0];assert.equal(row.pricing_policy,'GLOBAL_PERCENTAGE_V1')
 })
 for(const row of legacy)await scenario('Existing '+row.type+' remains LEGACY through viewing and supported editing',async()=>{
  const c=await adminService.detail(row.id);assert.equal(c.type,row.type);assert.equal(c.pricingPolicy,'LEGACY')
  const config=Object.fromEntries(Object.keys(input).filter(k=>!['code','type'].includes(k)).map(k=>[k,c[k]]));const saved=await adminService.update(row.id,{...config,description:'Updated legacy fixture',expectedUpdatedAt:c.updatedAt},actor)
  assert.equal(saved.pricingPolicy,'LEGACY');assert.equal(saved.type,row.type);assert.equal((await db.query('select pricing_policy from coupons where id=$1',[row.id])).rows[0].pricing_policy,'LEGACY')
 })
 const v1=new CheckoutQuoteService(client,{logger:{warn(){}}}),orders=new OrdersV1Service(client,{logger:{warn(){}}}),v2=new CheckoutQuoteV2Service(client,{logger:{warn(){}}}),orders2=new OrdersV2Service(client,{environment:'test',allowNonProductionOrders:true,logger:{warn(){}}})
 for(const version of [1,2])for(const kind of ['none','SALE','COUPON','tie'])await scenario('V'+version+' '+kind+' SQL evidence survives quotation, placement and frozen replay',async()=>{
  await updateStandard(f,{regularPrice:1000,salePrice:900,saleStartsAt:null,saleEndsAt:null,stockQuantity:200})
  const c=kind==='none'?null:await adminService.create({...input,code:'APP_'+version+'_'+kind.toUpperCase(),discountValue:kind==='SALE'?5:kind==='tie'?10:20},actor)
  let q,request,r
  if(version===1){const quoteInput=v1Request(f.normal.variant,c?.code??'');q=await v1.quote(quoteInput);request={idempotencyKey:q.idempotencyKey,items:quoteInput.items,contact:{name:'Fixture',email:quoteInput.email,phone:'00000000000'},shipping:{address:'Fixture address',...quoteInput.shipping,notes:''},paymentMethod:'Cash on Delivery',couponCode:c?.code??'',quoteFingerprint:q.quoteFingerprint};r=await orders.create(request)}
  else{q=await v2.quote({...quoteRequest([normalLine(f.normal.variant)]),couponCode:c?.code??''});request={contractVersion:2,idempotencyKey:randomUUID(),lines:[normalLine(f.normal.variant)],contact:{name:'Fixture Customer',email:'fixture@example.invalid',phone:'00000000000'},shipping:{address:'Fixture address',city:'Karachi',province:'Sindh',notes:''},paymentMethod:'Cash on Delivery',couponCode:c?.code??'',quoteFingerprint:q.quoteFingerprint};r=await orders2.create(request)}
  if(version===1)assertV1PricingEvidence(q,r,request)
  else assert.deepEqual(r.pricingOutcome,q.pricingOutcome)
  assert.equal(q.pricingOutcome.strategy,kind==='COUPON'?'COUPON':'SALE')
  const frozen=(await db.query('select variant_id,quantity,unit_price::text,line_total::text from order_items where order_id=$1',[r.id])).rows;assert.equal(frozen.length,1);assert.equal(frozen[0].variant_id,f.normal.variant);assert.equal(Number(frozen[0].unit_price),q.lines[0].unitPrice);assert.equal(Number(frozen[0].line_total),q.lines[0].lineTotal)
  if(version===1)assert.deepEqual(r.lines.map(({id,...line})=>line),q.lines)
  assert(!('_prices' in q));assert(!('_coupon' in q));assert(!('_demand' in q));await committed(db,r.id,q,{coupon:kind==='COUPON'?c.id:null})
  const before=await state014(db);assert.deepEqual(await(version===1?orders.create(request):orders2.create(request)),{...r,idempotent:true});assert.deepEqual(await state014(db),before)
  console.log('Release010 application evidence '+JSON.stringify({version,kind,subtotal:q.subtotal,discount:q.discount,shippingFee:q.shippingFee,total:q.total,strategy:q.pricingOutcome.strategy,couponOutcome:q.pricingOutcome.couponOutcome}))
 })
 await scenario('V2 fixed/configurable selected lines retain composition and independent/component pricing',async()=>{
  for(const lines of [[fixedLine(f)],[configuredLine(f)]]){const q=await v2.quote(quoteRequest(lines));assert.equal(q.lines.length,1);assert(q.lines[0].components.length>0);assert(q.lines[0].definitionFingerprint)}
 })
 await scenario('Legacy coupon quote/receipt remains unclassified with actual frozen lines',async()=>{
  const input=v1Request(f.normal.variant,legacy[0].code),q=await v1.quote(input),request={idempotencyKey:q.idempotencyKey,items:input.items,contact:{name:'Fixture',email:input.email,phone:'00000000000'},shipping:{address:'Fixture address',...input.shipping,notes:''},paymentMethod:'Cash on Delivery',couponCode:input.couponCode,quoteFingerprint:q.quoteFingerprint},r=await orders.create(request)
  assert(!('pricingOutcome'in q));assert(!('pricingOutcome'in r));assert.deepEqual(r.lines.map(({id,...line})=>line),q.lines)
 })
 console.log('Release010 application completed scenarios: '+count)
})

test('V2 quantity projection preserves SQL service and canonical HTTP receipt contracts',{timeout:120000},async t=>{
 const f=await salesFixture(t),{db}=f
 await db.query(await readFile(new URL('../../supabase/release-migrations/010_coupon_sale_comparison.sql',import.meta.url),'utf8'))
 await updateStandard(f,{regularPrice:1000,salePrice:900,saleStartsAt:null,saleEndsAt:null,stockQuantity:200})
 await updateTester(f,f.tester,{regularPrice:250,salePrice:225,saleStartsAt:null,saleEndsAt:null,stockQuantity:200})
 await updatePack(f,f.fixed,{fixedRegularPrice:450,fixedSalePrice:400,fixedSaleStartsAt:null,fixedSaleEndsAt:null})
 const database=(await db.query('select current_database() name')).rows[0].name
 const sqlResults=[],client={async rpc(name,args){
  const c=await connection(database)
  try{const result=await client014(c).rpc(name,args);if(!result.error)sqlResults.push({name,data:structuredClone(result.data)});return result}
  finally{await c.end()}
 }}
 const config=createAuthConfig({NODE_ENV:'test',CLIENT_ORIGIN:origin,AUTH_CSRF_SECRET:'quantity-contract-fixture-123456789012345',ADMIN_AUTH_PROVIDER:'prototype',CUSTOMER_AUTH_PROVIDER:'prototype',ENABLE_ADMIN_MFA:'false'})
 const runtime={config,repository:{client},sessionService:{restore:async()=>{throw Error('Unexpected session restoration in guest fixture')}}}
 const app=express();app.use(requestContext,cookieParser(),express.json({limit:'32kb'}))
 app.use('/api/v2/public',createOrdersV2Router(runtime,{client,allowNonProductionOrders:true,logger:{warn(){}}}))
 app.use(authErrorHandler(config))
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve))
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}))
 const base='http://127.0.0.1:'+server.address().port
 async function http(path,body){
  const response=await fetch(base+'/api/v2/public/'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)})
  return {status:response.status,body:await response.json()}
 }
 const fixedRevision=(await db.query('select definition_revision::text revision from tester_packs where product_id=$1',[f.fixed.product.id])).rows[0].revision
 const pack=quantity=>({...fixedLine(f,quantity),definitionRevision:fixedRevision})
 const cases=[
  {name:'normal quantity one',lines:[normalLine(f.normal.variant)],subtotal:900,discount:0,physical:1,outcome:'not_requested'},
  {name:'normal quantity three',lines:[normalLine(f.normal.variant,3)],subtotal:3000,discount:600,physical:3,outcome:'applied',percentage:20},
  {name:'standalone tester quantity two',lines:[normalLine(f.tester.tester.variant_id,2)],subtotal:500,discount:100,physical:2,outcome:'applied',percentage:20},
  {name:'fixed pack quantity two',lines:[pack(2)],subtotal:900,discount:180,physical:4,outcome:'applied',percentage:20},
  {name:'configurable pack quantity two',lines:[configuredLine(f,undefined,2)],subtotal:1000,discount:200,physical:4,outcome:'applied',percentage:20},
  {name:'mixed supported kinds',lines:[normalLine(f.normal.variant,2),normalLine(f.tester.tester.variant_id,2),pack(2),configuredLine(f,undefined,2)],subtotal:4400,discount:880,physical:12,outcome:'applied',percentage:20},
  {name:'repeated canonical identities aggregate',lines:[normalLine(f.normal.variant),normalLine(f.normal.variant,2),pack(1),pack(1),configuredLine(f),configuredLine(f)],subtotal:4900,discount:980,physical:11,outcome:'applied',percentage:20,lineCount:3},
  {name:'sale winner',lines:[normalLine(f.normal.variant,2)],subtotal:1800,discount:0,physical:2,outcome:'sale_better',percentage:5},
  {name:'sale tie',lines:[normalLine(f.normal.variant,2)],subtotal:1800,discount:0,physical:2,outcome:'tie',percentage:10},
 ]
 const money=value=>BigInt(Math.round(value*100))
 function assertLines(actual,sql){
  assert.deepEqual(actual,sql)
  for(const line of actual){
   assert(Number.isSafeInteger(line.quantity)&&line.quantity>0)
   assert.equal(money(line.unitPrice)*BigInt(line.quantity),money(line.lineTotal))
   for(const component of line.components)assert.equal(component.totalPhysicalQuantity,component.quantityPerPack*line.quantity)
  }
 }
 async function scenario(name,work){let passed=false;await t.test(name,async()=>{await work();passed=true});if(!passed)throw Error('Critical V2 quantity contract failure: '+name)}
 let expectedMovementRows=0
 for(const item of cases){
  const code=item.percentage?'QUANTITY_'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase():''
  let couponId=null
  if(code)couponId=(await db.query("insert into coupons(code,type,discount_value,status) values($1,'Percentage',$2,'Active') returning id",[code,item.percentage])).rows[0].id
  const input={...quoteRequest(item.lines),couponCode:code},sql=await quoteV2(db,input)
  expectedMovementRows+=new Set(sql.lines.flatMap(line=>line.kind==='normal_variant'?[line.variantId]:line.components.map(component=>component.testerVariantId))).size
  await scenario('service: '+item.name,async()=>{
   // Real SQL output is the oracle. Inject private sentinels only to challenge projection.
   const enriched=structuredClone(sql),before=structuredClone(sql),calls=[]
   Object.assign(enriched,{_prices:['private'],_coupon:{private:true},_demand:['private'],serviceRole:'private'})
   for(const line of enriched.lines){Object.assign(line,{_regularPrice:1,salePrice:1,saleStartsAt:'2099-01-01',saleEndsAt:'2099-02-01',privateResolution:'private'});for(const component of line.components)Object.assign(component,{_regularReference:1,serviceRole:'private'})}
   enriched.pricingOutcome.privateEligibility='private'
   const service=new CheckoutQuoteV2Service({from(){throw Error('Unexpected second database read')},async rpc(name,args){calls.push({name,args});return {data:enriched,error:null}}})
   const result=await service.quote(input)
   assert.equal(calls.length,1);assert.equal(calls[0].name,'quote_checkout_v2');assert.deepEqual(calls[0].args.p_request,input)
   assert.deepEqual(result,sql);assert.deepEqual(sql,before);assertLines(result.lines,sql.lines)
   assert.doesNotMatch(JSON.stringify(result),/_prices|_coupon|_demand|serviceRole|_regularPrice|saleStartsAt|saleEndsAt|salePrice|privateResolution|privateEligibility|_regularReference/)
  })
  await scenario('HTTP/PostgreSQL: '+item.name,async()=>{
   const response=await http('checkout/quote',input);assert.equal(response.status,200,'V2 quote must return HTTP 200')
   const q=response.body.data,underlying=sqlResults.at(-1)
   assert.equal(underlying.name,'quote_checkout_v2');assertLines(q.lines,underlying.data.lines);assertLines(q.lines,sql.lines)
   assert.equal(q.quoteFingerprint,sql.quoteFingerprint);assert.deepEqual(q.pricingOutcome,sql.pricingOutcome)
   assert.equal(q.lines.length,item.lineCount??item.lines.length);assert.equal(q.subtotal,item.subtotal);assert.equal(q.discount,item.discount);assert.equal(q.shippingFee,250);assert.equal(q.total,item.subtotal-item.discount+250)
   if(item.lineCount)assert.deepEqual(['normal_variant','fixed_tester_pack','configurable_tester_pack'].map(kind=>q.lines.find(line=>line.kind===kind).quantity),[3,2,2])
   assert.equal(q.pricingOutcome.couponOutcome,item.outcome);assert.equal(q.pricingOutcome.strategy,item.outcome==='applied'?'COUPON':'SALE')
   assert.equal(q.lines.reduce((sum,line)=>sum+money(line.lineTotal),0n),money(q.subtotal))
   assert.doesNotMatch(JSON.stringify(q),/_prices|_coupon|_demand|_regularPrice|_regularReference|saleStartsAt|saleEndsAt|serviceRole/)
   const request={contractVersion:2,idempotencyKey:randomUUID(),lines:item.lines,contact:{name:'Fixture Customer',email:input.email,phone:'00000000000'},shipping:{address:'Fixture address',...input.shipping,notes:''},paymentMethod:'Cash on Delivery',couponCode:code,quoteFingerprint:q.quoteFingerprint}
   const placed=await http('orders',request);assert.equal(placed.status,201,'V2 order creation must return HTTP 201')
   const receipt=placed.body.data
   assert.equal(receipt.quoteFingerprint,q.quoteFingerprint);assert.deepEqual(receipt.pricingOutcome,q.pricingOutcome)
   const receiptLines=receipt.lines.map(({id,components,...line})=>({...line,components:components.map(({id,...component})=>component)}))
   assertLines(receiptLines,q.lines)
   await committed(db,receipt.id,q,{quantities:item.physical,coupon:item.outcome==='applied'?couponId:null})
   const stored=(await db.query('select quantity,unit_price::text,line_total::text from order_items where order_id=$1 order by position',[receipt.id])).rows
   assert.deepEqual(stored.map(row=>({quantity:row.quantity,unitPrice:Number(row.unit_price),lineTotal:Number(row.line_total)})),q.lines.map(({quantity,unitPrice,lineTotal})=>({quantity,unitPrice,lineTotal})))
   const beforeReplay=await state014(db),replay=await http('orders',request)
   assert.equal(replay.status,200);assert.deepEqual(replay.body.data,{...receipt,idempotent:true});assert.deepEqual(await state014(db),beforeReplay)
   console.log('V2 quantity HTTP evidence '+JSON.stringify({case:item.name,operation:'checkout.v2.quote-order-replay',quoteStatus:response.status,orderStatus:placed.status,replayStatus:replay.status,lineCount:q.lines.length,physicalDemand:item.physical,assertions:'passed'}))
  })
 }
 const state=await state014(db)
 assert.equal(state.orders.length,cases.length);assert.equal(state.payments.length,cases.length);assert.equal(state.movements.length,expectedMovementRows)
 assert.equal(state.movements.reduce((sum,row)=>sum-row.quantity_delta,0),cases.reduce((sum,item)=>sum+item.physical,0))
 console.log('V2 quantity committed state '+JSON.stringify({operation:'checkout.v2.committed-state',scenarios:cases.length,orders:state.orders.length,payments:state.payments.length,inventoryMovements:state.movements.length,assertions:'passed'}))
})
