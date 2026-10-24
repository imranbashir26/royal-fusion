import assert from 'node:assert/strict'
import test from 'node:test'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {fixtureV2,normalLine,fixedLine,configuredLine,requestV2,orderV2,shapeSQL} from './support/checkoutV2Database.js'
import {fixture014,apply014,mutate014,state014,client014} from './support/fulfillmentV2Database.js'
import {OrdersV2Service} from '../services/ordersV2Service.js'
import {OrdersV1Service} from '../services/ordersV1Service.js'
import {checkedFixture,confirmV1} from './support/checkedV1Database.js'
import {savePack,productPatch,saveTester,variantPatch} from './support/testerCatalogDatabase.js'
const logger={warn(){}}
async function fixture(t){const f=await fixture014();t.after(()=>f.db.close());return f}
async function create(f,lines,changes={}){
 const input=await requestV2(f.db,lines,changes),service=new OrdersV2Service(client014(f.db),{environment:'test',allowNonProductionOrders:true,logger})
 return {input,order:await service.create(input,null,'sql-014-order-fixture')}
}
async function failure(f,fn,pattern){const before=await state014(f.db);await assert.rejects(fn,pattern);assert.deepEqual(await state014(f.db),before)}
const stock=async(f,id)=>(await f.db.query('select stock_quantity,available from public.product_variants where id=$1',[id])).rows[0]
async function corrupt(f,sql,args=[]){await f.db.exec('set session_replication_role=replica');try{await f.db.query(sql,args)}finally{await f.db.exec('set session_replication_role=origin')}}

// Privileged disposable corruption only. Keep the corrupt state, then prove every
// rejected public service-role action leaves all business rows byte-for-byte intact.
async function rejectFrozenCorruption(f,order,change,unique=[]){
 await f.db.exec('begin;set local session_replication_role=replica')
 try{
  if(unique.length){
   const constraints=(await f.db.query("select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.order_item_components'::regclass and contype='u'")).rows
   for(const definition of unique){
    const constraint=constraints.find(c=>c.definition.replaceAll('"','')===definition);assert.ok(constraint,definition)
    await f.db.exec('alter table public.order_item_components drop constraint "'+constraint.conname.replaceAll('"','""')+'"')
   }
  }
  await change();await f.db.exec('set local session_replication_role=origin;savepoint before_action')
  const before=await state014(f.db)
  for(const [action,payload] of [['cancel',{reason:'Reject corrupted frozen purchase'}],['status',{status:'Confirmed',reason:''}]]){
   await assert.rejects(()=>mutate014(f,order.id,action,payload),/ORDER_SNAPSHOT_INCONSISTENT/)
   await f.db.exec('rollback to savepoint before_action;reset role')
   assert.deepEqual(await state014(f.db),before)
  }
 }finally{await f.db.exec('rollback;reset role')}
}

const cloneComponentSQL=`insert into public.order_item_components(order_id,order_item_id,tester_variant_id,tester_product_id,tester_name,sku,size,volume_ml,quantity_per_pack,total_physical_quantity,reference_unit_price,position)
 select $2::uuid,$3::uuid,tester_variant_id,tester_product_id,tester_name,sku,size,volume_ml,1,1,reference_unit_price,$4::integer
 from public.order_item_components where order_id=$1 order by order_item_id,position limit 1`

test('orphan with a valid tester UUID and matching inflated placement ledger rejects without any committed effects',async t=>{
 const f=await fixture(t),id=f.tester.tester.variant_id,{order}=await create(f,[fixedLine(f)])
 assert.equal((await stock(f,id)).stock_quantity,10)
 await corrupt(f,cloneComponentSQL,[order.id,order.id,randomUUID(),0])
 await corrupt(f,"update public.inventory_movements set quantity_delta=-3 where reference_id=$1 and reason='Order placed'",[order.id])
 // No enclosing rollback: rejection must hold at the real RPC commit boundary.
 await failure(f,()=>mutate014(f,order.id,'cancel',{reason:'Orphan cannot authorize an extra unit'}),/ORDER_SNAPSHOT_INCONSISTENT/)
 assert.equal((await stock(f,id)).stock_quantity,10)
 assert.equal((await f.db.query('select status,revision::text revision from public.orders where id=$1',[order.id])).rows[0].status,'Pending')
})

