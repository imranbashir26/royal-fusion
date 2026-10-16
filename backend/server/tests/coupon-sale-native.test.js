import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {salesFixture,updateStandard,updateTester,updatePack,v1Request,quoteV1,placeV1,additional,waitBlocked,waitClock,deadline,counts,committed} from './support/scheduledSalesDatabase.js'
import {normalLine,fixedLine,configuredLine,quoteRequest,quoteV2,requestV2,orderV2} from './support/checkoutV2Database.js'
import {state014,mutate014} from './support/fulfillmentV2Database.js'
import {shapeSQL} from './support/catalogManifest.js'

const releaseURL=new URL('../../supabase/release-migrations/010_coupon_sale_comparison.sql',import.meta.url)
async function apply(db,source){try{await db.query(source??await readFile(releaseURL,'utf8'))}catch(e){await db.query('rollback');throw e}}
const code=()=> ('GLOBAL_'+randomUUID().replaceAll('-','').slice(0,16)).toUpperCase()
async function coupon(db,patch={}) {
 const row={code:code(),percentage:20,minimum:0,cap:null,limit:0,customerLimit:0,status:'Active',...patch}
 return (await db.query(`insert into public.coupons(code,type,discount_value,minimum_order_amount,max_discount_amount,usage_limit,per_customer_usage_limit,status)
 values($1,'Percentage',$2,$3,$4,$5,$6,$7) returning *`,[row.code,row.percentage,row.minimum,row.cap,row.limit,row.customerLimit,row.status])).rows[0]
}
async function evidence(db,id){return (await db.query(`select o.*,coalesce(o.pricing_outcome,o.quote_snapshot->'pricingOutcome') evidence,
 (select jsonb_agg(jsonb_build_object('unitPrice',i.unit_price,'quantity',i.quantity,'total',i.line_total) order by i.id) from order_items i where order_id=o.id) frozen,
 (select count(*)::int from coupon_redemptions where order_id=o.id) redemptions,
 (select amount::text from payments where order_id=o.id) payment from orders o where id=$1`,[id])).rows[0]}
