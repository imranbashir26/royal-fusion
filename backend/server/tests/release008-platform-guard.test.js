import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {nativeFixture,connection} from './support/release005NativeFixture.js'
import {apply005} from './support/post014DefaultAclHardening.js'
import {shapeSQL} from './support/catalogManifest.js'
import {clientV2,requestV2,normalLine,orderV2} from './support/checkoutV2Database.js'
import {CheckoutQuoteService} from '../services/checkoutQuoteService.js'
import {OrdersV1Service} from '../services/ordersV1Service.js'
import {CheckoutQuoteV2Service} from '../services/checkoutQuoteV2Service.js'
import {OrdersV2Service} from '../services/ordersV2Service.js'
import {state014} from './support/fulfillmentV2Database.js'
import {createCheckoutClient} from '../../../frontend/src/services/checkoutClient.ts'

const root=new URL('../../supabase/',import.meta.url)
const files={8:'008_durable_checkout_attempts.sql',9:'009_scheduled_fixed_sale_pricing.sql',10:'010_coupon_sale_comparison.sql'}
const artifact=new URL('tests/release008_010_catalog_manifest.json',root)
const source=async n=>(await readFile(new URL('release-migrations/'+files[n],root),'utf8')).replaceAll('\r\n','\n')
const digest=secret=>createHash('sha256').update('rf:v1:capability:008:'+secret).digest('hex')
const variant='b35b3be7-a7dd-4c70-9c14-d1a9394d4711'
const contact={name:'Synthetic Customer',email:'synthetic@example.invalid',phone:'00012345678'}
const shipping={address:'Synthetic private address',city:'Karachi',province:'Sindh',notes:'Synthetic private notes'}
const quoteInput=(couponCode='')=>({items:[{variantId:variant,quantity:1}],email:contact.email,shipping:{city:shipping.city,province:shipping.province},couponCode})
const orderInput=(q,couponCode='')=>({idempotencyKey:q.idempotencyKey,items:quoteInput().items,contact,shipping,paymentMethod:'Cash on Delivery',couponCode,quoteFingerprint:q.quoteFingerprint})