test('frozen component correspondence rejects every orphan, cross-parent and extra-row case atomically',async t=>{
 const f=await fixture(t),{order:pack}=await create(f,[fixedLine(f)]),{order:other}=await create(f,[fixedLine(f)])
 const {order:mixed}=await create(f,[normalLine(f.normal.variant),fixedLine(f),configuredLine(f,[
  {variantId:f.tester.tester.variant_id,quantityPerPack:1},{variantId:f.second.tester.variant_id,quantityPerPack:1}])])
 const items=(await f.db.query('select id,line_kind from public.order_items where order_id=$1',[mixed.id])).rows
 const normal=items.find(i=>i.line_kind==='normal_variant').id,configured=items.find(i=>i.line_kind==='configurable_tester_pack').id
 const own=(await f.db.query('select id from public.order_items where order_id=$1',[pack.id])).rows[0].id
 const foreign=(await f.db.query('select id from public.order_items where order_id=$1',[other.id])).rows[0].id
 const cases=[
  ['nonexistent parent / real tester UUID',pack,()=>f.db.query(cloneComponentSQL,[pack.id,pack.id,randomUUID(),0])],
  ['parent from another order',pack,()=>f.db.query(cloneComponentSQL,[pack.id,pack.id,foreign,1]),['UNIQUE (order_item_id, tester_variant_id)']],
  ['component under normal line',mixed,()=>f.db.query(cloneComponentSQL,[pack.id,mixed.id,normal,0])],
  ['extra valid tester under pack absent from frozen quote',pack,()=>f.db.query(`insert into public.order_item_components(order_id,order_item_id,tester_variant_id,tester_product_id,tester_name,sku,size,volume_ml,quantity_per_pack,total_physical_quantity,reference_unit_price,position)
   select order_id,order_item_id,$2::uuid,$3::uuid,tester_name,sku,size,volume_ml,1,1,reference_unit_price,1 from public.order_item_components where order_id=$1`,[pack.id,f.second.tester.variant_id,f.second.product.id])],
  ['copied legitimate component under wrong pack parent',mixed,()=>f.db.query(cloneComponentSQL,[pack.id,mixed.id,configured,2]),['UNIQUE (order_item_id, tester_variant_id)']],
  ['component order disagrees with its parent order',pack,()=>f.db.query('update public.order_item_components set order_id=$2 where order_id=$1',[pack.id,other.id])],
  ['duplicate tester where quote contains one',pack,()=>f.db.query(cloneComponentSQL,[pack.id,pack.id,own,1]),['UNIQUE (order_item_id, tester_variant_id)']],
 ]
 for(const [name,order,change,unique] of cases)await t.test(name,()=>rejectFrozenCorruption(f,order,change,unique))
})

test('quoted line and component positions must equal independent zero-based array ordinals',async t=>{
 const f=await fixture(t),{order:single}=await create(f,[fixedLine(f)])
 const {order:multiple}=await create(f,[normalLine(f.normal.variant),configuredLine(f,[
  {variantId:f.tester.tester.variant_id,quantityPerPack:1},{variantId:f.second.tester.variant_id,quantityPerPack:1}])])
 const pack=(await f.db.query("select id,position from public.order_items where order_id=$1 and line_kind='configurable_tester_pack'",[multiple.id])).rows[0]
 async function quotePosition(order,path,value){await f.db.query('update public.orders set quote_snapshot=jsonb_set(quote_snapshot,$2::text[],$3::jsonb) where id=$1',[order.id,path,JSON.stringify(value)])}
 const cases=[
  ['quoted line position only 7',single,()=>quotePosition(single,['lines','0','position'],7)],
  ['quoted and stored first line both 7',single,async()=>{await quotePosition(single,['lines','0','position'],7);await f.db.query('update public.order_items set position=7 where order_id=$1',[single.id])}],
  ['two-line gap 0,2',multiple,async()=>{await quotePosition(multiple,['lines','1','position'],2);await f.db.query('update public.order_items set position=2 where order_id=$1 and position=1',[multiple.id])}],
  ['line array reordered against persisted positions',multiple,()=>f.db.query("update public.orders set quote_snapshot=jsonb_set(quote_snapshot,'{lines}',jsonb_build_array(quote_snapshot->'lines'->1,quote_snapshot->'lines'->0)) where id=$1",[multiple.id])],
  ['quoted component position only 7',single,()=>quotePosition(single,['lines','0','components','0','position'],7)],
  ['quoted and stored first component both 7',single,async()=>{await quotePosition(single,['lines','0','components','0','position'],7);await f.db.query('update public.order_item_components set position=7 where order_id=$1',[single.id])}],
  ['quoted and stored first component both 1',single,async()=>{await quotePosition(single,['lines','0','components','0','position'],1);await f.db.query('update public.order_item_components set position=1 where order_id=$1',[single.id])}],
  ['component gap 0,2',multiple,async()=>{await quotePosition(multiple,['lines',String(pack.position),'components','1','position'],2);await f.db.query('update public.order_item_components set position=2 where order_item_id=$1 and position=1',[pack.id])}],
  ['duplicate component position',multiple,async()=>{await quotePosition(multiple,['lines',String(pack.position),'components','1','position'],0);await f.db.query('update public.order_item_components set position=0 where order_item_id=$1 and position=1',[pack.id])},['UNIQUE (order_item_id, position)']],
  ['reordered frozen component array against persisted positions',multiple,()=>f.db.query(`update public.orders set quote_snapshot=jsonb_set(quote_snapshot,$2::text[],jsonb_build_array(quote_snapshot->'lines'->$3::integer->'components'->1,quote_snapshot->'lines'->$3::integer->'components'->0)) where id=$1`,[multiple.id,['lines',String(pack.position),'components'],pack.position])],
 ]
 for(const [name,order,change,unique] of cases)await t.test(name,()=>rejectFrozenCorruption(f,order,change,unique))
})

