import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {randomUUID,createHash} from 'node:crypto'
import {nativeFixture,connection} from './support/release005NativeFixture.js'
import {apply005} from './support/post014DefaultAclHardening.js'
import {state014} from './support/fulfillmentV2Database.js'
import {normalLine,requestV2,orderV2} from './support/checkoutV2Database.js'
import {shapeSQL} from './support/catalogManifest.js'
const product='45852db8-8b83-425e-8d1f-4112958ed505',variant='b35b3be7-a7dd-4c70-9c14-d1a9394d4711'
const source=new URL('../../supabase/release-migrations/007_checked_v1_checkout.sql',import.meta.url)
async function install(db,url){try{await db.query(await readFile(url,'utf8'))}catch(e){await db.query('rollback');throw e}}
const request=()=>({items:[{variantId:variant,quantity:1}],shipping:{city:'Karachi',province:'Sindh'},email:'fixture@example.invalid',couponCode:''})
const contact={name:'Fixture',email:'fixture@example.invalid',phone:'00000000000'},shipping={address:'Fixture address',city:'Karachi',province:'Sindh',notes:''}
async function quote(db,input=request()){return (await db.query('select quote_checkout_v1_checked($1::jsonb,null) q',[JSON.stringify(input)])).rows[0].q}
async function order(db,confirmation,id=randomUUID(),coupon=''){return (await db.query('select create_order_transaction_v1_checked($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,null,null,$7) q',['checkout:'+id,JSON.stringify(request().items),JSON.stringify(contact),JSON.stringify(shipping),'Cash on Delivery',coupon,confirmation])).rows[0].q}
async function legacy(db,id){return (await db.query('select create_order_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,null,null,null) q',['checkout:'+id,JSON.stringify(request().items),JSON.stringify(contact),JSON.stringify(shipping),'Cash on Delivery'])).rows[0].q}
async function reset(db){await db.query('update product_variants set stock_quantity=12,regular_price=2900,sale_price=null,standard_manual_available=true where id=$1',[variant]);await db.query('update shipping_methods set base_fee=250,free_shipping_threshold=null where code=$1',['rf007']);await db.query('delete from shipping_rates where shipping_method_id in(select id from shipping_methods where code=$1)',['rf007'])}
async function lockWait(observer,client){const pid=(await client.query('select pg_backend_pid() pid')).rows[0].pid;return async()=>{for(let i=0;i<100;i++){if((await observer.query('select wait_event_type w from pg_stat_activity where pid=$1',[pid])).rows[0]?.w==='Lock')return;await new Promise(r=>setTimeout(r,20))}assert.fail('No actual lock wait')}}
async function assertCommitted(db,receipt,quoted,priorStock,couponId=null){
 const saved=(await db.query('select to_jsonb(o) row from orders o where id=$1',[receipt.id])).rows[0].row
 assert.equal(saved.checkout_version,1);assert.equal(saved.v1_quote_fingerprint,quoted.quoteFingerprint)
 assert.deepEqual([saved.subtotal,saved.discount,saved.shipping_fee,saved.total],[quoted.subtotal,quoted.discount,quoted.shippingFee,quoted.total])
 assert.equal(saved.coupon_id,couponId)
 const payment=(await db.query('select to_jsonb(p) row from payments p where order_id=$1',[receipt.id])).rows
 assert.equal(payment.length,1);assert.equal(payment[0].row.amount,quoted.total);assert.equal(payment[0].row.provider,'Cash on Delivery')
 const items=(await db.query('select quantity,unit_price from order_items where order_id=$1',[receipt.id])).rows
 assert.equal(items.length,1);assert.equal(items[0].quantity,1);assert.equal(Number(items[0].unit_price),quoted.subtotal)
 const movements=(await db.query("select quantity_delta,balance_after from inventory_movements where reference_id=$1 and reason='Order placed'",[receipt.id])).rows
 assert.deepEqual(movements,[{quantity_delta:-1,balance_after:priorStock-1}])
 assert.equal((await db.query('select stock_quantity from product_variants where id=$1',[variant])).rows[0].stock_quantity,priorStock-1)
 const redeemed=(await db.query('select coupon_id,discount_amount from coupon_redemptions where order_id=$1',[receipt.id])).rows
 assert.equal(redeemed.length,couponId===null?0:1)
 if(couponId!==null){assert.equal(redeemed[0].coupon_id,couponId);assert.equal(Number(redeemed[0].discount_amount),quoted.discount)}
}
test('Release 007 checked V1 native acceptance; stop at first critical failure',async t=>{
 async function scenario(name,run){let passed=false;await t.test(name,async()=>{await run();passed=true});if(!passed)throw Error('Critical verification failure: '+name)}
 const db=await nativeFixture(t)
 await apply005(db);await install(db,new URL('../../supabase/release-migrations/006_standard_variant_availability.sql',import.meta.url))
 await db.query("insert into shipping_methods(code,name,base_fee) values('rf007','Fixture',250)")
 await db.query(`insert into site_settings(id,payments) values('site','[{"name":"Cash on Delivery","active":true},{"name":"Bank Transfer","active":true}]') on conflict(id) do update set payments=excluded.payments`)
 const historicalToken=randomUUID(),historical=await legacy(db,historicalToken)
 await scenario('Install exact post-006 predecessor and preserve historical financial records',async()=>{
  const before=await state014(db);await install(db,source);const after=await state014(db)
  assert.deepEqual(after,{...before,orders:before.orders.map(row=>({...row,v1_quote_fingerprint:null}))})
 })
 await scenario('Repeat execution rejects drift and rolls back without changing state',async()=>{const before=await state014(db);await assert.rejects(()=>install(db,source),/BASELINE_DRIFT/);assert.deepEqual(await state014(db),before)})
 await scenario('Valid quote and checked placement use exact accepted financial amounts',async()=>{const q=await quote(db);assert.match(q.quoteFingerprint,/^[0-9a-f]{64}$/);assert.equal(q.total,3150);assert.equal('_coupon' in q,false);const stock=(await db.query('select stock_quantity from product_variants where id=$1',[variant])).rows[0].stock_quantity;const receipt=await order(db,q.quoteFingerprint);assert.deepEqual([receipt.subtotal,receipt.discount,receipt.shippingFee,receipt.total],[q.subtotal,q.discount,q.shippingFee,q.total]);assert.equal(receipt.idempotent,false);await assertCommitted(db,receipt,q,stock)})
 await scenario('Malformed internal coupon representations are rejected before effects',async()=>{
  const q=(await db.query('select public.resolve_checkout_v1_007($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,null,null,null) q',['quote:fixture',JSON.stringify(request().items),JSON.stringify(contact),JSON.stringify(shipping),'Cash on Delivery'])).rows[0].q
  assert.equal(q._coupon,null)
  const before=await state014(db)
  for(const value of [[],false,1,'invalid',{}, {id:randomUUID()}, {id:'invalid'}]){
   await assert.rejects(()=>db.query('select public.create_order_v1_effects_007($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,null,null,null,$6::jsonb)',['checkout:'+randomUUID(),JSON.stringify(request().items),JSON.stringify(contact),JSON.stringify(shipping),'Cash on Delivery',JSON.stringify({...q,_coupon:value})]),e=>['22023','22P02'].includes(e.code))
  }
  const missing={...q};delete missing._coupon
  await assert.rejects(()=>db.query('select public.create_order_v1_effects_007($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,null,null,null,$6::jsonb)',['checkout:'+randomUUID(),JSON.stringify(request().items),JSON.stringify(contact),JSON.stringify(shipping),'Cash on Delivery',JSON.stringify(missing)]),/V1_COUPON_STATE_INVALID/)
  await assert.rejects(()=>db.query('select public.create_order_v1_effects_007($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,null,null,$7::jsonb)',['checkout:'+randomUUID(),JSON.stringify(request().items),JSON.stringify(contact),JSON.stringify(shipping),'Cash on Delivery','INVALID',JSON.stringify(q)]),/V1_COUPON_STATE_INVALID/)
  assert.deepEqual(await state014(db),before)
 })
 for(const [type,value,discount,fee] of [['Percentage',10,290,250],['Fixed Amount',125,125,250],['Free Shipping',0,0,0]])await scenario('Valid '+type+' coupon preserves committed financials and one redemption',async()=>{
  await reset(db);const code='VALID-'+type.replaceAll(' ','-').toUpperCase()
  const coupon=(await db.query('insert into coupons(code,type,discount_value,status,usage_limit,per_customer_usage_limit) values($1,$2,$3,$4,2,2) returning id',[code,type,value,'Active'])).rows[0].id
  const q=await quote(db,{...request(),couponCode:code});assert.deepEqual([q.subtotal,q.discount,q.shippingFee,q.total],[2900,discount,fee,2900-discount+fee])
  const token=randomUUID(),first=await order(db,q.quoteFingerprint,token,code);await assertCommitted(db,first,q,12,coupon)
  assert.equal((await db.query('select used_count from coupons where id=$1',[coupon])).rows[0].used_count,1)
  const before=await state014(db);assert.deepEqual(await order(db,q.quoteFingerprint,token,code),{...first,idempotent:true});assert.deepEqual(await state014(db),before)
  assert.equal((await quote(db,{...request(),couponCode:code})).quoteFingerprint,q.quoteFingerprint)
  const second=await order(db,q.quoteFingerprint,randomUUID(),code);await assertCommitted(db,second,q,11,coupon)
  assert.equal((await db.query('select used_count from coupons where id=$1',[coupon])).rows[0].used_count,2)
  const exhausted=await state014(db);await assert.rejects(()=>order(db,q.quoteFingerprint,randomUUID(),code),/usage limit/);assert.deepEqual(await state014(db),exhausted)
 })
 await scenario('Missing, forged and legacy unchecked new submissions have no effects',async()=>{const before=await state014(db);await assert.rejects(()=>order(db,null),/V1_QUOTE_REQUIRED/);await assert.rejects(()=>order(db,'0'.repeat(64)),/V1_QUOTE_CHANGED/);await assert.rejects(()=>legacy(db,randomUUID()),/V1_QUOTE_REQUIRED/);assert.deepEqual(await state014(db),before)})
 await scenario('Material request mismatch invalidates a valid confirmation',async()=>{const q=await quote(db,{...request(),email:'other@example.invalid'});const before=await state014(db);await assert.rejects(()=>order(db,q.quoteFingerprint),/V1_QUOTE_CHANGED/);assert.deepEqual(await state014(db),before)})
 await scenario('Price changed after quote rejects before all order effects',async()=>{await reset(db);const q=await quote(db);await db.query('update product_variants set sale_price=2500 where id=$1',[variant]);const before=await state014(db);await assert.rejects(()=>order(db,q.quoteFingerprint),/V1_QUOTE_CHANGED/);assert.deepEqual(await state014(db),before);assert.equal((await quote(db)).total,2750)})
 await scenario('Shipping charge changed after quote rejects without effects',async()=>{await reset(db);const q=await quote(db);await db.query("update shipping_methods set base_fee=300 where code='rf007'");const before=await state014(db);await assert.rejects(()=>order(db,q.quoteFingerprint),/V1_QUOTE_CHANGED/);assert.deepEqual(await state014(db),before)})
 await scenario('Coupon mutation and eligibility loss reject without consumption',async()=>{await reset(db);await db.query("insert into coupons(code,type,discount_value,status) values('RF007','Percentage',10,'Active')");const input={...request(),couponCode:'RF007'},q=await quote(db,input);await db.query("update coupons set discount_value=20 where code='RF007'");let before=await state014(db);await assert.rejects(()=>order(db,q.quoteFingerprint,randomUUID(),'RF007'),/V1_QUOTE_CHANGED/);assert.deepEqual(await state014(db),before);const fresh=await quote(db,input);await db.query("update coupons set status='Inactive' where code='RF007'");before=await state014(db);await assert.rejects(()=>order(db,fresh.quoteFingerprint,randomUUID(),'RF007'),/Coupon/);assert.deepEqual(await state014(db),before)})
 await scenario('Stock exhaustion rejects without effects',async()=>{await reset(db);const q=await quote(db);await db.query('update product_variants set stock_quantity=0 where id=$1',[variant]);const before=await state014(db);await assert.rejects(()=>order(db,q.quoteFingerprint),/unavailable|enough stock/);assert.deepEqual(await state014(db),before)})
 await scenario('Lost response and repeated same-token replay preserve original amounts',async()=>{await reset(db);const q=await quote(db),token=randomUUID(),first=await order(db,q.quoteFingerprint,token);await db.query('update product_variants set sale_price=2000,stock_quantity=0 where id=$1',[variant]);const before=await state014(db),replay=await order(db,q.quoteFingerprint,token);assert.deepEqual(replay,{...first,idempotent:true});assert.deepEqual(await state014(db),before);await assert.rejects(()=>order(db,'0'.repeat(64),token),/IDEMPOTENCY_CONFLICT/)})
 await scenario('Historical legacy replay remains valid after catalog changes',async()=>{const before=await state014(db);assert.deepEqual(await legacy(db,historicalToken),{...historical,idempotent:true});assert.deepEqual(await state014(db),before)})
 await scenario('Cross-version idempotency fences are unchanged',async()=>{await reset(db);const v2=await requestV2(db,[normalLine(variant)]),created=await orderV2(db,v2);const confirmation=(await quote(db)).quoteFingerprint;await assert.rejects(()=>order(db,confirmation,v2.idempotencyKey),/IDEMPOTENCY_CONFLICT/);assert.equal(created.idempotent,false)})
 await scenario('Native price-writer lock wait invalidates outdated quote',async()=>{await reset(db);const q=await quote(db),name=(await db.query('select current_database() n')).rows[0].n,a=await connection(name),b=await connection(name);try{await a.query('begin');await a.query('update product_variants set sale_price=2200 where id=$1',[variant]);const before=await state014(a),blocked=await lockWait(db,b),pending=order(b,q.quoteFingerprint).then(value=>({value}),error=>({error}));await blocked();await a.query('commit');assert.match((await pending).error.message,/V1_QUOTE_CHANGED/);assert.deepEqual(await state014(db),before)}finally{await a.query('rollback');await a.end();await b.end()}})
 await scenario('Concurrent same-token submissions create exactly one order/payment',async()=>{await reset(db);const q=await quote(db),token=randomUUID(),name=(await db.query('select current_database() n')).rows[0].n,a=await connection(name),b=await connection(name);try{await a.query('begin');const first=await order(a,q.quoteFingerprint,token),blocked=await lockWait(db,b),pending=order(b,q.quoteFingerprint,token);await blocked();await a.query('commit');assert.deepEqual(await pending,{...first,idempotent:true});await assertCommitted(db,first,q,12)}finally{await a.query('rollback');await a.end();await b.end()}})
 await scenario('Concurrent different-token requests cannot double redeem the last coupon slot',async()=>{
  await reset(db);const code='LAST-SLOT',coupon=(await db.query("insert into coupons(code,type,discount_value,status,usage_limit) values($1,'Percentage',10,'Active',1) returning id",[code])).rows[0].id
  const q=await quote(db,{...request(),couponCode:code}),name=(await db.query('select current_database() n')).rows[0].n,a=await connection(name),b=await connection(name)
  try{await a.query('begin');const first=await order(a,q.quoteFingerprint,randomUUID(),code),blocked=await lockWait(db,b),pending=order(b,q.quoteFingerprint,randomUUID(),code).then(value=>({value}),error=>({error}));await blocked();await a.query('commit');assert.match((await pending).error.message,/usage limit/);await assertCommitted(db,first,q,12,coupon);assert.equal((await db.query('select used_count from coupons where id=$1',[coupon])).rows[0].used_count,1);assert.equal((await db.query('select count(*)::int n from coupon_redemptions where coupon_id=$1',[coupon])).rows[0].n,1)}finally{await a.query('rollback');await a.end();await b.end()}
 })
 await scenario('Late payment failure rolls back all transactional effects',async()=>{await reset(db);const q=await quote(db);await db.query(`create function public.rf007_fail() returns trigger language plpgsql as $$begin raise exception 'RF007_LATE_FAILURE';end$$;create trigger rf007_fail before insert on payments for each row execute function public.rf007_fail()`);const before=await state014(db);try{await assert.rejects(()=>order(db,q.quoteFingerprint),/RF007_LATE_FAILURE/);assert.deepEqual(await state014(db),before)}finally{await db.query('drop trigger rf007_fail on payments;drop function public.rf007_fail()')}})
 await scenario('Browser roles, private helpers and direct unchecked service writes remain denied',async()=>{
  await reset(db);const q=await quote(db)
  for(const role of ['anon','authenticated','service_role']){
   for(const signature of ['public.resolve_checkout_v1_007(text,jsonb,jsonb,jsonb,text,text,uuid,uuid)','public.create_order_v1_effects_007(text,jsonb,jsonb,jsonb,text,text,uuid,uuid,jsonb)'])assert.equal((await db.query('select has_function_privilege($1,$2,$3) allowed',[role,signature,'EXECUTE'])).rows[0].allowed,false)
   for(const signature of ['public.quote_checkout_v1_checked(jsonb,uuid)','public.create_order_transaction_v1_checked(text,jsonb,jsonb,jsonb,text,text,uuid,uuid,text)'])assert.equal((await db.query('select has_function_privilege($1,$2,$3) allowed',[role,signature,'EXECUTE'])).rows[0].allowed,role==='service_role')
   await db.query('set role '+role)
   try{
    await assert.rejects(()=>db.query("select public.resolve_checkout_v1_007('quote:read-only','[]','{}','{}',null,null,null,null)"),/permission denied/)
    if(role!=='service_role'){
     await assert.rejects(()=>quote(db),/permission denied/);await assert.rejects(()=>order(db,q.quoteFingerprint),/permission denied/)
     const readable=(await db.query("select has_table_privilege(current_user,'public.orders','SELECT') allowed")).rows[0].allowed
     if(readable)assert.equal((await db.query('select id from orders')).rows.length,0)
    }else{
     await assert.rejects(()=>db.query("insert into orders(order_number,customer_name,customer_email,shipping_address,shipping_city,payment_method,subtotal,total,idempotency_key) values('DENIED','Denied','fixture@example.invalid','Denied','Karachi','Cash on Delivery',1,1,$1)",['checkout:'+randomUUID()]),/V1_QUOTE_REQUIRED/)
     await assert.rejects(()=>db.query("insert into orders(order_number,customer_name,customer_email,shipping_address,shipping_city,payment_method,subtotal,total,idempotency_key,v1_quote_fingerprint) values('FORGED','Denied','fixture@example.invalid','Denied','Karachi','Cash on Delivery',1,1,$1,$2)",['checkout:'+randomUUID(),q.quoteFingerprint]),/V1_QUOTE_REQUIRED/)
     const placed=await order(db,q.quoteFingerprint);assert.equal(placed.idempotent,false)
    }
   }finally{await db.query('reset role')}
  }
 })
})


