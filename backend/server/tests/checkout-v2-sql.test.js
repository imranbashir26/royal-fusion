import assert from 'node:assert/strict'
import test from 'node:test'
import {randomUUID} from 'node:crypto'
import {fixtureV2,normalLine,fixedLine,configuredLine,quoteRequest,quoteV2,requestV2,orderV2,baselineV2,applyV2,shapeSQL,clientV2} from './support/checkoutV2Database.js'
import {OrdersV1Service} from '../services/ordersV1Service.js'
import {savePack,saveTester,productPatch,variantPatch} from './support/testerCatalogDatabase.js'

async function fixture(t) {const f=await fixtureV2();t.after(()=>f.db.close());return f}
async function state(db) {
 const r=await db.query(`select jsonb_build_object('orders',(select jsonb_agg(to_jsonb(x) order by id) from public.orders x),
 'items',(select jsonb_agg(to_jsonb(x) order by id) from public.order_items x),
 'components',(select jsonb_agg(to_jsonb(x) order by id) from public.order_item_components x),
 'payments',(select jsonb_agg(to_jsonb(x) order by id) from public.payments x),
 'history',(select jsonb_agg(to_jsonb(x) order by id) from public.order_status_history x),
 'movements',(select jsonb_agg(to_jsonb(x) order by id) from public.inventory_movements x),
 'redemptions',(select jsonb_agg(to_jsonb(x) order by id) from public.coupon_redemptions x),
 'variants',(select jsonb_agg(to_jsonb(x) order by id) from public.product_variants x),
 'coupons',(select jsonb_agg(to_jsonb(x) order by id) from public.coupons x)) s`)
 return r.rows[0].s
}
async function unchangedFailure(db,fn,pattern) {const before=await state(db);await assert.rejects(fn,pattern);assert.deepEqual(await state(db),before)}

test('mixed order: one monetary parent per logical line; whole-order demand and provenance',async t=>{
 const f=await fixture(t),{db}=f,id=f.tester.tester.variant_id
 const lines=[normalLine(f.normal.variant),normalLine(id,2),fixedLine(f,2),configuredLine(f,[{variantId:id,quantityPerPack:3}],2)]
 const input=await requestV2(db,lines),q=await quoteV2(db,quoteRequest(lines));assert.equal(q.subtotal,5800);assert.equal(q.shippingFee,250)
 const receipt=await orderV2(db,input);assert.equal(receipt.lines.length,4);assert.equal(receipt.total,6050)
 const inventory=(await db.query('select stock_quantity,available from public.product_variants where id=$1',[id])).rows[0]
 assert.deepEqual(inventory,{stock_quantity:0,available:false})
 assert.equal((await db.query('select manual_available from public.tester_variants where variant_id=$1',[id])).rows[0].manual_available,true)
 assert.equal((await db.query('select count(*)::int n from public.order_item_components')).rows[0].n,2)
 const movements=(await db.query('select variant_id,quantity_delta from public.inventory_movements order by variant_id')).rows
 assert.deepEqual(new Map(movements.map(m=>[m.variant_id,m.quantity_delta])),new Map([[id,-12],[f.normal.variant,-1]]))
 const pack=(await db.query('select definition_revision::text,definition_fingerprint from public.tester_packs where product_id=$1',[f.fixed.product.id])).rows[0]
 assert.equal(pack.definition_revision,String(f.fixed.definition.definition_revision));assert.equal(pack.definition_fingerprint,f.fixed.definition.definition_fingerprint)
})
test('canonical selection aggregation, order, line identity and replay survive catalog changes',async t=>{
 const f=await fixture(t),{db}=f,id=f.tester.tester.variant_id
 const lines=[configuredLine(f,[{variantId:id.toUpperCase(),quantityPerPack:1},{variantId:id,quantityPerPack:1}])]
 const request=await requestV2(db,lines),receipt=await orderV2(db,request)
 request.lines=[configuredLine(f,[{variantId:id,quantityPerPack:2}])]
 assert.equal((await orderV2(db,request)).id,receipt.id)
 await db.query('update public.product_variants set regular_price=400 where id=$1',[id])
 await db.query('update public.tester_variants set manual_available=false where variant_id=$1',[id])
 const replay=await orderV2(db,request);assert.equal(replay.idempotent,true);assert.equal(replay.lines[0].components[0].referenceUnitPrice,250)
 assert.deepEqual(replay.lines,receipt.lines)
 for(const change of [
  r=>r.lines[0].selections[0].quantityPerPack=3,r=>r.lines[0].quantity=2,r=>r.contact.name='Changed Customer',
  r=>r.shipping.address='Another Fictional Address',r=>r.paymentMethod='Bank Transfer',r=>r.couponCode='OTHER',r=>r.quoteFingerprint='0'.repeat(64),
  r=>r.lines=[normalLine(id,2)]
 ]) {const other=structuredClone(request);change(other);await unchangedFailure(db,()=>orderV2(db,other),/V2_IDEMPOTENCY_CONFLICT/)}
})
test('quote changes and stock failures roll back all effects; sufficient stock changes do not change fingerprint',async t=>{
 const f=await fixture(t),{db}=f,id=f.tester.tester.variant_id,lines=[configuredLine(f)]
 const request=await requestV2(db,lines),original=request.quoteFingerprint
 await db.query('update public.product_variants set stock_quantity=10 where id=$1',[id])
 assert.equal((await quoteV2(db,quoteRequest(lines))).quoteFingerprint,original)
 await db.query('update public.product_variants set regular_price=350 where id=$1',[id])
 await unchangedFailure(db,()=>orderV2(db,request),/V2_QUOTE_CHANGED/)
 await db.query('update public.product_variants set stock_quantity=12 where id=$1',[id])
 const current=await requestV2(db,[fixedLine(f),normalLine(id,9)])
 await db.query('update public.product_variants set stock_quantity=9 where id=$1',[id])
 await unchangedFailure(db,()=>orderV2(db,current),/V2_INSUFFICIENT_STOCK/)
})
test('fixed price and sale price are authoritative, with separately frozen component references',async t=>{
 const f=await fixture(t),{db}=f
 assert.equal((await quoteV2(db,quoteRequest([fixedLine(f)]))).subtotal,450)
 await db.query('update public.product_variants set regular_price=800 where id=$1',[f.tester.tester.variant_id])
 const q=await quoteV2(db,quoteRequest([fixedLine(f,2)]));assert.equal(q.subtotal,900);assert.equal(q.lines[0].components[0].referenceUnitPrice,800)
})
test('actual service role cannot execute v2 order RPC or write v2 orders/items/components; quote permitted',async t=>{
 const f=await fixture(t),{db}=f,input=await requestV2(db,[fixedLine(f)])
 await db.exec('set role service_role')
 try {
  await assert.rejects(()=>orderV2(db,input),/permission denied/)
  await assert.rejects(()=>db.query("insert into public.orders(order_number,customer_name,shipping_address,shipping_city,payment_method,checkout_version,snapshot_version) values('forged','Fixture','Address','City','Cash on Delivery',2,2)"),/V2_DIRECT_WRITE_DENIED/)
  assert.equal((await quoteV2(db,quoteRequest([fixedLine(f)]))).orderingEnabled,false)
 } finally {await db.exec('reset role')}
 const receipt=await orderV2(db,input)
 await db.exec('set role service_role')
 try {
  await assert.rejects(()=>db.query("insert into public.order_items(order_id,product_id,product_name,size,quantity,unit_price,snapshot_version,line_kind) values($1,$2,'Forged','Tester pack',1,450,2,'fixed_tester_pack')",[receipt.id,f.fixed.product.id]),/V2_DIRECT_WRITE_DENIED/)
  await assert.rejects(()=>db.query('insert into public.order_item_components default values'),/permission denied/)
  await assert.rejects(()=>db.query("update public.payments set amount=1 where order_id=$1",[receipt.id]),/V2_DIRECT_WRITE_DENIED/)
  await assert.rejects(()=>db.query('truncate public.orders cascade'),/V2_DIRECT_WRITE_DENIED|permission denied/)
 } finally {await db.exec('reset role')}
 const acl=(await db.query("select has_function_privilege('service_role','public.create_order_transaction_v2(jsonb,uuid)','execute') order_rpc,has_table_privilege('service_role','public.order_item_components','select') read,has_table_privilege('authenticated','public.order_item_components','select') browser")).rows[0]
 assert.deepEqual(acl,{order_rpc:false,read:true,browser:false})
})
test('v1/v2 SQL collision fences and old fulfillment rejection have zero effects',async t=>{
 const f=await fixture(t),{db}=f,req=await requestV2(db,[normalLine(f.normal.variant)]),receipt=await orderV2(db,req)
 const args=['checkout:'+req.idempotencyKey,JSON.stringify([{variantId:f.normal.variant,quantity:1}]),JSON.stringify(req.contact),JSON.stringify(req.shipping)]
 await unchangedFailure(db,()=>db.query("select public.create_order_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,'Cash on Delivery')",args),/V2_IDEMPOTENCY_CONFLICT/)
 await unchangedFailure(db,()=>db.query("select public.apply_admin_order_action($1,$2,'cancel',$3,'0','{}','fixture-request')",[receipt.id,f.admin,randomUUID()]),/ORDER_VERSION_UNSUPPORTED/)
 const key=randomUUID();await db.query("select public.create_order_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,'Cash on Delivery')",['checkout:'+key,...args.slice(1)])
 const v2=await requestV2(db,[normalLine(f.normal.variant)]);v2.idempotencyKey=key
 await unchangedFailure(db,()=>orderV2(db,v2),/V2_IDEMPOTENCY_CONFLICT/)
})
test('snapshot immutability and component completeness use frozen data, not the later catalog',async t=>{
 const f=await fixture(t),{db}=f,receipt=await orderV2(db,await requestV2(db,[fixedLine(f)]))
 for(const sql of ['update public.order_items set quantity=2 where order_id=$1','delete from public.order_item_components where order_id=$1',"update public.orders set checkout_version=1 where id=$1"])
  await unchangedFailure(db,()=>db.query(sql,[receipt.id]),/V2_SNAPSHOT_IMMUTABLE/)
 await db.exec(`create function public.fixture_missing_component() returns trigger language plpgsql as $$begin return null; end$$; create trigger fixture_missing_component before insert on public.order_item_components for each row execute function public.fixture_missing_component()`)
 await unchangedFailure(db,()=>orderV2(db,requestV2Sync(f)),/V2_QUOTE_CHANGED|V2_SNAPSHOT_INVALID/)
 // Explicit valid quote reaches deferred snapshot validation instead of preflight.
 const req=await requestV2(db,[fixedLine(f)]);await unchangedFailure(db,()=>orderV2(db,req),/V2_SNAPSHOT_INVALID/)
})
function requestV2Sync(f) {return {contractVersion:2,idempotencyKey:randomUUID(),lines:[fixedLine(f)],contact:{name:'Fixture Customer',email:'fixture@example.invalid',phone:'00000000000'},shipping:{address:'Fictional Address',city:'Karachi',province:'Sindh',notes:''},paymentMethod:'Cash on Delivery',couponCode:'',quoteFingerprint:'0'.repeat(64)}}