test('canonical normal, standalone, fixed, configurable and shared-tester cancellations retain contiguous snapshots',async t=>{
 const f=await fixture(t),id=f.tester.tester.variant_id
 const alternate={...f,fixed:await savePack(f.db,f.admin,null,productPatch({price:undefined}),{mode:'fixed',fixedRegularPrice:450,components:[{testerVariantId:id,quantityPerPack:1,displayOrder:0}]})}
 for(const [name,lines] of [
  ['normal',[normalLine(f.normal.variant)]],['standalone tester',[normalLine(id)]],['fixed',[fixedLine(f)]],
  ['configurable contiguous components',[configuredLine(f,[{variantId:id,quantityPerPack:1},{variantId:f.second.tester.variant_id,quantityPerPack:1}])]],
  ['five-line shared tester',[normalLine(f.normal.variant),normalLine(id),fixedLine(f),configuredLine(f),fixedLine(alternate)]],
 ])await t.test(name,async()=>{
  const before=(await f.db.query('select id,stock_quantity,available from public.product_variants order by id')).rows
  const {order}=await create(f,lines);await mutate014(f,order.id,'cancel',{reason:'Valid '+name})
  assert.deepEqual((await f.db.query('select id,stock_quantity,available from public.product_variants order by id')).rows,before)
  assert.equal((await f.db.query('select revision::text revision from public.orders where id=$1',[order.id])).rows[0].revision,'1')
 })
})

test('mixed V2 cancellation aggregates shared physical demand once, preserves money/manual intent and replays exactly',async t=>{
 const f=await fixture(t),id=f.tester.tester.variant_id;
 const {order}=await create(f,[normalLine(f.normal.variant),normalLine(id,2),fixedLine(f,2),configuredLine(f,[{variantId:id,quantityPerPack:3}],2)])
 assert.equal(order.total,6050);assert.deepEqual(await stock(f,id),{stock_quantity:0,available:false})
 const mutation=randomUUID(),first=await mutate014(f,order.id,'cancel',{reason:'Whole frozen purchase'},{mutation,revision:'0'})
 assert.equal(first.changed,true);assert.equal(first.revision,'1');assert.equal(first.paymentStatus,'Unpaid')
 assert.deepEqual(await stock(f,id),{stock_quantity:12,available:true});assert.equal((await stock(f,f.normal.variant)).stock_quantity,12)
 const movements=(await f.db.query("select variant_id,quantity_delta,balance_after,created_by,note from public.inventory_movements where reference_id=$1 and reason='Order cancelled' order by variant_id",[order.id])).rows
 assert.equal(movements.length,2);assert.equal(movements.find(m=>m.variant_id===id).quantity_delta,12)
 assert.ok(movements.every(m=>m.balance_after===12&&m.created_by===f.admin&&m.note==='Whole frozen purchase'))
 assert.equal((await f.db.query('select stock_quantity from public.products where id=$1',[f.fixed.product.id])).rows[0].stock_quantity,0)
 const before=await state014(f.db),replay=await mutate014(f,order.id,'cancel',{reason:'Whole frozen purchase'},{mutation,revision:'0'})
 assert.deepEqual(replay,{...first,replayed:true});assert.deepEqual(await state014(f.db),before)
 await failure(f,()=>mutate014(f,order.id,'cancel',{reason:'Changed'},{mutation,revision:'0'}),/MUTATION_CONFLICT/)
 const duplicate=await mutate014(f,order.id,'cancel',{reason:'Independent acknowledgement'})
 assert.equal(duplicate.changed,false);assert.equal(duplicate.revision,'1');assert.equal((await stock(f,id)).stock_quantity,12)
 assert.equal((await f.db.query("select count(*)::int n from public.order_status_history where order_id=$1 and to_status='Cancelled'",[order.id])).rows[0].n,1)
 assert.equal((await f.db.query("select count(*)::int n from public.inventory_movements where reference_id=$1 and reason='Order cancelled'",[order.id])).rows[0].n,2)
})

