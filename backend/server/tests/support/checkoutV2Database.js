import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { testerBaseline, applyTesterMigration, testerFixture, savePack, productPatch, testerSqlClient } from './testerCatalogDatabase.js'

export const migrationURL = new URL('../../../supabase/migrations/013_tester_checkout_order_snapshots.sql', import.meta.url)
export { shapeSQL } from './catalogManifest.js'

export async function baselineV2() {
 const { db, admin } = await testerBaseline()
 await applyTesterMigration(db)
 return { db, admin }
}
export async function applyV2(db, style='LF') {
 let source=(await readFile(migrationURL,'utf8')).replaceAll('\r\n','\n')
 if(style==='CRLF') source=source.replaceAll('\n','\r\n')
 try { await db.exec(source) } catch(error) { await db.exec('rollback'); throw error }
}
export async function fixtureV2() {
 const f=await baselineV2(); await applyV2(f.db)
 const { db, admin }=f
 await db.exec("insert into public.shipping_methods(code,name,base_fee) values('v2-fixture','Fixture',250)")
 await db.exec(`insert into public.site_settings(id,payments) values('site','[{"name":"Cash on Delivery","active":true},{"name":"Bank Transfer","active":true}]') on conflict(id) do update set payments=excluded.payments`)
 f.tester=await testerFixture(db,admin)
 f.second=await testerFixture(db,admin,{regularPrice:300})
 const patch=productPatch(); delete patch.price
 f.fixed=await savePack(db,admin,null,patch,{mode:'fixed',fixedRegularPrice:450,components:[{testerVariantId:f.tester.tester.variant_id,quantityPerPack:2,displayOrder:0}]})
 const configurable=productPatch(); delete configurable.price
 f.configurable=await savePack(db,admin,null,configurable,{mode:'configurable',allowedVariants:[f.tester,f.second].map((t,displayOrder)=>({testerVariantId:t.tester.variant_id,active:true,displayOrder}))})
 f.normal={ product:'45852db8-8b83-425e-8d1f-4112958ed505',variant:'b35b3be7-a7dd-4c70-9c14-d1a9394d4711' }
 await db.query("insert into public.products(id,name,slug,sku,price,scent_family,main_image_url,status,active) values($1,'Baraan','baraan-v2','RF-BAR-001',2900,'Woody','/fixture.webp','Published',true)",[f.normal.product])
 await db.query("insert into public.product_variants(id,product_id,option_value,sku,regular_price,stock_quantity) values($1,$2,'50 ml','RF-BAR-001-50',2900,12)",[f.normal.variant,f.normal.product])
 return f
}
export const normalLine=(id,quantity=1)=>({kind:'normal_variant',variantId:id,quantity})
export const fixedLine=(f,quantity=1)=>({kind:'fixed_tester_pack',packId:f.fixed.product.id,definitionRevision:String(f.fixed.definition.definition_revision),quantity})
export const configuredLine=(f,selections=[{variantId:f.tester.tester.variant_id,quantityPerPack:2}],quantity=1)=>({kind:'configurable_tester_pack',packId:f.configurable.product.id,definitionRevision:String(f.configurable.definition.definition_revision),quantity,selections})
export const quoteRequest=lines=>({contractVersion:2,lines,shipping:{city:'Karachi',province:'Sindh'},email:'fixture@example.invalid',couponCode:''})
export async function quoteV2(db,input,customer=null) { return (await db.query('select public.quote_checkout_v2($1::jsonb,$2::uuid) result',[JSON.stringify(input),customer])).rows[0].result }
export async function requestV2(db,lines,changes={}) {
 const quoted=await quoteV2(db,{...quoteRequest(lines),...(changes.quote??{})})
 return {contractVersion:2,idempotencyKey:randomUUID(),lines,contact:{name:'Fixture Customer',email:'fixture@example.invalid',phone:'00000000000'},shipping:{address:'Fictional Address',city:'Karachi',province:'Sindh',notes:''},paymentMethod:'Cash on Delivery',couponCode:'',quoteFingerprint:quoted.quoteFingerprint,...changes.order}
}
export async function orderV2(db,input,customer=null) { return (await db.query('select public.create_order_transaction_v2($1::jsonb,$2::uuid) result',[JSON.stringify(input),customer])).rows[0].result }
export function clientV2(db) {
 const read=testerSqlClient(db)
 return {...read,async rpc(name,args) {
  if(name==='create_order_transaction') {
   await db.exec('set role service_role')
   try {return {data:(await db.query('select public.create_order_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7::uuid,$8::uuid) result',
    [args.p_idempotency_key,JSON.stringify(args.p_items),JSON.stringify(args.p_contact),JSON.stringify(args.p_shipping),args.p_payment_method,args.p_coupon_code,args.p_shipping_method_id,args.p_customer_id])).rows[0].result,error:null}}
   catch(e){return {data:null,error:{code:e.code,message:e.message}}}
   finally{await db.exec('reset role').catch(e=>{if(e.code!=='25P02')throw e})}
  }
  if(!['quote_checkout_v2','create_order_transaction_v2'].includes(name)) return read.rpc(name,args)
  try { return {data:(await db.query(`select public.${name}($1::jsonb,$2::uuid) result`,[JSON.stringify(args.p_request),args.p_customer_id])).rows[0].result,error:null} }
  catch(e) {return {data:null,error:{code:e.code,message:e.message}}}
 }}
}