for(const styles of [['LF','LF'],['CRLF','CRLF'],['LF','CRLF'],['CRLF','LF']]) test('migration exact install/rerun '+styles.join(' → '),async t=>{
 const {db}=await baselineV2();t.after(()=>db.close());await applyV2(db,styles[0]);const before=(await db.query(shapeSQL)).rows[0].shape;await applyV2(db,styles[1]);assert.equal((await db.query(shapeSQL)).rows[0].shape,before)
})
test('unknown baseline and mutated target reject without repair',async t=>{
 const {db}=await baselineV2();t.after(()=>db.close());await db.exec('alter table public.orders add column unrelated_drift text');await assert.rejects(()=>applyV2(db),/BASELINE_DRIFT/)
})

test('fixed sale/definition changes, configurable limits, membership and manual availability',async t=>{
 const f=await fixture(t),{db}=f,id=f.tester.tester.variant_id
 const oldRequest=await requestV2(db,[fixedLine(f)])
 f.fixed=await savePack(db,f.admin,f.fixed.product.id,{}, {fixedSalePrice:400},String(f.fixed.product.catalog_revision),String(f.fixed.definition.definition_revision))
 assert.equal((await quoteV2(db,quoteRequest([fixedLine(f)]))).subtotal,400)
 await unchangedFailure(db,()=>orderV2(db,oldRequest),/V2_DEFINITION_STALE/)
 for(const line of [configuredLine(f,[{variantId:id,quantityPerPack:1}]),configuredLine(f,[{variantId:f.normal.variant,quantityPerPack:2}]),configuredLine(f,[{variantId:randomUUID(),quantityPerPack:2}])])
  await assert.rejects(()=>quoteV2(db,quoteRequest([line])),/V2_PACK_UNITS_INVALID|V2_SELECTION_UNAVAILABLE/)
 const config=await savePack(db,f.admin,f.configurable.product.id,{}, {maximumUnits:2,allowedVariants:[{testerVariantId:id,active:true,displayOrder:0},{testerVariantId:f.second.tester.variant_id,active:false,displayOrder:1}]},String(f.configurable.product.catalog_revision),String(f.configurable.definition.definition_revision));f.configurable=config
 assert.equal((await quoteV2(db,quoteRequest([configuredLine(f)]))).subtotal,500)
 await assert.rejects(()=>quoteV2(db,quoteRequest([configuredLine(f,[{variantId:id,quantityPerPack:3}])])),/V2_PACK_UNITS_INVALID/)
 await assert.rejects(()=>quoteV2(db,quoteRequest([configuredLine(f,[{variantId:f.second.tester.variant_id,quantityPerPack:2}])])),/V2_SELECTION_UNAVAILABLE/)
 const valid=await requestV2(db,[fixedLine(f)]);await db.query('update public.tester_variants set manual_available=false where variant_id=$1',[id])
 await unchangedFailure(db,()=>orderV2(db,valid),/V2_SELECTION_UNAVAILABLE/)
 await db.query('update public.tester_variants set manual_available=true where variant_id=$1',[id]);await db.query('update public.product_variants set stock_quantity=0 where id=$1',[id])
 await assert.rejects(()=>quoteV2(db,quoteRequest([normalLine(id)])),/V2_SELECTION_UNAVAILABLE/)
})

