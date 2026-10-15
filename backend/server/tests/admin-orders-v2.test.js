import assert from 'node:assert/strict'
import test,{before,after} from 'node:test'
import {randomUUID} from 'node:crypto'
import express from 'express'
import cookieParser from 'cookie-parser'
import {fixture014,client014,state014} from './support/fulfillmentV2Database.js'
import {fixtureV2,normalLine,fixedLine,configuredLine,quoteRequest,requestV2} from './support/checkoutV2Database.js'
import {createAuthConfig} from '../auth/config.js'
import {getAuthCookieNames,getSessionCsrfToken} from '../auth/cookies.js'
import {requestContext,authErrorHandler} from '../middleware/authSecurity.js'
import {AdminAuthorizationService} from '../services/adminAuthorizationService.js'
import {createAdminOrdersV1Router} from '../routes/adminOrdersV1.js'
import {createOrdersV2Router} from '../routes/ordersV2.js'
import {OrdersV2Service} from '../services/ordersV2Service.js'
import {OrdersV1Service} from '../services/ordersV1Service.js'
import {checkedFixture,confirmV1} from './support/checkedV1Database.js'
import {checkoutExecutionPolicy} from '../services/checkoutExecutionPolicy.js'
let f,client,server,base,calls=[],logs=[]
const origin='https://fulfillment014.example.invalid',logger={warn:e=>logs.push(e)}
const config={...createAuthConfig({NODE_ENV:'test',CLIENT_ORIGIN:origin,AUTH_CSRF_SECRET:'fixture014-secret-12345678901234567890',ADMIN_AUTH_PROVIDER:'prototype',CUSTOMER_AUTH_PROVIDER:'prototype',ENABLE_ADMIN_MFA:'false'}),adminMfaEnabled:true}
const names=getAuthCookieNames(config)
before(async()=>{
 f=await fixture014();client=client014(f.db);const rpc=client.rpc.bind(client)
 client.rpc=async(...args)=>{calls.push(structuredClone(args));return rpc(...args)}
 const runtime={config,repository:{client},adminAuthorization:new AdminAuthorizationService(client),sessionService:{restore:async({accessToken})=>({record:{sessionClass:accessToken==='customer'?'customer':'administrator',mfaAssurance:accessToken==='adminNoMfa'?'aal1':'aal2'},identity:{id:f.admin,emailVerified:true,assuranceLevel:accessToken==='adminNoMfa'?'aal1':'aal2'}})}}
 const app=express();app.use(requestContext,cookieParser(),express.json({limit:'32kb'}))
 app.use('/admin',createAdminOrdersV1Router(runtime,{client,logger}))
 app.use('/default',createOrdersV2Router(runtime,{client,logger}))
 app.use('/production',createOrdersV2Router({...runtime,config:{...config,environment:'production',secureCookies:true,allowDevelopmentLoopback:false}},{client,logger,allowNonProductionOrders:true}))
 app.use('/enabled',createOrdersV2Router(runtime,{client,logger,allowNonProductionOrders:true}))
 app.use(authErrorHandler(config));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`
})
after(async()=>{if(server)await new Promise(r=>server.close(r));if(f)await f.db.close()})
async function http(path,body,{actor,csrf=true,requestOrigin=origin,method=body===undefined?'GET':'POST'}={}){
 const headers={'Content-Type':'application/json','Origin':requestOrigin,'X-Request-ID':'api-014-correlation'}
 if(actor){const token=getSessionCsrfToken('fixture014-handle',config);headers.Cookie=`${names.access}=${actor}; ${names.refresh}=refresh; ${names.session}=fixture014-handle; ${names.csrf}=${token}`;if(csrf)headers['X-RF-CSRF']=token}
 const r=await fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()}
}
const enabledService=()=>new OrdersV2Service(client,{environment:'test',allowNonProductionOrders:true,logger})

test('execution policy is false by default and absolute production/unknown denial cannot be overridden',async()=>{
 for(const options of [{},{environment:'production',allowNonProductionOrders:true},{environment:'unknown',allowNonProductionOrders:true},{environment:'test',allowNonProductionOrders:'true'}])assert.equal(checkoutExecutionPolicy(options).orderingEnabled,false)
 const request=await requestV2(f.db,[fixedLine(f)]),before=await state014(f.db),count=calls.length
 for(const path of ['/default/orders','/production/orders']){
  const response=await http(path,request);assert.equal(response.status,503,JSON.stringify({path,response,logs}));assert.equal(response.body.error.code,'CHECKOUT_UNAVAILABLE')
 }
 assert.equal(calls.length,count);assert.deepEqual(await state014(f.db),before)
 for(const path of ['/default/checkout/quote','/production/checkout/quote','/enabled/checkout/quote']){
  const r=await http(path,quoteRequest([fixedLine(f)]));assert.equal(r.status,200);assert.equal(r.body.data.orderingEnabled,path.startsWith('/enabled'))
 }
})

test('real service-role HTTP creation/replay return 201/200 with trusted customer and frozen public receipt',async()=>{
 const request=await requestV2(f.db,[fixedLine(f),normalLine(f.normal.variant)]),created=await http('/enabled/orders',request,{actor:'customer'})
 assert.equal(created.status,201);assert.equal(created.body.data.contractVersion,2);assert.equal(calls.at(-1)[1].p_customer_id,f.admin)
 const before=await state014(f.db),replay=await http('/enabled/orders',request,{actor:'customer'})
 assert.equal(replay.status,200);assert.equal(replay.body.data.id,created.body.data.id);assert.deepEqual(await state014(f.db),before)
 assert.doesNotMatch(JSON.stringify(created.body),/canonical_request|quote_snapshot|customer_email|metadata|order_notes/)
 assert.equal(created.body.meta.requestId,'api-014-correlation')
})

test('lost response after commit retries the same UUID; changed intent conflicts without duplicate effects',async()=>{
 const request=await requestV2(f.db,[normalLine(f.second.tester.variant_id)]),rpc=client.rpc.bind(client);let lost=true
 client.rpc=async(...args)=>{const r=await rpc(...args);if(args[0]==='create_order_transaction_v2'&&lost&&!r.error){lost=false;throw new Error('fixture014 lost response')}return r}
 try{
  assert.equal((await http('/enabled/orders',request)).status,503)
  const after=await state014(f.db),retry=await http('/enabled/orders',request);assert.equal(retry.status,200);assert.equal(retry.body.data.idempotencyKey,request.idempotencyKey)
  assert.deepEqual(await state014(f.db),after)
  const conflict=await http('/enabled/orders',{...request,contact:{...request.contact,name:'Changed buyer'}});assert.equal(conflict.status,409);assert.equal(conflict.body.error.code,'IDEMPOTENCY_CONFLICT')
  assert.deepEqual(await state014(f.db),after)
 }finally{client.rpc=rpc}
})

test('Admin frozen DTO includes components, reference-only values and allowed actions with explicit version support',async()=>{
 const input=await requestV2(f.db,[configuredLine(f),fixedLine(f)]),order=await enabledService().create(input)
 await f.db.query("update public.products set name='Current renamed pack' where id=$1",[f.fixed.product.id])
 const list=await http('/admin',undefined,{actor:'admin'});assert.equal(list.status,200)
 assert.equal(list.body.data.items.find(i=>i.id===order.id).fulfillmentSupported,true)
 const detail=await http('/admin/'+order.id,undefined,{actor:'admin'});assert.equal(detail.status,200)
 const d=detail.body.data;assert.equal(d.snapshotVersion,2);assert.equal(d.physicalQuantity,4);assert.ok(d.allowedActions.includes('cancel'))
 assert.equal(d.items.find(i=>i.packId===f.fixed.product.id).name,order.lines.find(l=>l.packId===f.fixed.product.id).name)
 assert.ok(d.items.every(i=>i.variantId===null&&i.components.length===1&&typeof i.definitionRevision==='string'))
 assert.doesNotMatch(JSON.stringify(d),/canonical_request|quote_snapshot|requestFingerprint|quoteFingerprint|identityHash|mutationId|fingerprint|"metadata"/)
 const command={mutationId:randomUUID(),expectedRevision:d.revision,reason:'Frozen API cancellation'},r=await http('/admin/'+order.id+'/cancel',command,{actor:'admin'})
 assert.equal(r.status,200);assert.equal(r.body.data.changed,true)
 const after=await state014(f.db),retry=await http('/admin/'+order.id+'/cancel',command,{actor:'admin'});assert.equal(retry.body.data.replayed,true);assert.deepEqual(await state014(f.db),after)
})

test('Admin session/MFA/CSRF/origin and strict actor/stock injection remain fenced before RPC',async()=>{
 const input=await requestV2(f.db,[normalLine(f.normal.variant)]),order=await enabledService().create(input),body={mutationId:randomUUID(),expectedRevision:'0',reason:'Security test'},count=calls.length
 for(const options of [{},{actor:'customer'},{actor:'adminNoMfa'},{actor:'admin',csrf:false},{actor:'admin',requestOrigin:'https://evil.example.invalid'}])assert.ok([401,403].includes((await http('/admin/'+order.id+'/cancel',body,options)).status))
 for(const extra of [{actorId:f.admin},{stockQuantity:100},{components:[]}])assert.equal((await http('/admin/'+order.id+'/cancel',{...body,...extra},{actor:'admin'})).status,400)
 assert.equal(calls.length,count)
 const forged=await http('/enabled/orders',{...input,customerId:f.admin});assert.equal(forged.status,400);assert.equal(calls.length,count)
 assert.equal((await http('/enabled/orders',input,{actor:'admin'})).status,403)
})

test('malformed or privately extended RPC receipt is validated/allowlisted and diagnostics stay correlated',async()=>{
 const input=await requestV2(f.db,[normalLine(f.normal.variant)]),receipt=await enabledService().create(input),rpc=client.rpc
 try{
  client.rpc=async()=>({data:{...receipt,idempotent:true,canonical_request:{secret:'private'},customer_email:'private@example.invalid',lines:receipt.lines.map(l=>({...l,internal:'private'}))}})
  const replay=await enabledService().create(input,null,'receipt-014-request');assert.deepEqual(replay,{...receipt,idempotent:true})
  for(const change of [r=>({...r,idempotencyKey:randomUUID()}),r=>({...r,total:-1}),r=>({...r,lines:[]}),r=>({...r,lines:r.lines.map(l=>({...l,lineTotal:1}))})]){
   client.rpc=async()=>({data:change(receipt)});await assert.rejects(()=>enabledService().create(input,null,'receipt-014-request'),{code:'CHECKOUT_UNAVAILABLE'})
  }
  client.rpc=async()=>({error:{code:'XX000',message:'SELECT secret Authorization buyer@example.invalid',stack:'private'}})
  await assert.rejects(()=>enabledService().create(input,null,'receipt-014-request'),{code:'CHECKOUT_UNAVAILABLE'})
  const e=logs.at(-1);assert.equal(e.requestId,'receipt-014-request');assert.equal(e.operation,'create_order_transaction_v2')
  assert.doesNotMatch(JSON.stringify(logs),/SELECT secret|Authorization|buyer@example|"stack"/)
 }finally{client.rpc=rpc}
})

test('V1 Admin API remains usable on 014; dispatcher cancellation retains existing receipt/status contract',async t=>{
 const previous=f,from=client.from,rpc=client.rpc
 f=await checkedFixture(t);Object.assign(client,client014(f.db))
 try{
  const request=await confirmV1(f.db,{items:[{variantId:f.normal.variant,quantity:1}],contact:{name:'V1 buyer',email:'v1@example.invalid',phone:'00000000000'},shipping:{address:'Fictional Address',city:'Karachi',province:'Sindh',notes:''},paymentMethod:'Cash on Delivery',couponCode:''})
  const order=await new OrdersV1Service(client,{logger}).create(request),d=await http('/admin/'+order.id,undefined,{actor:'admin'});assert.equal(d.status,200)
  assert.equal(d.body.data.checkoutVersion,1);assert.equal(d.body.data.snapshotVersion,undefined)
  const cancel=await http('/admin/'+order.id+'/cancel',{mutationId:randomUUID(),expectedRevision:d.body.data.revision,reason:'V1 unchanged'},{actor:'admin'})
  assert.equal(cancel.status,200);assert.equal(cancel.body.data.status,'Cancelled')
 }finally{f=previous;client.from=from;client.rpc=rpc}
})

test('before 014 an explicitly enabled local service still cannot execute owner-only order RPC',async t=>{
 const old=await fixtureV2();t.after(()=>old.db.close());const input=await requestV2(old.db,[fixedLine(old)])
 const service=new OrdersV2Service(client014(old.db),{environment:'test',allowNonProductionOrders:true,logger})
 await assert.rejects(()=>service.create(input),{code:'CHECKOUT_UNAVAILABLE'})
 assert.equal((await old.db.query('select count(*)::int n from public.orders')).rows[0].n,0)
})