for(const manual of [true,false])test('standalone tester restock derives effective availability, manual='+manual,async t=>{
 const f=await fixture(t),id=f.tester.tester.variant_id,{order}=await create(f,[normalLine(id,12)])
 if(!manual)await f.db.query('update public.tester_variants set manual_available=false where variant_id=$1',[id])
 await mutate014(f,order.id,'cancel',{reason:'Restore tester'})
 assert.deepEqual(await stock(f,id),{stock_quantity:12,available:manual})
 assert.equal((await f.db.query('select manual_available from public.tester_variants where variant_id=$1',[id])).rows[0].manual_available,manual)
})

test('catalog recipe, membership, prices, names, source and legal archival never reinterpret frozen restoration',async t=>{
 const f=await fixture(t),id=f.tester.tester.variant_id,second=f.second.tester.variant_id
 const {order}=await create(f,[fixedLine(f,2),configuredLine(f,[{variantId:id,quantityPerPack:2},{variantId:second,quantityPerPack:1}],2)])
 f.fixed=await savePack(f.db,f.admin,f.fixed.product.id,{name:'New pack name',status:'Archived'},
  {fixedRegularPrice:900,components:[{testerVariantId:second,quantityPerPack:1,displayOrder:0}]},String(f.fixed.product.catalog_revision),String(f.fixed.definition.definition_revision))
 f.configurable=await savePack(f.db,f.admin,f.configurable.product.id,{status:'Archived'},
  {allowedVariants:[{testerVariantId:second,active:true,displayOrder:0}]},String(f.configurable.product.catalog_revision),String(f.configurable.definition.definition_revision))
 await f.db.query("update public.product_variants set regular_price=700 where id=$1",[id])
 await f.db.query('update public.tester_variants set manual_available=false,source_product_id=$2 where variant_id=$1',[id,f.normal.product])
 await f.db.query("update public.products set name='Renamed archived tester',status='Archived',active=false where id=$1",[f.tester.product.id])
 await mutate014(f,order.id,'cancel',{reason:'Use frozen contents'})
 assert.deepEqual(await stock(f,id),{stock_quantity:12,available:false});assert.equal((await stock(f,second)).stock_quantity,12)
 const restored=(await f.db.query("select variant_id,quantity_delta from public.inventory_movements where reference_id=$1 and reason='Order cancelled'",[order.id])).rows
 assert.equal(restored.find(r=>r.variant_id===id).quantity_delta,8);assert.equal(restored.find(r=>r.variant_id===second).quantity_delta,2)
})

test('V2 operational actions reuse forward states, tracking correction and COD collection without duplicate revisions',async t=>{
 const f=await fixture(t),{order}=await create(f,[normalLine(f.normal.variant)])
 const confirm=await mutate014(f,order.id,'status',{status:'Confirmed',reason:''});assert.equal(confirm.revision,'1')
 const noop=await mutate014(f,order.id,'status',{status:'Confirmed',reason:''});assert.equal(noop.changed,false);assert.equal(noop.revision,'1')
 await failure(f,()=>mutate014(f,order.id,'cancel',{reason:'stale'},{revision:'0'}),/ORDER_STALE/)
 await mutate014(f,order.id,'note',{text:'Private operations note'})
 await mutate014(f,order.id,'status',{status:'Processing',reason:''})
 await failure(f,()=>mutate014(f,order.id,'status',{status:'Shipped',reason:''}),/FULFILLMENT_REQUIRED/)
 await mutate014(f,order.id,'fulfillment',{courier:'Courier',trackingNumber:'TRACK',reason:''})
 await mutate014(f,order.id,'status',{status:'Shipped',courier:'Courier',trackingNumber:'TRACK',reason:''})
 await failure(f,()=>mutate014(f,order.id,'cancel',{reason:'Too late'}),/CANCELLATION_NOT_ALLOWED/)
 await failure(f,()=>mutate014(f,order.id,'fulfillment',{courier:'Courier',trackingNumber:'CORRECTED',reason:''}),/INVALID_TRACKING/)
 await mutate014(f,order.id,'fulfillment',{courier:'Courier',trackingNumber:'CORRECTED',reason:'Correct tracking'})
 await mutate014(f,order.id,'status',{status:'Delivered',reason:''})
 assert.equal((await f.db.query('select payment_status from public.orders where id=$1',[order.id])).rows[0].payment_status,'Unpaid')
 await mutate014(f,order.id,'payment',{reference:'COD verified',reason:'Funds collected'})
 await failure(f,()=>mutate014(f,order.id,'note',{text:'Terminal note'}),/INVALID_ORDER_TRANSITION/)
})