test('coupons use parent product, declared tester/pack category and relational associations, never components',async t=>{
 const f=await fixture(t),{db}=f,primary=randomUUID(),related=randomUUID(),componentCategory=randomUUID(),coupon=randomUUID()
 await db.query("insert into public.categories(id,name,slug,status,active) values($1,'Pack category','pack-cat','Published',true),($2,'Related','related','Published',true),($3,'Component','component','Published',true)",[primary,related,componentCategory])
 await db.query('update public.products set category_id=$1 where id=$2',[primary,f.fixed.product.id])
 await db.query('update public.products set category_id=$1 where id=$2',[componentCategory,f.tester.product.id])
 await db.query('insert into public.product_categories(product_id,category_id) values($1,$2)',[f.fixed.product.id,related])
 await db.query("insert into public.coupons(id,code,type,discount_value,status,start_date,end_date) values($1,'PARENT10','Percentage',10,'Active',(statement_timestamp() at time zone 'UTC')::date,(statement_timestamp() at time zone 'UTC')::date)",[coupon])
 const preview=async lines=>quoteV2(db,{...quoteRequest(lines),couponCode:'PARENT10'})
 await db.query('insert into public.coupon_products(coupon_id,product_id) values($1,$2)',[coupon,f.fixed.product.id])
 await db.query('insert into public.coupon_categories(coupon_id,category_id) values($1,$2)',[coupon,primary])
 assert.equal((await preview([fixedLine(f),normalLine(f.tester.tester.variant_id)])).discount,45)
 await db.query('update public.coupon_categories set category_id=$2 where coupon_id=$1',[coupon,related]);assert.equal((await preview([fixedLine(f)])).discount,45)
 await db.query('update public.coupon_categories set category_id=$2 where coupon_id=$1',[coupon,componentCategory]);await assert.rejects(()=>preview([fixedLine(f)]),/V2_INVALID_COUPON/)
 await db.query('delete from public.coupon_products where coupon_id=$1',[coupon]);assert.equal((await preview([normalLine(f.tester.tester.variant_id)])).discount,25)
 await db.query('update public.coupon_categories set category_id=$2 where coupon_id=$1',[coupon,primary])
 const request=await requestV2(db,[fixedLine(f)],{quote:{couponCode:'PARENT10'},order:{couponCode:'PARENT10'}})
 const receipt=await orderV2(db,request);assert.equal(receipt.subtotal,450);assert.equal(receipt.discount,45)
 assert.equal((await db.query('select used_count from public.coupons where id=$1',[coupon])).rows[0].used_count,1)
 await db.query('update public.coupons set usage_limit=1 where id=$1',[coupon]);await unchangedFailure(db,()=>orderV2(db,{...request,idempotencyKey:randomUUID()}),/V2_INVALID_COUPON/)
 assert.equal((await orderV2(db,request)).id,receipt.id)
})

test('shipping parity: priority, post-discount thresholds, free shipping and fail-closed ambiguity',async t=>{
 const f=await fixture(t),{db}=f,method=(await db.query('select id from public.shipping_methods limit 1')).rows[0].id
 await db.query("insert into public.shipping_rates(shipping_method_id,scope_type,scope_value,fee,minimum_subtotal) values($1,'default','',200,0),($1,'province','Sindh',150,0),($1,'city','Karachi',100,0)",[method])
 assert.equal((await quoteV2(db,quoteRequest([fixedLine(f)]))).shippingFee,100)
 await db.query("update public.shipping_rates set minimum_subtotal=500 where scope_type='city'")
 assert.equal((await quoteV2(db,quoteRequest([fixedLine(f)]))).shippingFee,150)
 await db.query('update public.shipping_methods set free_shipping_threshold=400 where id=$1',[method])
 assert.equal((await quoteV2(db,quoteRequest([fixedLine(f)]))).shippingFee,0)
 await db.query('update public.shipping_methods set free_shipping_threshold=null where id=$1',[method])
 const request=await requestV2(db,[fixedLine(f)])
 await db.query("delete from public.shipping_rates where scope_type<>'default'")
 await db.query("insert into public.shipping_rates(shipping_method_id,scope_type,scope_value,fee,minimum_subtotal) values($1,'default','alternate',200,0)",[method])
 await unchangedFailure(db,()=>orderV2(db,request),/V2_CONFIGURATION_INVALID/)
})

test('payment precedence is SQL-authoritative; disabled-after-quote rejects without effects',async t=>{
 const f=await fixture(t),{db}=f,request=await requestV2(db,[fixedLine(f)])
 await db.exec(`insert into public.public_site_settings(key,value) values('commerce','{"codEnabled":true,"bankTransferEnabled":true}') on conflict(key) do update set value=excluded.value`)
 await db.exec(`update public.site_settings set payments='[{"name":"Cash on Delivery","active":false},{"name":"Bank Transfer","active":true}]' where id='site'`)
 const q=await quoteV2(db,quoteRequest([fixedLine(f)]));assert.deepEqual(q.paymentMethods,['Bank Transfer']);assert.notEqual(q.quoteFingerprint,request.quoteFingerprint)
 await unchangedFailure(db,()=>orderV2(db,request),/V2_PAYMENT_UNAVAILABLE/)
 const bank=await requestV2(db,[fixedLine(f)],{order:{paymentMethod:'Bank Transfer'}});assert.equal((await orderV2(db,bank)).paymentStatus,'Pending')
})

test('historical rows survive without inferred identities; new historical spoofing is rejected',async t=>{
 const {db}=await baselineV2();t.after(()=>db.close())
 const id=randomUUID();await db.query("insert into public.orders(id,order_number,customer_name,customer_email,shipping_address,shipping_city,payment_method) values($1,'historic','Historic','historic@example.invalid','Old address','Old city','Cash on Delivery')",[id])
 await db.exec('alter table public.order_items drop constraint order_items_variant_required_for_new_rows')
 await db.query("insert into public.order_items(order_id,product_name,size,quantity,unit_price) values($1,'Old purchase','Legacy size',1,100)",[id])
 // Restore the exact existing NOT VALID constraint; old NULL data is grandfathered.
 await db.exec('alter table public.order_items add constraint order_items_variant_required_for_new_rows check(variant_id is not null) not valid')
 const before=(await db.query('select to_jsonb(o) o from public.orders o where id=$1',[id])).rows[0].o
 await applyV2(db)
 const after=(await db.query('select to_jsonb(o) o from public.orders o where id=$1',[id])).rows[0].o
 for(const key of Object.keys(before))assert.deepEqual(after[key],before[key])
 assert.equal(after.snapshot_version,0);const item=(await db.query('select * from public.order_items where order_id=$1',[id])).rows[0]
 assert.equal(item.variant_id,null);assert.equal(item.pack_id,null);assert.equal(item.canonical_line_identity,null)
 await assert.rejects(()=>db.query("insert into public.orders(order_number,customer_name,shipping_address,shipping_city,payment_method,snapshot_version) values('spoof','Historic','Address','City','Cash on Delivery',0)"),/V2_HISTORICAL_SPOOF/)
 await assert.rejects(()=>db.query("insert into public.order_items(order_id,product_name,size,quantity,unit_price,snapshot_version) values($1,'spoof','size',1,100,0)",[id]),/V2_HISTORICAL_SPOOF/)
})

