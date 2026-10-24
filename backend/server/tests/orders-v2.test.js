import assert from 'node:assert/strict'
import test,{before,after} from 'node:test'
import express from 'express'
import cookieParser from 'cookie-parser'
import {createAuthConfig} from '../auth/config.js'
import {getAuthCookieNames,getSessionCsrfToken} from '../auth/cookies.js'
import {requestContext,authErrorHandler} from '../middleware/authSecurity.js'
import {createOrdersV2Router} from '../routes/ordersV2.js'
import {OrdersV1Service} from '../services/ordersV1Service.js'
import {AdminOrdersV1Service} from '../services/adminOrdersV1Service.js'
import {CheckoutQuoteV2Service} from '../services/checkoutQuoteV2Service.js'
import {fixtureV2,clientV2,quoteRequest,fixedLine,normalLine,requestV2,orderV2} from './support/checkoutV2Database.js'
import {startIsolatedApi} from './support/isolatedApi.js'
import {checkedFixture} from './support/checkedV1Database.js'
let f,server,base,calls=[],logs=[]
const origin='https://checkout.example.invalid'
const config={...createAuthConfig({NODE_ENV:'test',CLIENT_ORIGIN:origin,AUTH_CSRF_SECRET:'synthetic-v2-secret-1234567890123456789',ADMIN_AUTH_PROVIDER:'prototype',CUSTOMER_AUTH_PROVIDER:'prototype',ENABLE_ADMIN_MFA:'false'}),environment:'production',secureCookies:true,allowDevelopmentLoopback:false}
const names=getAuthCookieNames(config)
before(async()=>{
 f=await fixtureV2();const client=clientV2(f.db),real=client.rpc.bind(client)
 client.rpc=async(...args)=>{calls.push(args);return real(...args)}
 const runtime={config,repository:{client},sessionService:{restore:async({accessToken})=>({record:{sessionClass:accessToken==='admin'?'administrator':'customer'},identity:{id:f.admin,emailVerified:true}})}}
 const app=express();app.use(requestContext);app.use(cookieParser());app.use(express.json({limit:'32kb'}))
 app.use('/api/v2/public',createOrdersV2Router(runtime,{client,logger:{warn:l=>logs.push(l)}}));app.use(authErrorHandler(config))
 app.use((e,req,res,_next)=>res.status(e.status??500).json({error:{code:'INVALID_CHECKOUT_REQUEST',message:'Invalid checkout request.',requestId:req.requestId}}))
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}/api/v2/public`
})
after(async()=>{if(server)await new Promise(r=>server.close(r));if(f)await f.db.close()})
async function http(path,body,{actor,csrf=true,requestOrigin=origin,raw=false}={}){
 const headers={'Content-Type':'application/json','Origin':requestOrigin,'X-Request-ID':'v2-api-request-id'}
 if(actor){const token=getSessionCsrfToken('synthetic-handle',config);headers.Cookie=`${names.access}=${actor}; ${names.refresh}=refresh; ${names.session}=synthetic-handle; ${names.csrf}=${token}`;if(csrf)headers['X-RF-CSRF']=token}
 const res=await fetch(base+path,{method:'POST',headers,body:raw?body:JSON.stringify(body)});return {status:res.status,body:await res.json(),cache:res.headers.get('cache-control'),requestId:res.headers.get('x-request-id')}
}
test('guest v2 quote uses authoritative SQL envelope and requestId with ordering disabled',async()=>{
 const r=await http('/checkout/quote',quoteRequest([fixedLine(f)]));assert.equal(r.status,200);assert.equal(r.body.data.subtotal,450);assert.equal(r.body.data.orderingEnabled,false)
 assert.equal(r.body.data.contractVersion,2);assert.equal(r.body.meta.requestId,r.requestId);assert.match(r.requestId,/^req_[0-9a-f-]{36}$/);assert.notEqual(r.requestId,'v2-api-request-id');assert.equal(r.cache,'no-store')
 assert.equal(r.body.data._demand,undefined);assert.equal(r.body.data._couponId,undefined)
})
test('verified customer UUID is server-derived; administrator/CSRF/origin failures reject',async()=>{
 const body=quoteRequest([normalLine(f.normal.variant)])
 assert.equal((await http('/checkout/quote',body,{actor:'customer'})).status,200)
 assert.equal(calls.at(-1)[1].p_customer_id,f.admin)
 for(const options of [{actor:'admin'},{actor:'customer',csrf:false},{requestOrigin:'https://evil.example.invalid'}])assert.equal((await http('/checkout/quote',body,options)).status,403)
})
test('strict quote rejects forged authority, prices, fixed contents and unknown fields before SQL',async()=>{
 for(const change of [b=>b.customerId=f.admin,b=>b.actorId=f.admin,b=>b.total=1,b=>b.lines[0].components=[],b=>b.lines[0].price=1,b=>b.extra=true,b=>b.shipping.extra=true]){
  const body=quoteRequest([fixedLine(f)]);change(body);const count=calls.length;assert.equal((await http('/checkout/quote',body)).status,400);assert.equal(calls.length,count)
 }
})
test('invalid JSON, scalar body, version and raw request size fail safely',async()=>{
 for(const body of ['{','null','false',JSON.stringify({...quoteRequest([fixedLine(f)]),contractVersion:1}),' '.repeat(33000)]){
  const r=await http('/checkout/quote',body,{raw:true});assert.equal(r.status,body.length>32768?413:400);assert.doesNotMatch(JSON.stringify(r.body),/stack|SELECT|Authorization|secret/)
 }
})
test('v2 order endpoint stays unavailable and makes zero order RPC calls',async()=>{
 const request=await requestV2(f.db,[fixedLine(f)]),count=calls.length,r=await http('/orders',request)
 assert.equal(r.status,503);assert.equal(r.body.error.code,'CHECKOUT_UNAVAILABLE');assert.equal(calls.length,count)
 assert.equal((await f.db.query('select count(*)::int n from public.orders')).rows[0].n,0)
})
test('strict order injection is rejected before unavailable response with no RPC',async()=>{
 const body=await requestV2(f.db,[fixedLine(f)]);body.customerId=f.admin;const count=calls.length
 assert.equal((await http('/orders',body)).status,400);assert.equal(calls.length,count)
})
test('diagnostics preserve request correlation and redact internal database errors',async()=>{
 const entries=[],service=new CheckoutQuoteV2Service({rpc:async()=>({error:{code:'XX000',message:'SELECT password secret Authorization payload',stack:'private'}})},{logger:{warn:l=>entries.push(l)},requestId:'v2-correlated-id'})
 await assert.rejects(()=>service.quote(quoteRequest([fixedLine(f)])),{code:'CHECKOUT_UNAVAILABLE'})
 assert.equal(entries[0].requestId,'v2-correlated-id');assert.equal(entries[0].operation,'quote_checkout_v2');assert.equal(entries[0].subsystem,'checkout_v2');assert.equal(entries[0].category,'XX000')
 assert.doesNotMatch(JSON.stringify(entries),/password|Authorization|payload|SELECT|stack/)
})
test('v1 service rejects normal-only v2 replay; Admin reads frozen detail after 014',async t=>{
 const checked=await checkedFixture(t)
 const req=await requestV2(checked.db,[normalLine(checked.normal.variant)]),receipt=await orderV2(checked.db,req),client=clientV2(checked.db)
 const v1={idempotencyKey:req.idempotencyKey,items:[{variantId:checked.normal.variant,quantity:1}],contact:req.contact,shipping:req.shipping,paymentMethod:req.paymentMethod,couponCode:''}
 await assert.rejects(()=>new OrdersV1Service(client,{logger:{warn(){}}}).create(v1),{code:'IDEMPOTENCY_CONFLICT'})
 const admin=new AdminOrdersV1Service(client,{warn(){}}),list=await admin.list({page:1,pageSize:25},'fixture-request')
 assert.equal(list.items.find(o=>o.id===receipt.id).checkoutVersion,2);assert.equal(list.items.find(o=>o.id===receipt.id).fulfillmentSupported,true)
 const detail=await admin.detail(receipt.id,['*'],'fixture-request');assert.equal(detail.snapshotVersion,2);assert.equal(detail.items[0].variantId,f.normal.variant)
})
test('actual API parser redacts malformed JSON on canonical and case/trailing-slash routes',async()=>{
 const api=await startIsolatedApi()
 try {
  for(const path of ['/api/v2/public/checkout/quote','/api/v2/public/orders/','/api/V2/public/orders']){
   const r=await fetch(api.baseUrl+path,{method:'POST',headers:{'Content-Type':'application/json','X-Request-ID':'parser-boundary-id'},body:'{"customer_secret":"private-value",'})
   assert.equal(r.status,400);const body=await r.json();assert.equal(body.error.code,'INVALID_CHECKOUT_REQUEST');assert.equal(body.error.requestId,r.headers.get('x-request-id'));assert.match(body.error.requestId,/^req_[0-9a-f-]{36}$/);assert.notEqual(body.error.requestId,'parser-boundary-id')
   assert.doesNotMatch(JSON.stringify(body),/private-value|customer_secret|stack|SyntaxError/)
  }
 }finally{await api.stop()}
})
