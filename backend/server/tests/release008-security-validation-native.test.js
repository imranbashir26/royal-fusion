import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile, writeFile} from 'node:fs/promises'
import {createHash, createHmac, randomUUID} from 'node:crypto'
import {nativeFixture, connection} from './support/release005NativeFixture.js'
import {apply005} from './support/post014DefaultAclHardening.js'
import {shapeSQL} from './support/catalogManifest.js'
import {state014} from './support/fulfillmentV2Database.js'
import {clientV2, requestV2, normalLine, orderV2} from './support/checkoutV2Database.js'
import {CheckoutQuoteService} from '../services/checkoutQuoteService.js'
import {OrdersV1Service} from '../services/ordersV1Service.js'
import {createCheckoutClient} from '../../../frontend/src/services/checkoutClient.ts'
import {createCheckoutIntentStore} from '../../../frontend/src/store/checkoutIntentStore.ts'

// Release 008 ONLY. No successor loading, manifest refresh, production config or URLs.
const migrations = new URL('../../supabase/release-migrations/', import.meta.url)
const predecessor = '6076eb77ec31ddf953f6207c193cbebe5afb4c2568592676d19da736e8460fcb'
const expected = 'ef503bf722574c1c6f7febbd628cc93951d772928d0d28a735f75637ad31e819'
const variant = 'b35b3be7-a7dd-4c70-9c14-d1a9394d4711'
const product = '45852db8-8b83-425e-8d1f-4112958ed505'
const contact = {name:'Synthetic Customer', email:'synthetic@example.invalid', phone:'00012345678'}
const shipping = {address:'Synthetic private address', city:'Karachi', province:'Sindh', notes:'Synthetic private notes'}
const quoteInput = (extra={}) => ({items:[{variantId:variant,quantity:1}], email:contact.email, shipping:{city:shipping.city,province:shipping.province},couponCode:'',...extra})
const orderInput = q => ({idempotencyKey:q.idempotencyKey,items:quoteInput().items,contact:{...contact},shipping:{...shipping},paymentMethod:'Cash on Delivery',couponCode:'',quoteFingerprint:q.quoteFingerprint})
const verifier = value => createHash('sha256').update('rf:v1:capability:008:'+value).digest('hex')
const readers = ['supabase_etl_admin','supabase_read_only_user']
const operators = ['dashboard_user','supabase_auth_admin','supabase_storage_admin']
const privateFunctions = [
 'checkout_v1_verifier_008(text)','checkout_v1_mac_008(text,text,jsonb,text)',
 'checkout_platform_operator_008(oid)','checkout_platform_reader_008(oid)',
 'checkout_v1_attempt_guard_008()','checkout_v1_quote_identity_008(jsonb,text,jsonb,text,uuid)',
 'checkout_v1_request_identity_008(jsonb,jsonb,jsonb,text,text,uuid,uuid,text)',
 'quote_checkout_v1_007_internal(jsonb,uuid)','create_order_transaction_v2_008_internal(jsonb,uuid)',
 'resolve_checkout_v1_007(text,jsonb,jsonb,jsonb,text,text,uuid,uuid)',
 'create_order_v1_effects_007(text,jsonb,jsonb,jsonb,text,text,uuid,uuid,jsonb)',
]