test('semantic manifest keeps nullability, effective ACLs and constraint properties strict',async t=>{
 const {db}=await baselineV2();t.after(()=>db.close())
 const before=(await db.query(shapeSQL)).rows[0].shape
 // The reviewed owner/service already have full view-lock capability through
 // UPDATE/DELETE/TRUNCATE; the nondelegable MAINTAIN bit is redundant.
 await db.exec('begin;revoke maintain on public.product_sales_rankings from postgres,service_role')
 assert.equal((await db.query(shapeSQL)).rows[0].shape,before)
 await db.exec('set local role service_role;lock table public.product_sales_rankings in access exclusive mode nowait;reset role')
 await applyV2(db)
 // The previous install committed; rebuild a baseline for independent drift cases.
 const baseline=await baselineV2();t.after(()=>baseline.db.close())
 for(const [name,mutation] of [
  ['removed NOT NULL','alter table public.products alter column name drop not null'],
  ['unexpected NOT NULL','alter table public.products alter column price set not null'],
  ['column type','alter table public.products alter column name type varchar(240)'],
  ['column default',"alter table public.products alter column short_description set default 'drift'"],
  ['PUBLIC view SELECT','grant select on public.product_sales_rankings to public'],
  ['anon view SELECT','grant select on public.product_sales_rankings to anon'],
  ['authenticated view UPDATE','grant update on public.product_sales_rankings to authenticated'],
  ['removed view SELECT','revoke select on public.product_sales_rankings from authenticated'],
  ['unexpected view MAINTAIN grantee','grant maintain on public.product_sales_rankings to anon'],
  ['delegable view MAINTAIN','grant maintain on public.product_sales_rankings to service_role with grant option'],
  ['table MAINTAIN','grant maintain on public.tester_variants to anon'],
  ['column ACL','grant select(name) on public.products to anon'],
  ['function owner','alter function public.tester_catalog_assert_admin(uuid,text) owner to service_role'],
  ['function search_path',"alter function public.tester_catalog_assert_admin(uuid,text) set search_path=public"],
  ['function ACL','grant execute on function public.tester_catalog_assert_admin(uuid,text) to public'],
  ['role inheritance','grant service_role to anon'],
  ['NOT NULL inheritance flag','alter table public.products alter constraint products_name_not_null no inherit'],
 ])await t.test(name,async()=>{
  const prior=(await baseline.db.query(shapeSQL)).rows[0].shape
  await baseline.db.exec('begin;'+mutation);await assert.rejects(()=>applyV2(baseline.db),/BASELINE_DRIFT/)
  assert.equal((await baseline.db.query(shapeSQL)).rows[0].shape,prior)
 })
})

test('target function, trigger, policy and ACL mutation are detected; populated rerun preserves data',async t=>{
 const f=await fixture(t),{db}=f;await orderV2(db,await requestV2(db,[fixedLine(f)]));const before=await state(db)
 await applyV2(db,'CRLF');assert.deepEqual(await state(db),before)
 for(const mutation of [
  "alter function public.quote_checkout_v2(jsonb,uuid) set search_path=public",
  'alter table public.order_items disable trigger snapshot_write_013',
  'create policy forged on public.order_item_components for select to authenticated using(true)',
  'grant execute on function public.create_order_transaction_v2(jsonb,uuid) to service_role',
  'grant insert on public.order_item_components to service_role',
 ]) {await db.exec('begin;'+mutation);await assert.rejects(()=>applyV2(db),/TARGET_DRIFT/);assert.deepEqual(await state(db),before)}
})

test('late payment failure rolls back orders, snapshots, inventory, coupon usage and history',async t=>{
 const f=await fixture(t),{db}=f,coupon=randomUUID()
 await db.query("insert into public.coupons(id,code,type,discount_value,status) values($1,'ROLLBACK','Percentage',10,'Active')",[coupon])
 const request=await requestV2(db,[fixedLine(f)],{quote:{couponCode:'ROLLBACK'},order:{couponCode:'ROLLBACK'}})
 await db.exec(`create function public.fixture_payment_failure() returns trigger language plpgsql as $$begin raise exception 'fixture payment failure'; end$$;create trigger fixture_payment_failure before insert on public.payments for each row execute function public.fixture_payment_failure()`)
 await unchangedFailure(db,()=>orderV2(db,request),/fixture payment failure/)
})

test('v1 Baraan/tester quotes, transactions and cancellation still work under the actual service role',async t=>{
 const f=await fixture(t),{db}=f
 const request=await requestV2(db,[normalLine(f.normal.variant)])
 const create=async id=>(await db.query("select public.create_order_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,'Cash on Delivery') result",
  ['checkout:'+randomUUID(),JSON.stringify([{variantId:id,quantity:1}]),JSON.stringify(request.contact),JSON.stringify(request.shipping)])).rows[0].result
 await db.exec('set role service_role')
 try {
  const normal=await create(f.normal.variant);assert.equal(normal.subtotal,2900);assert.equal(normal.shippingFee,250);assert.equal(normal.total,3150)
  const tester=await create(f.tester.tester.variant_id);assert.equal(tester.subtotal,250)
  await db.query("update public.orders set internal_notes='[\"service v1 note\"]'::jsonb where id=$1",[normal.id])
  const rev=String((await db.query('select revision from public.orders where id=$1',[normal.id])).rows[0].revision)
  await db.query("select public.apply_admin_order_action($1,$2,'cancel',$3,$4,$5::jsonb,'fixture-request')",[normal.id,f.admin,randomUUID(),rev,JSON.stringify({reason:'Fixture cancellation'})])
 } finally {await db.exec('reset role')}
 assert.equal((await db.query('select stock_quantity from public.product_variants where id=$1',[f.normal.variant])).rows[0].stock_quantity,12)
 assert.equal((await db.query('select stock_quantity from public.product_variants where id=$1',[f.tester.tester.variant_id])).rows[0].stock_quantity,11)
 await assert.rejects(()=>db.query("select public.create_order_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,'Cash on Delivery')",
  ['checkout:'+randomUUID(),JSON.stringify([{variantId:f.fixed.product.id,quantity:1}]),JSON.stringify(request.contact),JSON.stringify(request.shipping)]),/variant|available|found/i)
})

test('configurable different/reordered selections, definition changes and invalid structural state fail safely',async t=>{
 const f=await fixture(t),{db}=f,a=f.tester.tester.variant_id,b=f.second.tester.variant_id
 const lines=[configuredLine(f,[{variantId:a,quantityPerPack:1},{variantId:b,quantityPerPack:1}])]
 const request=await requestV2(db,lines),receipt=await orderV2(db,request)
 const reordered=structuredClone(request);reordered.lines[0].selections.reverse();assert.equal((await orderV2(db,reordered)).id,receipt.id)
 const changed=structuredClone(request);changed.lines[0].selections=[{variantId:b,quantityPerPack:2}];await unchangedFailure(db,()=>orderV2(db,changed),/V2_IDEMPOTENCY_CONFLICT/)
 // Replay uses frozen snapshots after later recipe/pricing changes.
 f.fixed=await savePack(db,f.admin,f.fixed.product.id,{}, {components:[{testerVariantId:b,quantityPerPack:3,displayOrder:0}]},String(f.fixed.product.catalog_revision),String(f.fixed.definition.definition_revision))
 assert.equal((await quoteV2(db,quoteRequest([fixedLine(f)]))).lines[0].components[0].testerVariantId,b)
 // Simulate an inconsistent external catalog ONLY in this disposable owner fixture.
 // Normal 012 writers prohibit this state; resolver still must fail closed.
 await db.exec('set session_replication_role=replica')
 try {await db.query("update public.products set active=false,status='Archived' where id=$1",[f.second.product.id])}
 finally {await db.exec('set session_replication_role=origin')}
 await assert.rejects(()=>quoteV2(db,quoteRequest([fixedLine(f)])),/V2_SELECTION_UNAVAILABLE/)
 assert.equal((await orderV2(db,request)).id,receipt.id)
})