test('Bank Transfer cancellation preserves Pending and paid fulfillment blocks cancellation without refund/coupon reversal',async t=>{
 const f=await fixture(t),id=f.normal.variant
 const {order:pending}=await create(f,[normalLine(id)],{order:{paymentMethod:'Bank Transfer'}})
 await mutate014(f,pending.id,'cancel',{reason:'Unconfirmed transfer'})
 assert.equal((await f.db.query('select payment_status from public.orders where id=$1',[pending.id])).rows[0].payment_status,'Pending')
 const {order}=await create(f,[normalLine(id)],{order:{paymentMethod:'Bank Transfer'}})
 await mutate014(f,order.id,'status',{status:'Confirmed',reason:''})
 await failure(f,()=>mutate014(f,order.id,'status',{status:'Processing',reason:''}),/PAYMENT_INCONSISTENT/)
 await mutate014(f,order.id,'payment',{reference:'BANK-VERIFIED',reason:'Bank verified'})
 await failure(f,()=>mutate014(f,order.id,'cancel',{reason:'Paid'}),/PAID_CANCELLATION_BLOCKED/)
 await mutate014(f,order.id,'status',{status:'Processing',reason:''})
 await failure(f,()=>mutate014(f,order.id,'payment',{reference:'OTHER',reason:'Changed reference'}),/PAYMENT_CONFIRMATION_CONFLICT/)
 const coupon=randomUUID();await f.db.query("insert into public.coupons(id,code,type,discount_value,status) values($1,'KEEP014','Percentage',10,'Active')",[coupon])
 const {order:discounted}=await create(f,[fixedLine(f)],{quote:{couponCode:'KEEP014'},order:{couponCode:'KEEP014'}})
 await mutate014(f,discounted.id,'cancel',{reason:'Do not reverse coupon'})
 assert.equal((await f.db.query('select used_count from public.coupons where id=$1',[coupon])).rows[0].used_count,1)
 assert.equal((await f.db.query('select count(*)::int n from public.coupon_redemptions where order_id=$1',[discounted.id])).rows[0].n,1)
 assert.equal((await f.db.query('select count(*)::int n from public.refunds')).rows[0].n,0)
})

for(const [name,sql] of [
 ['missing component','delete from public.order_item_components where order_id=$1'],
 ['multiplication mismatch','update public.order_item_components set total_physical_quantity=3 where order_id=$1'],
 ['line mismatch','update public.order_items set quantity=2 where order_id=$1'],
 ['wrong component owner','update public.order_item_components set order_id=gen_random_uuid() where order_id=$1'],
 ['wrong physical owner','update public.order_item_components set tester_product_id=gen_random_uuid() where order_id=$1'],
 ['extra component',`insert into public.order_item_components(order_id,order_item_id,tester_variant_id,tester_product_id,tester_name,sku,size,volume_ml,quantity_per_pack,total_physical_quantity,reference_unit_price,position)
 select order_id,order_item_id,gen_random_uuid(),tester_product_id,tester_name,sku,size,volume_ml,quantity_per_pack,total_physical_quantity,reference_unit_price,1 from public.order_item_components where order_id=$1`],
 ['wrong frozen quote',"update public.orders set quote_snapshot=jsonb_set(quote_snapshot,'{lines,0,name}','\"Forged\"') where id=$1"],
 ['missing placement ledger',"delete from public.inventory_movements where reference_id=$1 and reason='Order placed'"],
 ['wrong placement quantity',"update public.inventory_movements set quantity_delta=-1 where reference_id=$1 and reason='Order placed'"],
 ['extra physical ledger',"insert into public.inventory_movements(variant_id,quantity_delta,balance_after,reason,reference_type,reference_id) values(gen_random_uuid(),-1,0,'Order placed','order',$1)"],
 ['duplicate placement ledger',"insert into public.inventory_movements(variant_id,quantity_delta,balance_after,reason,reference_type,reference_id) select variant_id,quantity_delta,balance_after,reason,reference_type,reference_id from public.inventory_movements where reference_id=$1 and reason='Order placed'"],
])test('corrupted '+name+' fails atomically for cancellation and operational actions',async t=>{
 const f=await fixture(t),{order}=await create(f,[fixedLine(f)])
 await corrupt(f,sql,[order.id])
 for(const [action,payload] of [['cancel',{reason:'Corrupt'}],['status',{status:'Confirmed',reason:''}]])await failure(f,()=>mutate014(f,order.id,action,payload),/ORDER_SNAPSHOT_INCONSISTENT/)
})

