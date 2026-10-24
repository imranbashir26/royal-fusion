import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {openSync,closeSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {checkedFixture} from './support/checkedV1Database.js'
import {connection} from './support/release005NativeFixture.js'
import {clientV2,requestV2,normalLine,orderV2} from './support/checkoutV2Database.js'
import {state014} from './support/fulfillmentV2Database.js'
import {OrdersV1Service} from '../services/ordersV1Service.js'
import {CheckoutQuoteService} from '../services/checkoutQuoteService.js'
const variant='b35b3be7-a7dd-4c70-9c14-d1a9394d4711'
const contact={name:'Fixture',email:'fixture@example.invalid',phone:'00000000000'}
const shipping={address:'Fixture address',city:'Karachi',province:'Sindh',notes:''}
const quoteInput=(couponCode='')=>({items:[{variantId:variant,quantity:1}],email:contact.email,shipping:{city:shipping.city,province:shipping.province},couponCode})
const input=(q,couponCode='')=>({idempotencyKey:q.idempotencyKey,items:quoteInput().items,contact,shipping,paymentMethod:'Cash on Delivery',couponCode,quoteFingerprint:q.quoteFingerprint})
const release=new URL('../../supabase/release-migrations/008_durable_checkout_attempts.sql',import.meta.url)
async function advisoryKey(observer,key){return (await observer.query(`select
 ((hashtextextended($1,0)>>32)&4294967295)::text classid,
 (hashtextextended($1,0)&4294967295)::text objid,1::text objsubid`,[key])).rows[0]}
async function waitForLock(observer,pid,blockerPid,expectedKey,queryMarker){
 const observerPid=(await observer.query('select pg_backend_pid() pid')).rows[0].pid
 assert.ok(Number.isInteger(pid)&&Number.isInteger(blockerPid))
 assert.notEqual(observerPid,pid);assert.notEqual(observerPid,blockerPid);assert.notEqual(pid,blockerPid)
 const deadline=Date.now()+5000
 for(let i=0;i<200&&Date.now()<deadline;i++){
  const row=(await observer.query({text:`select a.pid,a.wait_event_type,a.wait_event,a.query,
   pg_blocking_pids(a.pid) blockers,w.classid::text,w.objid::text,w.objsubid::text
   from pg_stat_activity a join pg_locks w on w.pid=a.pid
   where a.pid=$1 and a.state='active' and a.wait_event_type='Lock' and a.wait_event='advisory'
   and w.locktype='advisory' and not w.granted and w.mode='ExclusiveLock'
   and exists(select 1 from pg_locks h where h.pid=$2 and h.granted and h.locktype=w.locktype
    and h.mode=w.mode and h.database is not distinct from w.database
    and (h.classid,h.objid,h.objsubid)=(w.classid,w.objid,w.objsubid))`,values:[pid,blockerPid],query_timeout:2000})).rows[0]
  if(row&&row.blockers.includes(blockerPid)&&row.query.includes(queryMarker)
   &&['classid','objid','objsubid'].every(k=>row[k]===String(expectedKey[k]))){
   console.log('Actual concurrent PG advisory lock: '+JSON.stringify({...row,observerPid,blockerPid}));return row
  }
  await new Promise(r=>setTimeout(r,20))
 }
 assert.fail('No matching real PG advisory lock wait within 5 seconds')
}
// Never silently skip a required native gate.
test('Release 008 durable attempt acceptance; real PG17 and stop on first failure',{timeout:240000},async t=>{
 const cleanup=[];const f=await checkedFixture({after:fn=>cleanup.push(fn)});let db=f.db
 const database=(await db.query('select current_database() db')).rows[0].db,clients=[]
 const additional=async()=>{const c=await connection(database);clients.push(c)
  // Capture once while idle; querying a blocked client would queue behind its lock.
  c.testBackendPid=(await c.query('select pg_backend_pid() pid')).rows[0].pid;return c}
 t.after(async()=>{for(const c of clients)await c.end();if(db!==f.db)await db.end();for(const fn of cleanup)await fn()})
 const quote=async(coupon='')=>new CheckoutQuoteService(clientV2(db),{logger:{warn(){}}}).quote(quoteInput(coupon))
 const place=(c,body)=>new OrdersV1Service(clientV2(c),{logger:{warn(){}}}).create(body)
 const terminal=async token=>(await db.query('select token,credential_verifier,quote_identity_mac,price_fingerprint_mac,request_identity_mac,state,created_at,retired_at from checkout_v1_attempts where token=$1',['checkout:'+token])).rows[0]
 const counts=async()=>(await db.query(`select (select count(*)::int from orders) orders,(select count(*)::int from payments) payments,(select count(*)::int from inventory_movements where reason='Order placed') movements,(select count(*)::int from coupon_redemptions) redemptions,(select stock_quantity from product_variants where id=$1) stock`,[variant])).rows[0]
 async function scenario(name,fn){let ok=false;await t.test(name,{timeout:60000},async()=>{await fn();ok=true});if(!ok)throw Error('Critical verification failure: '+name)}
 let retiredInput,replacementInput,replacementReceipt
 await scenario('original ABA sequence: retirement wins, price reverts, delayed request has no effects',async()=>{
  const a=await quote();retiredInput=input(a);const hold=await additional(),delayed=await additional(),retry=await additional()
  const gate=8000081;await hold.query('select pg_advisory_lock($1)',[gate]);let outcome
  try{
   outcome=(async()=>{await delayed.query('select pg_advisory_lock($1)',[gate]);try{return await place(delayed,retiredInput)}finally{await delayed.query('select pg_advisory_unlock($1)',[gate])}})().then(receipt=>({receipt}),error=>({error}))
   await waitForLock(db,delayed.testBackendPid,hold.testBackendPid,{classid:0,objid:gate,objsubid:1},'select pg_advisory_lock')
   await db.query('update product_variants set regular_price=3000 where id=$1',[variant])
   const before=await counts();await assert.rejects(()=>place(retry,retiredInput),{code:'QUOTE_CHANGED',status:409});assert.deepEqual(await counts(),before)
   assert.equal((await terminal(a.idempotencyKey)).state,'retired')
   const b=await quote();replacementInput=input(b);replacementReceipt=await place(retry,replacementInput);assert.equal(replacementReceipt.total,3250)
   await db.query('update product_variants set regular_price=2900 where id=$1',[variant])
  }finally{await hold.query('select pg_advisory_unlock($1)',[gate])}
  const delivered=await outcome;assert.equal(delivered.error?.code,'QUOTE_CHANGED');assert.equal(delivered.error?.status,409)
  assert.deepEqual(await counts(),{orders:1,payments:1,movements:1,redemptions:0,stock:11})
  assert.equal((await terminal(a.idempotencyKey)).state,'retired')
  const before=await state014(db);assert.equal((await place(retry,replacementInput)).id,replacementReceipt.id);assert.deepEqual(await state014(db),before)
  const finances=(await db.query('select o.total,p.amount,i.unit_price from orders o join payments p on p.order_id=o.id join order_items i on i.order_id=o.id')).rows
  assert.deepEqual(finances,[{total:'3250.00',amount:'3250.00',unit_price:'3000.00'}])
  const ledger=(await db.query("select quantity_delta,balance_after,reference_id from inventory_movements where reason='Order placed'")).rows
  assert.deepEqual(ledger,[{quantity_delta:-1,balance_after:11,reference_id:replacementReceipt.id}])
  const saved=(await db.query('select idempotency_key,v1_quote_fingerprint from orders where id=$1',[replacementReceipt.id])).rows[0]
  assert.equal(saved.idempotency_key,'checkout:'+replacementInput.idempotencyKey)
  const verifier=createHash('sha256').update('rf:v1:capability:008:'+replacementInput.quoteFingerprint,'utf8').digest('hex')
  assert.ok(saved.v1_quote_fingerprint===verifier,'Stored confirmation must equal the canonical capability verifier')
  assert.ok(saved.v1_quote_fingerprint!==replacementInput.quoteFingerprint,'Raw checkout capability must never be persisted')
  assert.equal((await terminal(replacementInput.idempotencyKey)).state,'committed')
  console.log('Committed ABA effects: '+JSON.stringify({counts:await counts(),finances,ledger,retiredToken:a.idempotencyKey,retiredState:'retired',replacementState:'committed'}))
 })
 await scenario('committed delivery wins token lock; concurrent duplicate returns identical replay',async()=>{
  const q=await quote(),body=input(q),first=await additional(),second=await additional()
  const key=await advisoryKey(db,'checkout:'+body.idempotencyKey);await first.query('begin')
  let pending
  try{const receipt=await place(first,body);pending=place(second,body).then(receipt=>({receipt}),error=>({error}))
   await waitForLock(db,second.testBackendPid,first.testBackendPid,key,'create_order_transaction_v1_checked')
   await first.query('commit');const result=await pending;if(result.error)throw result.error
   assert.equal(result.receipt.id,receipt.id);assert.equal(result.receipt.idempotent,true)
  }finally{await first.query('rollback');if(pending)await pending}
  assert.equal((await terminal(q.idempotencyKey)).state,'committed');assert.equal((await counts()).orders,2);assert.equal((await counts()).payments,2);assert.equal((await counts()).stock,10)
 })
 await scenario('lost terminal response and concurrent retries recover identical committed rejection',async()=>{
  const q=await quote(),body=input(q);await db.query('update shipping_methods set base_fee=251')
  const raw=await clientV2(db).rpc('create_order_transaction_v1_checked',{p_idempotency_key:'checkout:'+body.idempotencyKey,p_items:body.items,p_contact:contact,p_shipping:shipping,p_payment_method:body.paymentMethod,p_coupon_code:null,p_shipping_method_id:null,p_customer_id:null,p_quote_fingerprint:body.quoteFingerprint})
  assert.deepEqual(raw.data,{outcome:'retired',code:'QUOTE_CHANGED',idempotencyKey:body.idempotencyKey});assert.equal(raw.error,null)
  // Drop the returned response, reconnect, and retry simultaneously.
  const first=await additional(),second=await additional();const before=await counts()
  await Promise.all([assert.rejects(()=>place(first,body),{code:'QUOTE_CHANGED'}),assert.rejects(()=>place(second,body),{code:'QUOTE_CHANGED'})]);assert.deepEqual(await counts(),before)
  await db.query('update shipping_methods set base_fee=250');await assert.rejects(()=>place(db,body),{code:'QUOTE_CHANGED'});assert.equal((await terminal(body.idempotencyKey)).state,'retired')
 })
 await scenario('wrong credential, owner, identity, malformed input and unknown token cannot poison issued token',async()=>{
  const q=await quote(),body=input(q),before=await terminal(q.idempotencyKey)
  for(const altered of [{...body,quoteFingerprint:'0'.repeat(64)},{...body,contact:{...contact,email:'other@example.invalid'}},{...body,items:[{variantId:variant,quantity:2}]},{...body,shipping:{...shipping,city:'Lahore'}}])await assert.rejects(()=>place(db,altered),{code:'IDEMPOTENCY_CONFLICT'})
  await assert.rejects(()=>place(db,{...body,items:[{variantId:variant,quantity:0}]}),{code:'INVALID_QUANTITY'})
  await assert.rejects(()=>place(db,{...body,idempotencyKey:randomUUID()}),{code:'CHECKOUT_UNAVAILABLE'})
  const wrongOwner=new OrdersV1Service(clientV2(db),{logger:{warn(){}}});await assert.rejects(()=>wrongOwner.create(body,randomUUID()),{code:'IDEMPOTENCY_CONFLICT'})
  assert.ok(isDeepStrictEqual(await terminal(q.idempotencyKey),before),'Rejected requests must not alter any attempt field');await place(db,body);assert.equal((await terminal(q.idempotencyKey)).state,'committed')
 })
 await scenario('different full request cannot reuse a retired token; UUID textual aliases cannot reactivate it',async()=>{
  await assert.rejects(()=>place(db,{...retiredInput,contact:{...contact,name:'Different'}}),{code:'IDEMPOTENCY_CONFLICT'})
  await assert.rejects(()=>place(db,{...retiredInput,idempotencyKey:retiredInput.idempotencyKey.toUpperCase()}),{code:'QUOTE_CHANGED'})
 })
 await scenario('real retirement write failure rolls back and never returns replacement authorization',async()=>{
  const q=await quote(),body=input(q);await db.query('update shipping_methods set base_fee=252');const before=await counts()
  await db.query("create function public.rf008_injected_failure() returns trigger language plpgsql as $$begin raise exception 'fixture retirement disk failure';end$$; create trigger rf008_failure before update on checkout_v1_attempts for each row execute function public.rf008_injected_failure()")
  try{await assert.rejects(()=>place(db,body),e=>e.status>=500&&e.code!=='QUOTE_CHANGED');assert.equal((await terminal(q.idempotencyKey)).state,'active');assert.deepEqual(await counts(),before)}finally{await db.query('drop trigger rf008_failure on checkout_v1_attempts;drop function public.rf008_injected_failure()')}
  await assert.rejects(()=>place(db,body),{code:'QUOTE_CHANGED'});assert.equal((await terminal(q.idempotencyKey)).state,'retired');await db.query('update shipping_methods set base_fee=250')
 })
 await scenario('ACL, RLS, immutable terminal records and private RPC restrictions',async()=>{
  for(const role of ['anon','authenticated','service_role']){
   await db.query('set role '+role)
   try{for(const sql of ['select * from public.checkout_v1_attempts','delete from public.checkout_v1_attempts','truncate public.checkout_v1_attempts',"select public.checkout_v1_quote_identity_008('[]','', '{}','',null)","select public.quote_checkout_v1_007_internal('{}',null)"])await assert.rejects(()=>db.query(sql),e=>e.code==='42501')
    if(role!=='service_role')await assert.rejects(()=>db.query('select public.quote_checkout_v1_checked($1,null)',[JSON.stringify(quoteInput())]),e=>e.code==='42501')
   }finally{await db.query('reset role')}
  }
  await assert.rejects(()=>db.query('delete from checkout_v1_attempts'),/V1_ATTEMPT_IMMUTABLE/);await assert.rejects(()=>db.query('truncate checkout_v1_attempts'),/V1_ATTEMPT_IMMUTABLE/)
  const rls=(await db.query("select relrowsecurity from pg_class where oid='public.checkout_v1_attempts'::regclass")).rows[0];assert.equal(rls.relrowsecurity,true)
 })
 await scenario('V2 token fences and original V2 success/replay remain functional',async()=>{
  const v2=await requestV2(db,[normalLine(variant)]);const receipt=await orderV2(db,v2);const before=await counts();assert.equal((await orderV2(db,v2)).id,receipt.id);assert.deepEqual(await counts(),before)
  for(const token of [retiredInput.idempotencyKey,replacementInput.idempotencyKey,(await quote()).idempotencyKey])await assert.rejects(()=>orderV2(db,{...v2,idempotencyKey:token}),/V2_IDEMPOTENCY_CONFLICT/)
  await assert.rejects(()=>place(db,{...retiredInput,idempotencyKey:v2.idempotencyKey}),{code:'IDEMPOTENCY_CONFLICT'})
 })
 await scenario('coupon accounting remains exact and replay causes no duplicate redemption',async()=>{
  await db.query("insert into coupons(code,type,discount_value,status,usage_limit,per_customer_usage_limit) values('RETIRE008','Percentage',10,'Active',5,5)")
  const q=await quote('RETIRE008'),body=input(q,'RETIRE008');assert.equal(q.discount,290);const receipt=await place(db,body)
  assert.equal(receipt.total,2860);assert.equal((await db.query("select used_count from coupons where code='RETIRE008'")).rows[0].used_count,1)
  const before=await counts();assert.equal((await place(db,body)).id,receipt.id);assert.deepEqual(await counts(),before)
  const stale=input(await quote('RETIRE008'),'RETIRE008');await db.query("update coupons set discount_value=20 where code='RETIRE008'");await assert.rejects(()=>place(db,stale),{code:'QUOTE_CHANGED'})
  assert.deepEqual(await counts(),before);assert.equal((await db.query("select used_count from coupons where code='RETIRE008'")).rows[0].used_count,1)
 })
 await scenario('lost successful order response replays exact token without repeating financial or inventory effects',async()=>{
  const q=await quote(),body=input(q),before=await counts(),direct=clientV2(db),calls=[];let loseResponse=true
  const service=new OrdersV1Service({...direct,async rpc(name,args){
   calls.push(structuredClone(args));const result=await direct.rpc(name,args)
   if(loseResponse&&!result.error&&result.data?.id){loseResponse=false;throw Error('Lost response after real SQL commit')}
   return result
  }},{logger:{warn(){}}})
  await assert.rejects(()=>service.create(body),{code:'CHECKOUT_UNAVAILABLE',status:503})
  const committed=await counts();assert.deepEqual(committed,{...before,orders:before.orders+1,payments:before.payments+1,movements:before.movements+1,stock:before.stock-1})
  assert.equal((await terminal(q.idempotencyKey)).state,'committed')
  await db.query('update product_variants set regular_price=3100 where id=$1',[variant]);await db.query('update shipping_methods set base_fee=300')
  try{
   const changed=await state014(db),replay=await service.create(body)
   assert.equal(replay.idempotent,true);assert.equal(replay.total,q.total);assert.deepEqual(calls[0],calls[1]);assert.deepEqual(await state014(db),changed)
   assert.equal((await db.query('select amount from payments where order_id=$1',[replay.id])).rows[0].amount,String(q.total)+'.00')
  }finally{await db.query('update product_variants set regular_price=2900 where id=$1',[variant]);await db.query('update shipping_methods set base_fee=250')}
 })
 await scenario('retirement wins real token lock; duplicate waits for commit before receiving terminal rejection',async()=>{
  const q=await quote(),body=input(q),first=await additional(),second=await additional()
  const key=await advisoryKey(db,'checkout:'+body.idempotencyKey),before=await counts();let pending
  await db.query('update shipping_methods set base_fee=251');await first.query('begin')
  try{
   const result=await clientV2(first).rpc('create_order_transaction_v1_checked',{p_idempotency_key:'checkout:'+body.idempotencyKey,p_items:body.items,p_contact:contact,p_shipping:shipping,p_payment_method:body.paymentMethod,p_coupon_code:null,p_shipping_method_id:null,p_customer_id:null,p_quote_fingerprint:body.quoteFingerprint})
   assert.equal(result.error,null);assert.deepEqual(result.data,{outcome:'retired',code:'QUOTE_CHANGED',idempotencyKey:q.idempotencyKey})
   assert.equal((await terminal(q.idempotencyKey)).state,'active','Other sessions must not see uncommitted retirement')
   pending=place(second,body).then(receipt=>({receipt}),error=>({error}))
   await waitForLock(db,second.testBackendPid,first.testBackendPid,key,'create_order_transaction_v1_checked')
   await first.query('commit');const delivered=await pending
   assert.equal(delivered.error?.status,409);assert.equal(delivered.error?.code,'QUOTE_CHANGED')
   assert.equal((await terminal(q.idempotencyKey)).state,'retired');assert.deepEqual(await counts(),before)
  }finally{await first.query('rollback');if(pending)await pending;await db.query('update shipping_methods set base_fee=250')}
 })
 await scenario('one-shot guarded release rejects reexecution atomically',async()=>{
  const before=await counts(),sql=await readFile(release,'utf8');try{await assert.rejects(()=>db.query(sql),/RF_RELEASE008_BASELINE_DRIFT/)}finally{await db.query('rollback')}
  assert.deepEqual(await counts(),before)
 })
 await scenario('retirement persists across actual owned PostgreSQL restart',async()=>{
  const config=JSON.parse(await readFile(process.env.RF_RELEASE005_NATIVE_CONFIG,'utf8'));assert.equal(await readFile(config.cluster+'/release005-owned-marker','utf8'),config.marker);assert.ok(config.pgBin)
  const before=await counts(),previousStart=(await db.query('select pg_postmaster_start_time() started')).rows[0].started
  for(const c of clients.splice(0))await c.end();await db.end();f.db.end=async()=>{}
  const executable=path.join(config.pgBin,'pg_ctl'+(process.platform==='win32'?'.exe':''))
  // The restarted Windows postmaster inherits stdout/stderr. Captured pipes keep
  // execFileSync waiting for EOF even after pg_ctl exits successfully. Use owned
  // file descriptors for both lifecycle and server logs, with unchanged timeouts.
  const fd=openSync(path.join(path.dirname(config.cluster),'restart-postgres.log'),'a'),started=Date.now()
  try{execFileSync(executable,['restart','-D',config.cluster,'-m','fast','-w','-t','20'],{windowsHide:true,stdio:['ignore',fd,fd],timeout:45000})}finally{closeSync(fd)}
  db=await connection(database)
  const currentStart=(await db.query('select pg_postmaster_start_time() started')).rows[0].started
  assert.ok(currentStart>previousStart,'A different postmaster startup must be independently observed')
  console.log('Owned PostgreSQL restart: '+JSON.stringify({previousStart,currentStart,elapsedMs:Date.now()-started}))
  assert.equal((await terminal(retiredInput.idempotencyKey)).state,'retired')
  await assert.rejects(()=>place(db,retiredInput),{code:'QUOTE_CHANGED'});assert.equal((await place(db,replacementInput)).id,replacementReceipt.id);assert.deepEqual(await counts(),before)
 })
})