test('effective snapshot/helper privileges are least-authority for every exposed role',async t=>{
 const f=await fixture(t),{db}=f
 const functions=(await db.query(`select p.oid::regprocedure::text signature,p.proname,p.prosecdef,p.proconfig,r.rolname owner
  from pg_proc p join pg_roles r on r.oid=p.proowner where p.pronamespace='public'::regnamespace
  and (p.proname like 'checkout_v2_%' or p.proname like 'checkout_snapshot_%' or p.proname in ('quote_checkout_v2','create_order_transaction_v2','create_order_transaction_v1_013_internal','apply_admin_order_action_v1_013_internal'))`)).rows
 assert.ok(functions.length>=15)
 for(const fn of functions){
  assert.equal(fn.owner,'postgres');assert.deepEqual(fn.proconfig,['search_path=""'])
  for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,fn.signature])).rows[0].allowed,role==='service_role'&&fn.proname==='quote_checkout_v2',role+':'+fn.signature)
 }
 assert.equal(functions.find(f=>f.proname==='checkout_snapshot_write_guard_013').prosecdef,false)
 for(const role of ['anon','authenticated','service_role']){
  for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'])assert.equal((await db.query("select has_table_privilege($1,'public.order_item_components',$2) allowed",[role,privilege])).rows[0].allowed,role==='service_role'&&privilege==='SELECT',role+':'+privilege)
 }
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.order_item_components'::regclass")).rows[0].relrowsecurity,true)
 assert.equal((await db.query("select count(*)::int n from pg_policy where polrelid='public.order_item_components'::regclass")).rows[0].n,0)
 await db.exec("set role service_role; select set_config('royal_fusion.checkout_v2_owner','true',false)")
 try {await assert.rejects(()=>db.exec("insert into public.orders(order_number,customer_name,shipping_address,shipping_city,payment_method,checkout_version,snapshot_version) values('guc-spoof','Fixture','Address','City','Cash on Delivery',2,2)"),/V2_DIRECT_WRITE_DENIED/)}
 finally{await db.exec('reset role')}
})

test('extra owner-inserted snapshot component is rejected against the frozen complete recipe',async t=>{
 const f=await fixture(t),{db}=f,receipt=await orderV2(db,await requestV2(db,[fixedLine(f)])),item=receipt.lines[0]
 await unchangedFailure(db,()=>db.query(`insert into public.order_item_components(order_id,order_item_id,tester_variant_id,tester_product_id,tester_name,sku,size,volume_ml,quantity_per_pack,total_physical_quantity,reference_unit_price,position)
  values($1,$2,$3,$4,'Extra component','EXTRA','5 ml',5,1,1,300,1)`,[receipt.id,item.id,f.second.tester.variant_id,f.second.product.id]),/V2_SNAPSHOT_INVALID/)
})
test('authenticated browsers retain v1 reads but cannot obtain v2 component snapshots through order JSON',async t=>{
 const f=await fixture(t),{db}=f,request=await requestV2(db,[fixedLine(f)]),receipt=await orderV2(db,request,f.admin)
 const old=(await db.query("select public.create_order_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,'Cash on Delivery',null,null,$5) result",
  ['checkout:'+randomUUID(),JSON.stringify([{variantId:f.normal.variant,quantity:1}]),JSON.stringify(request.contact),JSON.stringify(request.shipping),f.admin])).rows[0].result
 // Supabase-like auth.uid() in this disposable fixture only.
 await db.exec("create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$")
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.admin]);await db.exec('set role authenticated')
 try{
  assert.equal((await db.query('select count(*)::int n from public.orders where id=$1',[old.id])).rows[0].n,1)
  assert.equal((await db.query('select count(*)::int n from public.orders where id=$1',[receipt.id])).rows[0].n,0)
  assert.equal((await db.query('select count(*)::int n from public.order_items where order_id=$1',[receipt.id])).rows[0].n,0)
  await assert.rejects(()=>db.exec('select * from public.order_item_components'),/permission denied/)
 }finally{await db.exec('reset role')}
})
test('normal variant exact stock exhaustion preserves v1 availability behavior',async t=>{
 const f=await fixture(t),{db}=f
 await orderV2(db,await requestV2(db,[normalLine(f.normal.variant,12)]))
 assert.deepEqual((await db.query('select stock_quantity,available from public.product_variants where id=$1',[f.normal.variant])).rows[0],{stock_quantity:0,available:false})
 assert.equal((await db.query('select stock_quantity from public.product_variants where id=$1',[f.tester.tester.variant_id])).rows[0].stock_quantity,12)
})

async function v1Sql(db,request,{service=true}={}) {
 if(service)await db.exec('set role service_role')
 try{return (await db.query('select public.create_order_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,null,$7) result',
  ['checkout:'+request.idempotencyKey,JSON.stringify(request.lines.map(l=>({variantId:l.variantId,quantity:l.quantity}))),JSON.stringify(request.contact),JSON.stringify(request.shipping),request.paymentMethod,request.couponCode,request.customerId??null])).rows[0].result}
 finally{if(service)await db.exec('reset role').catch(e=>{if(e.code!=='25P02')throw e})}
}

test('actual SQL UUID namespace: both same-version case orders and all four cross-version collisions have no duplicate effects',async t=>{
 const f=await fixture(t),{db}=f,coupon=randomUUID()
 await db.query("insert into public.coupons(id,code,type,discount_value,status) values($1,'UUID10','Percentage',10,'Active')",[coupon])
 for(const version of [1,2])for(const uppercaseFirst of [false,true])await t.test(`v${version} ${uppercaseFirst?'uppercase':'lowercase'} first`,async()=>{
  const input=await requestV2(db,[normalLine(f.normal.variant)],{quote:{couponCode:'UUID10'},order:{couponCode:'UUID10'}})
  const canonical='a'+input.idempotencyKey.slice(1);input.idempotencyKey=uppercaseFirst?canonical.toUpperCase():canonical
  const create=version===1?r=>v1Sql(db,r):r=>orderV2(db,r),first=await create(input),before=await state(db)
  const retry={...input,idempotencyKey:uppercaseFirst?canonical:canonical.toUpperCase()}
  const replay=await create(retry);assert.equal(replay.id,first.id);assert.equal(replay.idempotent,true);assert.deepEqual(await state(db),before)
  assert.equal((await db.query('select count(*)::int n from public.orders where public.checkout_v2_stored_uuid(idempotency_key)=$1::uuid',[canonical])).rows[0].n,1)
  assert.equal((await db.query('select idempotency_key from public.orders where id=$1',[first.id])).rows[0].idempotency_key,'checkout:'+canonical)
  for(const mutate of [r=>r.lines[0].quantity=2,r=>r.contact.name='Changed customer',r=>r.shipping.address='Changed address',r=>r.paymentMethod='Bank Transfer',r=>r.couponCode='OTHER']){
   const changed=structuredClone(retry);mutate(changed);await unchangedFailure(db,()=>create(changed),/V2_IDEMPOTENCY_CONFLICT/)
  }
  const other=version===1?r=>orderV2(db,r):r=>v1Sql(db,r)
  await unchangedFailure(db,()=>other(retry),/V2_IDEMPOTENCY_CONFLICT/)
  // Neither replay nor a cross-version conflict may consult current commerce state.
  await db.exec('begin')
  try{
   await db.query('update public.product_variants set stock_quantity=0,regular_price=3500 where id=$1',[f.normal.variant])
   await db.exec('update public.site_settings set payments=\'[{"name":"Cash on Delivery","active":false},{"name":"Bank Transfer","active":false}]\'')
   const unavailableState=await state(db);assert.equal((await create(retry)).id,first.id);assert.deepEqual(await state(db),unavailableState)
   await assert.rejects(()=>other(retry),/V2_IDEMPOTENCY_CONFLICT/)
   await db.exec('rollback');assert.deepEqual(await state(db),before)
  }catch(e){await db.exec('rollback');throw e}
 })
})