const cents=value=>{const [whole,fraction='']=String(value).split('.');assert(/^\d+$/.test(whole)&&/^\d{0,2}$/.test(fraction),'Exact nonnegative paisa');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'))}
async function frozenLines(db,id){return (await db.query(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'variantId',variant_id,'quantity',quantity,'unitPrice',unit_price,'lineTotal',line_total) order by variant_id nulls last,id),'[]'::jsonb) lines from order_items where order_id=$1`,[id])).rows[0].lines}
function publicLines(quote,request){
 assert.deepEqual(Object.keys(quote).sort(),['pricingOutcome','subtotal','discount','shippingFee','total','currency','shippingMethodId','paymentMethods','quoteFingerprint','idempotencyKey','lines'].sort())
 const quantities=new Map();for(const line of request.items){const id=line.variantId.toLowerCase();quantities.set(id,(quantities.get(id)??0)+line.quantity)}
 assert.deepEqual(quote.lines.map(l=>[l.variantId,l.quantity]),[...quantities].sort(([a],[b])=>a.localeCompare(b)))
 for(const line of quote.lines){assert.deepEqual(Object.keys(line).sort(),['variantId','quantity','unitPrice','lineTotal'].sort());assert.equal(cents(line.lineTotal),cents(line.unitPrice)*BigInt(line.quantity))}
 assert.equal(quote.lines.reduce((sum,l)=>sum+cents(l.lineTotal),0n),cents(quote.subtotal))
 const allowedOutcome=['policy','strategy','regularSubtotal','saleSubtotal','couponDiscount','couponSubtotal','merchandiseTotal','couponOutcome','requestedCouponCode','appliedCouponId','appliedCouponCode','acceptedQuoteFingerprint']
 if(quote.pricingOutcome)assert.deepEqual(Object.keys(quote.pricingOutcome).sort(),allowedOutcome.sort())
}
async function lineEquality(db,quote,request,receipt){
 publicLines(quote,request)
 const stored=await frozenLines(db,receipt.id);assert.deepEqual(receipt.lines,stored)
 for(const line of receipt.lines)assert.deepEqual(Object.keys(line).sort(),['id','variantId','quantity','unitPrice','lineTotal'].sort())
 assert.deepEqual(receipt.lines.map(({id,...line})=>line),quote.lines)
 assert.equal(stored.reduce((sum,l)=>sum+cents(l.lineTotal),0n),cents(receipt.subtotal))
 console.log('Release010 V1 frozen line equality '+JSON.stringify({id:receipt.id,quoteLines:quote.lines,frozenLines:stored,subtotal:receipt.subtotal,discount:receipt.discount,shippingFee:receipt.shippingFee,total:receipt.total}))
}
async function pair(f,version,couponCode='',quantity=1,lines){
 if(version===1){const request=v1Request(f.normal.variant,couponCode);if(lines)request.items=lines.map(l=>({variantId:l.variantId,quantity:l.quantity}));else request.items[0].quantity=quantity;const quote=await quoteV1(f.db,request);if(f.publicV1Lines)publicLines(quote,request);return {quote,place:async db=>{const receipt=await placeV1(db,quote,request);if(quote.lines&&receipt.id)await lineEquality(db,quote,request,receipt);return receipt},request}}
 const chosen=lines??[normalLine(f.normal.variant,quantity)],quote=await quoteV2(f.db,{...quoteRequest(chosen),couponCode})
 const request={contractVersion:2,idempotencyKey:randomUUID(),lines:chosen,contact:{name:'Fixture Customer',email:'fixture@example.invalid',phone:'00000000000'},shipping:{address:'Fixture address',city:'Karachi',province:'Sindh',notes:''},paymentMethod:'Cash on Delivery',couponCode,quoteFingerprint:quote.quoteFingerprint}
 return {quote,place:db=>orderV2(db,request),request}
}
async function financial(f,version,{sale=900,percentage=20,quantity=1,minimum=0,cap=null,winner='COUPON',outcome='applied',discount=200,merchandise=800}={}){
 await updateStandard(f,{regularPrice:1000,salePrice:sale,stockQuantity:200})
 const c=await coupon(f.db,{percentage,minimum,cap}),p=await pair(f,version,c.code,quantity),r=await p.place(f.db),stored=await evidence(f.db,r.id)
 const expected={regularSubtotal:1000*quantity,saleSubtotal:(sale??1000)*quantity,couponDiscount:discount,couponSubtotal:1000*quantity-discount,merchandiseTotal:merchandise}
 for(const [k,v] of Object.entries(expected))assert.equal(p.quote.pricingOutcome[k],v,k)
 assert.equal(stored.evidence.strategy,winner);assert.equal(stored.evidence.couponOutcome,outcome);assert.equal(stored.evidence.requestedCouponCode,c.code)
 assert.equal(stored.coupon_code,c.code);assert.equal(stored.coupon_id,winner==='COUPON'?c.id:null);assert.equal(stored.redemptions,winner==='COUPON'?1:0)
 assert.equal(Number(stored.subtotal),winner==='COUPON'?1000*quantity:(sale??1000)*quantity);assert.equal(Number(stored.discount),winner==='COUPON'?discount:0)
 assert.equal(Number(stored.payment),Number(stored.total));assert(stored.frozen.every(i=>i.unitPrice===(winner==='COUPON'?1000:(sale??1000))))
 assert.equal(stored.evidence.acceptedQuoteFingerprint,p.quote.quoteFingerprint)
 await committed(f.db,r.id,p.quote,{quantities:quantity,coupon:winner==='COUPON'?c.id:null})
 assert.equal((await f.db.query('select used_count from coupons where id=$1',[c.id])).rows[0].used_count,winner==='COUPON'?1:0)
 const before=await state014(f.db);assert.deepEqual(await p.place(f.db),{...r,idempotent:true});assert.deepEqual(await state014(f.db),before)
 console.log('Release010 committed outcome '+JSON.stringify({version,id:r.id,...stored.evidence,subtotal:stored.subtotal,discount:stored.discount,total:stored.total,payment:stored.payment,redemptions:stored.redemptions}))
 return {c,p,r,stored}
}

test('Release 010 authoritative global comparison and compatibility; stop at first critical failure',{timeout:540000},async t=>{
 let scenarios=0
 async function scenario(name,work){let passed=false;await t.test(name,{timeout:60000},async()=>{await work();passed=true;scenarios++});if(!passed)throw Error('Critical Release010 verification failure: '+name)}
 const f=await salesFixture(t),{db}=f,source=await readFile(releaseURL,'utf8')
 const legacy={}
 for(const [name,type,value] of [['percent','Percentage',10],['fixed','Fixed Amount',100],['shipping','Free Shipping',0],['cap','Percentage',50],['minimum','Percentage',10],['restricted','Percentage',10]]){
  legacy[name]=(await db.query('insert into coupons(code,type,discount_value,minimum_order_amount,max_discount_amount,status) values($1,$2,$3,$4,$5,$6) returning *',['LEGACY_'+name.toUpperCase(),type,value,name==='minimum'?2800:0,name==='cap'?30:null,'Active'])).rows[0]
 }
 await db.query('insert into coupon_products(coupon_id,product_id) values($1,$2)',[legacy.restricted.id,f.normal.product])
 const historical=[]
 for(const version of [1,2]){const p=await pair(f,version,legacy.percent.code);const r=await p.place(db);historical.push({p,r,lines:version===1?await frozenLines(db,r.id):null})}
 await scenario('Exact post-009 predecessor; real ACL drift rejects atomically',async()=>{
  const before=(await db.query(shapeSQL)).rows[0].shape,rows=await state014(db)
  await db.query('begin;grant execute on function public.sale_timestamp_009(jsonb) to service_role')
  await assert.rejects(()=>apply(db,source),/RF_RELEASE010_BASELINE_DRIFT/)
  assert.equal((await db.query(shapeSQL)).rows[0].shape,before);assert.deepEqual(await state014(db),rows)
 })
 await scenario('Induced late private ACL failure rolls back columns, functions and all rows',async()=>{
  const before=(await db.query(shapeSQL)).rows[0].shape,rows=await state014(db),marker='-- @RELEASE010-POST-GUARD-BEGIN'
  assert.equal(source.split(marker).length,2)
  await assert.rejects(()=>apply(db,source.replace(marker,'grant execute on function public.coupon_sale_choice_010(numeric,numeric,public.coupons) to service_role;\n'+marker)),/RF_RELEASE010_PRIVATE_RPC/)
  assert.equal((await db.query(shapeSQL)).rows[0].shape,before);assert.deepEqual(await state014(db),rows)
 })
 await scenario('One-shot installation preserves existing rows and explicitly grandfathers every existing coupon',async()=>{
  const before=await state014(db);await apply(db,source);f.publicV1Lines=true;const after=await state014(db)
  for(const c of after.coupons){assert.equal(c.pricing_policy,'LEGACY');delete c.pricing_policy}
  for(const o of after.orders){assert.equal(o.pricing_outcome,null);delete o.pricing_outcome}
  assert.deepEqual(after,before)
  for(const {p,r,lines}of historical){const replay=await p.place(db);assert.deepEqual(replay,{...r,...(lines?{lines}:{}),idempotent:true});if(lines)assert(!('pricingOutcome' in replay))}
 })
 await scenario('Reapplication rejects without mutation',async()=>{const shape=(await db.query(shapeSQL)).rows[0].shape,before=await state014(db);await assert.rejects(()=>apply(db,source),/RF_RELEASE010_BASELINE_DRIFT/);assert.equal((await db.query(shapeSQL)).rows[0].shape,shape);assert.deepEqual(await state014(db),before)})
 await scenario('Policy defaults, exact values, immutability, type and restriction invariants',async()=>{
  const c=await coupon(db);assert.equal(c.pricing_policy,'GLOBAL_PERCENTAGE_V1')
  for(const policy of ['LEGACY','global_percentage_v1','FORGED'])await assert.rejects(()=>db.query("insert into coupons(code,type,discount_value,pricing_policy) values($1,'Percentage',10,$2)",[code(),policy]),/COUPON_POLICY_INVALID/)
  await assert.rejects(()=>db.query("update coupons set pricing_policy='GLOBAL_PERCENTAGE_V1' where id=$1",[legacy.percent.id]),/COUPON_POLICY_IMMUTABLE/)
  await assert.rejects(()=>db.query("update coupons set pricing_policy='LEGACY' where id=$1",[c.id]),/COUPON_POLICY_IMMUTABLE/)
  for(const type of ['Fixed Amount','Free Shipping'])await assert.rejects(()=>db.query('insert into coupons(code,type,discount_value) values($1,$2,10)',[code(),type]),e=>e.code==='23514')
  await assert.rejects(()=>db.query('update coupons set applicable_product_ids=array[$2::uuid] where id=$1',[c.id,f.normal.product]),e=>e.code==='23514')
  await assert.rejects(()=>db.query('insert into coupon_products(coupon_id,product_id) values($1,$2)',[c.id,f.normal.product]),/COUPON_SCOPE_INVALID/)
  const category=(await db.query("insert into categories(name,slug) values('Policy fixture',$1) returning id",[code().toLowerCase()])).rows[0].id
  await assert.rejects(()=>db.query('insert into coupon_categories(coupon_id,category_id) values($1,$2)',[c.id,category]),/COUPON_SCOPE_INVALID/)
 })
 await scenario('Anonymous/authenticated direct writes and all untrusted private helper execution are denied',async()=>{
  for(const role of ['anon','authenticated','service_role']){
   await db.query('set role '+role)
   try{
    await assert.rejects(()=>db.query('select public.coupon_sale_choice_010(1000,900,null::public.coupons)'),e=>e.code==='42501')
    await assert.rejects(()=>db.query("select public.resolve_checkout_v1_007('forged','[]','{}','{}',null,null,null,null)"),e=>e.code==='42501')
    await assert.rejects(()=>db.query("select public.quote_checkout_v1_007_internal('{}',null)"),e=>e.code==='42501')
    await assert.rejects(()=>db.query("select public.checkout_v2_v1_receipt(null,false)"),e=>e.code==='42501')
    if(role!=='service_role'){
     await assert.rejects(()=>db.query("update coupons set pricing_policy='LEGACY'"),e=>e.code==='42501')
     await assert.rejects(()=>quoteV1(db,v1Request(f.normal.variant)),e=>e.code==='42501')
     await assert.rejects(()=>db.query("select public.create_order_transaction_v2('{}',null)"),e=>e.code==='42501')
    }
   }finally{await db.query('reset role')}
  }
  await db.query("select set_config('request.jwt.claim.role','authenticated',false)")
  try{await assert.rejects(()=>quoteV1(db,v1Request(f.normal.variant)),/PERMISSION_DENIED/)}finally{await db.query("select set_config('request.jwt.claim.role','service_role',false)")}
 })
 for(const version of [1,2]){
  await scenario('V'+version+' no coupon freezes effective prices and consumes no redemption',async()=>{
   await updateStandard(f,{regularPrice:1000,salePrice:700,stockQuantity:200});const p=await pair(f,version),r=await p.place(db),row=await evidence(db,r.id)
   assert.equal(p.quote.subtotal,700);assert.equal(p.quote.discount,0);assert.equal(row.evidence.couponOutcome,'not_requested');assert.equal(row.evidence.couponSubtotal,null);assert.equal(row.redemptions,0);await committed(db,r.id,p.quote)
  })
  await scenario('V'+version+' SALE wins globally; requested coupon persists with no usage',()=>financial(f,version,{sale:700,percentage:10,winner:'SALE',outcome:'sale_better',discount:100,merchandise:700}))
  await scenario('V'+version+' COUPON wins; regular frozen prices, one payment/redemption and immutable replay',()=>financial(f,version))
  await scenario('V'+version+' exact tie selects SALE without redemption',()=>financial(f,version,{percentage:10,winner:'SALE',outcome:'tie',discount:100,merchandise:900}))
  await scenario('V'+version+' no active sale uses regular prices and coupon alternative',()=>financial(f,version,{sale:null}))
  await scenario('V'+version+' multiple quantities use aggregate percentage',()=>financial(f,version,{quantity:3,discount:600,merchandise:2400}))
  await scenario('V'+version+' capped aggregate discount changes winner without per-item caps',()=>financial(f,version,{percentage:50,cap:50,winner:'SALE',outcome:'sale_better',discount:50,merchandise:900}))
  await scenario('V'+version+' optional cap retains exact winning coupon discount',()=>financial(f,version,{percentage:50,cap:150,discount:150,merchandise:850}))
  await scenario('V'+version+' R minimum equality qualifies despite S below minimum',()=>financial(f,version,{minimum:1000}))
  await scenario('V'+version+' R minimum above subtotal explicitly rejects without effects',async()=>{const c=await coupon(db,{minimum:1000.01}),before=await state014(db);await assert.rejects(()=>pair(f,version,c.code),/Coupon minimum|V2_INVALID_COUPON/);assert.deepEqual(await state014(db),before)})
  await scenario('V'+version+' shipping thresholds use selected merchandise rather than delivered-total comparison',async()=>{
   await db.query('update shipping_methods set base_fee=100,free_shipping_threshold=925');const result=await financial(f,version,{sale:950,percentage:10,discount:100,merchandise:900});assert.equal(result.p.quote.shippingFee,100);assert.equal(result.p.quote.total,1000);await db.query('update shipping_methods set base_fee=250,free_shipping_threshold=null')
  })
  for(const kind of ['inactive','expired','not_started','exhausted'])await scenario('V'+version+' invalid requested coupon '+kind+' cannot become sale_better',async()=>{
   const c=await coupon(db,{status:kind==='inactive'?'Inactive':'Active',limit:kind==='exhausted'?1:0})
   if(kind==='expired')await db.query("update coupons set end_date='2000-01-01' where id=$1",[c.id])
   if(kind==='not_started')await db.query("update coupons set start_date='2099-01-01' where id=$1",[c.id])
   if(kind==='exhausted')await db.query('update coupons set used_count=1 where id=$1',[c.id])
   const before=await state014(db);await assert.rejects(()=>pair(f,version,c.code),/Coupon|COUPON/);assert.deepEqual(await state014(db),before)
  })
 }
 for(const schedule of ['immediate','future','expired','regular'])await scenario('V1 '+schedule+' sale exposes only same-resolution selected prices',async()=>{
  await updateStandard(f,{regularPrice:1000,salePrice:schedule==='regular'?null:700,saleStartsAt:schedule==='future'?'2099-01-01T00:00:00Z':null,saleEndsAt:schedule==='expired'?'2000-01-01T00:00:00Z':null,stockQuantity:200})
  const p=await pair(f,1),r=await p.place(db);assert.equal(p.quote.lines[0].unitPrice,schedule==='immediate'?700:1000);await committed(db,r.id,p.quote)
 })
 await scenario('V1 canonical UUID aliases aggregate repeated lines and sort distinct variants deterministically',async()=>{
  await updateStandard(f,{regularPrice:1000,salePrice:700,saleStartsAt:null,saleEndsAt:null,stockQuantity:200});await updateTester(f,f.tester,{regularPrice:250,salePrice:null,stockQuantity:200})
  const lines=[normalLine(f.tester.tester.variant_id,2),normalLine(f.normal.variant.toUpperCase(),2),normalLine(f.normal.variant,1)]
  const p=await pair(f,1,'',1,lines),r=await p.place(db);assert.equal(p.quote.subtotal,2600);assert.equal(p.quote.lines.length,2);assert.equal(p.quote.lines.find(l=>l.variantId===f.normal.variant).quantity,3);await committed(db,r.id,p.quote,{quantities:5})
 })
 for(const strategy of ['SALE','COUPON','tie'])for(const representation of ['lowercase','uppercase','repeated'])await scenario('V1 '+strategy+' '+representation+' UUIDs preserve canonical frozen charges and one replay',async()=>{
  await updateStandard(f,{regularPrice:1000,salePrice:900,saleStartsAt:null,saleEndsAt:null,stockQuantity:200})
  const c=await coupon(db,{percentage:strategy==='SALE'?5:strategy==='COUPON'?20:10}),id=f.normal.variant
  const lines=representation==='repeated'?[normalLine(id,1),normalLine(id.toUpperCase(),2),normalLine(id,3)]:[normalLine(representation==='uppercase'?id.toUpperCase():id)]
  const quantity=representation==='repeated'?6:1,p=await pair(f,1,c.code,1,lines),r=await p.place(db),winner=strategy==='COUPON'
  assert.deepEqual(p.quote.lines,[{variantId:id,quantity,unitPrice:winner?1000:900,lineTotal:(winner?1000:900)*quantity}])
  assert.equal(p.quote.pricingOutcome.strategy,winner?'COUPON':'SALE');assert.equal(p.quote.discount,winner?200*quantity:0)
  await committed(db,r.id,p.quote,{quantities:quantity,coupon:winner?c.id:null})
  assert.equal((await db.query("select count(*)::int n from inventory_movements where reference_id=$1 and reason='Order placed'",[r.id])).rows[0].n,1)
  const before=await state014(db);assert.deepEqual(await p.place(db),{...r,idempotent:true});assert.deepEqual(await state014(db),before)
 })
 await scenario('V1 reordered mixed-case repeated identities retain private fingerprint, quote lines and committed aggregation',async()=>{
  await updateStandard(f,{regularPrice:1000,salePrice:700,saleStartsAt:null,saleEndsAt:null,stockQuantity:200});await updateTester(f,f.tester,{regularPrice:250,salePrice:null,stockQuantity:200})
  const lines=[normalLine(f.tester.tester.variant_id,2),normalLine(f.normal.variant.toUpperCase(),2),normalLine(f.normal.variant,1)]
  const p=await pair(f,1,'',1,lines),reordered=await pair(f,1,'',1,[...lines].reverse())
  assert.deepEqual(p.quote.lines,reordered.quote.lines)
  const fingerprints=(await db.query('select price_fingerprint from checkout_v1_attempts where token=any($1::text[])',[[p.quote.idempotencyKey,reordered.quote.idempotencyKey].map(k=>'checkout:'+k)])).rows
  assert.equal(fingerprints.length,2);assert.equal(fingerprints[0].price_fingerprint,fingerprints[1].price_fingerprint)
  p.request.items.reverse();const r=await p.place(db);await committed(db,r.id,p.quote,{quantities:5})
  const movements=(await db.query("select variant_id,sum(-quantity_delta)::int quantity,count(*)::int movements from inventory_movements where reference_id=$1 and reason='Order placed' group by variant_id order by variant_id",[r.id])).rows
  assert.deepEqual(movements,p.quote.lines.map(l=>({variant_id:l.variantId,quantity:l.quantity,movements:1})))
 })
 for(const kind of ['unknown','malformed'])await scenario('V1 '+kind+' UUID quotation rejects without financial or inventory effects',async()=>{
  const before=await state014(db),request=v1Request(kind==='unknown'?randomUUID():'invalid-uuid')
  await assert.rejects(()=>quoteV1(db,request),kind==='unknown'?/unavailable/:/V2_INVALID_REQUEST/)
  assert.deepEqual(await state014(db),before)
 })
 for(const kind of ['foreign','missing','additional','quantity','client_price','client_total'])await scenario('V1 checked placement rejects '+kind+' merchandise mutation without effects',async()=>{
  const p=await pair(f,1,'',1,[normalLine(f.normal.variant),normalLine(f.tester.tester.variant_id)]),request=structuredClone(p.request)
  if(kind==='foreign')request.items[0].variantId=f.second.tester.variant_id
  if(kind==='missing')request.items.pop()
  if(kind==='additional')request.items.push({variantId:f.second.tester.variant_id,quantity:1})
  if(kind==='quantity')request.items[0].quantity++
  if(kind==='client_price')request.items[0].unitPrice=1
  if(kind==='client_total')request.items[0].lineTotal=1
  const before=await state014(db);await assert.rejects(()=>placeV1(db,p.quote,request),/IDEMPOTENCY_CONFLICT|V2_INVALID_REQUEST/);assert.deepEqual(await state014(db),before)
 })
 for(const kind of ['missing','additional','foreign','duplicate_alias','quantity','zero_price','changed_price','changed_subtotal'])await scenario('Private V1 effects retain '+kind+' pricing-state rejection and atomic no-effects',async()=>{
  const request=v1Request(f.normal.variant);request.items.push({variantId:f.tester.tester.variant_id,quantity:1})
  const contact={name:'Fixture',email:request.email,phone:'00000000000'},shipping={address:'Fixture address',...request.shipping,notes:''}
  const q=(await db.query('select public.resolve_checkout_v1_007($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,null,null,null) q',['quote:identity-fixture',JSON.stringify(request.items),JSON.stringify(contact),JSON.stringify(shipping),'Cash on Delivery'])).rows[0].q
  if(kind==='missing')q._prices.pop()
  if(kind==='additional')q._prices.push({...q._prices[0],variantId:randomUUID()})
  if(kind==='foreign')q._prices[0].variantId=f.second.tester.variant_id
  if(kind==='duplicate_alias')q._prices[1]={...q._prices[0],variantId:q._prices[0].variantId.toUpperCase()}
  if(kind==='quantity')request.items[0].quantity++
  if(kind==='zero_price')q._prices[0].unitPrice=0
  if(kind==='changed_price')q._prices[0].unitPrice+=0.01
  if(kind==='changed_subtotal')q.subtotal+=0.01
  const before=await state014(db)
  await assert.rejects(()=>db.query('select public.create_order_v1_effects_007($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,null,null,null,$6::jsonb)',['checkout:'+randomUUID(),JSON.stringify(request.items),JSON.stringify(contact),JSON.stringify(shipping),'Cash on Delivery',JSON.stringify(q)]),e=>e.code==='22023'&&e.message==='V1_PRICING_STATE_INVALID')
  assert.deepEqual(await state014(db),before)
  console.log('Release010 rejected identity state '+JSON.stringify({case:kind,orders:before.orders.length,payments:before.payments.length,movements:before.movements?.length??0,redemptions:before.redemptions?.length??0,unchanged:true}))
 })
 await scenario('V1 decimal paisa prices and order-level discount remain exact in frozen receipt',async()=>{
  await updateStandard(f,{regularPrice:1000.05,salePrice:900.03,saleStartsAt:null,saleEndsAt:null,stockQuantity:200});const c=await coupon(db,{percentage:20}),p=await pair(f,1,c.code,3),r=await p.place(db)
  assert.deepEqual(p.quote.lines,[{variantId:f.normal.variant,quantity:3,unitPrice:1000.05,lineTotal:3000.15}]);assert.equal(p.quote.discount,600.03);assert.equal(p.quote.total,2650.12);await committed(db,r.id,p.quote,{quantities:3,coupon:c.id})
 })
 await scenario('V1 changed catalog price retires issued confirmation without order effects',async()=>{
  await updateStandard(f,{regularPrice:1000,salePrice:900,saleStartsAt:null,saleEndsAt:null,stockQuantity:200});const p=await pair(f,1);await updateStandard(f,{salePrice:850});const before=await state014(db);assert.equal((await p.place(db)).outcome,'retired');assert.deepEqual(await state014(db),before)
 })
 await scenario('Shared exact aggregate rounding, caps, tie and numeric rejection',async()=>{
  const c=await coupon(db,{percentage:10})
  const resolve=async(r,s)=>(await db.query('select coupon_sale_choice_010($1::numeric,$2::numeric,c) result from coupons c where id=$3',[r,s,c.id])).rows[0].result
  assert.equal((await resolve('.05','.05')).couponDiscount,.01)
  assert.equal((await resolve('.10','.10')).couponDiscount,.01,'Round once on aggregate, not .01 per .05 line')
  for(const r of ['NaN','Infinity','-1','0','10000000000','.001'])await assert.rejects(()=>resolve(r,'.05'),/COUPON_PRICING_INVALID/)
  await db.query('update coupons set max_discount_amount=0 where id=$1',[c.id]);assert.equal((await resolve(1000,1000)).couponOutcome,'tie')
 })
 for(const version of [1,2])await scenario('V'+version+' mixed cart chooses one global strategy; no per-line hybrid total',async()=>{
  await updateStandard(f,{regularPrice:1000,salePrice:500,stockQuantity:200});await updateTester(f,f.tester,{regularPrice:1000,salePrice:null,stockQuantity:200})
  const c=await coupon(db,{percentage:30}),p=await pair(f,version,c.code,1,[normalLine(f.normal.variant),normalLine(f.tester.tester.variant_id)]),r=await p.place(db)
  assert.deepEqual([p.quote.pricingOutcome.regularSubtotal,p.quote.pricingOutcome.saleSubtotal,p.quote.pricingOutcome.couponSubtotal,p.quote.total],[2000,1500,1400,1650]);assert.equal(p.quote.subtotal,2000);assert((await evidence(db,r.id)).frozen.every(l=>l.unitPrice===1000));await committed(db,r.id,p.quote,{quantities:2,coupon:c.id})
 })
 for(const kind of ['tester','fixed','configurable'])await scenario(kind+' owns both alternatives and preserves component demand/reference basis',async()=>{
  await updateTester(f,f.tester,{regularPrice:250,salePrice:225,stockQuantity:200})
  await updatePack(f,f.fixed,{fixedRegularPrice:450,fixedSalePrice:400})
  const c=await coupon(db,{percentage:20}),lines=kind==='tester'?[normalLine(f.tester.tester.variant_id,2)]:kind==='fixed'?[fixedLine(f,2)]:[configuredLine(f,undefined,2)]
  // Refresh only the definition token changed by the actual authorized writer.
  if(kind==='fixed')lines[0].definitionRevision=(await db.query('select definition_revision::text r from tester_packs where product_id=$1',[f.fixed.product.id])).rows[0].r
  const p=await pair(f,2,c.code,1,lines),r=await p.place(db),q=p.quote
  assert.equal(q.pricingOutcome.strategy,'COUPON');assert.equal(q.subtotal,kind==='tester'?500:kind==='fixed'?900:1000)
  assert.equal(q.lines[0].unitPrice,kind==='tester'?250:kind==='fixed'?450:500)
  if(kind!=='tester')assert(q.lines[0].components.every(x=>x.referenceUnitPrice===250))
  await committed(db,r.id,q,{quantities:kind==='tester'?2:4,coupon:c.id})
 })
 for(const version of [1,2])for(const boundary of ['activation','expiration'])await scenario('V'+version+' '+boundary+' invalidates accepted quote without effects',async()=>{
  await updateStandard(f,{regularPrice:1000,salePrice:900,saleStartsAt:null,saleEndsAt:null,stockQuantity:200});const instant=await deadline(db)
  await updateStandard(f,{[boundary==='activation'?'saleStartsAt':'saleEndsAt']:instant});const c=await coupon(db,{percentage:15}),p=await pair(f,version,c.code),before=await state014(db)
  await waitClock(db,instant)
  if(version===1){const result=await p.place(db);assert.equal(result.outcome,'retired');assert.equal((await db.query('select state from checkout_v1_attempts where token=$1',['checkout:'+p.quote.idempotencyKey])).rows[0].state,'retired')}
  else await assert.rejects(()=>p.place(db),/V2_QUOTE_CHANGED/)
  assert.deepEqual(await state014(db),before)
 })
 await scenario('Native lock wait crossing expiry re-resolves after lock and rejects stale confirmation',async()=>{
  const instant=await deadline(db);await updateStandard(f,{regularPrice:1000,salePrice:900,saleStartsAt:null,saleEndsAt:instant,stockQuantity:200});const c=await coupon(db,{percentage:15}),p=await pair(f,1,c.code),a=await additional(t,db),b=await additional(t,db);a.nativePid=(await a.query('select pg_backend_pid() n')).rows[0].n
  let pending
  try{await a.query('begin');await a.query('select id from product_variants where id=$1 for update',[f.normal.variant]);pending=p.place(b);await waitBlocked(db,b,a);await waitClock(db,instant);await a.query('commit');assert.equal((await pending).outcome,'retired')}
  finally{await a.query('rollback');if(pending)await pending}
 })
 for(const version of [1,2])await scenario('V'+version+' coupon terms change rejects stale confirmation before all effects',async()=>{
  await updateStandard(f,{regularPrice:1000,salePrice:900,saleStartsAt:null,saleEndsAt:null,stockQuantity:200});const c=await coupon(db),p=await pair(f,version,c.code);await db.query('update coupons set discount_value=25 where id=$1',[c.id]);const before=await state014(db)
  if(version===1)assert.equal((await p.place(db)).outcome,'retired');else await assert.rejects(()=>p.place(db),/V2_QUOTE_CHANGED/)
  assert.deepEqual(await state014(db),before)
 })
 for(const restriction of ['limit','customerLimit'])await scenario('Concurrent winners serialize final '+restriction+' slot; one order/redemption/payment survives',async()=>{
  const c=await coupon(db,{[restriction]:1}),p=await pair(f,1,c.code),other=await pair(f,2,c.code),a=await additional(t,db),b=await additional(t,db);a.nativePid=(await a.query('select pg_backend_pid() n')).rows[0].n
  let pending
  try{await a.query('begin');const r=await p.place(a);pending=other.place(b).then(value=>({value}),error=>({error}));await waitBlocked(db,b,a);await a.query('commit');assert.match((await pending).error.message,/COUPON|Coupon/);await committed(db,r.id,p.quote,{coupon:c.id});assert.equal((await db.query('select count(*)::int n from coupon_redemptions where coupon_id=$1',[c.id])).rows[0].n,1)}finally{await a.query('rollback');if(pending)await pending}
 })
 await scenario('Duplicate token concurrent placement returns immutable replay with one set of effects',async()=>{
  const c=await coupon(db),p=await pair(f,1,c.code),a=await additional(t,db),b=await additional(t,db);a.nativePid=(await a.query('select pg_backend_pid() n')).rows[0].n;const before=await counts(db);let pending
  try{await a.query('begin');const r=await p.place(a);pending=p.place(b);await waitBlocked(db,b,a);await a.query('commit');assert.deepEqual(await pending,{...r,idempotent:true});const after=await counts(db);assert.deepEqual(after,{orders:before.orders+1,payments:before.payments+1,movements:before.movements+1,redemptions:before.redemptions+1})}finally{await a.query('rollback');if(pending)await pending}
 })
 for(const version of [1,2])for(const subsystem of ['payment','redemption','snapshot'])await scenario('V'+version+' late '+subsystem+' failure rolls back all order and inventory effects',async()=>{
  const c=await coupon(db),p=await pair(f,version,c.code),before=await state014(db)
  const table=subsystem==='payment'?'payments':subsystem==='redemption'?'coupon_redemptions':'orders'
  const trigger=subsystem==='snapshot'?`create constraint trigger rf010_fixture_failure after insert on public.${table} deferrable initially deferred`:`create trigger rf010_fixture_failure before insert on public.${table}`
  await db.query(`create function public.rf010_fixture_failure() returns trigger language plpgsql as $$begin raise exception 'FIXTURE_LATE_FAILURE';end$$; ${trigger} for each row execute function public.rf010_fixture_failure()`)
  try{await assert.rejects(()=>p.place(db),/FIXTURE_LATE_FAILURE/);assert.deepEqual(await state014(db),before)}finally{await db.query(`drop trigger rf010_fixture_failure on public.${table};drop function public.rf010_fixture_failure()`)}
 })
 await scenario('Frozen outcome/items resist mutation; cancellation restores stock once without redemption reversal',async()=>{
  const {r,p}=await financial(f,1);const before=await state014(db)
  await assert.rejects(()=>db.query("update orders set pricing_outcome=jsonb_set(pricing_outcome,'{strategy}','\"SALE\"') where id=$1",[r.id]),/IMMUTABLE/)
  await assert.rejects(()=>db.query('update order_items set unit_price=1 where order_id=$1',[r.id]),/PRICING_ITEMS_IMMUTABLE/);assert.deepEqual(await state014(db),before)
  const c=await coupon(db),v2=await pair(f,2,c.code),receipt=await v2.place(db),snapshot=await evidence(db,receipt.id)
  await mutate014(f,receipt.id,'cancel',{reason:'Owned acceptance cancellation'});const after=await evidence(db,receipt.id);assert.deepEqual(after.evidence,snapshot.evidence);assert.equal(after.redemptions,1)
  const quantity=(await db.query("select sum(quantity_delta)::int n from inventory_movements where reference_id=$1 and reason='Order cancelled'",[receipt.id])).rows[0].n;assert.equal(quantity,1)
  await mutate014(f,receipt.id,'cancel',{reason:'Owned duplicate cancellation'});assert.equal((await db.query("select sum(quantity_delta)::int n from inventory_movements where reference_id=$1 and reason='Order cancelled'",[receipt.id])).rows[0].n,1)
  assert.equal((await p.place(db)).id,r.id)
 })
 for(const name of Object.keys(legacy))await scenario('Grandfathered '+name+' retains type, effective-price stacking, minimum, cap and scope',async()=>{
  await updateStandard(f,{regularPrice:2900,salePrice:2450,saleStartsAt:null,saleEndsAt:null,stockQuantity:200})
  for(const version of [1,2]){
   const before=await state014(db)
   if(name==='minimum'){await assert.rejects(()=>pair(f,version,legacy[name].code),/minimum|COUPON/);assert.deepEqual(await state014(db),before);continue}
   const p=await pair(f,version,legacy[name].code),r=await p.place(db);assert.equal(p.quote.subtotal,2450);assert.equal(p.quote.discount,name==='percent'||name==='restricted'?245:name==='cap'?30:name==='fixed'?100:0);assert.equal(p.quote.shippingFee,name==='shipping'?0:250)
   const row=await evidence(db,r.id);assert.equal(row.evidence,null);assert.equal(row.redemptions,1);assert.equal(row.coupon_id,legacy[name].id)
  }
 })
 await scenario('Historical committed replay preserves financials and adds only persisted V1 lines after catalog changes',async()=>{
  await db.query('update coupons set status=$1 where id=$2',['Inactive',legacy.percent.id]);await updateStandard(f,{salePrice:2000});const before=await state014(db)
  for(const {p,r,lines}of historical){const replay=await p.place(db);assert.deepEqual(replay,{...r,...(lines?{lines}:{}),idempotent:true});if(lines)assert(!('pricingOutcome' in replay))};assert.deepEqual(await state014(db),before)
 })
 await scenario('Unchecked new V1, forged credentials, cross-version issued token and retired replay stay fenced',async()=>{
  const p=await pair(f,1),request=p.request,before=await state014(db)
  await assert.rejects(()=>placeV1(db,{...p.quote,quoteFingerprint:'0'.repeat(64)},request),/IDEMPOTENCY_CONFLICT/)
  await assert.rejects(()=>db.query('select create_order_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,null,null,null)',['checkout:'+randomUUID(),JSON.stringify(request.items),JSON.stringify({name:'Fixture',email:request.email,phone:'00000000000'}),JSON.stringify({address:'Fixture address',...request.shipping,notes:''}),'Cash on Delivery']),/V1_QUOTE_REQUIRED/)
  const v2=await pair(f,2);v2.request.idempotencyKey=p.quote.idempotencyKey;await assert.rejects(()=>v2.place(db),/IDEMPOTENCY_CONFLICT/);assert.deepEqual(await state014(db),before)
  await updateStandard(f,{salePrice:1900});assert.equal((await p.place(db)).outcome,'retired');await updateStandard(f,{salePrice:2000});assert.equal((await p.place(db)).outcome,'retired')
 })
 console.log('Release010 completed native scenarios: '+scenarios)
})
