import assert from 'node:assert/strict'
import test,{before,after} from 'node:test'
import {randomUUID} from 'node:crypto'
import express from 'express'
import cookieParser from 'cookie-parser'
import {createAuthConfig} from '../auth/config.js'
import {getAuthCookieNames,getSessionCsrfToken} from '../auth/cookies.js'
import {requestContext,authErrorHandler} from '../middleware/authSecurity.js'
import {createTesterPacksV2Router} from '../routes/testerPacksV2.js'
import {TesterCatalogService} from '../services/testerCatalogService.js'
import {ProductAdminService} from '../services/productAdminService.js'
import {AdminOrdersV1Service} from '../services/adminOrdersV1Service.js'
import {toProductDto} from '../mappers/productAdminMapper.js'
import {CheckoutQuoteService} from '../services/checkoutQuoteService.js'
import {isNormalJsonProduct} from '../routes/public.js'
import {createPackSchema,updatePackSchema} from '../schemas/testerCatalog.js'
import {testerBaseline,applyTesterMigration,testerFixture,savePack,productPatch,saveTester,variantPatch,testerSqlClient} from './support/testerCatalogDatabase.js'
let db,admin,client,service,tester,pack,server,base
const origin='https://catalog.example.invalid'
const config=createAuthConfig({NODE_ENV:'test',CLIENT_ORIGIN:origin,AUTH_CSRF_SECRET:'synthetic-catalog-csrf-secret-123456789',ADMIN_AUTH_PROVIDER:'prototype',CUSTOMER_AUTH_PROVIDER:'prototype',ENABLE_ADMIN_MFA:'false'})
const names=getAuthCookieNames(config)
before(async()=>{
 ({db,admin}=await testerBaseline());await applyTesterMigration(db);client=testerSqlClient(db);service=new TesterCatalogService(client,{error(){}})
 tester=await testerFixture(db,admin);const p=productPatch();delete p.price
 pack=await savePack(db,admin,null,p,{mode:'fixed',fixedRegularPrice:500,components:[{testerVariantId:tester.tester.variant_id,quantityPerPack:2,displayOrder:0}]})
 const runtime={config,repository:{client},sessionService:{restore:async({accessToken})=>{if(!accessToken)throw Object.assign(new Error('Required'),{code:'AUTH_REQUIRED'});return {record:{sessionClass:accessToken==='customer'?'customer':'administrator',mfaAssurance:'aal2'},identity:{id:accessToken,assuranceLevel:'aal2'}}}},adminAuthorization:{resolve:async id=>id===admin?{userId:admin,permissions:['*']}:null}}
 const app=express();app.use(requestContext);app.use(express.json({limit:'32kb'}));app.use(cookieParser())
 app.use('/api/v2/admin/tester-packs',createTesterPacksV2Router(runtime,{client,logger:{error(){}}}))
 app.use('/api/v2/public/tester-packs',createTesterPacksV2Router(runtime,{client,publicOnly:true,logger:{error(){}}}))
 app.use(authErrorHandler(config));app.use((e,req,res,_next)=>res.status(e.status||500).json({error:{code:'SAFE_FAILURE',requestId:req.requestId}}))
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}/api/v2`
})
after(async()=>{if(server)await new Promise(r=>server.close(r));if(db)await db.close()})
async function http(path,{method='GET',actor,body,csrf=true,requestOrigin=origin}={}){
 const headers={'Content-Type':'application/json','X-Request-ID':'tester-http-request-id'}
 if(actor){const token=getSessionCsrfToken('synthetic-handle',config);headers.Cookie=`${names.access}=${actor}; ${names.refresh}=refresh; ${names.session}=synthetic-handle; ${names.csrf}=${token}`;if(csrf)headers['X-RF-CSRF']=token}
 if(method!=='GET')headers.Origin=requestOrigin
 const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)})
 return {status:response.status,body:await response.json()}
}
test('public pack read supplies complete safe recipe, fixed pricing and advisory availability without purchasing',async()=>{
 const r=await http('/public/tester-packs/'+pack.product.id);assert.equal(r.status,200)
 assert.equal(r.body.data.fixedRegularPrice,500);assert.equal(r.body.data.availablePackCount,6);assert.equal(r.body.data.components.length,1);assert.equal(r.body.data.components[0].quantityPerPack,2);assert.equal(r.body.data.purchasable,false);assert.equal(r.body.data.components[0].sourceProductId,undefined);assert.equal(r.body.meta.requestId,'tester-http-request-id')
})
test('normal Admin list/get/update/archive exclude NULL-price packs before any mutation',async()=>{
 const normal=new ProductAdminService(client)
 const r=await normal.list({page:1,pageSize:25});assert.ok(r.items.every(i=>i.commerceKind!=='tester_pack'));assert.ok(r.items.some(i=>i.id===tester.product.id))
 for(const fn of [()=>normal.get(pack.product.id),()=>normal.update(pack.product.id,{name:'forged'},{userId:admin}),()=>normal.archive(pack.product.id,{userId:admin})])await assert.rejects(fn,{code:'PRODUCT_NOT_FOUND'})
 assert.equal((await service.get(pack.product.id)).name,pack.product.name)
 assert.throws(()=>toProductDto(pack.product),/normal product DTO/)
})
test('existing Admin product service creates and edits one independent structured tester variant',async()=>{
 const normal=new ProductAdminService(client),sku=randomUUID()
 const created=await normal.create({commerceKind:'tester',name:'Standalone tester',slug:sku,sku,price:300,scentFamily:'Woody',image:'/tester.webp',stockQuantity:9,status:'Published',testerAvailable:true},{userId:admin,requestId:'tester-product-request'})
 assert.equal(created.commerceKind,'tester');assert.equal(created.variants.length,1);assert.equal(created.variants[0].optionValue,'5 ml');assert.equal(created.variants[0].stockQuantity,9)
 const updated=await normal.update(created.id,{price:350,stockQuantity:4,expectedRevision:created.catalogRevision},{userId:admin,requestId:'tester-product-update'})
 assert.equal(updated.variants[0].id,created.variants[0].id);assert.equal(updated.price,350);assert.equal(updated.variants[0].regularPrice,350);assert.equal(updated.variants[0].stockQuantity,4)
 await assert.rejects(()=>normal.update(created.id,{commerceKind:'standard'},{userId:admin,requestId:'tester-kind-request'}),{code:'INVALID_REQUEST'})
})
test('inactive tester edit preserves physical inventory rather than overwriting it with the active-stock aggregate',async()=>{
 const created=await saveTester(db,admin,null,productPatch({status:'Draft'}),variantPatch({active:false,stockQuantity:12}))
 assert.equal(created.product.stock_quantity,0)
 const normal=new ProductAdminService(client),editable=await normal.get(created.product.id)
 assert.equal(editable.stockQuantity,12)
 const updated=await normal.update(created.product.id,{name:'Presentation edit',stockQuantity:editable.stockQuantity,expectedRevision:editable.catalogRevision},{userId:admin,requestId:'inactive-tester-edit'})
 assert.equal(updated.variants[0].stockQuantity,12);assert.equal(updated.variants[0].active,false)
})
test('v1 resolver accepts real standalone testers; forged pack UUID is unavailable with zero order RPCs',async()=>{
 const quote=new CheckoutQuoteService(client)
 assert.equal((await quote.variants([{variantId:tester.tester.variant_id,quantity:1}]))[0].product_id,tester.product.id)
 await assert.rejects(()=>quote.variants([{variantId:pack.product.id,quantity:1}]),{code:'VARIANT_NOT_FOUND'})
})
test('existing JSON allowlist preserves legacy standard/tester but rejects NULL/pack/unknown prices',()=>{
 for(const kind of ['standard','tester'])assert.equal(isNormalJsonProduct({commerceKind:kind,price:2900}),true)
 assert.equal(isNormalJsonProduct({price:2900}),true)
 assert.equal(isNormalJsonProduct({commerceKind:null,price:2900}),false)
 for(const kind of ['tester_pack','future',null])assert.equal(isNormalJsonProduct({commerceKind:kind,price:null}),false)
 assert.equal(isNormalJsonProduct({commerceKind:'tester_pack',price:2900}),false)
 assert.equal(isNormalJsonProduct({commerceKind:'future',price:2900}),false)
})
test('Admin reads require existing administrator session; writes require CSRF and exact Origin',async()=>{
 for(const actor of [undefined,'customer','forged'])assert.ok([401,403].includes((await http('/admin/tester-packs',{actor})).status))
 assert.equal((await http('/admin/tester-packs',{actor:admin})).status,200)
 const body={product:{name:'Draft',slug:'draft',sku:'draft',image:'/draft.webp',scentFamily:'Woody'},definition:{mode:'fixed',fixedRegularPrice:500}}
 assert.equal((await http('/admin/tester-packs',{method:'POST',actor:admin,body,csrf:false})).status,403)
 assert.equal((await http('/admin/tester-packs',{method:'POST',actor:admin,body,requestOrigin:'https://evil.example.invalid'})).status,403)
 assert.equal((await http('/admin/tester-packs',{method:'POST',actor:admin,body:{...body,actorId:admin}})).status,400)
})
test('strict schemas reject authority/price injection, wrong modes, and unbounded membership/payload',async()=>{
 const base={product:{name:'Draft',slug:'draft',sku:'draft',image:'/draft.webp',scentFamily:'Woody'},definition:{mode:'configurable'}}
 assert.equal(createPackSchema.safeParse(base).success,true)
 for(const value of [{...base,product:{...base.product,price:1}},{...base,definition:{...base.definition,fixedRegularPrice:100}},{...base,definition:{...base.definition,allowedVariants:Array.from({length:101},()=>({testerVariantId:tester.tester.variant_id,active:true,displayOrder:0}))}}])assert.equal(createPackSchema.safeParse(value).success,false)
 assert.equal(updatePackSchema.safeParse({product:{},definition:{},expectedRevision:'0'}).success,false)
 assert.equal((await http('/admin/tester-packs',{method:'POST',actor:admin,body:{...base,product:{...base.product,description:'x'.repeat(33000)}}})).status,413)
})
test('create, stale PATCH, atomic membership replacement, mode immutability and archive use frozen revisions',async()=>{
 const unique=randomUUID()
 const input={product:{name:'Created',slug:unique,sku:unique,image:'/draft.webp',scentFamily:'Woody'},definition:{mode:'configurable',allowedVariants:[{testerVariantId:tester.tester.variant_id,active:true,displayOrder:0}]}}
 const created=await http('/admin/tester-packs',{method:'POST',actor:admin,body:input});assert.equal(created.status,201)
 const c=created.body.data,path='/admin/tester-packs/'+c.id,rev={expectedRevision:c.catalogRevision,expectedDefinitionRevision:c.definitionRevision}
 const changed=await http(path,{method:'PATCH',actor:admin,body:{product:{name:'Edited'},definition:{},...rev}});assert.equal(changed.status,200)
 assert.equal((await http(path,{method:'PATCH',actor:admin,body:{product:{name:'Stale'},definition:{},...rev}})).status,409)
 const latest=changed.body.data
 const mode=await http(path,{method:'PATCH',actor:admin,body:{product:{},definition:{mode:'fixed'},expectedRevision:latest.catalogRevision,expectedDefinitionRevision:latest.definitionRevision}});assert.equal(mode.status,400)
 const archived=await http(path+'/archive',{method:'POST',actor:admin,body:{expectedRevision:latest.catalogRevision,expectedDefinitionRevision:latest.definitionRevision}});assert.equal(archived.status,200);assert.equal(archived.body.data.status,'Archived');assert.equal(Number(archived.body.data.definitionRevision),Number(latest.definitionRevision)+1)
 assert.equal((await http('/public/tester-packs/'+c.id)).status,404)
})
test('defensive public snapshot masking hides fixed recipes; configurable options exclude hidden memberships',async()=>{
 const hidden=await saveTester(db,admin,null,productPatch({status:'Unpublished'}),variantPatch())
 const p=productPatch();delete p.price
 const configurable=await savePack(db,admin,null,p,{mode:'configurable',allowedVariants:[{testerVariantId:tester.tester.variant_id,active:true,displayOrder:0},{testerVariantId:hidden.tester.variant_id,active:true,displayOrder:1}]})
 const publicConfig=await service.get(configurable.product.id,true)
 assert.deepEqual(publicConfig.allowedVariants.map(v=>v.testerVariantId),[tester.tester.variant_id]);assert.equal(JSON.stringify(publicConfig).includes(hidden.tester.variant_id),false)
 // Fault-inject a missing tester read rather than persisting an invalid published definition.
 class MissingTesterSnapshot extends TesterCatalogService {
  async read(table,filters,columns) {const rows=await super.read(table,filters,columns);return table==='products'&&filters.some(([op,k,v])=>op==='eq'&&k==='commerce_kind'&&v==='tester')?rows.filter(p=>p.id!==tester.product.id):rows}
 }
 const fixedPublic=await new MissingTesterSnapshot(client).get(pack.product.id,true)
 assert.equal(fixedPublic.available,false);assert.deepEqual(fixedPublic.components,[]);assert.equal(JSON.stringify(fixedPublic).includes(tester.tester.variant_id),false)
 assert.equal((await service.get(pack.product.id)).components[0].testerVariantId,tester.tester.variant_id)
})
test('backend relation reads paginate complete membership sets and bound UUID filter batches',async()=>{
 const rows=Array.from({length:1001},(_,i)=>({id:String(i),pack_id:'pack',tester_variant_id:String(i)})),calls=[]
 const reader={from(table){const q={filters:[],select(){return this},in(k,v){assert.ok(v.length<=100);this.filters.push(r=>v.includes(r[k]));return this},eq(k,v){this.filters.push(r=>r[k]===v);return this},order(){return this},range(a,b){this.a=a;this.b=b;return this},then(resolve,reject){calls.push([table,this.a,this.b]);return Promise.resolve({data:rows.filter(r=>this.filters.every(f=>f(r))).slice(this.a,this.b+1),error:null}).then(resolve,reject)}};return q}}
 const s=new TesterCatalogService(reader)
 assert.equal((await s.read('tester_pack_components',[])).length,1001);assert.equal(calls.length,3)
 calls.length=0;assert.equal((await s.read('products',[['in','id',rows.slice(0,250).map(r=>r.id)]])).length,250);assert.equal(calls.length,3)
})
test('request-scoped diagnostics keep requestId and normalized failure fields without SQL/secret exposure',async()=>{
 const logs=[],q={select(){return this},eq(){return this},order(){return this},range(){return this},then(resolve){return Promise.resolve({data:null,error:{code:'PGRST999',message:'SECRET SQL customer@example.invalid'}}).then(resolve)}}
 const s=new TesterCatalogService({from(){return q}},{error:e=>logs.push(e)},{requestId:'catalog-diagnostic-request'})
 await assert.rejects(()=>s.list(),e=>e.code==='TESTER_SERVICE_UNAVAILABLE'&&!e.message.includes('SECRET'))
 assert.deepEqual(logs,[{event:'tester_catalog.failed',operation:'list',subsystem:'products',category:'RELATIONAL_FAILURE',requestId:'catalog-diagnostic-request'}])
})
test('tester categories preserve omission, clear explicit null, replace UUID, and reject invalid/stale edits atomically',async()=>{
 const normal=new ProductAdminService(client),a=randomUUID(),b=randomUUID(),sku=randomUUID()
 for(const id of [a,b])await db.query("insert into public.categories(id,name,slug,status,active) values($1::uuid,$2,$1::text,'Published',true)",[id,id])
 const actor={userId:admin,requestId:'tester-category-review'},created=await normal.create({commerceKind:'tester',name:'Categorized tester',slug:sku,sku,price:250,image:'/tester.webp',scentFamily:'Woody',stockQuantity:3,status:'Published',categoryId:a},actor)
 let t=await normal.update(created.id,{name:'Category omitted',expectedRevision:created.catalogRevision},actor)
 assert.equal(t.categoryId,a)
 t=await normal.update(t.id,{categoryId:null,expectedRevision:t.catalogRevision},actor)
 assert.equal(t.categoryId,null);assert.equal(t.category,'');assert.equal(t.isAttar,false)
 t=await normal.update(t.id,{categoryId:b,expectedRevision:t.catalogRevision},actor)
 assert.equal(t.categoryId,b)
 const tables=['products','product_variants','tester_variants','tester_packs','tester_pack_components','tester_pack_allowed_variants','admin_audit_logs']
 const snapshot=()=>Promise.all(tables.map(async table=>(await db.query(`select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') rows from public.${table} r`)).rows))
 const before=await snapshot()
 await assert.rejects(()=>normal.update(t.id,{categoryId:randomUUID(),expectedRevision:t.catalogRevision},actor),{code:'INVALID_CATEGORY'})
 assert.deepEqual(await snapshot(),before)
 await assert.rejects(()=>normal.update(t.id,{categoryId:null,expectedRevision:created.catalogRevision},actor),{code:'CATALOG_STALE'})
 assert.deepEqual(await snapshot(),before)
})
test('published zero-stock fixed and configurable packs remain structurally valid and publicly unavailable',async()=>{
 const t=await saveTester(db,admin,null,productPatch(),variantPatch({stockQuantity:0,available:false}))
 for(const mode of ['fixed','configurable']) {
  const p=productPatch();delete p.price
  const saved=await savePack(db,admin,null,p,mode==='fixed'?{mode,fixedRegularPrice:500,components:[{testerVariantId:t.tester.variant_id,quantityPerPack:1,displayOrder:0}]}:{mode,allowedVariants:[{testerVariantId:t.tester.variant_id,active:true,displayOrder:0}]})
  const result=await service.get(saved.product.id,true)
  assert.equal(result.status,'Published');assert.equal(result.available,false);assert.equal(result.purchasable,false)
 }
})