test('shared SQL key derives one UUID/lock identity and malformed keys cannot produce effects',async t=>{
 const f=await fixture(t),{db}=f,input=await requestV2(db,[normalLine(f.normal.variant)]),id=input.idempotencyKey
 const keys=['checkout:'+id,'checkout:'+id.toUpperCase(),' CHECKOUT:{'+id.toUpperCase()+'} ','checkout:'+id.replaceAll('-','')]
 const rows=(await db.query("select public.checkout_v2_key(k) key,hashtextextended(public.checkout_v2_key(k),0)::text lock from unnest($1::text[]) k",[keys])).rows
 assert.equal(new Set(rows.map(r=>r.key)).size,1);assert.equal(new Set(rows.map(r=>r.lock)).size,1)
 assert.equal(rows[0].key,'checkout:'+id)
 for(const bad of ['not-a-uuid','aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeeg','',id+'-extra']){
  await unchangedFailure(db,()=>v1Sql(db,{...input,idempotencyKey:bad}),/V2_INVALID_REQUEST/)
  await unchangedFailure(db,()=>orderV2(db,{...input,idempotencyKey:bad}),/V2_INVALID_REQUEST/)
 }
})

for(const styles of [['LF','LF'],['CRLF','CRLF'],['LF','CRLF'],['CRLF','LF']])test('populated historical UUID aliases and ambiguous legacy rows survive '+styles.join(' -> '),async t=>{
 const f=await baselineV2(),{db}=f;t.after(()=>db.close())
 const product=randomUUID(),variant=randomUUID(),key='a'+randomUUID().slice(1),coupon=randomUUID()
 await db.query("insert into public.products(id,name,slug,sku,price,scent_family,main_image_url,status,active) values($1::uuid,'Historical fixture',$1::uuid::text,$1::uuid::text,2900,'Woody','/fixture.webp','Published',true)",[product])
 await db.query("insert into public.product_variants(id,product_id,option_value,sku,regular_price,stock_quantity) values($1::uuid,$2,'50 ml',$1::uuid::text,2900,12)",[variant,product])
 await db.exec("insert into public.shipping_methods(code,name,base_fee) values('history-uuid','Fixture',250);insert into public.site_settings(id,payments) values('site','[{\"name\":\"Cash on Delivery\",\"active\":true}]') on conflict(id) do update set payments=excluded.payments")
 await db.query("insert into public.coupons(id,code,type,discount_value,status) values($1,'HISTORY10','Percentage',10,'Active')",[coupon])
 const input=await requestV2Legacy(variant,key)
 const historical=await v1Sql(db,{...input,idempotencyKey:key.toUpperCase()})
 const aliasKey=(await db.query('select idempotency_key from public.orders where id=$1',[historical.id])).rows[0].idempotency_key
 assert.equal(aliasKey,'checkout:'+key.toUpperCase())
 const duplicateKey='b'+randomUUID().slice(1);await v1Sql(db,{...input,idempotencyKey:duplicateKey});await v1Sql(db,{...input,idempotencyKey:duplicateKey.toUpperCase()})
 const aliases=[]
 for(const form of ['braced','unhyphenated']){
  const uuid='c'+randomUUID().slice(1),alias=form==='braced'?'{'+uuid.toUpperCase()+'}':uuid.replaceAll('-','')
  const old=await v1Sql(db,{...input,idempotencyKey:alias});aliases.push({uuid,alias,id:old.id})
 }
 const beforeInstall=(await db.query('select to_jsonb(o) o from public.orders o order by id')).rows
 await applyV2(db,styles[0]);const before=await state(db)
 for(const row of beforeInstall){const current=before.orders.find(o=>o.id===row.o.id);for(const [k,v] of Object.entries(row.o))assert.deepEqual(current[k],v);assert.equal(current.snapshot_version,0)}
 // Same UUID, no catalog eligibility: the historical receipt remains reachable.
 await db.query('update public.product_variants set stock_quantity=0 where id=$1',[variant])
 await db.exec('update public.site_settings set payments=\'[{"name":"Cash on Delivery","active":false}]\'')
 const unavailable=await state(db)
 assert.equal((await v1Sql(db,input)).id,historical.id);assert.deepEqual(await state(db),unavailable)
 for(const alias of aliases){
  assert.equal((await v1Sql(db,{...input,idempotencyKey:alias.uuid})).id,alias.id)
  assert.equal((await db.query('select idempotency_key from public.orders where id=$1',[alias.id])).rows[0].idempotency_key,'checkout:'+alias.alias)
 }
 assert.deepEqual(await state(db),unavailable)
 await unchangedFailure(db,()=>v1Sql(db,{...input,contact:{...input.contact,name:'Different customer'}}),/V2_IDEMPOTENCY_CONFLICT/)
 const v2={...input,contractVersion:2,quoteFingerprint:'0'.repeat(64)}
 await unchangedFailure(db,()=>orderV2(db,v2),/V2_IDEMPOTENCY_CONFLICT/)
 for(const create of [r=>v1Sql(db,r),r=>orderV2(db,{...r,contractVersion:2,quoteFingerprint:'0'.repeat(64)})])
  await unchangedFailure(db,()=>create({...input,idempotencyKey:duplicateKey}),/V2_IDEMPOTENCY_AMBIGUOUS/)
 const frozen=await state(db),shape=(await db.query(shapeSQL)).rows[0].shape
 await applyV2(db,styles[1]);assert.deepEqual(await state(db),frozen);assert.equal((await db.query(shapeSQL)).rows[0].shape,shape)
 assert.equal((await db.query('select idempotency_key from public.orders where id=$1',[historical.id])).rows[0].idempotency_key,aliasKey)
 assert.equal((await db.query('select idempotency_key from public.payments where order_id=$1',[historical.id])).rows[0].idempotency_key,aliasKey+':payment')
 assert.equal((await db.query("select indexdef from pg_indexes where indexname='orders_idempotency_uidx'")).rows[0].indexdef.includes('UNIQUE'),true)
})
function requestV2Legacy(variant,key){return {idempotencyKey:key,lines:[normalLine(variant)],contact:{name:'Historical customer',email:'history@example.invalid',phone:'00000000000'},shipping:{address:'Historical address',city:'Karachi',province:'Sindh',notes:''},paymentMethod:'Cash on Delivery',couponCode:'HISTORY10'}}

const serviceInput=request=>({idempotencyKey:request.idempotencyKey,items:request.lines.map(l=>({variantId:l.variantId,quantity:l.quantity})),
 contact:request.contact,shipping:request.shipping,paymentMethod:request.paymentMethod,couponCode:request.couponCode})
