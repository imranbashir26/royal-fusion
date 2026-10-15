import assert from 'node:assert/strict'
import test from 'node:test'
import {randomUUID} from 'node:crypto'
import {salesFixture,apply009,source009,updateStandard,updateTester,updatePack,v1Request,quoteV1,placeV1,additional,waitBlocked,waitClock,deadline,counts,committed,variantInput} from './support/scheduledSalesDatabase.js'
import {normalLine,fixedLine,configuredLine,quoteRequest,quoteV2,requestV2,orderV2} from './support/checkoutV2Database.js'
import {state014,mutate014} from './support/fulfillmentV2Database.js'
import {saveTester} from './support/testerCatalogDatabase.js'
import {shapeSQL} from './support/catalogManifest.js'

// Native PG17 is mandatory. The runner stops the entire selection on its first failure.
test('Release 009 scheduled fixed prices: native PG17 acceptance',{timeout:240000},async t=>{
 async function scenario(name,fn){
  let passed=false
  await t.test(name,{timeout:45000},async s=>{await fn(s);passed=true})
  if(!passed)throw Error('Critical scheduled-price verification failure: '+name)
 }
 await scenario('Exact post-008 upgrade preserves committed replay, pack hashes, data and RLS',async s=>{
  const f=await salesFixture(s,{install:false}),{db}=f,r=v1Request(f.normal.variant),q=await quoteV1(db,r),order=await placeV1(db,q,r)
  const v2input=await requestV2(db,[fixedLine(f)]),v2order=await orderV2(db,v2input)
  const before=await state014(db),hash=(await db.query('select definition_fingerprint from tester_packs where product_id=$1',[f.fixed.product.id])).rows[0].definition_fingerprint
  await apply009(db)
  const after=await state014(db)
  for(const row of after.variants){delete row.sale_starts_at;delete row.sale_ends_at}
  assert.deepEqual(after,before)
  assert.equal((await db.query('select tester_pack_definition_hash($1) hash',[f.fixed.product.id])).rows[0].hash,hash)
  assert.deepEqual(await placeV1(db,q,r),{...order,idempotent:true})
  assert.deepEqual(await orderV2(db,v2input),{...v2order,idempotent:true})
  await committed(db,order.id,q)
 })
 const start='2030-01-01T10:00:00.000000Z',end='2030-01-01T11:00:00.000000Z'
 for(const [name,sale,lo,hi,at,price] of [
  ['no sale',null,null,null,start,2900],['immediate indefinite',2450,null,null,start,2450],
  ['start minus one microsecond',2450,start,end,'2030-01-01T09:59:59.999999Z',2900],
  ['inclusive start',2450,start,end,start,2450],['exclusive end',2450,start,end,end,2900],
  ['end plus one microsecond',2450,start,end,'2030-01-01T11:00:00.000001Z',2900],
  ['no lower bound',2450,null,end,start,2450],['no upper bound',2450,start,null,end,2450],
  ['expired',2450,start,end,'2031-01-01T00:00:00Z',2900]]){
  await scenario('Deterministic arithmetic: '+name,async s=>{
   const {db}=await salesFixture(s)
   assert.equal(Number((await db.query('select effective_sale_price_009(2900,$1,$2,$3,$4) price',[sale,lo,hi,at])).rows[0].price),price)
  })
 }
 await scenario('Invalid amounts, dates, precision and windows reject without changing regular prices',async s=>{
  const f=await salesFixture(s),{db}=f,before=await state014(db)
  for(const args of [[0,null,null],[-1,null,null],[2900,null,null],[3000,null,null],['NaN',null,null],['Infinity',null,null],[2450.001,null,null],[null,start,end],[2450,end,start],[2450,start,start],[2450,'infinity',null]]){
   await assert.rejects(()=>db.query('select effective_sale_price_009(2900,$1,$2,$3,$4)',[...args,start]),e=>e.code==='22023')
  }
  for(const changes of [{salePrice:2450,saleStartsAt:end,saleEndsAt:start},{salePrice:2450,saleStartsAt:'2030-01-01T00:00:00'},{salePrice:null,saleEndsAt:end},{salePrice:2900},{salePrice:-1}])await assert.rejects(()=>updateStandard(f,changes))
  assert.deepEqual(await state014(db),before)
 })
 await scenario('Catalog writer atomically sets, retains, changes and clears schedules; manual availability and IDs survive',async s=>{
  const f=await salesFixture(s),{db}=f
  const a=await updateStandard(f,{salePrice:2450,saleStartsAt:start,saleEndsAt:end,available:false})
  const original=a.variants[0]
  assert.equal(original.id,f.normal.variant);assert.equal(original.standard_manual_available,false);assert.equal(original.available,false)
  const b=await updateStandard(f,{salePrice:2400})
  assert.equal(b.variants[0].sale_starts_at,original.sale_starts_at);assert.equal(b.variants[0].sale_ends_at,original.sale_ends_at)
  const c=await updateStandard(f,{saleStartsAt:null,saleEndsAt:null})
  assert.equal(c.variants[0].sale_starts_at,null);assert.equal(c.variants[0].sale_price,2400)
  await updateStandard(f,{saleStartsAt:start,saleEndsAt:end})
  const cleared=await updateStandard(f,{salePrice:0})
  assert.deepEqual([cleared.variants[0].sale_price,cleared.variants[0].sale_starts_at,cleared.variants[0].sale_ends_at],[null,null,null])
  assert.equal(cleared.variants[0].regular_price,2900);assert.equal(cleared.variants[0].standard_manual_available,false)
  await updateStandard(f,{salePrice:2450,saleStartsAt:start,saleEndsAt:end})
  await db.query("select save_catalog_product($1,'{\"sale_price\":null}'::jsonb,null,null)",[f.normal.product])
  assert.deepEqual((await db.query('select sale_price,sale_starts_at,sale_ends_at from product_variants where id=$1',[f.normal.variant])).rows[0],{sale_price:null,sale_starts_at:null,sale_ends_at:null})
 })
 await scenario('Concurrent administrator saves retain optimistic revision fencing',async s=>{
  const f=await salesFixture(s),{db}=f,a=await additional(s,db),b=await additional(s,db)
  const rev=(await db.query('select catalog_revision::text r from products where id=$1',[f.normal.product])).rows[0].r
  await a.query('begin')
  let pending
  try{
   await updateStandard({...f,db:a},{salePrice:2450,saleStartsAt:start,saleEndsAt:end},rev)
   pending=updateStandard({...f,db:b},{salePrice:2300},rev).then(value=>({value}),error=>({error}))
   await waitBlocked(db,b,a);await a.query('commit')
   assert.match((await pending).error.message,/CATALOG_STALE/)
   assert.equal(Number((await db.query('select sale_price from product_variants where id=$1',[f.normal.variant])).rows[0].sale_price),2450)
  }finally{await a.query('rollback');if(pending)await pending}
 })
 await scenario('Tester writer preserves schedules/manual intent and does not inherit source perfume prices',async s=>{
  const f=await salesFixture(s),{db}=f,id=f.tester.tester.variant_id
  const revision=(await db.query('select catalog_revision::text r from products where id=$1',[f.tester.product.id])).rows[0].r
  f.tester=await saveTester(db,f.admin,f.tester.product.id,{},await variantInput(db,id),f.normal.product,revision)
  assert.equal(f.tester.tester.source_product_id,f.normal.product)
  await updateStandard(f,{salePrice:2450})
  assert.equal((await quoteV1(db,v1Request(id))).subtotal,250)
  const a=await updateTester(f,f.tester,{salePrice:200,saleStartsAt:start,saleEndsAt:end})
  const b=await updateTester(f,f.tester,{salePrice:190})
  assert.equal(b.variants[0].sale_starts_at,a.variants[0].sale_starts_at)
  assert.equal(b.tester.manual_available,true)
  const c=await updateTester(f,f.tester,{salePrice:0})
  assert.deepEqual([c.variants[0].sale_price,c.variants[0].sale_starts_at,c.variants[0].sale_ends_at],[null,null,null])
  assert.equal(c.variants[0].id,id);assert.equal(c.variants[0].regular_price,250)
 })
 await scenario('Pack writer preserves legacy hash, hashes schedule instants without timezone dependence, and clears atomically',async s=>{
  const f=await salesFixture(s),{db}=f
  const a=await updatePack(f,f.fixed,{fixedSalePrice:400,fixedSaleStartsAt:start,fixedSaleEndsAt:end})
  assert.notEqual(a.definition.definition_fingerprint,f.fixed.definition.definition_fingerprint)
  assert.equal(Number(a.definition.definition_revision),Number(f.fixed.definition.definition_revision)+1)
  await db.query("set timezone='Asia/Karachi'")
  const hash=(await db.query('select tester_pack_definition_hash($1) h',[f.fixed.product.id])).rows[0].h
  await db.query("set timezone='UTC'")
  assert.equal((await db.query('select tester_pack_definition_hash($1) h',[f.fixed.product.id])).rows[0].h,hash)
  const b=await updatePack(f,f.fixed,{fixedSalePrice:390})
  assert.equal(new Date(b.definition.fixed_sale_starts_at).getTime(),Date.parse(start))
  const c=await updatePack(f,f.fixed,{fixedSalePrice:null})
  assert.deepEqual([c.definition.fixed_sale_price,c.definition.fixed_sale_starts_at,c.definition.fixed_sale_ends_at],[null,null,null])
  assert.equal(c.definition.fixed_regular_price,450)
  await assert.rejects(()=>updatePack(f,f.configurable,{fixedSaleStartsAt:start}))
 })
 for(const version of [1,2])for(const boundary of ['activation','expiration'])await scenario('V'+version+' rejects a quote across '+boundary+' without order, payment or inventory effects',async s=>{
  const f=await salesFixture(s),{db}=f,at=await deadline(db)
  await updateStandard(f,{salePrice:2450,...(boundary==='activation'?{saleStartsAt:at}:{saleEndsAt:at})})
  const r=v1Request(f.normal.variant),q=version===1?await quoteV1(db,r):await requestV2(db,[normalLine(f.normal.variant)])
  const before=await state014(db),c=await counts(db)
  await waitClock(db,at)
  if(version===1){
   const result=await placeV1(db,q,r)
   assert.deepEqual(result,{outcome:'retired',code:'QUOTE_CHANGED',idempotencyKey:q.idempotencyKey})
   assert.equal((await db.query('select state from checkout_v1_attempts where token=$1',['checkout:'+q.idempotencyKey])).rows[0].state,'retired')
  }else await assert.rejects(()=>orderV2(db,q),/V2_QUOTE_CHANGED/)
  assert.deepEqual(await counts(db),c);assert.deepEqual(await state014(db),before)
 })
 for(const version of [1,2])await scenario('V'+version+' unchanged sale, coupon accounting and immutable committed replay',async s=>{
  const f=await salesFixture(s),{db}=f
  await updateStandard(f,{salePrice:2450})
  const coupon=(await db.query("insert into coupons(code,type,discount_value,status,usage_limit) values('SCHEDULED','Percentage',10,'Active',2) returning id")).rows[0].id
  const r=v1Request(f.normal.variant,'SCHEDULED'),q=version===1?await quoteV1(db,r):await quoteV2(db,{...quoteRequest([normalLine(f.normal.variant)]),couponCode:r.couponCode})
  assert.deepEqual([q.subtotal,q.discount,q.shippingFee,q.total],[2450,245,250,2455])
  assert.equal('_prices' in q,false)
  const body=version===1?q:await requestV2(db,[normalLine(f.normal.variant)],{quote:{couponCode:r.couponCode},order:{couponCode:r.couponCode}})
  const order=version===1?await placeV1(db,body,r):await orderV2(db,body)
  await committed(db,order.id,q,{coupon})
  assert.equal((await db.query('select stock_quantity from product_variants where id=$1',[f.normal.variant])).rows[0].stock_quantity,11)
  await updateStandard(f,{salePrice:2400,saleEndsAt:'2001-01-01T00:00:00Z'})
  const before=await state014(db)
  assert.deepEqual(version===1?await placeV1(db,body,r):await orderV2(db,body),{...order,idempotent:true})
  assert.deepEqual(await state014(db),before)
 })
 await scenario('Retirement survives amount reversion and delayed duplicate submissions',async s=>{
  const f=await salesFixture(s),{db}=f,r=v1Request(f.normal.variant),q=await quoteV1(db,r)
  await updateStandard(f,{salePrice:2450})
  assert.equal((await placeV1(db,q,r)).outcome,'retired')
  await updateStandard(f,{salePrice:null})
  const before=await state014(db)
  assert.equal((await placeV1(db,q,r)).outcome,'retired');assert.deepEqual(await state014(db),before)
  const fresh=await quoteV1(db,r),receipt=await placeV1(db,fresh,r);await committed(db,receipt.id,fresh)
 })
 for(const version of [1,2])await scenario('V'+version+' lock wait crossing expiry uses post-lock instant',async s=>{
  const f=await salesFixture(s),{db}=f,a=await additional(s,db),b=await additional(s,db),at=await deadline(db)
  await updateStandard(f,{salePrice:2450,saleEndsAt:at})
  const r=v1Request(f.normal.variant),q=version===1?await quoteV1(db,r):await requestV2(db,[normalLine(f.normal.variant)])
  const before=await state014(db)
  await a.query('begin');await a.query('select id from product_variants where id=$1 for update',[f.normal.variant])
  let pending
  try{
   pending=(version===1?placeV1(b,q,r):orderV2(b,q)).then(value=>({value}),error=>({error}))
   await waitBlocked(db,b,a);await waitClock(db,at);await a.query('commit')
   const result=await pending
   if(version===1)assert.equal(result.value.outcome,'retired');else assert.match(result.error.message,/V2_QUOTE_CHANGED/)
   assert.deepEqual(await state014(db),before)
  }finally{await a.query('rollback');if(pending)await pending}
 })
 for(const version of [1,2])await scenario('V'+version+' frozen pre-boundary resolution can commit after expiry without mixed item prices',async s=>{
  const f=await salesFixture(s),{db}=f,a=await additional(s,db),b=await additional(s,db),at=await deadline(db)
  await updateStandard(f,{salePrice:2450,saleEndsAt:at})
  await updateTester(f,f.tester,{salePrice:200,saleEndsAt:at})
  const r={...v1Request(f.normal.variant),items:[{variantId:f.normal.variant,quantity:1},{variantId:f.tester.tester.variant_id,quantity:1}]}
  const q=version===1?await quoteV1(db,r):await quoteV2(db,quoteRequest(r.items.map(x=>normalLine(x.variantId))))
  const body=version===1?q:await requestV2(db,r.items.map(x=>normalLine(x.variantId)))
  const gate=29009
  await db.query(`create function public.rf009_gate() returns trigger language plpgsql as $$begin perform pg_advisory_xact_lock(29009);return new;end$$;
   create trigger rf009_gate before insert on payments for each row execute function public.rf009_gate()`)
  await a.query('select pg_advisory_lock($1)',[gate])
  let pending
  try{
   pending=(version===1?placeV1(b,body,r):orderV2(b,body)).then(value=>({value}),error=>({error}))
   await waitBlocked(db,b,a);await waitClock(db,at);await a.query('select pg_advisory_unlock($1)',[gate])
   const result=await pending;if(result.error)throw result.error
   await committed(db,result.value.id,q,{quantities:2})
   assert.deepEqual((await db.query('select unit_price::int price from order_items where order_id=$1 order by unit_price',[result.value.id])).rows.map(x=>x.price),[200,2450])
  }finally{await a.query('select pg_advisory_unlock($1)',[gate]);if(pending)await pending;await db.query('drop trigger rf009_gate on payments;drop function public.rf009_gate()')}
 })
 await scenario('Same-token concurrency produces one committed order, payment and deduction',async s=>{
  const f=await salesFixture(s),{db}=f,a=await additional(s,db),b=await additional(s,db),r=v1Request(f.normal.variant)
  await updateStandard(f,{salePrice:2450})
  const q=await quoteV1(db,r);await a.query('begin');let pending
  try{
   const first=await placeV1(a,q,r)
   pending=placeV1(b,q,r).then(value=>({value}),error=>({error}))
   await waitBlocked(db,b,a);await a.query('commit')
   const result=await pending;if(result.error)throw result.error
   assert.deepEqual(result.value,{...first,idempotent:true});await committed(db,first.id,q)
   assert.deepEqual(await counts(db),{orders:1,payments:1,movements:1,redemptions:0})
  }finally{await a.query('rollback');if(pending)await pending}
 })
 await scenario('Late payment failure rolls back all sale-related financial and inventory effects',async s=>{
  const f=await salesFixture(s),{db}=f,r=v1Request(f.normal.variant)
  await updateStandard(f,{salePrice:2450});const q=await quoteV1(db,r)
  await db.query("create function public.rf009_failure() returns trigger language plpgsql as $$begin raise exception 'RF009_LATE_FAILURE';end$$;create trigger rf009_failure before insert on payments for each row execute function public.rf009_failure()")
  const before=await state014(db)
  try{await assert.rejects(()=>placeV1(db,q,r),/RF009_LATE_FAILURE/);assert.deepEqual(await state014(db),before)
   assert.equal((await db.query('select state from checkout_v1_attempts where token=$1',['checkout:'+q.idempotencyKey])).rows[0].state,'active')
  }finally{await db.query('drop trigger rf009_failure on payments;drop function public.rf009_failure()')}
 })
 for(const kind of ['tester','fixed','configurable'])await scenario(kind+' activation and expiry retain the correct pricing owner',async s=>{
  const f=await salesFixture(s),{db}=f
  const line=()=>kind==='tester'?normalLine(f.tester.tester.variant_id):kind==='fixed'?fixedLine(f):configuredLine(f)
  const at=await deadline(db)
  if(kind==='fixed'){
   f.fixed=await updatePack(f,f.fixed,{fixedSalePrice:400,fixedSaleStartsAt:at})
   await updateTester(f,f.tester,{salePrice:200})
  }else await updateTester(f,f.tester,{salePrice:200,saleStartsAt:at})
  let q=await quoteV2(db,quoteRequest([line()]))
  assert.equal(q.subtotal,kind==='tester'?250:kind==='fixed'?450:500)
  await waitClock(db,at);q=await quoteV2(db,quoteRequest([line()]))
  assert.equal(q.subtotal,kind==='tester'?200:400)
  if(kind==='fixed')assert.equal(q.lines[0].components[0].referenceUnitPrice,200)
  const body=await requestV2(db,[line()]),receipt=await orderV2(db,body)
  await committed(db,receipt.id,q,{quantities:kind==='tester'?1:2})
  const expired='2001-01-01T00:00:00Z'
  if(kind==='fixed')f.fixed=await updatePack(f,f.fixed,{fixedSaleStartsAt:null,fixedSaleEndsAt:expired})
  else await updateTester(f,f.tester,{saleStartsAt:null,saleEndsAt:expired})
  q=await quoteV2(db,quoteRequest([line()]))
  assert.equal(q.subtotal,kind==='tester'?250:kind==='fixed'?450:500)
 })
 await scenario('One configurable component changes charge; fixed pack charge stays independent',async s=>{
  const f=await salesFixture(s),{db}=f,selections=[f.tester,f.second].map(x=>({variantId:x.tester.variant_id,quantityPerPack:1}))
  const configurable=configuredLine(f,selections),before=await quoteV2(db,quoteRequest([configurable])),fixed=await quoteV2(db,quoteRequest([fixedLine(f)]))
  await updateTester(f,f.second,{salePrice:275})
  const changed=await quoteV2(db,quoteRequest([configurable]))
  assert.equal(before.subtotal,550);assert.equal(changed.subtotal,525);assert.notEqual(before.quoteFingerprint,changed.quoteFingerprint)
  assert.equal((await quoteV2(db,quoteRequest([fixedLine(f)]))).subtotal,fixed.subtotal)
 })
 await scenario('Admin price change racing checked placement rejects the stale amount atomically',async s=>{
  const f=await salesFixture(s),{db}=f,a=await additional(s,db),b=await additional(s,db),r=v1Request(f.normal.variant),q=await quoteV1(db,r)
  await a.query('begin');let pending
  try{
   await updateStandard({...f,db:a},{salePrice:2450})
   pending=placeV1(b,q,r).then(value=>({value}),error=>({error}))
   await waitBlocked(db,b,a);await a.query('commit')
   const result=await pending;if(result.error)throw result.error
   assert.equal(result.value.outcome,'retired')
   assert.deepEqual(await counts(db),{orders:0,payments:0,movements:0,redemptions:0})
   assert.equal((await db.query('select stock_quantity from product_variants where id=$1',[f.normal.variant])).rows[0].stock_quantity,12)
  }finally{await a.query('rollback');if(pending)await pending}
 })
 await scenario('Post-expiry V2 cancellation restores inventory once and preserves frozen pack prices',async s=>{
  const f=await salesFixture(s),{db}=f
  await updateTester(f,f.tester,{salePrice:200})
  const q=await quoteV2(db,quoteRequest([configuredLine(f)])),body=await requestV2(db,[configuredLine(f)]),receipt=await orderV2(db,body)
  await committed(db,receipt.id,q,{quantities:2})
  const frozen=(await db.query('select quote_snapshot from orders where id=$1',[receipt.id])).rows[0].quote_snapshot
  await updateTester(f,f.tester,{saleEndsAt:'2001-01-01T00:00:00Z'})
  assert.equal((await db.query('select stock_quantity from product_variants where id=$1',[f.tester.tester.variant_id])).rows[0].stock_quantity,10)
  await mutate014(f,receipt.id,'cancel',{reason:'Disposable scheduled-sale cancellation'})
  assert.equal((await db.query('select stock_quantity from product_variants where id=$1',[f.tester.tester.variant_id])).rows[0].stock_quantity,12)
  assert.deepEqual((await db.query('select quote_snapshot from orders where id=$1',[receipt.id])).rows[0].quote_snapshot,frozen)
  assert.equal((await db.query("select count(*)::int n from inventory_movements where reference_id=$1 and reason='Order cancelled'",[receipt.id])).rows[0].n,1)
  const stable=await state014(db)
  const duplicate=await mutate014(f,receipt.id,'cancel',{reason:'Duplicate must not restore again'})
  assert.equal(duplicate.changed,false)
  const acknowledged=await state014(db)
  assert.equal(acknowledged.audits.length,stable.audits.length+1)
  delete acknowledged.audits;delete stable.audits
  assert.deepEqual(acknowledged,stable)
 })
 await scenario('Security-invoker view honors existing visibility and denies writes; service batch is bounded',async s=>{
  const f=await salesFixture(s),{db}=f
  await updateStandard(f,{salePrice:2450,saleStartsAt:start,saleEndsAt:end})
  for(const role of ['anon','authenticated']){
   await db.query('set role '+role)
   try{
    const base=(await db.query('select id from product_variants order by id')).rows
    assert.deepEqual((await db.query('select id from storefront_variant_prices order by id')).rows,base)
    await assert.rejects(()=>db.query('update storefront_variant_prices set sale_price=1'),e=>e.code==='42501')
    for(const sql of ["select sale_timestamp_009('null')","select catalog_sale_prices_009()","select checkout_v2_resolve('[]',false)","select * from checkout_v1_attempts"])
     await assert.rejects(()=>db.query(sql),e=>e.code==='42501')
    await assert.rejects(()=>db.query('update product_variants set sale_starts_at=now()'),e=>e.code==='42501')
   }finally{await db.query('reset role')}
  }
  await db.query('set role service_role')
  try{
   await assert.rejects(()=>db.query("select sale_timestamp_009('null')"),e=>e.code==='42501')
   const batch=(await db.query('select catalog_sale_prices_009($1::uuid[],$2::uuid[]) result',[[f.normal.variant,f.tester.tester.variant_id],[f.fixed.product.id,f.configurable.product.id]])).rows[0].result
   assert.equal(batch.variants.length,2);assert.equal(batch.packs.length,2);assert.equal(batch.variants.find(v=>v.variantId===f.normal.variant).effectivePrice,2900)
   assert.equal(Date.parse(batch.variants.find(v=>v.variantId===f.normal.variant).validUntil),Date.parse(start))
   for(const ids of [[f.normal.variant,f.normal.variant],[null],Array.from({length:101},()=>randomUUID())])await assert.rejects(()=>db.query('select catalog_sale_prices_009($1::uuid[],null)',[ids]),/SALE_CATALOG_IDS_INVALID/)
  }finally{await db.query('reset role')}
  await db.query("select set_config('request.jwt.claim.role','authenticated',false)")
  try{await assert.rejects(()=>db.query('select catalog_sale_prices_009()'),/SALE_CATALOG_PERMISSION_DENIED/)}finally{await db.query("select set_config('request.jwt.claim.role','service_role',false)")}
 })
 await scenario('Predecessor drift and reinstallation reject atomically; late ACL failure rolls back all changes',async s=>{
  const f=await salesFixture(s,{install:false}),{db}=f,source=await source009(),before=(await db.query(shapeSQL)).rows[0].shape,data=await state014(db)
  const wrong=source.replace('00bf3eb3276b0ddf57d260397f117c30c175d29c86d8cc9c9c9c33476a8663b3','0'.repeat(64))
  await assert.rejects(()=>apply009(db,wrong),/RF_RELEASE009_BASELINE_DRIFT/)
  assert.equal((await db.query(shapeSQL)).rows[0].shape,before);assert.deepEqual(await state014(db),data)
  const marker='-- @RELEASE009-POST-GUARD-BEGIN'
  assert.equal(source.split(marker).length,2)
  const unsafe=source.replace(marker,'grant execute on function public.sale_timestamp_009(jsonb) to service_role;\n'+marker)
  await assert.rejects(()=>apply009(db,unsafe),/RF_RELEASE009_PRIVATE_RPC/)
  assert.equal((await db.query(shapeSQL)).rows[0].shape,before);assert.deepEqual(await state014(db),data)
  assert.equal((await db.query("select to_regprocedure('public.effective_sale_price_009(numeric,numeric,timestamptz,timestamptz,timestamptz)') f")).rows[0].f,null)
  await apply009(db)
  const installed=(await db.query(shapeSQL)).rows[0].shape
  await assert.rejects(()=>apply009(db),/RF_RELEASE009_BASELINE_DRIFT/)
  assert.equal((await db.query(shapeSQL)).rows[0].shape,installed)
 })
})