test('Release 008 security validation on owned native PostgreSQL 17; stop on first critical failure',{timeout:540000},async t=>{
 const cleanup=[], clients=[], db=await nativeFixture({after:fn=>cleanup.push(fn)})
 const config=JSON.parse(await readFile(process.env.RF_RELEASE005_NATIVE_CONFIG,'utf8'))
 const evidence={scope:'008 only',passed:[],failed:[],successorsExecuted:false,productionAccess:false}
 t.after(async()=>{
  try {evidence.finalFingerprint=(await db.query(shapeSQL)).rows[0].shape}
  finally {
   await writeFile(new URL('release008-security-result.json','file:///'+config.cluster.replaceAll('\\','/').replace(/\/pgdata$/,'')+'/'),JSON.stringify(evidence,null,2)+'\n')
   for(const c of clients)await c.end()
   for(const fn of cleanup)await fn()
  }
 })
 const shape=async()=>(await db.query(shapeSQL)).rows[0].shape
 const apply=async sql=>{try{return await db.query(sql)}catch(e){await db.query('rollback');throw e}}
 const load=async name=>(await readFile(new URL(name,migrations),'utf8')).replaceAll('\r\n','\n')
 const sql=await load('008_durable_checkout_attempts.sql')
 async function scenario(name,fn){
  let passed=false
  await t.test(name,{timeout:60000},async()=>{
   try{await fn();evidence.passed.push(name);passed=true}
   catch(e){evidence.failed.push({name,message:e.message,code:e.code});throw e}
  })
  if(!passed)throw Error('Critical verification failed; no further tests executed: '+name)
 }
 const logs=[], issuedCapabilities=[], logger={warn:record=>logs.push(record)}
 const quote=async(extra={},customer=null,c=db)=>{
  const q=await new CheckoutQuoteService(clientV2(c),{logger}).quote(quoteInput(extra),customer)
  issuedCapabilities.push(q.quoteFingerprint);return q
 }
 const place=(body,c=db,customer=null)=>new OrdersV1Service(clientV2(c),{logger}).create(body,customer,'synthetic-request')
 const attempt=async q=>(await db.query('select * from public.checkout_v1_attempts where token=$1',['checkout:'+q.idempotencyKey])).rows[0]
 const state=async()=>({business:await state014(db),attempts:(await db.query('select * from public.checkout_v1_attempts order by token')).rows})
 const counts=async()=>(await db.query(`select (select count(*)::int from orders) orders,(select count(*)::int from payments) payments,
  (select count(*)::int from order_items) items,(select count(*)::int from inventory_movements where reason='Order placed') movements,
  (select count(*)::int from coupon_redemptions) redemptions,(select stock_quantity from product_variants where id=$1) stock`,[variant])).rows[0]
 const additional=async()=>{const c=await connection((await db.query('select current_database() n')).rows[0].n);clients.push(c);return c}
 const resetCommerce=async()=>{await db.query('update product_variants set regular_price=2900,sale_price=null,stock_quantity=30,standard_manual_available=true where id=$1',[variant]);await db.query('update shipping_methods set base_fee=250')}
 let guards
 async function mutation(sql,expectedCode,proof){
  await db.query('begin')
  try{
   await db.query(sql)
   if(proof)await proof()
   await assert.rejects(()=>db.query(guards),e=>e.code==='P0001'&&e.message===expectedCode)
  }finally{await db.query('rollback')}
  assert.equal(await shape(),expected)
 }
 async function waitLock(c,blocker){
  const pid=c.processID, blockerPid=blocker.processID,deadline=Date.now()+5000
  while(Date.now()<deadline){
   const r=(await db.query("select wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1",[pid])).rows[0]
   if(r?.wait_event_type==='Lock'&&r.blockers.includes(blockerPid)){evidence.concurrentLockObserved=true;return}
   await new Promise(resolve=>setTimeout(resolve,20))
  }
  assert.fail('No actual concurrent PostgreSQL lock wait observed')
 }
 await scenario('native 17.11 exact post-007 predecessor with bounded platform profiles',async()=>{
  evidence.version=(await db.query('show server_version')).rows[0].server_version
  assert.match(evidence.version,/^17\.11(?:\D|$)/)
  await apply005(db);await apply(await load('006_standard_variant_availability.sql'));await apply(await load('007_checked_v1_checkout.sql'))
  assert.equal(await shape(),predecessor)
  await db.query(`create role dashboard_user createrole nosuperuser nobypassrls nologin inherit createdb replication;
   create role supabase_auth_admin createrole nosuperuser nobypassrls login noinherit nocreatedb noreplication;
   create role supabase_storage_admin createrole nosuperuser nobypassrls login noinherit nocreatedb noreplication;
   create role supabase_etl_admin nosuperuser nocreaterole nocreatedb login inherit bypassrls replication;
   create role supabase_read_only_user nosuperuser nocreaterole nocreatedb login inherit bypassrls noreplication;
   grant pg_read_all_data to supabase_etl_admin,supabase_read_only_user with inherit true,set true,admin false;`)
  evidence.predecessor=await shape();assert.equal(evidence.predecessor,predecessor)
 })
 await scenario('missing cryptographic prerequisites fail before schema changes and fully roll back',async()=>{
  for(const [signature,name] of [['extensions.hmac(bytea,bytea,text)','rf008_missing_hmac'],['extensions.gen_random_bytes(integer)','rf008_missing_random']]){
   await db.query('begin');await db.query('alter function '+signature+' rename to '+name)
   await assert.rejects(()=>apply(sql),e=>e.message==='RF_RELEASE008_CRYPTO_REQUIRED')
   assert.equal(await shape(),predecessor)
   assert.equal((await db.query("select to_regclass('public.checkout_v1_attempts') value")).rows[0].value,null)
  }
 })
 await scenario('complete release 008 commits with the exact measured catalog and unchanged roles',async()=>{
  const roles=(await db.query('select * from pg_roles order by oid')).rows
  const result=await apply(sql);assert.equal(result.at(-1).command,'COMMIT')
  assert.equal(await shape(),expected);evidence.post008=await shape()
  assert.deepEqual((await db.query('select * from pg_roles order by oid')).rows,roles)
  const post=sql.slice(sql.lastIndexOf('do $post$'))
  const start=post.indexOf(' if not exists(select 1 from pg_class'),end=post.lastIndexOf('end; $post$;')
  assert(start>0&&end>start);guards='do $verify$ begin\n'+post.slice(start,end)+'end; $verify$;'
  await db.query(`insert into shipping_methods(code,name,base_fee) values('security008only','Synthetic shipping',250);
   insert into site_settings(id,payments) values('site','[{"name":"Cash on Delivery","active":true},{"name":"Bank Transfer","active":true}]') on conflict(id) do update set payments=excluded.payments`)
  await resetCommerce()
 })
 await scenario('CSPRNG issuance, 256-bit capability shape, fresh uniqueness, verifier-only storage',async()=>{
  const definition=(await db.query("select pg_get_functiondef('public.quote_checkout_v1_checked(jsonb,uuid)'::regprocedure) value")).rows[0].value
  assert.match(definition,/extensions\.gen_random_bytes\(32\)/)
  const seen=new Set()
  for(let i=0;i<12;i++){
   const q=await quote(),row=await attempt(q)
   assert.match(q.quoteFingerprint,/^[a-f0-9]{64}$/);assert(!seen.has(q.quoteFingerprint));seen.add(q.quoteFingerprint)
   assert.equal(row.credential_verifier,verifier(q.quoteFingerprint));assert.notEqual(row.credential_verifier,q.quoteFingerprint)
   assert.deepEqual(Object.keys(row).sort(),['token','credential_verifier','quote_identity_mac','price_fingerprint_mac','request_identity_mac','state','created_at','retired_at'].sort())
   for(const value of [q.quoteFingerprint,...Object.values(contact),shipping.address,shipping.notes])assert(!JSON.stringify(row).includes(value))
  }
 })
 await scenario('native HMAC RFC4231 vector and protocol cross-implementation/domain/token/key binding',async()=>{
  const vector=(await db.query("select encode(extensions.hmac(convert_to('Hi There','UTF8'),decode(repeat('0b',20),'hex'),'sha256'),'hex') value")).rows[0].value
  assert.equal(vector,'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7')
  const q=await quote(),row=await attempt(q),token='checkout:'+q.idempotencyKey
  const identity=(await db.query('select public.checkout_v1_quote_identity_008($1,$2,$3,$4,null)::text value',[JSON.stringify(quoteInput().items),contact.email,JSON.stringify(shipping),''])).rows[0].value
  const mac=(domain,key,tag=token)=>createHmac('sha256',Buffer.from(key,'hex')).update('rf008:'+domain+':'+tag+':'+identity).digest('hex')
  assert.equal(row.quote_identity_mac,mac('quote',q.quoteFingerprint))
  assert.notEqual(row.quote_identity_mac,mac('request',q.quoteFingerprint))
  assert.notEqual(row.quote_identity_mac,mac('quote',q.quoteFingerprint,'checkout:'+randomUUID()))
  assert.notEqual(row.quote_identity_mac,mac('quote',row.credential_verifier))
  for(const candidate of ['synthetic@example.invalid','other@example.invalid','customer@example.invalid']){
   assert.notEqual(row.quote_identity_mac,createHash('sha256').update(candidate).digest('hex'))
   assert.notEqual(row.quote_identity_mac,createHmac('sha256',Buffer.from(row.credential_verifier,'hex')).update(identity.replace(contact.email,candidate)).digest('hex'))
  }
  // Identical customer/quote data is unlinkable by equality of the persisted MACs.
  const other=await attempt(await quote());assert.notEqual(row.quote_identity_mac,other.quote_identity_mac)
  for(const bad of [null,'',q.quoteFingerprint.toUpperCase(),'x'.repeat(64),'a'.repeat(63)])await assert.rejects(()=>db.query('select public.checkout_v1_verifier_008($1)',[bad]),/V2_INVALID_REQUEST/)
  await assert.rejects(()=>db.query("select public.checkout_v1_mac_008('unknown',$1,'{}',$2)",[token,q.quoteFingerprint]),/V2_INVALID_REQUEST/)
 })
 await scenario('stored/modified/replayed verifiers and wrong capability/quote/customer cannot authorize or poison state',async()=>{
  const q=await quote(),body=orderInput(q),row=await attempt(q),other=await quote(),before=await state()
  for(const capability of [row.credential_verifier,verifier(row.credential_verifier),'0'.repeat(64),q.quoteFingerprint.slice(0,-1)+(q.quoteFingerprint.endsWith('0')?'1':'0'),other.quoteFingerprint])await assert.rejects(()=>place({...body,quoteFingerprint:capability}),{code:'IDEMPOTENCY_CONFLICT'})
  for(const altered of [{contact:{...contact,email:'other@example.invalid'}},{items:[{variantId:variant,quantity:2}]},{shipping:{...shipping,city:'Lahore'}},{couponCode:'OTHER'}])await assert.rejects(()=>place({...body,...altered}),{code:'IDEMPOTENCY_CONFLICT'})
  await assert.rejects(()=>place(body,db,randomUUID()),{code:'IDEMPOTENCY_CONFLICT'})
  await assert.rejects(()=>place({...body,idempotencyKey:randomUUID()}),{code:'CHECKOUT_UNAVAILABLE'})
  for(const bad of [null,undefined,'bad'])await assert.rejects(()=>place({...body,quoteFingerprint:bad}))
  assert.deepEqual(await state(),before)
 })
 await scenario('real pg_read_all_data plus BYPASSRLS sees sanitized attempts but cannot write or execute private RPCs',async()=>{
  const q=await quote()
  for(const role of readers){
   await db.query('set session authorization '+role)
   try{
    const p=(await db.query("select pg_has_role(current_user,'pg_read_all_data','USAGE') inherits,(select rolbypassrls from pg_roles where rolname=current_user) bypass")).rows[0]
    assert.deepEqual(p,{inherits:true,bypass:true})
    const row=(await db.query('select * from checkout_v1_attempts where token=$1',['checkout:'+q.idempotencyKey])).rows[0];assert(row)
    for(const value of [q.quoteFingerprint,...Object.values(contact),shipping.address,shipping.notes])assert(!JSON.stringify(row).includes(value))
    for(const statement of ["insert into checkout_v1_attempts(token) values('checkout:'||gen_random_uuid()::text)","update checkout_v1_attempts set state='retired'",'delete from checkout_v1_attempts','truncate checkout_v1_attempts'])await assert.rejects(()=>db.query(statement),e=>e.code==='42501')
    for(const signature of privateFunctions)assert.equal((await db.query("select has_function_privilege(current_user,$1,'EXECUTE') value",['public.'+signature])).rows[0].value,false)
    await assert.rejects(()=>db.query("select public.checkout_v1_verifier_008($1)",[q.quoteFingerprint]),e=>e.code==='42501')
    await assert.rejects(()=>db.query("select public.quote_checkout_v1_checked('{}',null)"),e=>e.code==='42501')
   }finally{await db.query('reset session authorization')}
  }
 })
 await scenario('owner-only ACLs, RLS without policies, private search paths and public RPC definer contexts',async()=>{
  const table=(await db.query("select relowner='postgres'::regrole owner,relrowsecurity rls,(select count(*)::int from pg_policy where polrelid=c.oid) policies,(select count(*)::int from aclexplode(c.relacl) a where grantee<>c.relowner) grants from pg_class c where oid='checkout_v1_attempts'::regclass")).rows[0]
  assert.deepEqual(table,{owner:true,rls:true,policies:0,grants:0})
  for(const signature of privateFunctions){
   const p=(await db.query("select proowner='postgres'::regrole owner,proconfig,(select count(*)::int from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where grantee<>proowner) grants from pg_proc where oid=$1::regprocedure",['public.'+signature])).rows[0]
   assert.equal(p.owner,true);assert.deepEqual(p.proconfig,['search_path=""']);assert.equal(p.grants,0)
  }
  for(const signature of ['quote_checkout_v1_checked(jsonb,uuid)','create_order_transaction_v1_checked(text,jsonb,jsonb,jsonb,text,text,uuid,uuid,text)','create_order_transaction_v2(jsonb,uuid)']){
   const p=(await db.query("select prosecdef,proowner='postgres'::regrole owner,proconfig from pg_proc where oid=$1::regprocedure",['public.'+signature])).rows[0]
   assert.equal(p.prosecdef,true);assert.equal(p.owner,true);assert.deepEqual(p.proconfig,['search_path=""'])
   for(const role of ['anon','authenticated','service_role',...operators,...readers])assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') value",[role,'public.'+signature])).rows[0].value,role==='service_role')
  }
  for(const role of ['anon','authenticated','service_role',...operators]){
   await db.query('set session authorization '+role)
   try{await assert.rejects(()=>db.query('select * from checkout_v1_attempts'),e=>e.code==='42501')}
   finally{await db.query('reset session authorization')}
  }
 })
 await scenario('valid confirmation/recovery writes one order/payment/stock ledger and no persisted raw capability',async()=>{
  const q=await quote(),body=orderInput(q),before=await counts(),a=await place(body),after=await counts()
  assert.deepEqual(after,{orders:before.orders+1,payments:before.payments+1,items:before.items+1,movements:before.movements+1,redemptions:before.redemptions,stock:before.stock-1})
  assert.equal(a.total,q.total);assert.equal(a.idempotent,false)
  assert.equal((await attempt(q)).state,'committed')
  assert.equal((await db.query('select v1_quote_fingerprint from orders where id=$1',[a.id])).rows[0].v1_quote_fingerprint,verifier(q.quoteFingerprint))
  assert(!JSON.stringify(a).includes(q.quoteFingerprint));assert(!JSON.stringify(await state()).includes(q.quoteFingerprint))
  const snapshot=await state(),second=await additional(),b=await place(body,second)
  assert.equal(b.id,a.id);assert.equal(b.idempotent,true);assert.deepEqual(await state(),snapshot)
  for(const altered of [{quoteFingerprint:(await attempt(q)).credential_verifier},{shipping:{...shipping,address:'Different address'}},{contact:{...contact,name:'Different name'}},{paymentMethod:'Bank Transfer'}])await assert.rejects(()=>place({...body,...altered}),{code:'IDEMPOTENCY_CONFLICT'})
  assert.deepEqual(await state(),snapshot)
  for(const role of readers){await db.query('set session authorization '+role);try{
   // Explicit limitation: database-wide readers can already read ordinary order PII.
   const o=(await db.query('select customer_email,shipping_address from orders where id=$1',[a.id])).rows[0]
   assert.equal(o.customer_email,contact.email);assert.equal(o.shipping_address,shipping.address)
  }finally{await db.query('reset session authorization')}}
 })
 await scenario('same-attempt concurrent confirmation actually waits and creates exactly one set of effects',async()=>{
  const q=await quote(),body=orderInput(q),a=await additional(),b=await additional(),before=await counts();let pending
  await a.query('begin')
  try{
   const first=await place(body,a);pending=place(body,b).then(value=>({value}),error=>({error}))
   await waitLock(b,a);await a.query('commit')
   const second=await pending;if(second.error)throw second.error
   assert.equal(second.value.id,first.id);assert.equal(second.value.idempotent,true)
  }finally{await a.query('rollback');if(pending)await pending}
  const after=await counts();assert.equal(after.orders,before.orders+1);assert.equal(after.payments,before.payments+1);assert.equal(after.movements,before.movements+1);assert.equal(after.stock,before.stock-1)
 })
 await scenario('first confirmation rolls back; a waiting same-attempt retry alone commits safely',async()=>{
  const q=await quote(),body=orderInput(q),a=await additional(),b=await additional(),before=await counts();let pending
  await a.query('begin')
  try{await place(body,a);pending=place(body,b).then(value=>({value}),error=>({error}));await waitLock(b,a);await a.query('rollback');const result=await pending;if(result.error)throw result.error;assert.equal(result.value.idempotent,false)}
  finally{await a.query('rollback');if(pending)await pending}
  const after=await counts();assert.equal(after.orders,before.orders+1);assert.equal(after.payments,before.payments+1);assert.equal(after.stock,before.stock-1)
 })
 await scenario('price changes retire once; ABA reversion/lost rejection/reconnect do not reactivate; request MAC freezes',async()=>{
  const q=await quote(),body=orderInput(q),before=await counts()
  await db.query('update shipping_methods set base_fee=251')
  await assert.rejects(()=>place(body),{code:'QUOTE_CHANGED'})
  const row=await attempt(q);assert.equal(row.state,'retired');assert.match(row.request_identity_mac,/^[a-f0-9]{64}$/)
  await db.query('update shipping_methods set base_fee=250')
  const c=await additional();await assert.rejects(()=>place(body,c),{code:'QUOTE_CHANGED'})
  await assert.rejects(()=>place({...body,contact:{...contact,phone:'11122233344'}}),{code:'IDEMPOTENCY_CONFLICT'})
  assert.deepEqual(await counts(),before);assert.deepEqual(await attempt(q),row)
  const fresh=await quote();assert.notEqual(fresh.idempotencyKey,q.idempotencyKey);await place(orderInput(fresh))
 })
 await scenario('insufficient stock/unavailable catalog rolls back without retiring or consuming attempt',async()=>{
  const q=await quote(),body=orderInput(q)
  for(const stock of [0]){
   await db.query('update product_variants set stock_quantity=$1 where id=$2',[stock,variant]);const before=await state()
   await assert.rejects(()=>place(body),e=>['OUT_OF_STOCK','INSUFFICIENT_STOCK','VARIANT_UNAVAILABLE'].includes(e.code));assert.deepEqual(await state(),before)
  }
  await resetCommerce();const q2=await quote({items:[{variantId:variant,quantity:2}]}),body2={...orderInput(q2),items:[{variantId:variant,quantity:2}]}
  await db.query('update product_variants set stock_quantity=1 where id=$1',[variant]);const before=await state()
  await assert.rejects(()=>place(body2),{code:'INSUFFICIENT_STOCK'});assert.deepEqual(await state(),before)
  await resetCommerce();await db.query('update product_variants set standard_manual_available=false where id=$1',[variant]);const unavailable=await state()
  await assert.rejects(()=>place(body));assert.deepEqual(await state(),unavailable);assert.equal((await attempt(q)).state,'active')
  await resetCommerce();await place(body)
 })
 await scenario('two concurrent distinct attempts compete for last inventory without overselling',async()=>{
  await resetCommerce();const q1=await quote(),q2=await quote();await db.query('update product_variants set stock_quantity=1 where id=$1',[variant])
  const a=await additional(),b=await additional(),before=await counts();let pending
  await a.query('begin')
  try{
   await place(orderInput(q1),a);pending=place(orderInput(q2),b).then(value=>({value}),error=>({error}))
   await waitLock(b,a);await a.query('commit');assert((await pending).error)
  }finally{await a.query('rollback');if(pending)await pending}
  const after=await counts();assert.equal(after.stock,0);assert.equal(after.orders,before.orders+1);assert.equal(after.payments,before.payments+1);assert.equal((await attempt(q2)).state,'active');await resetCommerce()
 })
 await scenario('late payment failure rolls back order/items/stock/coupon/history and active attempt',async()=>{
  const code='RF008ONLY',coupon=(await db.query("insert into coupons(code,type,discount_value,status,usage_limit) values($1,'Percentage',10,'Active',10) returning id",[code])).rows[0].id
  const q=await quote({couponCode:code}),body={...orderInput(q),couponCode:code}
  await db.query("create function public.rf008_fail_payment() returns trigger language plpgsql as $$begin raise exception 'RF008_SYNTHETIC_PAYMENT_FAILURE';end$$;create trigger rf008_fail before insert on payments for each row execute function public.rf008_fail_payment()")
  try{const before=await state();await assert.rejects(()=>place(body),e=>e.status>=500);assert.deepEqual(await state(),before)}
  finally{await db.query('drop trigger rf008_fail on payments;drop function public.rf008_fail_payment()')}
  const receipt=await place(body);assert.equal((await attempt(q)).state,'committed')
  assert.equal((await db.query('select used_count from coupons where id=$1',[coupon])).rows[0].used_count,1)
  assert.equal((await db.query('select count(*)::int n from coupon_redemptions where order_id=$1',[receipt.id])).rows[0].n,1)
  assert.equal(await shape(),expected)
 })
 await scenario('retirement write failure cannot authorize replacement and leaves all transactional records intact',async()=>{
  const q=await quote(),body=orderInput(q);await db.query('update shipping_methods set base_fee=252')
  await db.query("create function public.rf008_fail_retirement() returns trigger language plpgsql as $$begin raise exception 'RF008_SYNTHETIC_RETIRE_FAILURE';end$$;create trigger rf008_fail before update on checkout_v1_attempts for each row execute function public.rf008_fail_retirement()")
  try{const before=await state();await assert.rejects(()=>place(body),e=>e.status>=500&&e.code!=='QUOTE_CHANGED');assert.deepEqual(await state(),before)}
  finally{await db.query('drop trigger rf008_fail on checkout_v1_attempts;drop function public.rf008_fail_retirement()')}
  await assert.rejects(()=>place(body),{code:'QUOTE_CHANGED'});assert.equal((await attempt(q)).state,'retired');await resetCommerce()
 })
 for(const role of operators)for(const attribute of ['superuser','nocreaterole','bypassrls',role==='dashboard_user'?'login':'nologin',role==='dashboard_user'?'noinherit':'inherit',role==='dashboard_user'?'nocreatedb':'createdb',role==='dashboard_user'?'noreplication':'replication'])await scenario('reject altered platform operator '+role+' '+attribute,()=>mutation('alter role '+role+' '+attribute,'RF_RELEASE008_PRIVATE_ROLE_PATH'))
 for(const role of readers)for(const attribute of ['superuser','createrole','createdb','nobypassrls','nologin','noinherit',role==='supabase_etl_admin'?'noreplication':'replication'])await scenario('reject altered platform reader '+role+' '+attribute,()=>mutation('alter role '+role+' '+attribute,'RF_RELEASE008_PRIVATE_ROLE_PATH'))
 for(const [option,usage,set,admin] of [['inherit true,set false',true,false,false],['inherit false,set true',false,true,false],['inherit false,set false,admin true',false,false,true]])for(const target of ['postgres','supabase_read_only_user','pg_read_all_data','pg_write_all_data','pg_maintain'])await scenario('reject unauthorized membership '+target+' '+option,()=>mutation('grant '+target+' to service_role with '+option,'RF_RELEASE008_PRIVATE_ROLE_PATH',async()=>{
  const row=(await db.query("select pg_has_role('service_role',$1,'USAGE') usage,pg_has_role('service_role',$1,'SET') switch,(select admin_option from pg_auth_members where member='service_role'::regrole and roleid=$1::regrole) admin",[target])).rows[0]
  assert.deepEqual(row,{usage,switch:set,admin})
 }))
 await scenario('reject custom elevated role and indirect SET/USAGE paths into protected roles',async()=>{
  await mutation('create role rf008_intruder createrole','RF_RELEASE008_PRIVATE_ROLE_PATH')
  for(const option of ['inherit true,set true','inherit false,set true'])await mutation('create role rf008_bridge;grant supabase_read_only_user to rf008_bridge with '+option+';grant rf008_bridge to service_role with '+option,'RF_RELEASE008_PRIVATE_ROLE_PATH')
  for(const reader of readers)await mutation('grant pg_read_all_data to '+reader+' with admin true','RF_RELEASE008_PRIVATE_ROLE_PATH')
 })
 for(const role of ['anon','authenticated','service_role',...operators,...readers])await scenario('reject explicit table/column/write/private RPC grants to '+role,async()=>{
  for(const grant of ['select','update','insert','delete','truncate','select (credential_verifier)','update (state)'])await mutation('grant '+grant+' on checkout_v1_attempts to '+role,'RF_RELEASE008_PRIVATE_ACL')
  await mutation('grant execute on function public.checkout_v1_mac_008(text,text,jsonb,text) to '+role,'RF_RELEASE008_PRIVATE_RPC')
 })
 await scenario('PUBLIC private-function grant, policy drift, wrong ownership and widened search_path fail closed',async()=>{
  await mutation('grant execute on function public.checkout_v1_verifier_008(text) to public','RF_RELEASE008_PRIVATE_RPC')
  await mutation('create policy rf008_leak on checkout_v1_attempts for select to anon using(true)','RF_RELEASE008_PRIVATE_ACL')
  await mutation('alter table checkout_v1_attempts disable row level security','RF_RELEASE008_PRIVATE_ACL')
  await mutation('alter table checkout_v1_attempts owner to service_role','RF_RELEASE008_PRIVATE_ACL')
  await mutation('alter function public.checkout_v1_mac_008(text,text,jsonb,text) set search_path=public','RF_RELEASE008_PRIVATE_RPC')
 })
 await scenario('terminal attempts cannot be mutated/deleted/truncated even by ordinary owner SQL',async()=>{
  const q=await quote();await place(orderInput(q));const before=await state()
  for(const statement of ["update checkout_v1_attempts set state='active',request_identity_mac=null where token=$1",'delete from checkout_v1_attempts where token=$1'])await assert.rejects(()=>db.query(statement,['checkout:'+q.idempotencyKey]),/V1_ATTEMPT_IMMUTABLE/)
  await assert.rejects(()=>db.query('truncate checkout_v1_attempts'),/V1_ATTEMPT_IMMUTABLE/);assert.deepEqual(await state(),before)
 })
 await scenario('V2 confirmation/replay and both directions of the UUID namespace fence',async()=>{
  const request=await requestV2(db,[normalLine(variant)]),receipt=await orderV2(db,request),before=await state()
  assert.equal((await orderV2(db,request)).id,receipt.id);assert.deepEqual(await state(),before)
  const q=await quote();await assert.rejects(()=>orderV2(db,{...request,idempotencyKey:q.idempotencyKey}),/V2_IDEMPOTENCY_CONFLICT/)
  await assert.rejects(()=>place({...orderInput(q),idempotencyKey:request.idempotencyKey}),{code:'IDEMPOTENCY_CONFLICT'});assert.equal((await attempt(q)).state,'active')
 })
 await scenario('actual frontend client -> backend services -> native SQL quote/confirmation/lost-response recovery',async()=>{
  let lost=false, capturedQuote
  const fetcher=async(path,options)=>{
   if(path.endsWith('/session'))return new Response(JSON.stringify({data:{csrfToken:'synthetic'}}))
   try{
    const request=JSON.parse(options.body),data=path.endsWith('/quote')?{...await quote(request),orderingEnabled:true}:await place(request)
    if(path.endsWith('/quote'))capturedQuote=data
    if(lost&&!path.endsWith('/quote')){lost=false;throw Error('Synthetic lost committed response')}
    return new Response(JSON.stringify({data}))
   }catch(e){if(e.message==='Synthetic lost committed response')throw e;return new Response(JSON.stringify({error:{code:e.code,message:e.message}}),{status:e.status??500})}
  }
  const client=createCheckoutClient(fetcher,'/synthetic'),q=await client.quote(quoteInput()),body=orderInput(q)
  assert.equal(q.quoteFingerprint,capturedQuote.quoteFingerprint)
  lost=true;await assert.rejects(()=>client.createOrder(body),e=>e.unknownOutcome===true)
  const before=await state(),receipt=await client.createOrder(body);assert.equal(receipt.idempotent,true);assert.deepEqual(await state(),before);assert(!JSON.stringify(receipt).includes(q.quoteFingerprint))
 })
 await scenario('browser session recovery retains the bearer intentionally; no server key/environment secret required',async()=>{
  const q=await quote(),body=orderInput(q),saved=new Map(),storage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)}
  const lines=[{lineId:JSON.stringify([product,variant]),entryId:randomUUID(),variantId:variant,quantity:1}]
  const {idempotencyKey,...request}=body
  const first=createCheckoutIntentStore(storage,()=>randomUUID(),async()=> 'consumed')
  first.getState().freeze(request,lines,idempotencyKey)
  assert([...saved.values()].some(v=>v.includes(q.quoteFingerprint)))
  const recovered=createCheckoutIntentStore(storage,()=>randomUUID(),async()=> 'consumed')
  assert.deepEqual(recovered.getState().intent.request,body)
  const receipt=await place(recovered.getState().intent.request);await recovered.getState().complete(receipt)
  assert.equal(recovered.getState().receipt.id,receipt.id)
  evidence.browserBearerStorage='sessionStorage frozen request and completion; bearer/PII accessible to same-origin scripts'
 })
 await scenario('backend/frontend pricing evidence uses verifier for V1 and legacy binding for V2 (synthetic envelopes only)',async()=>{
  const q=await quote(),body=orderInput(q),receipt=await place(body)
  const pricing={policy:'GLOBAL_PERCENTAGE_V1',strategy:'SALE',regularSubtotal:q.subtotal,saleSubtotal:q.subtotal,couponDiscount:0,couponSubtotal:null,merchandiseTotal:q.subtotal,requestedCouponCode:'',appliedCouponId:null,appliedCouponCode:null,couponOutcome:'not_requested',acceptedQuoteFingerprint:verifier(q.quoteFingerprint)}
  // No release 010 is applied: these are contract fixtures for the changed binding only.
  const lines=[{id:randomUUID(),variantId:variant,quantity:1,unitPrice:q.subtotal,lineTotal:q.subtotal}]
  const serviceData={...receipt,lines,pricingOutcome:pricing}
  const backend=new OrdersV1Service({rpc:async()=>({data:serviceData})},{logger})
  assert.equal((await backend.create(body)).pricingOutcome.acceptedQuoteFingerprint,verifier(q.quoteFingerprint))
  const fetcher=async path=>new Response(JSON.stringify({data:path.endsWith('/session')?{csrfToken:'synthetic'}:serviceData}))
  const frontend=createCheckoutClient(fetcher,'/synthetic')
  assert.equal((await frontend.createOrder(body)).id,receipt.id)
  pricing.acceptedQuoteFingerprint=q.quoteFingerprint
  await assert.rejects(()=>backend.create(body),{code:'CHECKOUT_UNAVAILABLE'})
  await assert.rejects(()=>frontend.createOrder(body),e=>e.unknownOutcome===true)
  const v2=createCheckoutClient(fetcher,'/synthetic','v2');assert.equal((await v2.createOrder(body)).id,receipt.id)
 })
 await scenario('application diagnostics/errors omit raw capability, identities and untrusted database error text',async()=>{
  const q=await quote(),body=orderInput(q),secretText=JSON.stringify(body)
  const fake={rpc:async()=>({error:{code:'XX000',message:secretText}})}
  const failures=[]
  for(const operation of [()=>new OrdersV1Service(fake,{logger}).create(body,null,'synthetic-request'),()=>new CheckoutQuoteService(fake,{logger}).quote(quoteInput())])try{await operation();assert.fail('Failure expected')}catch(e){failures.push({code:e.code,message:e.message})}
  const serialized=JSON.stringify({logs,failures})
  for(const secret of [q.quoteFingerprint,...Object.values(contact),shipping.address,shipping.notes])assert(!serialized.includes(secret))
  const settings=(await db.query("select current_setting('log_statement') statement,current_setting('log_parameter_max_length_on_error') as \"errorParameters\",current_setting('log_min_duration_statement') as \"slowQuery\"")).rows[0]
  evidence.localLogging=settings
  assert.equal(settings.statement,'none');assert.equal(settings.errorParameters,'0');assert.equal(settings.slowQuery,'-1')
  const databaseLog=await readFile(config.cluster.replace(/\/pgdata$/,'')+'/postgres.log','utf8')
  for(const capability of issuedCapabilities)assert(!databaseLog.includes(capability),'Raw capability in local PostgreSQL log')
  evidence.localDatabaseLogCapabilitiesChecked=issuedCapabilities.length
 })
 await scenario('final catalog remains exactly the measured post-008 state, without successor execution',async()=>{
  assert.equal(await shape(),expected);evidence.finalFingerprint=await shape()
  await assert.rejects(()=>apply(sql),/RF_RELEASE008_BASELINE_DRIFT/);assert.equal(await shape(),expected)
 })
 console.log('Release 008 security validation evidence: '+JSON.stringify({version:evidence.version,passed:evidence.passed.length,failed:evidence.failed.length,post008:evidence.post008,finalFingerprint:evidence.finalFingerprint,successorsExecuted:false,concurrentLockObserved:evidence.concurrentLockObserved}))
})