function actualV1Service(db,{denyReads=false}={}) {
 const client=clientV2(db),rpc=client.rpc.bind(client),calls=[],logs=[]
 client.rpc=async(name,args)=>{calls.push({name,args:structuredClone(args)});return rpc(name,args)}
 if(denyReads)client.from=()=>assert.fail('Service cannot read current catalog or textual order identity before SQL replay')
 return {client,calls,logs,service:new OrdersV1Service(client,{logger:{warn:entry=>logs.push(entry)}})}
}

test('actual V1 service: historical aliases replay frozen receipts; ambiguity and changed intent reach SQL with zero effects',async t=>{
 const f=await baselineV2(),{db}=f;t.after(()=>db.close())
 const product=randomUUID(),variant=randomUUID(),coupon=randomUUID()
 await db.query("insert into public.products(id,name,slug,sku,price,scent_family,main_image_url,status,active) values($1::uuid,'Historical service',$1::uuid::text,$1::uuid::text,2900,'Woody','/fixture.webp','Published',true)",[product])
 await db.query("insert into public.product_variants(id,product_id,option_value,sku,regular_price,stock_quantity) values($1::uuid,$2,'50 ml',$1::uuid::text,2900,12)",[variant,product])
 await db.exec("insert into public.shipping_methods(code,name,base_fee) values('service-history','Fixture',250);insert into public.site_settings(id,payments) values('site','[{\"name\":\"Cash on Delivery\",\"active\":true}]') on conflict(id) do update set payments=excluded.payments")
 await db.query("insert into public.coupons(id,code,type,discount_value,status) values($1,'HISTORY10','Percentage',10,'Active')",[coupon])
 const aliases=[]
 for(const form of ['uppercase','braced','unhyphenated']){
  const id='a'+randomUUID().slice(1),alias=form==='uppercase'?id.toUpperCase():form==='braced'?'{'+id.toUpperCase()+'}':id.replaceAll('-','')
  const request=requestV2Legacy(variant,id),old=await v1Sql(db,{...request,idempotencyKey:alias})
  aliases.push({form,request,id:old.id,storedKey:'checkout:'+alias})
 }
 const ambiguous='b'+randomUUID().slice(1),duplicate=requestV2Legacy(variant,ambiguous)
 await v1Sql(db,duplicate);await v1Sql(db,{...duplicate,idempotencyKey:ambiguous.toUpperCase()})
 await applyV2(db)
 const {service,calls,logs}=actualV1Service(db,{denyReads:true}),before=await state(db)
 for(const alias of aliases)await t.test(alias.form+' service replay',async()=>{
  const count=calls.length,result=await service.create(serviceInput(alias.request),null,'historical-service-id')
  assert.equal(result.id,alias.id);assert.equal(result.idempotencyKey,alias.request.idempotencyKey);assert.equal(result.idempotent,true)
  assert.equal(result.paymentStatus,'Unpaid');assert.equal(result.currency,'PKR');assert.equal(result.total,2860)
  assert.equal(calls.length,count+1);assert.equal(calls.at(-1).name,'create_order_transaction')
  assert.deepEqual(await state(db),before)
  assert.equal((await db.query('select idempotency_key from public.orders where id=$1',[alias.id])).rows[0].idempotency_key,alias.storedKey)
 })
 await unchangedFailure(db,()=>service.create(serviceInput(duplicate)),/cannot be matched safely/)
 assert.equal(logs.at(-1).category,'P0001')
 // All current commerce becomes invalid; frozen replay/conflict still precede it.
 await db.query('update public.product_variants set stock_quantity=0,available=false,regular_price=4000 where id=$1',[variant])
 await db.query("update public.products set status='Draft',active=false where id=$1",[product])
 await db.exec('update public.site_settings set payments=\'[{"name":"Cash on Delivery","active":false}]\';update public.shipping_methods set active=false')
 await db.query("update public.coupons set status='Inactive' where id=$1",[coupon])
 const invalidated=await state(db)
 for(const alias of aliases){assert.equal((await service.create(serviceInput(alias.request))).id,alias.id);assert.deepEqual(await state(db),invalidated)}
 const input=serviceInput(aliases[0].request)
 for(const mutate of [r=>r.items[0].quantity=2,r=>r.contact.name='Changed',r=>r.shipping.address='Changed address',r=>r.paymentMethod='Bank Transfer',r=>r.couponCode='OTHER']){
  const changed=structuredClone(input);mutate(changed)
  const count=calls.length;await assert.rejects(()=>service.create(changed),{code:'IDEMPOTENCY_CONFLICT',status:409})
  assert.equal(calls.length,count+1);assert.deepEqual(await state(db),invalidated)
 }
 const count=calls.length;await assert.rejects(()=>service.create(serviceInput(duplicate)),{code:'IDEMPOTENCY_AMBIGUOUS',status:409})
 assert.equal(calls.length,count+1);assert.deepEqual(await state(db),invalidated)
 assert.doesNotMatch(JSON.stringify(logs),/history@example|SELECT|Authorization|stack|Historical address/)
})

test('actual V1 service: Baraan new order, canonical/uppercase retry, lost response and V2 fence all use authoritative RPC',async t=>{
 const f=await fixture(t),{db}=f,{service,client,calls}=actualV1Service(db,{denyReads:true})
 const request=serviceInput(await requestV2(db,[normalLine(f.normal.variant)])),created=await service.create(request)
 assert.equal(created.subtotal,2900);assert.equal(created.shippingFee,250);assert.equal(created.total,3150)
 assert.equal(created.paymentStatus,'Unpaid');assert.equal(created.idempotent,false);assert.equal(created.idempotencyKey,request.idempotencyKey)
 assert.deepEqual(Object.keys(created).sort(),['id','idempotencyKey','orderNumber','status','paymentStatus','paymentMethod','subtotal','discount','shippingFee','total','currency','idempotent'].sort())
 assert.equal(calls.length,1);assert.equal(calls[0].args.p_shipping_method_id,null);assert.equal(calls[0].args.p_customer_id,null)
 const before=await state(db)
 for(const key of [request.idempotencyKey,request.idempotencyKey.toUpperCase()]){
  const count=calls.length,replay=await service.create({...request,idempotencyKey:key})
  assert.equal(replay.id,created.id);assert.equal(replay.idempotent,true);assert.equal(calls.length,count+1);assert.deepEqual(await state(db),before)
 }
 await assert.rejects(()=>service.create({...request,shipping:{...request.shipping,notes:'Changed'}}),{code:'IDEMPOTENCY_CONFLICT'})
 assert.deepEqual(await state(db),before)
 const lostRequest={...request,idempotencyKey:randomUUID()},rpc=client.rpc.bind(client);let lost=true
 client.rpc=async(...args)=>{const result=await rpc(...args);if(lost&&!result.error){lost=false;throw new Error('Disposable lost response after commit')}return result}
 await assert.rejects(()=>service.create(lostRequest),{code:'CHECKOUT_UNAVAILABLE'})
 const committed=(await db.query('select id from public.orders where idempotency_key=$1',['checkout:'+lostRequest.idempotencyKey])).rows[0].id,afterLost=await state(db)
 const replay=await service.create(lostRequest);assert.equal(replay.id,committed);assert.equal(replay.idempotent,true);assert.deepEqual(await state(db),afterLost)
 const v2Request=await requestV2(db,[normalLine(f.normal.variant)]);await orderV2(db,v2Request)
 await db.query('update public.product_variants set stock_quantity=0,available=false where id=$1',[f.normal.variant])
 await db.exec('update public.site_settings set payments=\'[{"name":"Cash on Delivery","active":false}]\'')
 const invalidated=await state(db),count=calls.length
 await assert.rejects(()=>service.create(serviceInput({...v2Request,idempotencyKey:v2Request.idempotencyKey.toUpperCase()})),{code:'IDEMPOTENCY_CONFLICT',status:409})
 assert.equal(calls.length,count+1);assert.deepEqual(await state(db),invalidated)
 assert.equal((await service.create(request)).id,created.id);assert.deepEqual(await state(db),invalidated)
})