// Real SQL, existing checkout and canonical cancellation; no production connections.
async function availabilityFixture(stock=1) {
 const normal=new ProductAdminService(client),actor={userId:admin,requestId:'tester-provenance-request'},sku=randomUUID()
 const t=await normal.create({commerceKind:'tester',name:'Provenance tester',slug:sku,sku,price:250,image:'/tester.webp',scentFamily:'Woody',status:'Published',stockQuantity:stock,testerAvailable:true},actor)
 const packs=[]
 for(const mode of ['fixed','configurable']) {
  const p=productPatch();delete p.price
  packs.push(await savePack(db,admin,null,p,mode==='fixed'?{mode,fixedRegularPrice:500,components:[{testerVariantId:t.variants[0].id,quantityPerPack:1,displayOrder:0}]}:{mode,allowedVariants:[{testerVariantId:t.variants[0].id,active:true,displayOrder:0}]}))
 }
 const definitions=async()=>Promise.all(packs.map(async p=>(await db.query('select to_jsonb(p) product,to_jsonb(d) definition from public.products p join public.tester_packs d on d.product_id=p.id where p.id=$1',[p.product.id])).rows[0]))
 const before=await definitions()
 const state=async()=>{
  const dto=await normal.get(t.id)
  const registry=(await db.query('select * from public.tester_variants where tester_product_id=$1',[t.id])).rows[0]
  assert.equal(dto.testerAvailable,registry.manual_available)
  assert.equal(dto.variants[0].available,registry.manual_available && dto.variants[0].stockQuantity>0)
  assert.deepEqual(await definitions(),before,'inventory/manual intent must not edit pack definitions or timestamps')
  return dto
 }
 const publicPacks=()=>Promise.all(packs.map(p=>service.get(p.product.id,true)))
 const update=async patch=>{const latest=await normal.get(t.id);return normal.update(t.id,{...patch,expectedRevision:latest.catalogRevision},actor)}
 const checkout=async()=>{
  await db.exec("insert into public.shipping_methods(code,name,base_fee) values('tester-provenance','Tester provenance fixture',250) on conflict do nothing")
  const r=await db.query('select public.create_order_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,null,null,null) receipt',[
   `checkout:${randomUUID()}`,JSON.stringify([{variantId:t.variants[0].id,quantity:1}]),JSON.stringify({name:'Synthetic customer',email:'tester-provenance@example.invalid',phone:'03001234567'}),JSON.stringify({address:'Synthetic fixture street',city:'Lahore',province:'Punjab',notes:''}),'Cash on Delivery'])
  return r.rows[0].receipt.id
 }
 const cancel=async id=>{
  const expectedRevision=String((await db.query('select revision from public.orders where id=$1',[id])).rows[0].revision)
  return new AdminOrdersV1Service(client,{warn(){}}).mutate(id,'cancel',{mutationId:randomUUID(),expectedRevision,reason:'Disposable provenance cancellation'},actor)
 }
 return {t,state,update,checkout,cancel,publicPacks}
}