// Full native PG17, fresh owned loopback cluster; no production URL/env loading.
test('Release 008-010 native security, privacy, recovery and exact migration chain',{timeout:540000},async t=>{
 const cleanups=[],db=await nativeFixture({after:fn=>cleanups.push(fn)}),clients=[]
 t.after(async()=>{for(const c of clients)await c.end();for(const fn of cleanups)await fn()})
 const version=(await db.query('show server_version')).rows[0].server_version
 assert.match(version,/^17\.11(?:\D|$)/)
 const shape=async()=>(await db.query(shapeSQL)).rows[0].shape
 const apply=async sql=>{try{const result=await db.query(sql);assert.equal(result.at(-1).command,'COMMIT')}catch(e){await db.query('rollback');throw e}}
 const legacy=async name=>apply(await readFile(new URL('release-migrations/'+name,root),'utf8'))
 await apply005(db);await legacy('006_standard_variant_availability.sql');await legacy('007_checked_v1_checkout.sql')
 assert.equal(await shape(),'6076eb77ec31ddf953f6207c193cbebe5afb4c2568592676d19da736e8460fcb')
 await db.query(`create role dashboard_user createrole nosuperuser nobypassrls nologin inherit createdb replication;
 create role supabase_auth_admin createrole nosuperuser nobypassrls login noinherit nocreatedb noreplication;
 create role supabase_storage_admin createrole nosuperuser nobypassrls login noinherit nocreatedb noreplication;
 create role supabase_etl_admin login inherit bypassrls replication;
 create role supabase_read_only_user login inherit bypassrls;
 grant pg_read_all_data to supabase_etl_admin,supabase_read_only_user with inherit true,set true,admin false;`)
 assert.equal(await shape(),'6076eb77ec31ddf953f6207c193cbebe5afb4c2568592676d19da736e8460fcb')
 const refresh=process.env.RF_REFRESH_RELEASE008_MANIFESTS==='true'
 const measured={postgresql:version,predecessor007:await shape(),post:{},transitions:[],passed:0,successorsProductionApplied:false}
 const config=JSON.parse(await readFile(process.env.RF_RELEASE005_NATIVE_CONFIG,'utf8'))
 const checkpoint=new URL('chain-checkpoint.json','file:///'+config.cluster.replace(/\/pgdata$/,'')+'/')
 const record=async()=>writeFile(checkpoint,JSON.stringify(measured,null,2)+'\n')
 const expected=refresh?null:JSON.parse(await readFile(artifact,'utf8'))
 async function scenario(name,work){let passed=false;await t.test(name,async()=>{await work();passed=true;measured.passed++});if(!passed)throw Error('Critical security verification failed; stopped: '+name)}
 const counts=async()=>(await db.query(`select (select count(*)::int from orders) orders,(select count(*)::int from payments) payments,(select count(*)::int from inventory_movements) movements,(select count(*)::int from coupon_redemptions) redemptions,(select stock_quantity from product_variants where id=$1) stock`,[variant])).rows[0]
 const quote=async(code='',customer=null)=>new CheckoutQuoteService(clientV2(db),{logger:{warn(){}}}).quote(quoteInput(code),customer)
 const place=(body,c=db,customer=null)=>new OrdersV1Service(clientV2(c),{logger:{warn(){}}}).create(body,customer)
 const attempt=async q=>(await db.query('select * from checkout_v1_attempts where token=$1',['checkout:'+q.idempotencyKey])).rows[0]
 const readerCheck=async(q,name)=>{
  await db.query('set role '+name)
  try{
   assert.equal((await db.query(`select has_table_privilege(current_user,'public.checkout_v1_attempts','SELECT') reads,(select rolbypassrls from pg_roles where rolname=current_user) bypass`)).rows[0].reads,true)
   assert.equal((await db.query('select rolbypassrls from pg_roles where rolname=current_user')).rows[0].rolbypassrls,true)
   const rows=(await db.query('select * from public.checkout_v1_attempts where token=$1',['checkout:'+q.idempotencyKey])).rows
   assert.equal(rows.length,1)
   const serialized=JSON.stringify(rows)
   for(const secret of [q.quoteFingerprint,contact.email,contact.name,contact.phone,shipping.address,shipping.notes])assert.equal(serialized.includes(secret),false,'Private attempt material must not be readable')
   for(const statement of ['delete from public.checkout_v1_attempts',"update public.checkout_v1_attempts set state='retired'",'truncate public.checkout_v1_attempts',"select public.checkout_v1_verifier_008('"+'a'.repeat(64)+"')", "select public.quote_checkout_v1_checked('{}',null)"])await assert.rejects(()=>db.query(statement),e=>e.code==='42501')
  }finally{await db.query('reset role')}
 }
 let guards,guard009,protocol008
 const protocol=async()=>(await db.query(`select p.proname,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p where p.pronamespace='public'::regnamespace
  and (p.proname in ('quote_checkout_v1_checked','create_order_transaction_v1_checked','create_order_transaction_v2')
  or p.proname like 'checkout%008') order by p.proname`)).rows
 async function rejectedMutation(sql,code){
  await db.query('begin')
  try{await db.query(sql);await assert.rejects(()=>db.query(guards),e=>e.code==='P0001'&&e.message===code)}
  finally{await db.query('rollback')}
 }
 for(const level of [8,9,10]){
  let sql=await source(level)
  if(level===10&&refresh){
   const actual=await shape()
   assert.equal(actual,measured.post[level-1])
   assert.equal(sql.match(/if shape <> '[a-f0-9]{64}'/g)?.length,1)
   sql=sql.replace(/if shape <> '[a-f0-9]{64}'/,()=>"if shape <> '"+actual+"'")
   await writeFile(new URL('release-migrations/'+files[level],root),sql)
  }
  await scenario('release '+level+' applies exact predecessor, preserves rows, rejects reapplication',async()=>{
   const beforeShape=await shape(),declared=sql.match(/if shape <> '([a-f0-9]{64})'/)?.[1]
   assert.equal(declared,beforeShape,'Declared predecessor must equal independently measured catalog')
   if(level===9)assert.equal(beforeShape,'ef503bf722574c1c6f7febbd628cc93951d772928d0d28a735f75637ad31e819')
   const before=(await db.query("select coalesce(jsonb_agg(to_jsonb(t) order by token),'[]') rows from public.checkout_v1_attempts t").catch(e=>{if(level===8&&e.code==='42P01')return {rows:[{rows:[]}]};throw e})).rows[0].rows
   await apply(sql)
   measured.post[level]=await shape()
   if(level===8)assert.equal(measured.post[8],'ef503bf722574c1c6f7febbd628cc93951d772928d0d28a735f75637ad31e819')
   measured.transitions.push({release:level,predecessor:beforeShape,post:measured.post[level],sourceSha256:createHash('sha256').update(sql).digest('hex'),result:'COMMIT'})
   await record();console.log('Measured native migration transition: '+JSON.stringify(measured.transitions.at(-1)))
   if(expected)assert.equal(measured.post[level],expected.post[level])
   const after=(await db.query("select coalesce(jsonb_agg(to_jsonb(t) order by token),'[]') rows from checkout_v1_attempts t")).rows[0].rows
   assert.deepEqual(after,before)
   const checkpoint=await shape();await assert.rejects(()=>apply(sql),new RegExp('RF_RELEASE'+String(level).padStart(3,'0')+'_BASELINE_DRIFT'))
   assert.equal(await shape(),checkpoint)
  })
  if(level===8){
   const post=sql.slice(sql.lastIndexOf('do $post$'))
   const start=post.indexOf(' if not exists(select 1 from pg_class')
   const end=post.lastIndexOf('end; $post$;')
   assert(start>0&&end>start)
   guards='do $verify$ begin\n'+post.slice(start,end)+'end; $verify$;'
   protocol008=await protocol()
   await db.query(`insert into shipping_methods(code,name,base_fee) values('security008','Synthetic shipping',250);
    insert into site_settings(id,payments) values('site','[{"name":"Cash on Delivery","active":true},{"name":"Bank Transfer","active":true}]') on conflict(id) do update set payments=excluded.payments`)
  }
  if(level>=9)await scenario('release '+level+' preserves exact validated 008 protocol bodies and ACLs',async()=>{assert.deepEqual(await protocol(),protocol008);await db.query(guards)})
  if(level===9){
   const start=sql.indexOf(" if exists(select 1 from pg_roles b where b.rolname in ('dashboard_user'")
   const finish=sql.indexOf(" then raise exception 'RF_RELEASE009_PRIVATE_ROLE_PATH'; end if;",start)
   assert(start>0&&finish>start)
   guard009='do $verify$ begin\n'+sql.slice(start,finish)+" then raise exception 'RF_RELEASE009_PRIVATE_ROLE_PATH'; end if; end; $verify$;"
   await scenario('release 009 bounded role compatibility rejects altered profiles, escalations and membership paths',async()=>{
    await db.query(guard009)
    for(const role of ['dashboard_user','supabase_auth_admin','supabase_storage_admin'])for(const change of ['superuser','nocreaterole','bypassrls',role==='dashboard_user'?'login':'nologin',role==='dashboard_user'?'noinherit':'inherit',role==='dashboard_user'?'nocreatedb':'createdb',role==='dashboard_user'?'noreplication':'replication']){
     await db.query('begin')
     try{await db.query('alter role '+role+' '+change);await assert.rejects(()=>db.query(guard009),/RF_RELEASE009_PRIVATE_ROLE_PATH/)}finally{await db.query('rollback')}
    }
    for(const mode of ['inherit true,set false','inherit false,set true','inherit false,set false,admin true'])for(const target of ['postgres','dashboard_user','supabase_auth_admin']){
     await db.query('begin')
     try{await db.query('grant '+target+' to service_role with '+mode);await assert.rejects(()=>db.query(guard009),/RF_RELEASE009_PRIVATE_ROLE_PATH/)}finally{await db.query('rollback')}
    }
   })
   await scenario('release 009 scheduled prices retain inclusive start/exclusive end, V1/V2 calculations and coupon accounting',async()=>{
    for(const [instant,expected] of [['2030-01-01T09:59:59.999999Z',2900],['2030-01-01T10:00:00Z',2450],['2030-01-01T11:00:00Z',2900]])assert.equal(Number((await db.query("select effective_sale_price_009(2900,2450,'2030-01-01T10:00:00Z','2030-01-01T11:00:00Z',$1) price",[instant])).rows[0].price),expected)
    await db.query("update product_variants set sale_price=2450,sale_starts_at='2000-01-01',sale_ends_at='2099-01-01' where id=$1",[variant])
    const coupon=(await db.query("insert into coupons(code,type,discount_value,status,usage_limit) values('RF009_CHAIN','Percentage',10,'Active',10) returning id")).rows[0].id
    const q=await quote('RF009_CHAIN'),r=await place(orderInput(q,'RF009_CHAIN'))
    assert.deepEqual([q.subtotal,q.discount,q.shippingFee,q.total],[2450,245,250,2455]);assert.equal(r.total,q.total)
    const v2=await requestV2(db,[normalLine(variant)],{quote:{couponCode:'RF009_CHAIN'},order:{couponCode:'RF009_CHAIN'}}),second=await orderV2(db,v2)
    assert.equal(second.total,2455);assert.equal((await db.query('select used_count from coupons where id=$1',[coupon])).rows[0].used_count,2)
    await db.query('update product_variants set sale_price=null,sale_starts_at=null,sale_ends_at=null where id=$1',[variant])
   })
  }
  await scenario('release '+level+' secrets absent, verifier replay denied, real platform reads bounded',async()=>{
   const q=await quote(),row=await attempt(q),body=orderInput(q)
   assert.match(q.quoteFingerprint,/^[0-9a-f]{64}$/);assert.notEqual(row.credential_verifier,q.quoteFingerprint)
   assert.equal(row.credential_verifier,digest(q.quoteFingerprint))
   assert.deepEqual(Object.keys(row).sort(),['token','credential_verifier','quote_identity_mac','price_fingerprint_mac','request_identity_mac','state','created_at','retired_at'].sort())
   const material=(await db.query(`select public.checkout_v1_quote_identity_008($1,$2,$3,'',null)::text value`,[JSON.stringify(body.items),body.contact.email,JSON.stringify(body.shipping)])).rows[0].value
   const expectedMac=createHmac('sha256',Buffer.from(q.quoteFingerprint,'hex')).update('rf008:quote:checkout:'+q.idempotencyKey+':'+material).digest('hex')
   assert.equal(row.quote_identity_mac,expectedMac)
   assert.notEqual(row.quote_identity_mac,createHash('sha256').update(contact.email).digest('hex'))
   assert.notEqual(row.quote_identity_mac,createHmac('sha256',Buffer.from(row.credential_verifier,'hex')).update('rf008:quote:checkout:'+q.idempotencyKey+':'+material).digest('hex'))
   const before=await counts()
   await assert.rejects(()=>place({...body,quoteFingerprint:row.credential_verifier}),e=>e.code==='IDEMPOTENCY_CONFLICT')
   await assert.rejects(()=>place({...body,contact:{...contact,email:'other@example.invalid'}}),e=>e.code==='IDEMPOTENCY_CONFLICT')
   assert.deepEqual(await counts(),before)
   for(const reader of ['supabase_etl_admin','supabase_read_only_user'])await readerCheck(q,reader)
   for(const role of ['anon','authenticated','service_role']){
    await db.query('set role '+role)
    try{await assert.rejects(()=>db.query('select * from public.checkout_v1_attempts'),e=>e.code==='42501')}
    finally{await db.query('reset role')}
   }
  })
  await scenario('release '+level+' confirmation/recovery/concurrency has one order and no persisted capability',async()=>{
   const q=await quote(),body=orderInput(q),database=(await db.query('select current_database() value')).rows[0].value
   const second=await connection(database);clients.push(second)
   const before=await counts(),[a,b]=await Promise.all([place(body),place(body,second)])
   assert.equal(a.id,b.id);assert.equal(Number(a.idempotent)+Number(b.idempotent),1)
   const after=await counts();assert.equal(after.orders,before.orders+1);assert.equal(after.stock,before.stock-1)
   assert.equal(after.payments,before.payments+1);assert.equal((await attempt(q)).state,'committed')
   assert.equal((await db.query('select v1_quote_fingerprint from orders where id=$1',[a.id])).rows[0].v1_quote_fingerprint,digest(q.quoteFingerprint))
   if(a.pricingOutcome)assert.equal(a.pricingOutcome.acceptedQuoteFingerprint,digest(q.quoteFingerprint))
   assert.equal(JSON.stringify(a).includes(q.quoteFingerprint),false)
   const persisted=(await db.query(`select coalesce(jsonb_agg(to_jsonb(o)),'[]') rows from orders o`)).rows[0].rows
   assert.equal(JSON.stringify(persisted).includes(q.quoteFingerprint),false)
   assert.equal((await place(body)).id,a.id);assert.deepEqual(await counts(),after)
   await assert.rejects(()=>place({...body,shipping:{...shipping,address:'Changed address'}}),e=>e.code==='IDEMPOTENCY_CONFLICT')
   for(const reader of ['supabase_etl_admin','supabase_read_only_user'])await readerCheck(q,reader)
  })
  await scenario('release '+level+' rollback and irreversible retired transition preserve stock and request binding',async()=>{
   const q=await quote(),body=orderInput(q),before=await counts()
   await db.query('begin')
   try{await place(body);await db.query('rollback')}catch(e){await db.query('rollback');throw e}
   assert.equal((await attempt(q)).state,'active');assert.deepEqual(await counts(),before)
   await db.query('update shipping_methods set base_fee=base_fee+1')
   await assert.rejects(()=>place(body),e=>e.code==='QUOTE_CHANGED')
   const row=await attempt(q);assert.equal(row.state,'retired');assert.match(row.request_identity_mac,/^[0-9a-f]{64}$/)
   assert.equal(JSON.stringify(row).includes(q.quoteFingerprint),false)
   await db.query('update shipping_methods set base_fee=base_fee-1')
   await assert.rejects(()=>place(body),e=>e.code==='QUOTE_CHANGED')
   await assert.rejects(()=>place({...body,contact:{...contact,phone:'11122233344'}}),e=>e.code==='IDEMPOTENCY_CONFLICT')
   assert.deepEqual(await counts(),before)
   const fresh=await quote();assert.notEqual(fresh.idempotencyKey,q.idempotencyKey);await place(orderInput(fresh))
  })
  await record()
 }
 await scenario('release 010 real authenticated V1/V2 SQL -> backend -> frontend pricing evidence and recovery',async()=>{
  const customer=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[customer,'chain-customer@example.invalid'])
  const client=clientV2(db),strict={...client,async rpc(name,args){
   if(!['quote_checkout_v2','create_order_transaction_v2'].includes(name))return client.rpc(name,args)
   await db.query('set role service_role');try{return await client.rpc(name,args)}finally{await db.query('reset role')}
  }}
  const quote1=new CheckoutQuoteService(strict,{logger:{warn(){}}}),orders1=new OrdersV1Service(strict,{logger:{warn(){}}})
  const quote2=new CheckoutQuoteV2Service(strict,{logger:{warn(){}}}),orders2=new OrdersV2Service(strict,{environment:'test',allowNonProductionOrders:true,logger:{warn(){}}})
  for(const version of [1,2])for(const [sale,percentage,cap,strategy,outcome,merchandise] of [[900,20,null,'COUPON','applied',800],[700,10,null,'SALE','sale_better',700],[900,10,null,'SALE','tie',900],[900,null,null,'SALE','not_requested',900],[900,50,50,'SALE','sale_better',900]]){
   await db.query('update product_variants set regular_price=1000,sale_price=$1,stock_quantity=200 where id=$2',[sale,variant])
   let code='',coupon=null
   if(percentage!==null){code='CHAIN_'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase();coupon=(await db.query("insert into coupons(code,type,discount_value,max_discount_amount,status,usage_limit) values($1,'Percentage',$2,$3,'Active',100) returning id",[code,percentage,cap])).rows[0].id}
   const bridge=async(path,options)=>{
    if(path.endsWith('/session'))return new Response(JSON.stringify({data:{csrfToken:'synthetic'}}))
    const body=JSON.parse(options.body)
    try{
     const data=path.endsWith('/quote')?await (version===1?quote1:quote2).quote(body,customer):await (version===1?orders1:orders2).create(body,customer)
     return new Response(JSON.stringify({data:path.endsWith('/quote')?{...data,orderingEnabled:true}:data}))
    }catch(e){return new Response(JSON.stringify({error:{code:e.code,message:e.message}}),{status:e.status??500})}
   }
   const browser=createCheckoutClient(bridge,'/synthetic','v'+version)
   const q=await browser.quote(version===1?quoteInput(code):{contractVersion:2,lines:[normalLine(variant)],email:contact.email,shipping:{city:shipping.city,province:shipping.province},couponCode:code})
   const body=version===1?orderInput(q,code):{...orderInput({...q,idempotencyKey:randomUUID()},code),contractVersion:2,lines:[normalLine(variant)]}
   if(version===2)delete body.items
   assert.equal(q.pricingOutcome.strategy,strategy);assert.equal(q.pricingOutcome.couponOutcome,outcome);assert.equal(q.pricingOutcome.merchandiseTotal,merchandise)
   const before=await counts(),r=await browser.createOrder(body),after=await counts()
   assert.equal(r.total,merchandise+250);assert.equal(after.orders,before.orders+1);assert.equal(after.payments,before.payments+1);assert.equal(after.stock,before.stock-1)
   assert.equal(after.redemptions,before.redemptions+(strategy==='COUPON'?1:0))
   const binding=version===1?digest(q.quoteFingerprint):q.quoteFingerprint
   assert.equal(r.pricingOutcome.acceptedQuoteFingerprint,binding)
   const stored=(await db.query('select * from orders where id=$1',[r.id])).rows[0],evidence=version===1?stored.pricing_outcome:stored.quote_snapshot.pricingOutcome
   assert.equal(stored.customer_id,customer);assert.deepEqual(evidence,r.pricingOutcome)
   assert.equal(Number((await db.query('select amount from payments where order_id=$1',[r.id])).rows[0].amount),r.total)
   if(coupon)assert.equal((await db.query('select used_count from coupons where id=$1',[coupon])).rows[0].used_count,strategy==='COUPON'?1:0)
   if(version===1){
    assert.equal((await attempt(q)).credential_verifier,binding);assert(!JSON.stringify(stored).includes(q.quoteFingerprint));assert(!JSON.stringify(r).includes(q.quoteFingerprint))
    await assert.rejects(()=>browser.createOrder({...body,quoteFingerprint:binding}),{code:'IDEMPOTENCY_CONFLICT'})
    await assert.rejects(()=>orders1.create(body,randomUUID()),{code:'IDEMPOTENCY_CONFLICT'})
   }
   const snapshot=await state014(db),replay=await browser.createOrder(body)
   assert.equal(replay.id,r.id);assert.equal(replay.idempotent,true);assert.deepEqual(replay.pricingOutcome,r.pricingOutcome);assert.deepEqual(await state014(db),snapshot)
   console.log('Real pricing integration: '+JSON.stringify({version,strategy,outcome,merchandise,total:r.total,bindingType:version===1?'capability-verifier':'V2-public-quote-hash'}))
  }
  measured.realPricingEvidenceIntegration='V1 and V2 actual SQL, backend services, frontend client, authenticated customer, coupon/sale/tie/no-coupon/capped outcomes'
  await db.query('update product_variants set regular_price=2900,sale_price=null where id=$1',[variant])
 })
 await scenario('release 010 deferred evidence authenticity rejects verifier/cross-attempt/raw substitutions atomically',async()=>{
  for(const kind of ['other-attempt-verifier','raw-current-capability']){
   const q=await quote(),body=orderInput(q),before=await state014(db),attemptBefore=await attempt(q)
   const replacement=kind==='raw-current-capability'?q.quoteFingerprint:digest((await quote()).quoteFingerprint)
   await db.query("select set_config('rf.test.bad_evidence',$1,false)",[replacement])
   await db.query(`create function public.rf010_bad_evidence() returns trigger language plpgsql as $fn$ begin
    new.pricing_outcome:=jsonb_set(new.pricing_outcome,'{acceptedQuoteFingerprint}',to_jsonb(current_setting('rf.test.bad_evidence')));return new;end;$fn$;
    create trigger rf010_bad_evidence before insert on orders for each row execute function public.rf010_bad_evidence()`)
   try{
    const result=await clientV2(db).rpc('create_order_transaction_v1_checked',{p_idempotency_key:'checkout:'+body.idempotencyKey,p_items:body.items,p_contact:body.contact,p_shipping:body.shipping,p_payment_method:body.paymentMethod,p_coupon_code:null,p_shipping_method_id:null,p_customer_id:null,p_quote_fingerprint:body.quoteFingerprint})
    assert.equal(result.error?.message,'PRICING_OUTCOME_INVALID');assert.deepEqual(await state014(db),before);assert.deepEqual(await attempt(q),attemptBefore)
   }
   finally{await db.query('drop trigger rf010_bad_evidence on orders;drop function public.rf010_bad_evidence()')}
   assert.equal(await shape(),measured.post[10]);await place(body)
  }
 })
 await scenario('release 010 late payment failure rolls back attempt, evidence, coupon, stock and related records',async()=>{
  const code='ROLLBACK_CHAIN',coupon=(await db.query("insert into coupons(code,type,discount_value,status,usage_limit) values($1,'Percentage',20,'Active',10) returning id",[code])).rows[0].id
  const q=await quote(code),body=orderInput(q,code),before=await state014(db),attemptBefore=await attempt(q)
  await db.query("create function public.rf010_late_failure() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_PAYMENT_FAILURE';end$$;create trigger rf010_late_failure before insert on payments for each row execute function public.rf010_late_failure()")
  try{await assert.rejects(()=>place(body),e=>e.status>=500);assert.deepEqual(await state014(db),before);assert.deepEqual(await attempt(q),attemptBefore)}
  finally{await db.query('drop trigger rf010_late_failure on payments;drop function public.rf010_late_failure()')}
  await place(body);assert.equal((await db.query('select used_count from coupons where id=$1',[coupon])).rows[0].used_count,1)
 })
 await scenario('native role escalation, altered profiles and object grants remain rejected',async()=>{
  for(const reader of ['supabase_etl_admin','supabase_read_only_user']){
   for(const change of ['nosuperuser nobypassrls','createrole','createdb'])await rejectedMutation('alter role '+reader+' '+change,'RF_RELEASE008_PRIVATE_ROLE_PATH')
  }
  for(const role of ['dashboard_user','supabase_auth_admin','supabase_storage_admin'])await rejectedMutation('alter role '+role+' superuser','RF_RELEASE008_PRIVATE_ROLE_PATH')
  for(const mode of ['inherit true,set false','inherit false,set true','inherit false,set false,admin true']){
   await rejectedMutation('grant supabase_read_only_user to service_role with '+mode,'RF_RELEASE008_PRIVATE_ROLE_PATH')
   await rejectedMutation('grant postgres to service_role with '+mode,'RF_RELEASE008_PRIVATE_ROLE_PATH')
  }
  await rejectedMutation('create role synthetic_intruder createrole','RF_RELEASE008_PRIVATE_ROLE_PATH')
  for(const role of ['anon','authenticated','service_role','supabase_etl_admin','supabase_read_only_user']){
   await rejectedMutation('grant select on checkout_v1_attempts to '+role,'RF_RELEASE008_PRIVATE_ACL')
   await rejectedMutation('grant execute on function public.checkout_v1_mac_008(text,text,jsonb,text) to '+role,'RF_RELEASE008_PRIVATE_RPC')
  }
 })
 await scenario('V2 quote/confirmation and replay remain compatible with V1 UUID fence',async()=>{
  const request=await requestV2(db,[normalLine(variant)]),receipt=await orderV2(db,request),before=await counts()
  assert.equal((await orderV2(db,request)).id,receipt.id);assert.deepEqual(await counts(),before)
  const q=await quote();await assert.rejects(()=>orderV2(db,{...request,idempotencyKey:q.idempotencyKey}),/V2_IDEMPOTENCY_CONFLICT/)
 })
 measured.finalCatalog=await shape()
 assert.equal(measured.finalCatalog,measured.post[10])
 await record()
 if(refresh)await writeFile(artifact,JSON.stringify(measured,null,2)+'\n')
 console.log('Native PostgreSQL security chain fingerprints: '+JSON.stringify(measured))
})