test('variant and active sibling aggregate bounds are checked before stock writes',async t=>{
 const f=await fixture(t),{order}=await create(f,[normalLine(f.normal.variant)])
 await f.db.query('update public.product_variants set stock_quantity=2147483647 where id=$1',[f.normal.variant])
 await failure(f,()=>mutate014(f,order.id,'cancel',{reason:'Variant overflow'}),/INVENTORY_RESTORATION_OVERFLOW/)
 await f.db.query('update public.product_variants set stock_quantity=2147483635 where id=$1',[f.normal.variant])
 await f.db.query("insert into public.product_variants(product_id,option_value,sku,regular_price,stock_quantity) values($1,'100 ml','BOUND014',100,12)",[f.normal.product])
 await failure(f,()=>mutate014(f,order.id,'cancel',{reason:'Product aggregate overflow'}),/INVENTORY_RESTORATION_OVERFLOW/)
})

test('revision overflow and snapshot multiplication overflow have zero effects',async t=>{
 const f=await fixture(t),{order}=await create(f,[fixedLine(f)])
 await corrupt(f,'update public.order_item_components set quantity_per_pack=2147483647 where order_id=$1',[order.id])
 await failure(f,()=>mutate014(f,order.id,'cancel',{reason:'Snapshot overflow'}),/ORDER_SNAPSHOT_INCONSISTENT/)
 const {order:normal}=await create(f,[normalLine(f.normal.variant)])
 await corrupt(f,'update public.orders set revision=9223372036854775807 where id=$1',[normal.id])
 await failure(f,()=>mutate014(f,normal.id,'cancel',{reason:'Revision overflow'}),/ORDER_REVISION_OVERFLOW/)
})

test('late cancellation audit failure rolls stock, ledger, order, history and catalog revisions back',async t=>{
 const f=await fixture(t),{order}=await create(f,[fixedLine(f)])
 await f.db.exec(`create function public.fixture014_audit_failure() returns trigger language plpgsql as $$begin if new.action='order.cancel' then raise exception 'fixture014 late audit'; end if; return new; end$$;
 create trigger fixture014_audit_failure before insert on public.admin_audit_logs for each row execute function public.fixture014_audit_failure()`)
 await failure(f,()=>mutate014(f,order.id,'cancel',{reason:'Atomic late failure'}),/fixture014 late audit/)
})

test('fresh duplicate cancellation fails closed when its restoration ledger is corrupted',async t=>{
 const f=await fixture(t),{order}=await create(f,[fixedLine(f)])
 await mutate014(f,order.id,'cancel',{reason:'First cancel'})
 await corrupt(f,"delete from public.inventory_movements where reference_id=$1 and reason='Order cancelled'",[order.id])
 await failure(f,()=>mutate014(f,order.id,'cancel',{reason:'Independent duplicate'}),/ORDER_LEDGER_INCONSISTENT/)
})

test('additional Paid payment and unsupported isolation reject cancellation atomically',async t=>{
 const f=await fixture(t),{order}=await create(f,[fixedLine(f)])
 await f.db.query("insert into public.payments(order_id,provider,amount,currency,status,idempotency_key) values($1,'Bank Transfer',1,'PKR','Paid',$2)",[order.id,randomUUID()])
 await failure(f,()=>mutate014(f,order.id,'cancel',{reason:'Another payment paid'}),/PAID_CANCELLATION_BLOCKED/)
 const before=await state014(f.db);await f.db.exec('begin isolation level repeatable read')
 try{await assert.rejects(()=>mutate014(f,order.id,'cancel',{reason:'Unsupported isolation'}),/ORDER_ISOLATION_UNSUPPORTED/)}finally{await f.db.exec('rollback;reset role')}
 assert.deepEqual(await state014(f.db),before)
})

test('late history insertion failure rolls the complete cancellation back',async t=>{
 const f=await fixture(t),{order}=await create(f,[fixedLine(f)])
 await f.db.exec(`create function public.fixture014_history_failure() returns trigger language plpgsql as $$begin if new.to_status='Cancelled' then raise exception 'fixture014 late history'; end if; return new; end$$;
 create trigger fixture014_history_failure before insert on public.order_status_history for each row execute function public.fixture014_history_failure()`)
 await failure(f,()=>mutate014(f,order.id,'cancel',{reason:'Atomic history failure'}),/fixture014 late history/)
})