// Adversarial permissions are installed only in fresh owned native databases.
// Every negative case proves its unsafe state before the corrected postcondition,
// then checks complete schema/security/business rollback, not merely an error.
const private007=[
 'public.checkout_v1_payments_007(jsonb)',
 'public.resolve_checkout_v1_007(text,jsonb,jsonb,jsonb,text,text,uuid,uuid)',
 'public.create_order_v1_effects_007(text,jsonb,jsonb,jsonb,text,text,uuid,uuid,jsonb)',
 'public.guard_v1_confirmation_007()',
]
const effects007=private007[2]
const quoteSQL=value=>"'"+value.replaceAll("'","''")+"'"
async function security007(db){return (await db.query("select jsonb_build_object('defaults',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d),'roles',(select jsonb_agg(to_jsonb(r) order by oid) from pg_roles r),'memberships',(select jsonb_agg(to_jsonb(m) order by roleid,member,grantor) from pg_auth_members m),'schemas',(select jsonb_agg(to_jsonb(n) order by oid) from pg_namespace n),'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p)) state")).rows[0].state}
async function snapshot007(db){return {business:await state014(db),shape:(await db.query(shapeSQL)).rows[0].shape,security:await security007(db)}}
function inject007(sql,ddl,proof){
 assert.equal(sql.split('do $post$').length,2)
 return sql.replace('do $post$',ddl+";do $proof$ begin if not ("+proof+") then raise exception 'RF007_UNSAFE_FIXTURE_NOT_PROVEN';end if;raise notice 'RF007_UNSAFE_FIXTURE_PROVEN';end;$proof$;\ndo $post$")
}
async function probe007(db,role,access='direct'){
 await db.query("create function public.rf007_acl_probe() returns integer language sql set search_path='' as $$select 1$$")
 try{
  // Mirror the release's named-role revokes so PUBLIC/default application access
  // cannot masquerade as the custom inherited or SET-only path being tested.
  await db.query('revoke all on function public.rf007_acl_probe() from public,anon,authenticated,service_role')
  assert.equal((await db.query("select has_function_privilege($1,'public.rf007_acl_probe()','EXECUTE') allowed",[role])).rows[0].allowed,true,'Default grant must exist on an actual new function')
  if(access==='inherit'){
   assert.equal((await db.query("select pg_has_role('service_role',$1,'USAGE') allowed",[role])).rows[0].allowed,true)
   assert.equal((await db.query("select has_function_privilege('service_role','public.rf007_acl_probe()','EXECUTE') allowed")).rows[0].allowed,true)
  }
  if(access==='set'){
   assert.equal((await db.query("select pg_has_role('service_role',$1,'USAGE') inherited,pg_has_role('service_role',$1,'SET') switchable",[role])).rows[0].inherited,false)
   assert.equal((await db.query("select pg_has_role('service_role',$1,'SET') allowed",[role])).rows[0].allowed,true)
   assert.equal((await db.query("select has_function_privilege('service_role','public.rf007_acl_probe()','EXECUTE') allowed")).rows[0].allowed,false)
  }
  await db.query(access==='direct'?'set role '+role:'set session authorization service_role'+(access==='set'?';set role '+role:''))
  try{assert.equal((await db.query('select public.rf007_acl_probe() value')).rows[0].value,1)}
  finally{await db.query('reset role;reset session authorization')}
 }finally{await db.query('drop function public.rf007_acl_probe()')}
}
async function assertPrivate007(db){
 for(const signature of private007){
  const row=(await db.query("select p.proowner='postgres'::regrole owner,p.proconfig,p.prosecdef,not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner) private from pg_proc p where p.oid=$1::regprocedure",[signature])).rows[0]
  assert.equal(row.owner,true);assert.deepEqual(row.proconfig,['search_path=""']);assert.equal(row.private,true);assert.equal(row.prosecdef,!signature.includes('guard_v1_confirmation'))
  for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature])).rows[0].allowed,false)
 }
}