test('last-unit checkout preserves manual intent; stock-only replenishment restores effective and pack availability',async()=>{
 const f=await availabilityFixture()
 await f.checkout()
 let t=await f.state();assert.equal(t.testerAvailable,true);assert.equal(t.variants[0].stockQuantity,0);assert.equal(t.variants[0].available,false)
 for(const p of await f.publicPacks()){assert.equal(p.status,'Published');assert.equal(p.available,false);assert.equal(p.purchasable,false);assert.deepEqual(p.components,[]);if(p.mode==='fixed')assert.equal(p.availablePackCount,0)}
 const updated=await f.update({stockQuantity:3})
 assert.equal(updated.testerAvailable,true);assert.equal(updated.variants[0].available,true)
 t=await f.state();assert.equal(t.variants[0].stockQuantity,3)
 const [fixed,configurable]=await f.publicPacks()
 assert.equal(fixed.available,true);assert.equal(fixed.availablePackCount,3);assert.equal(fixed.components.length,1)
 assert.equal(configurable.available,true);assert.equal(configurable.allowedVariants.length,1);assert.equal(configurable.minimumUnits,2)
})

test('canonical cancellation restores the last unit and effective availability without revising published packs',async()=>{
 const f=await availabilityFixture(),id=await f.checkout()
 let t=await f.state();assert.equal(t.testerAvailable,true);assert.equal(t.variants[0].available,false)
 await f.cancel(id)
 t=await f.state();assert.equal(t.testerAvailable,true);assert.equal(t.variants[0].stockQuantity,1);assert.equal(t.variants[0].available,true)
 assert.equal((await db.query('select status from public.orders where id=$1',[id])).rows[0].status,'Cancelled')
 const ledger=(await db.query('select quantity_delta,balance_after,reason from public.inventory_movements where reference_type=\'order\' and reference_id=$1 order by quantity_delta',[id])).rows
 assert.deepEqual(ledger,[{quantity_delta:-1,balance_after:0,reason:'Order placed'},{quantity_delta:1,balance_after:1,reason:'Order cancelled'}])
 assert.equal((await db.query("select count(*)::int n from public.order_status_history where order_id=$1 and to_status='Cancelled'",[id])).rows[0].n,1)
 const [fixed,configurable]=await f.publicPacks();assert.equal(fixed.available,true);assert.equal(configurable.available,false,'one unit cannot satisfy configurable minimum=2')
})