test('V1 Baraan lifecycle/replay/payment and cancellation stay unchanged on dispatcher 014',async t=>{
 const f=await checkedFixture(t),service=new OrdersV1Service(client014(f.db),{logger}),request=()=>confirmV1(f.db,{items:[{variantId:f.normal.variant,quantity:2}],contact:{name:'Baraan buyer',email:'baraan@example.invalid',phone:'00000000000'},shipping:{address:'Fictional Address',city:'Karachi',province:'Sindh',notes:''},paymentMethod:'Cash on Delivery',couponCode:''})
 const order=await service.create(await request()),mutation=randomUUID(),payload={status:'Confirmed',reason:''},result=await mutate014(f,order.id,'status',payload,{mutation,revision:'0'})
 const state=await state014(f.db);assert.deepEqual(await mutate014(f,order.id,'status',payload,{mutation,revision:'0'}),{...result,replayed:true});assert.deepEqual(await state014(f.db),state)
 assert.equal((await mutate014(f,order.id,'status',payload)).changed,false)
 await failure(f,()=>mutate014(f,order.id,'cancel',{reason:'Stale V1'},{revision:'0'}),/ORDER_STALE/)
 await mutate014(f,order.id,'cancel',{reason:'Restore Baraan V1'});assert.equal((await stock(f,f.normal.variant)).stock_quantity,12)
 assert.equal((await mutate014(f,order.id,'cancel',{reason:'V1 independent duplicate'})).changed,false)
 const delivered=await service.create(await request())
 for(const status of ['Confirmed','Processing','Shipped','Delivered'])await mutate014(f,delivered.id,'status',{status,reason:'',...(status==='Shipped'?{courier:'Courier',trackingNumber:'V1-TRACK'}:{})})
 assert.equal((await f.db.query('select payment_status from public.orders where id=$1',[delivered.id])).rows[0].payment_status,'Unpaid')
 await mutate014(f,delivered.id,'payment',{reference:'V1 COD',reason:'Funds collected'})
 assert.equal((await f.db.query('select payment_status from public.orders where id=$1',[delivered.id])).rows[0].payment_status,'Paid')
 assert.equal((await f.db.query('select count(*)::int n from public.order_status_history where order_id=$1',[delivered.id])).rows[0].n,5) // placement Pending + four forward transitions
})

test('arbitrary function default grants are removed and browser RLS remains closed for V2',async t=>{
 const f=await fixtureV2();t.after(()=>f.db.close())
 await f.db.exec('create role fixture014_inherited;alter default privileges for role postgres in schema public grant execute on functions to fixture014_inherited')
 await apply014(f.db)
 for(const name of ['fulfillment_v2_snapshot_014(uuid)','apply_admin_order_action_v2_014_internal(uuid,uuid,text,uuid,text,jsonb,text)','apply_admin_order_action(uuid,uuid,text,uuid,text,jsonb,text)','create_order_transaction_v2(jsonb,uuid)'])assert.equal((await f.db.query('select has_function_privilege(\'fixture014_inherited\',$1,\'execute\') allowed',['public.'+name])).rows[0].allowed,false)
 const {order}=await create(f,[fixedLine(f)])
 for(const role of ['anon','authenticated']){
  await f.db.exec('set role '+role)
  try{
   for(const table of ['orders','order_items']){
    const sql='select count(*)::int n from public.'+table+' where '+(table==='orders'?'id':'order_id')+'=$1';
    if((await f.db.query('select has_table_privilege(current_user,$1,\'select\') allowed',['public.'+table])).rows[0].allowed)assert.equal((await f.db.query(sql,[order.id])).rows[0].n,0)
    else await assert.rejects(()=>f.db.query(sql,[order.id]),/permission denied/)
   }
   await assert.rejects(()=>f.db.query('select * from public.order_item_components'),/permission denied/)
   await assert.rejects(()=>f.db.query('select public.apply_admin_order_action($1,$2,\'cancel\',$3,\'0\',\'{"reason":"Denied"}\',\'browser-014\')',[order.id,f.admin,randomUUID()]),/permission denied/)
  }finally{await f.db.exec('reset role')}
 }
})