test('actual V1 service: new-order payment/configuration/stock/coupon/shipping failures roll back all effects',async t=>{
 const f=await fixture(t),{db}=f,{service,calls}=actualV1Service(db)
 const request=serviceInput(await requestV2(db,[normalLine(f.normal.variant)]))
 const rejected=async(code,body=request)=>{
  const before=await state(db),count=calls.length
  await assert.rejects(()=>service.create({...body,idempotencyKey:randomUUID()},null,'new-order-service-id'),{code})
  assert.equal(calls.length,count+1);assert.deepEqual(await state(db),before)
 }
 await rejected('VARIANT_NOT_FOUND',{...request,items:[{variantId:randomUUID(),quantity:1}]})
 await db.query('update public.product_variants set stock_quantity=0 where id=$1',[f.normal.variant]);await rejected('OUT_OF_STOCK')
 await db.query('update public.product_variants set stock_quantity=12,available=true where id=$1',[f.normal.variant])
 await db.query("update public.products set status='Draft' where id=$1",[f.normal.product]);await rejected('VARIANT_UNAVAILABLE')
 await db.query("update public.products set status='Published' where id=$1",[f.normal.product])
 await db.exec('update public.site_settings set payments=\'[{"name":"Cash on Delivery","active":false},{"name":"Bank Transfer","active":true}]\'');await rejected('INVALID_PAYMENT_METHOD')
 await db.exec('update public.site_settings set payments=\'[{"name":"Cash on Delivery","active":false}]\'');await rejected('CHECKOUT_UNAVAILABLE')
 await db.exec('update public.site_settings set payments=\'[{"name":"Cash on Delivery","active":true},{"name":"Bank Transfer","active":true}]\'')
 // PostgreSQL's positive numeric CHECK rejects zero but permits NaN; the SQL guard must reject it.
 await db.query("update public.product_variants set regular_price='NaN'::numeric where id=$1",[f.normal.variant]);await rejected('CHECKOUT_UNAVAILABLE')
 await db.query('update public.product_variants set regular_price=2900 where id=$1',[f.normal.variant])
 await rejected('INVALID_COUPON',{...request,couponCode:'MISSING'})
 await db.exec('update public.shipping_methods set active=false');await rejected('CHECKOUT_UNAVAILABLE')
 await db.exec('update public.shipping_methods set active=true')
 const method=(await db.query('select id from public.shipping_methods limit 1')).rows[0].id
 await db.query("insert into public.shipping_rates(shipping_method_id,scope_type,scope_value,fee) values($1,'default','',250),($1,'default','another',250)",[method]);await rejected('CHECKOUT_UNAVAILABLE')
 await db.exec('delete from public.shipping_rates')
 const bank=await service.create({...request,idempotencyKey:randomUUID(),paymentMethod:'Bank Transfer'},f.admin)
 assert.equal(bank.paymentStatus,'Pending');assert.equal(bank.total,3150)
 const tester=await service.create({...request,idempotencyKey:randomUUID(),items:[{variantId:f.tester.tester.variant_id,quantity:1}]})
 assert.equal(tester.subtotal,250);assert.equal((await db.query('select manual_available from public.tester_variants where variant_id=$1',[f.tester.tester.variant_id])).rows[0].manual_available,true)
})

test('actual V1 SQL payment fallback preserves private false, public precedence and commerce fallback',async t=>{
 const f=await fixture(t),{db}=f,{service}=actualV1Service(db),input=serviceInput(await requestV2(db,[normalLine(f.normal.variant)]))
 await db.exec('update public.site_settings set payments=\'[{"name":"Cash on Delivery","active":false},{"name":"Bank Transfer","active":true}]\'')
 await db.exec('insert into public.public_site_settings(key,value) values(\'payments\',\'[{"name":"Cash on Delivery","active":true}]\') on conflict(key) do update set value=excluded.value')
 await assert.rejects(()=>service.create(input),{code:'INVALID_PAYMENT_METHOD'})
 await db.exec('update public.site_settings set payments=\'[]\'')
 const publicReceipt=await service.create(input);assert.equal(publicReceipt.total,3150)
 await db.exec('update public.public_site_settings set value=\'[]\' where key=\'payments\';insert into public.public_site_settings(key,value) values(\'commerce\',\'{"codEnabled":true,"bankTransferEnabled":false}\') on conflict(key) do update set value=excluded.value')
 const fallback=await service.create({...input,idempotencyKey:randomUUID()});assert.equal(fallback.total,3150)
 await db.exec('update public.public_site_settings set value=\'{"codEnabled":false,"bankTransferEnabled":true}\' where key=\'commerce\'')
 await assert.rejects(()=>service.create({...input,idempotencyKey:randomUUID()}),{code:'INVALID_PAYMENT_METHOD'})
 assert.equal((await service.create(input)).id,publicReceipt.id)
})

test('actual V1 service receipt after tracking correction remains public-only and preserves customer notes',async t=>{
 const f=await fixture(t),{db}=f,{service}=actualV1Service(db,{denyReads:true})
 const request=serviceInput(await requestV2(db,[normalLine(f.normal.variant)]));request.shipping.notes='Customer note'
 const order=await service.create(request),reason='Private corrected transposed tracking entry'
 const mutate=async(action,payload)=>{
  const revision=(await db.query('select revision::text revision from public.orders where id=$1',[order.id])).rows[0].revision
  return (await db.query('select public.apply_admin_order_action($1::uuid,$2::uuid,$3,$4::uuid,$5,$6::jsonb,$7) result',
   [order.id,f.admin,action,randomUUID(),revision,JSON.stringify(payload),'public-receipt-privacy'])).rows[0].result
 }
 await mutate('status',{status:'Confirmed'});await mutate('status',{status:'Processing'})
 await mutate('status',{status:'Shipped',courier:'Old courier',trackingNumber:'OLD-TRACK'})
 await mutate('fulfillment',{courier:'New courier',trackingNumber:'NEW-TRACK',reason})
 const before=await state(db),receipt=await service.create(request)
 assert.equal(receipt.status,'Shipped');assert.equal(receipt.id,order.id);assert.equal(receipt.idempotent,true)
 assert.doesNotMatch(JSON.stringify(receipt),/Private corrected|audit|metadata|trackingCorrection|payload/)
 assert.equal((await db.query('select order_notes from public.orders where id=$1',[order.id])).rows[0].order_notes,'Customer note')
 assert.equal((await db.query("select count(*)::int n from public.admin_audit_logs where resource_id=$1 and metadata->'trackingCorrection'->>'reason'=$2",[order.id,reason])).rows[0].n,1)
 assert.deepEqual(await state(db),before)
})