test('manual block survives stock-only replenishment; explicit enable restores availability without pack edits',async()=>{
 const f=await availabilityFixture(3)
 await f.update({testerAvailable:false})
 let t=await f.state();assert.equal(t.testerAvailable,false);assert.equal(t.variants[0].available,false)
 for(const p of await f.publicPacks()){assert.equal(p.status,'Published');assert.equal(p.available,false);assert.deepEqual(p.components,[]);assert.deepEqual(p.allowedVariants,[])}
 await f.update({stockQuantity:7})
 t=await f.state();assert.equal(t.testerAvailable,false);assert.equal(t.variants[0].stockQuantity,7);assert.equal(t.variants[0].available,false)
 for(const p of await f.publicPacks())assert.equal(p.available,false)
 await f.update({testerAvailable:true})
 t=await f.state();assert.equal(t.testerAvailable,true);assert.equal(t.variants[0].available,true)
 for(const p of await f.publicPacks())assert.equal(p.available,true)
})

test('manual block imposed after depletion survives real cancellation and later inventory writes',async()=>{
 const f=await availabilityFixture(),id=await f.checkout()
 await f.update({testerAvailable:false});await f.cancel(id)
 let t=await f.state();assert.equal(t.testerAvailable,false);assert.equal(t.variants[0].stockQuantity,1);assert.equal(t.variants[0].available,false)
 await db.query('update public.product_variants set stock_quantity=5,available=true where id=$1',[t.variants[0].id])
 t=await f.state();assert.equal(t.testerAvailable,false);assert.equal(t.variants[0].available,false)
 for(const p of await f.publicPacks())assert.equal(p.available,false)
 await f.update({testerAvailable:true});for(const p of await f.publicPacks())assert.equal(p.available,true)
})