test('014 ACL grants order capability only through service entrypoints; owner guards and V1 private body remain intact',async t=>{
 const f=await fixtureV2();t.after(()=>f.db.close())
 const body=(await f.db.query("select prosrc from pg_proc where oid='public.apply_admin_order_action_v1_013_internal(uuid,uuid,text,uuid,text,jsonb,text)'::regprocedure")).rows[0].prosrc
 assert.equal((await f.db.query("select has_function_privilege('service_role','public.create_order_transaction_v2(jsonb,uuid)','execute') allowed")).rows[0].allowed,false)
 await apply014(f.db)
 assert.equal((await f.db.query("select prosrc from pg_proc where oid='public.apply_admin_order_action_v1_013_internal(uuid,uuid,text,uuid,text,jsonb,text)'::regprocedure")).rows[0].prosrc,body)
 for(const role of ['anon','authenticated','service_role'])for(const name of ['create_order_transaction_v2(jsonb,uuid)','apply_admin_order_action(uuid,uuid,text,uuid,text,jsonb,text)','fulfillment_v2_snapshot_014(uuid)','apply_admin_order_action_v2_014_internal(uuid,uuid,text,uuid,text,jsonb,text)']){
  const external=name.startsWith('create_order_transaction_v2(')||name.startsWith('apply_admin_order_action(')
  assert.equal((await f.db.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,'public.'+name])).rows[0].allowed,role==='service_role'&&external)
 }
 const {order}=await create(f,[fixedLine(f)])
 await f.db.exec('set role service_role')
 try{await assert.rejects(()=>f.db.query("update public.orders set status='Confirmed' where id=$1",[order.id]),/V2_DIRECT_WRITE_DENIED/)
  await assert.rejects(()=>f.db.query("update public.payments set status='Paid' where order_id=$1",[order.id]),/V2_DIRECT_WRITE_DENIED/)}finally{await f.db.exec('reset role')}
 await failure(f,()=>mutate014(f,order.id,'cancel',{reason:'Forged actor'},{actor:randomUUID()}),/PERMISSION_DENIED/)
 await mutate014(f,order.id,'cancel',{reason:'Approved dispatcher'})
 const rows=(await f.db.query("select p.proowner='postgres'::regrole owner,p.prosecdef,p.proconfig,p.proacl::text acl from pg_proc p where p.proname in ('fulfillment_v2_snapshot_014','apply_admin_order_action_v2_014_internal')")).rows
 assert.ok(rows.every(r=>r.owner&&r.prosecdef&&r.proconfig.join()==='search_path=""'&&!/anon|authenticated|service_role|[,{]=X\//.test(r.acl)))
})

for(const styles of [['LF','LF'],['CRLF','CRLF'],['LF','CRLF'],['CRLF','LF']])test('014 exact install/rerun '+styles.join(' -> '),async t=>{
 const f=await fixtureV2();t.after(()=>f.db.close());await apply014(f.db,styles[0]);const before=(await f.db.query(shapeSQL)).rows[0].shape
 await apply014(f.db,styles[1]);assert.equal((await f.db.query(shapeSQL)).rows[0].shape,before)
})

test('014 populated rerun preserves V1/V2 data and rejects unknown baseline/target drift',async t=>{
 const f=await fixture(t),{order}=await create(f,[fixedLine(f)])
 // Seed the historical V1 RPC contract present at migration 014, before Release 007.
 // Current checked V1 service coverage uses checkedFixture above; do not install
 // later releases into this exact historical migration/rerun test.
 const legacy=await client014(f.db).rpc('create_order_transaction',{
  p_idempotency_key:'checkout:'+randomUUID(),p_items:[{variantId:f.normal.variant,quantity:1}],
  p_contact:{name:'Fixture Customer',email:'fixture@example.invalid',phone:'00000000000'},
  p_shipping:{address:'Fictional Address',city:'Karachi',province:'Sindh',notes:''},
  p_payment_method:'Cash on Delivery',p_coupon_code:null,p_shipping_method_id:null,p_customer_id:null,
 })
 assert.equal(legacy.error,null);assert.ok(legacy.data.id)
 await mutate014(f,order.id,'cancel',{reason:'Populated rerun'})
 const before=await state014(f.db),shape=(await f.db.query(shapeSQL)).rows[0].shape
 for(const style of ['LF','CRLF','LF']){
  await apply014(f.db,style);assert.deepEqual(await state014(f.db),before)
  assert.equal((await f.db.query(shapeSQL)).rows[0].shape,shape)
 }
 const oldValidator=await readFile(new URL('./support/fixtures/fulfillmentV2VulnerableSnapshot.sql',import.meta.url),'utf8')
 await f.db.exec('begin;'+oldValidator)
 await assert.rejects(()=>apply014(f.db),/TARGET_DRIFT/)
 assert.deepEqual(await state014(f.db),before)
 assert.equal((await f.db.query(shapeSQL)).rows[0].shape,shape)
 for(const ddl of ["grant execute on function public.fulfillment_v2_snapshot_014(uuid) to service_role","alter function public.apply_admin_order_action(uuid,uuid,text,uuid,text,jsonb,text) set search_path=public","alter table public.orders disable trigger snapshot_write_013"]){
  await f.db.exec('begin;'+ddl);await assert.rejects(()=>apply014(f.db),/TARGET_DRIFT/);assert.deepEqual(await state014(f.db),before)
 }
 const old=await fixtureV2();t.after(()=>old.db.close());await old.db.exec('alter table public.orders add column unexpected014 text')
 await assert.rejects(()=>apply014(old.db),/BASELINE_DRIFT/)
})