// Only CRLF -> LF is equivalent for this reviewed text fingerprint. Preserve
// spaces, BOMs, lone carriage returns, and final-newline differences.
function reviewedSource007(raw){
 const sql=raw.replaceAll('\r\n','\n')
 const guard=/ -- @RELEASE007-PRIVATE-GUARD-BEGIN\n[\s\S]*? -- @RELEASE007-PRIVATE-GUARD-END\n/
 assert.match(sql,guard)
 const old=sql.replace(guard,'')
 assert.equal(createHash('sha256').update(old).digest('hex').toUpperCase(),'C3FE97AA4D3E1A1889E40F146A6CCEBC83A3A3B44371D18E2A781E2913AAB1B6','Omission control must be the exact previously reviewed Release 007')
 return {sql,old}
}
function sourceRepresentations007(lf){
 let line=0
 return [['LF',lf],['CRLF',lf.replaceAll('\n','\r\n')],['mixed',lf.replace(/\n/g,()=>line++%2?'\r\n':'\n')]]
}
test('Release 007 source verification accepts LF, CRLF and mixed line endings',async t=>{
 const lf=(await readFile(source,'utf8')).replaceAll('\r\n','\n'),expected=reviewedSource007(lf)
 for(const [name,raw] of sourceRepresentations007(lf))await t.test(name,()=>{
  const verified=reviewedSource007(raw)
  assert.equal(verified.sql,lf);assert.equal(verified.old,expected.old)
 })
})
test('Release 007 source verification rejects substantive and non-line-ending mutations',async t=>{
 const lf=(await readFile(source,'utf8')).replaceAll('\r\n','\n')
 assert.ok(lf.includes('public.checkout_v1_payments_007'));assert.ok(lf.includes('begin;'));assert.ok(lf.endsWith('\n'))
 const mutations=[
  ['SQL function identity',lf.replace('public.checkout_v1_payments_007','public.checkout_v1_payments_007_mutated')],
  ['space',lf.replace('begin;','begin; ')],
  ['BOM','\uFEFF'+lf],
  ['lone carriage return','\r'+lf],
  ['missing final newline',lf.slice(0,-1)],
  ['additional final newline',lf+'\n'],
  ['missing guard start',lf.replace('@RELEASE007-PRIVATE-GUARD-BEGIN','@MUTATED-GUARD-BEGIN')],
  ['missing guard end',lf.replace('@RELEASE007-PRIVATE-GUARD-END','@MUTATED-GUARD-END')],
 ]
 for(const [name,changed] of mutations)await t.test(name,()=>{
  assert.notEqual(changed,lf)
  for(const [representation,raw] of sourceRepresentations007(changed))assert.throws(()=>reviewedSource007(raw),assert.AssertionError,name+' / '+representation)
 })
})

