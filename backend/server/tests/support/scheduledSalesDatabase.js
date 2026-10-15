import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {checkedFixture} from './checkedV1Database.js'
import {connection} from './release005NativeFixture.js'
import {testerFixture,savePack,saveTester,productPatch} from './testerCatalogDatabase.js'

export const release009URL=new URL('../../../supabase/release-migrations/009_scheduled_fixed_sale_pricing.sql',import.meta.url)
export const source009=()=>readFile(release009URL,'utf8')
export async function apply009(db,source){
 try{await db.query(source??await source009())}catch(error){await db.query('rollback');throw error}
}
export async function salesFixture(t,{install=true}={}){
 const cleanup=[]
 const f=await checkedFixture({after:fn=>cleanup.push(fn)})
 f.db.salesClients=[]
 t.after(async()=>{for(const client of f.db.salesClients)await client.end();for(const fn of cleanup)await fn()})
 f.second=await testerFixture(f.db,f.admin,{regularPrice:300})
 const patch=()=>{const p=productPatch();delete p.price;return p}
 f.fixed=await savePack(f.db,f.admin,null,patch(),{mode:'fixed',fixedRegularPrice:450,components:[{testerVariantId:f.tester.tester.variant_id,quantityPerPack:2,displayOrder:0}]})
 f.configurable=await savePack(f.db,f.admin,null,patch(),{mode:'configurable',allowedVariants:[f.tester,f.second].map((v,displayOrder)=>({testerVariantId:v.tester.variant_id,active:true,displayOrder}))})
 if(install)await apply009(f.db)
 return f
}
export async function variantInput(db,id,changes={}){
 const v=(await db.query('select * from public.product_variants where id=$1',[id])).rows[0]
 return {id:v.id,optionName:v.option_name,optionValue:v.option_value,sku:v.sku,regularPrice:Number(v.regular_price),salePrice:v.sale_price===null?null:Number(v.sale_price),stockQuantity:v.stock_quantity,active:v.active,available:v.standard_manual_available??true,displayOrder:v.display_order,...changes}
}
export async function updateStandard(f,changes,revision){
 const input=await variantInput(f.db,f.normal.variant,changes)
 const rev=revision??(await f.db.query('select catalog_revision::text r from products where id=$1',[f.normal.product])).rows[0].r
 return (await f.db.query('select public.save_catalog_product($1,$2::jsonb,$3::jsonb,$4) result',[f.normal.product,'{}',JSON.stringify([input]),rev])).rows[0].result
}
export async function updateTester(f,tester,changes){
 const v=await variantInput(f.db,tester.tester.variant_id,changes)
 v.available=(await f.db.query('select manual_available from tester_variants where variant_id=$1',[v.id])).rows[0].manual_available
 const rev=(await f.db.query('select catalog_revision::text r from products where id=$1',[tester.product.id])).rows[0].r
 return saveTester(f.db,f.admin,tester.product.id,{},v,tester.tester.source_product_id,rev)
}
export async function updatePack(f,pack,changes){
 const row=(await f.db.query('select p.catalog_revision::text r,d.definition_revision::text dr from products p join tester_packs d on d.product_id=p.id where p.id=$1',[pack.product.id])).rows[0]
 return savePack(f.db,f.admin,pack.product.id,{},changes,row.r,row.dr)
}
export const v1Request=(variant,couponCode='')=>({items:[{variantId:variant,quantity:1}],shipping:{city:'Karachi',province:'Sindh'},email:'fixture@example.invalid',couponCode})
export async function quoteV1(db,request){return (await db.query('select public.quote_checkout_v1_checked($1::jsonb,null) result',[JSON.stringify(request)])).rows[0].result}
export async function placeV1(db,q,request){
 return (await db.query('select public.create_order_transaction_v1_checked($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,null,null,$7) result',[
  'checkout:'+q.idempotencyKey,JSON.stringify(request.items),JSON.stringify({name:'Fixture',email:request.email,phone:'00000000000'}),
  JSON.stringify({address:'Fixture address',...request.shipping,notes:''}),'Cash on Delivery',request.couponCode||null,q.quoteFingerprint])).rows[0].result
}
export async function additional(t,db){
 const database=(await db.query('select current_database() n')).rows[0].n,c=await connection(database)
 c.nativePid=(await c.query('select pg_backend_pid() n')).rows[0].n
 db.salesClients.push(c)
 return c
}
export async function waitBlocked(observer,client,holder){
 const until=Date.now()+5000
 while(Date.now()<until){
  const row=(await observer.query('select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[client.nativePid])).rows[0]
  if(row?.wait_event_type==='Lock'&&row.blockers.includes(holder.nativePid))return
  await new Promise(resolve=>setTimeout(resolve,15))
 }
 assert.fail('Expected owned PostgreSQL blocker not observed')
}
export async function waitClock(db,instant){
 const until=Date.now()+7000
 while(Date.now()<until){
  if((await db.query('select clock_timestamp()>=$1::timestamptz reached',[instant])).rows[0].reached)return
  await new Promise(resolve=>setTimeout(resolve,15))
 }
 assert.fail('Owned database clock did not reach the schedule boundary')
}
export async function deadline(db){return (await db.query("select to_char((clock_timestamp()+interval '2 seconds') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') value")).rows[0].value}
export async function counts(db){return (await db.query(`select (select count(*)::int from orders) orders,
 (select count(*)::int from payments) payments,(select count(*)::int from inventory_movements where reason='Order placed') movements,
 (select count(*)::int from coupon_redemptions) redemptions`)).rows[0]}
export async function committed(db,id,expected,{quantities=1,coupon=null}={}){
 const row=(await db.query(`select o.subtotal::text,o.discount::text,o.shipping_fee::text,o.total::text,
  (select sum(unit_price*quantity)::text from order_items where order_id=o.id) items,
  (select amount::text from payments where order_id=o.id) payment,
  (select count(*)::int from payments where order_id=o.id) payments,
  (select sum(-quantity_delta)::int from inventory_movements where reference_id=o.id and reason='Order placed') deducted,
  (select count(*)::int from coupon_redemptions where order_id=o.id) redemptions
  from orders o where o.id=$1`,[id])).rows[0]
 assert(row,'Committed order exists')
 assert.deepEqual([row.subtotal,row.discount,row.shipping_fee,row.total,row.items,row.payment].map(Number),[expected.subtotal,expected.discount,expected.shippingFee,expected.total,expected.subtotal,expected.total])
 assert.equal(row.payments,1);assert.equal(row.deducted,quantities);assert.equal(row.redemptions,coupon?1:0)
 if(coupon)assert.equal((await db.query('select used_count from coupons where id=$1',[coupon])).rows[0].used_count,1)
 const order=(await db.query('select checkout_version,quote_snapshot from orders where id=$1',[id])).rows[0]
 if(order.checkout_version===2){
  const snapshot=order.quote_snapshot
  assert.deepEqual([snapshot.subtotal,snapshot.discount,snapshot.shippingFee,snapshot.total],[expected.subtotal,expected.discount,expected.shippingFee,expected.total])
  const items=(await db.query('select * from order_items where order_id=$1 order by position',[id])).rows
  assert.equal(items.length,snapshot.lines.length)
  for(let position=0;position<items.length;position++){
   const item=items[position],line=snapshot.lines[position]
   assert.equal(Number(item.unit_price),line.unitPrice);assert.equal(item.quantity,line.quantity)
   const physical=(await db.query('select * from order_item_components where order_item_id=$1 order by position',[item.id])).rows
   assert.equal(physical.length,line.components.length)
   for(let i=0;i<physical.length;i++){
    assert.equal(Number(physical[i].reference_unit_price),line.components[i].referenceUnitPrice)
    assert.equal(physical[i].tester_variant_id,line.components[i].testerVariantId)
    assert.equal(physical[i].total_physical_quantity,line.components[i].totalPhysicalQuantity)
   }
  }
 }else assert.equal(order.quote_snapshot,null)
 console.log('Committed scheduled-sale financial state: '+JSON.stringify({id,...row}))
}