test('manual enable at zero stock waits for inventory; configurable runtime counts repeated physical units',async()=>{
 const f=await availabilityFixture(0)
 await f.update({testerAvailable:false});await f.update({testerAvailable:true})
 let t=await f.state();assert.equal(t.testerAvailable,true);assert.equal(t.variants[0].available,false)
 await f.update({stockQuantity:1})
 let [fixed,configurable]=await f.publicPacks();assert.equal(fixed.available,true);assert.equal(configurable.available,false)
 await f.update({stockQuantity:2})
 ;[fixed,configurable]=await f.publicPacks();assert.equal(configurable.allowedVariants.length,1);assert.equal(configurable.available,true)
 await f.state()
})

test('configurable availability sums stocked active memberships and excludes manually blocked/inactive options',async()=>{
 const a=await availabilityFixture(),b=await testerFixture(db,admin,{stockQuantity:1}),inactive=await testerFixture(db,admin,{stockQuantity:5}),p=productPatch();delete p.price
 const saved=await savePack(db,admin,null,p,{mode:'configurable',allowedVariants:[{testerVariantId:a.t.variants[0].id,active:true,displayOrder:0},{testerVariantId:b.tester.variant_id,active:true,displayOrder:1},{testerVariantId:inactive.tester.variant_id,active:false,displayOrder:2}]})
 const definition=saved.definition
 let dto=await service.get(saved.product.id,true);assert.equal(dto.available,true);assert.equal(dto.allowedVariants.length,2)
 await a.update({testerAvailable:false})
 dto=await service.get(saved.product.id,true);assert.equal(dto.available,false);assert.deepEqual(dto.allowedVariants.map(v=>v.testerVariantId),[b.tester.variant_id])
 assert.deepEqual((await db.query('select to_jsonb(d) definition from public.tester_packs d where product_id=$1',[saved.product.id])).rows[0].definition,definition)
})