test('Release 007 Supabase platform guard predicates with immutable catalog fixtures',async t=>{
 // Reuse the native suite's exact-source/guard boundary. This selection does not
 // call nativeFixture, install migrations, CREATE/ALTER ROLE or change privileges.
 // Only membership/EXECUTE catalog lookups are substituted with immutable CTEs;
 // both production IF predicates are evaluated as SQL, not reimplemented in JS.
 const {sql}=reviewedSource007(await readFile(source,'utf8'))
 const block=sql.match(/ -- @RELEASE007-PRIVATE-GUARD-BEGIN\n([\s\S]*?) -- @RELEASE007-PRIVATE-GUARD-END/)[1]
 const predicates=Object.fromEntries([...block.matchAll(/^ if ([\s\S]*?)\n then raise exception 'RF_RELEASE007_PRIVATE_(ROLE_PATH|RPC)'; end if;/gm)].map(m=>[m[2],m[1]]))
 assert.deepEqual(Object.keys(predicates),['ROLE_PATH','RPC'])
 const membership=predicates.ROLE_PATH.slice(predicates.ROLE_PATH.indexOf('\n or exists'))
 const digest=value=>createHash('sha256').update(value).digest('hex')
 assert.equal(digest(membership),'545a847a0f35a4c1be6d4114e2a87d4d828179a5fe870ef77d3ee38fefee709c','Membership guard must remain unchanged')
 assert.equal(digest(predicates.RPC),'285a736b44a5766e0dd97bc3d0783ae5877b48ea58ad0f18e9a8cae50a37ca94','Private RPC guard must remain unchanged')
 assert.match(sql,/if shape <> '56e23c44b26187f5cd2a8d6407be3da0b21cedf07aa29d181e9a89052c7042b8'/)
 const next=await readFile(new URL('../../supabase/release-migrations/008_durable_checkout_attempts.sql',import.meta.url),'utf8')
 assert.match(next,/if shape <> '6076eb77ec31ddf953f6207c193cbebe5afb4c2568592676d19da736e8460fcb'/)

 const rewrite=condition=>{
  let result=condition.replace(/'([^']+)'::regprocedure/g,(_,signature)=>{
   assert.ok(private007.includes(signature));return `(select oid from pg_proc where signature='${signature}')`
  })
  result=result.replace(/pg_has_role\(b\.oid,r\.oid,'(USAGE|SET)'\)/g,(_,mode)=>
   `(exists(select 1 from role_path q where q.member=b.oid and q.roleid=r.oid and q.mode='${mode}'))`)
  result=result.replace("aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))",'(select grantee from fixture_acl where function_oid=p.oid)')
  result=result.replace("has_function_privilege(r.oid,p.oid,'EXECUTE')",`(r.rolsuper or exists(
   select 1 from fixture_acl x where x.function_oid=p.oid and (x.grantee=0 or exists(
    select 1 from role_path q where q.member=r.oid and q.roleid=x.grantee and q.mode='USAGE'))))`)
  assert.doesNotMatch(result,/::regprocedure|pg_has_role\(|has_function_privilege\(|aclexplode\(|acldefault\(/)
  return result
 }
 const oldRolePredicate="exists(select 1 from pg_roles b where b.rolname<>'postgres' and not (b.rolname='supabase_admin' and b.rolsuper) and (b.rolsuper or b.rolcreaterole))"+membership
 const query=rolePredicate=>`WITH RECURSIVE
  input AS (SELECT $1::jsonb value),
  pg_roles AS (SELECT r.* FROM input,jsonb_to_recordset(value->'roles') AS r(
   oid oid,rolname text,rolsuper boolean,rolcreaterole boolean,rolbypassrls boolean,
   rolcanlogin boolean,rolinherit boolean,rolcreatedb boolean,rolreplication boolean)),
  pg_auth_members AS (SELECT m.* FROM input,jsonb_to_recordset(value->'memberships') AS m(
   member oid,roleid oid,inherit_option boolean,set_option boolean,admin_option boolean)),
  pg_proc AS (SELECT p.* FROM input,jsonb_to_recordset(value->'functions') AS p(
   oid oid,signature text,proowner oid,proconfig text[],prosecdef boolean,proname text)),
  fixture_acl AS (SELECT a.* FROM input,jsonb_to_recordset(value->'acl') AS a(function_oid oid,grantee oid)),
  role_path(member,roleid,mode) AS (
   SELECT b.oid,r.oid,m.mode FROM pg_roles b CROSS JOIN pg_roles r CROSS JOIN (VALUES('USAGE'),('SET')) m(mode)
    WHERE b.oid=r.oid OR b.rolsuper
   UNION SELECT q.member,m.roleid,q.mode FROM role_path q JOIN pg_auth_members m ON m.member=q.roleid
    WHERE CASE q.mode WHEN 'USAGE' THEN m.inherit_option ELSE m.set_option END
  )
  SELECT CASE WHEN (${rewrite(rolePredicate)}) THEN 'RF_RELEASE007_PRIVATE_ROLE_PATH'
   WHEN (${rewrite(predicates.RPC)}) THEN 'RF_RELEASE007_PRIVATE_RPC' ELSE 'PASS' END result`
 const baseRole=(oid,rolname,patch={})=>({oid,rolname,rolsuper:false,rolcreaterole:false,rolbypassrls:false,
  rolcanlogin:false,rolinherit:true,rolcreatedb:false,rolreplication:false,...patch})
 const baseline=()=>({roles:[baseRole(10,'postgres'),baseRole(11,'supabase_admin',{rolsuper:true}),
  baseRole(12,'anon'),baseRole(13,'authenticated'),baseRole(14,'service_role',{rolbypassrls:true}),
  baseRole(15,'dashboard_user',{rolcreaterole:true,rolcreatedb:true,rolreplication:true}),
  baseRole(16,'supabase_auth_admin',{rolcreaterole:true,rolcanlogin:true,rolinherit:false}),
  baseRole(17,'supabase_storage_admin',{rolcreaterole:true,rolcanlogin:true,rolinherit:false}),baseRole(18,'authenticator')],
  memberships:[],functions:private007.map((signature,i)=>({oid:100+i,signature,proowner:10,
   proconfig:['search_path=""'],prosecdef:i!==3,proname:signature.split('.')[1].split('(')[0]})),
  acl:private007.map((_,i)=>({function_oid:100+i,grantee:10}))})
 const edge=(member,roleid,mode='SET')=>({member,roleid,inherit_option:mode==='USAGE',set_option:mode==='SET',admin_option:mode==='ADMIN'})
 const {PGlite}=await import('@electric-sql/pglite'),db=new PGlite()
 t.after(async()=>{await db.exec('rollback');await db.close()})
 await db.exec('begin read only')
 const evaluate=async(fixture,predicate=predicates.ROLE_PATH)=>{
  try{return (await db.query(query(predicate),[JSON.stringify(fixture)])).rows[0].result}
  catch(error){throw new Error(error.message)}
 }
 const scenario=async(name,mutate,expected='RF_RELEASE007_PRIVATE_ROLE_PATH')=>t.test(name,async()=>{
  const fixture=baseline();mutate(fixture);assert.equal(await evaluate(fixture),expected)
 })
 await t.test('former guard rejects documented Supabase roles; corrected guard accepts without EXECUTE exemptions',async()=>{
  assert.equal(await evaluate(baseline(),oldRolePredicate),'RF_RELEASE007_PRIVATE_ROLE_PATH')
  assert.equal(await evaluate(baseline()),'PASS')
 })
 await scenario('managed roles absent remains supported',f=>{f.roles=f.roles.filter(r=>![15,16,17].includes(r.oid))},'PASS')
 await scenario('non-superuser supabase_admin without private access remains supported',f=>{f.roles.find(r=>r.oid===11).rolsuper=false},'PASS')
 await scenario('custom CREATEROLE cannot borrow a platform profile',f=>f.roles.push(baseRole(20,'custom_admin',{rolcreaterole:true,rolcreatedb:true,rolreplication:true})))
 await scenario('custom SUPERUSER remains rejected',f=>f.roles.push(baseRole(20,'custom_admin',{rolsuper:true})))
 for(const id of [15,16,17]){
  const name=baseline().roles.find(r=>r.oid===id).rolname
  for(const flag of ['rolsuper','rolbypassrls','rolcanlogin','rolinherit','rolcreatedb','rolreplication'])await scenario(name+' rejects altered '+flag,f=>{
   const role=f.roles.find(r=>r.oid===id);role[flag]=!role[flag]
  })
  for(const mode of ['USAGE','SET','ADMIN']){
   await scenario(name+' rejects path to postgres / '+mode,f=>f.memberships.push(edge(id,10,mode)))
   for(const member of [12,13,14,18])await scenario(name+' rejects application membership '+member+' / '+mode,f=>f.memberships.push(edge(member,id,mode)))
  }
  for(const mode of ['USAGE','SET'])await scenario(name+' rejects transitive application path / '+mode,f=>{
   f.roles.push(baseRole(20,'bridge'));f.memberships.push(edge(14,20,mode),edge(20,id,mode))
  })
 }
 for(let index=0;index<private007.length;index++){
  for(const grantee of [0,11,12,13,14,15,16,17,20])await scenario('private helper '+index+' rejects EXECUTE grantee '+grantee,f=>{
   if(grantee===20)f.roles.push(baseRole(20,'custom_reader'))
   f.acl.push({function_oid:100+index,grantee})
  },'RF_RELEASE007_PRIVATE_RPC')
  await scenario('private helper '+index+' rejects changed owner',f=>{f.functions[index].proowner=14},'RF_RELEASE007_PRIVATE_RPC')
  await scenario('private helper '+index+' rejects changed search_path',f=>{f.functions[index].proconfig=['search_path=public']},'RF_RELEASE007_PRIVATE_RPC')
  await scenario('private helper '+index+' rejects changed security mode',f=>{f.functions[index].prosecdef=!f.functions[index].prosecdef},'RF_RELEASE007_PRIVATE_RPC')
 }
})

test('Release 007 native private-function ACL adversarial acceptance; stop at first failure',async t=>{
 const {sql,old}=reviewedSource007(await readFile(source,'utf8'))
 async function scenario(name,run){let passed=false;await t.test(name,async()=>{
  const cleanup=[],db=await nativeFixture({after:fn=>cleanup.push(fn)}),roles=[]
  const role=async(attributes='')=>{const name='rf007_acl_'+randomUUID().replaceAll('-','');await db.query('create role '+name+' '+attributes);roles.push(name);await db.query('grant usage on schema public to '+name);return name}
  const platform=(await db.query("select rolsuper from pg_roles where rolname='supabase_admin'")).rows[0].rolsuper
  try{
   await apply005(db);await install(db,new URL('../../supabase/release-migrations/006_standard_variant_availability.sql',import.meta.url))
   await db.query("insert into shipping_methods(code,name,base_fee) values('rf007-acl','Fixture',250);insert into site_settings(id,payments) values('site','[{\"name\":\"Cash on Delivery\",\"active\":true}]') on conflict(id) do update set payments=excluded.payments;insert into coupons(code,type,discount_value,status) values('ACL007','Percentage',10,'Active')")
   const historical=randomUUID(),saved=(await db.query('select public.create_order_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,null,null) receipt',['checkout:'+historical,JSON.stringify(request().items),JSON.stringify(contact),JSON.stringify(shipping),'Cash on Delivery','ACL007'])).rows[0].receipt
   const reject=async(candidate=sql,code='RF_RELEASE007_PRIVATE_RPC',injected=false)=>{
    const before=await snapshot007(db),notices=[];const observe=n=>notices.push(n.message);db.on('notice',observe)
    try{await assert.rejects(()=>db.query(candidate),e=>e.code==='P0001'&&e.message===code)}
    finally{db.off('notice',observe);await db.query('rollback')}
    if(injected)assert.equal(notices.filter(x=>x==='RF007_UNSAFE_FIXTURE_PROVEN').length,1,'Unsafe helper state must be proven before evaluating postconditions')
    assert.deepEqual(await snapshot007(db),before,'Rejected release must preserve business, catalog, privileges and memberships')
    assert.equal((await db.query("select to_regprocedure('public.create_order_v1_effects_007(text,jsonb,jsonb,jsonb,text,text,uuid,uuid,jsonb)') helper")).rows[0].helper,null)
   }
   await run({db,role,reject,historical,saved});passed=true
  }finally{
   await db.query(platform?'alter role supabase_admin superuser':'alter role supabase_admin nosuperuser')
   for(const fn of cleanup)await fn()
   const owner=await connection();try{for(const name of roles.reverse())await owner.query('drop role '+name)}finally{await owner.end()}
  }
 });if(!passed)throw Error('Critical verification failure: '+name)}
 await scenario('exact former release permits inherited private-helper execution; corrected release rejects it',async({db,role,reject})=>{
  const custom=await role();await db.query('alter default privileges for role postgres in schema public grant execute on functions to '+custom+';grant '+custom+' to service_role with inherit true,set false')
  await probe007(db,custom,'inherit')
  await db.query(old.replace(/commit;\s*$/,''))
  try{assert.equal((await db.query('select has_function_privilege(\'service_role\',$1,\'EXECUTE\') allowed',[effects007])).rows[0].allowed,true)}finally{await db.query('rollback')}
  await reject()
 })
 await scenario('clean baseline, legitimate owner/platform superuser and unchanged 008 commerce',async({db,historical,saved})=>{
  const defaults=await security007(db);await db.query(sql);await assertPrivate007(db)
  assert.deepEqual(await security007(db),defaults)
  for(const role of ['postgres','supabase_admin'])assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,effects007])).rows[0].allowed,true)
  await install(db,new URL('../../supabase/release-migrations/008_durable_checkout_attempts.sql',import.meta.url));await assertPrivate007(db)
  const before=await state014(db)
  const replay=(await db.query('select public.create_order_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,null,null) receipt',['checkout:'+historical,JSON.stringify(request().items),JSON.stringify(contact),JSON.stringify(shipping),'Cash on Delivery','ACL007'])).rows[0].receipt
  assert.equal(replay.id,saved.id);assert.equal(replay.idempotent,true);assert.deepEqual(await state014(db),before)
  const q=await quote(db),body=['checkout:'+q.idempotencyKey,JSON.stringify(request().items),JSON.stringify(contact),JSON.stringify(shipping),'Cash on Delivery',null,null,null,q.quoteFingerprint]
  const receipt=(await db.query('select public.create_order_transaction_v1_checked($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7::uuid,$8::uuid,$9) q',body)).rows[0].q
  await assertCommitted(db,receipt,q,11)
  const committed=await state014(db);assert.equal((await db.query('select public.create_order_transaction_v1_checked($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7::uuid,$8::uuid,$9) q',body)).rows[0].q.id,receipt.id);assert.deepEqual(await state014(db),committed)
  const stale=await quote(db);await db.query("update shipping_methods set base_fee=251 where code='rf007-acl'")
  body[0]='checkout:'+stale.idempotencyKey;body[8]=stale.quoteFingerprint
  const changed=await state014(db),result=(await db.query('select public.create_order_transaction_v1_checked($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7::uuid,$8::uuid,$9) q',body)).rows[0].q
  assert.deepEqual(result,{outcome:'retired',code:'QUOTE_CHANGED',idempotencyKey:stale.idempotencyKey});assert.deepEqual(await state014(db),changed)
  assert.equal((await db.query('select state from checkout_v1_attempts where token=$1',[body[0]])).rows[0].state,'retired')
 })
 await scenario('non-superuser platform role has no implicit private access and clean installation remains supported',async({db})=>{
  await db.query('alter role supabase_admin nosuperuser');await db.query(sql);await assertPrivate007(db)
  assert.equal((await db.query('select has_function_privilege(\'supabase_admin\',$1,\'EXECUTE\') allowed',[effects007])).rows[0].allowed,false)
 })
 for(const scope of ['global','schema'])for(const access of ['direct','inherit','set'])await scenario(scope+' function defaults / '+access+' access',async({db,role,reject})=>{
  const custom=await role();await db.query('alter default privileges for role postgres '+(scope==='schema'?'in schema public ':'')+'grant execute on functions to '+custom)
  if(access!=='direct')await db.query('grant '+custom+' to service_role with inherit '+(access==='inherit'?'true,set false':'false,set true'))
  await probe007(db,custom,access);await reject()
 })
 await scenario('transitive SET-only membership reaches default-privileged helper role',async({db,role,reject})=>{
  const custom=await role(),middle=await role();await db.query('alter default privileges for role postgres in schema public grant execute on functions to '+custom+';grant '+custom+' to '+middle+' with inherit false,set true;grant '+middle+' to service_role with inherit false,set true')
  await probe007(db,custom,'set');await reject()
 })
 await scenario('non-superuser platform role receiving schema function defaults is rejected',async({db,reject})=>{
  await db.query('alter role supabase_admin nosuperuser;alter default privileges for role postgres in schema public grant execute on functions to supabase_admin')
  await probe007(db,'supabase_admin');await reject()
 })
 await scenario('arbitrary custom superuser is not trusted by name',async({db,role,reject})=>{
  const custom=await role('superuser');assert.equal((await db.query('select rolsuper from pg_roles where rolname=$1',[custom])).rows[0].rolsuper,true)
  await reject(sql,'RF_RELEASE007_PRIVATE_ROLE_PATH')
 })
 await scenario('SET ROLE to owner is rejected even with unchanged owner-only helper ACLs',async({reject})=>{
  await reject(inject007(sql,'grant postgres to service_role with inherit false,set true',"pg_has_role('service_role','postgres','SET')"),'RF_RELEASE007_PRIVATE_ROLE_PATH',true)
 })
 for(const signature of private007){
  await scenario('direct custom EXECUTE rejected: '+signature,async({role,reject})=>{
   const custom=await role();await reject(inject007(sql,'grant execute on function '+signature+' to '+custom,'has_function_privilege('+quoteSQL(custom)+','+quoteSQL(signature)+",'EXECUTE')"),'RF_RELEASE007_PRIVATE_RPC',true)
  })
  await scenario('PUBLIC EXECUTE rejected: '+signature,async({reject})=>{
   await reject(inject007(sql,'grant execute on function '+signature+' to public',"has_function_privilege('anon',"+quoteSQL(signature)+",'EXECUTE')"),'RF_RELEASE007_PRIVATE_RPC',true)
  })
  await scenario('wrong owner rejected: '+signature,async({role,reject})=>{
   const custom=await role();await reject(inject007(sql,'alter function '+signature+' owner to '+custom,'(select proowner='+quoteSQL(custom)+'::regrole from pg_proc where oid='+quoteSQL(signature)+'::regprocedure)'),'RF_RELEASE007_PRIVATE_RPC',true)
  })
  await scenario('unsafe search_path rejected: '+signature,async({reject})=>{
   await reject(inject007(sql,'alter function '+signature+' set search_path=public','(select proconfig=array[\'search_path=public\']::text[] from pg_proc where oid='+quoteSQL(signature)+'::regprocedure)'),'RF_RELEASE007_PRIVATE_RPC',true)
  })
 }
 await scenario('explicit EXECUTE grant to trusted superuser still violates owner-only ACL',async({reject})=>{
  await reject(inject007(sql,'grant execute on function '+effects007+' to supabase_admin','exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid='+quoteSQL(effects007)+"::regprocedure and a.grantee='supabase_admin'::regrole)"),'RF_RELEASE007_PRIVATE_RPC',true)
 })
 await scenario('security-definer trigger drift is rejected',async({reject})=>{
  await reject(inject007(sql,'alter function public.guard_v1_confirmation_007() security definer',"(select prosecdef from pg_proc where oid='public.guard_v1_confirmation_007()'::regprocedure)"),'RF_RELEASE007_PRIVATE_RPC',true)
 })
})
