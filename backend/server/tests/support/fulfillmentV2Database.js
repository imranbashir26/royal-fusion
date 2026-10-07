import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {fixtureV2,clientV2} from './checkoutV2Database.js'
export const migration014URL=new URL('../../../supabase/migrations/014_tester_pack_fulfillment.sql',import.meta.url)
export async function apply014(db,style='LF'){
 let sql=(await readFile(migration014URL,'utf8')).replaceAll('\r\n','\n')
 if(style==='CRLF')sql=sql.replaceAll('\n','\r\n')
 try{await db.exec(sql)}catch(e){await db.exec('rollback');throw e}
}
export async function fixture014(){const f=await fixtureV2();await apply014(f.db);return f}
export async function mutate014(f,id,action,payload,options={}){
 const revision=options.revision??(await f.db.query('select revision::text revision from public.orders where id=$1',[id])).rows[0].revision
 const args=[id,options.actor??f.admin,action,options.mutation??randomUUID(),revision,JSON.stringify(payload),options.requestId??'fulfillment-014-fixture']
 await f.db.exec('set role service_role')
 try{return (await f.db.query('select public.apply_admin_order_action($1::uuid,$2::uuid,$3,$4::uuid,$5,$6::jsonb,$7) result',args)).rows[0].result}
 finally{await f.db.exec('reset role').catch(e=>{if(e.code!=='25P02')throw e})}
}
export function client014(db){
 const client=clientV2(db),old=client.rpc.bind(client)
 client.rpc=async(name,args)=>{
  if(!['create_order_transaction_v2','quote_checkout_v2','apply_admin_order_action'].includes(name))return old(name,args)
  await db.exec('set role service_role')
  try{
   const result=name==='apply_admin_order_action'
    ?await db.query('select public.apply_admin_order_action($1::uuid,$2::uuid,$3,$4::uuid,$5,$6::jsonb,$7) result',
     [args.p_order_id,args.p_actor_id,args.p_action,args.p_mutation_id,args.p_expected_revision,JSON.stringify(args.p_payload),args.p_request_id])
    :await db.query(`select public.${name}($1::jsonb,$2::uuid) result`,[JSON.stringify(args.p_request),args.p_customer_id])
   return {data:result.rows[0].result,error:null}
  }catch(e){return {data:null,error:{code:e.code,message:e.message}}}
  finally{await db.exec('reset role').catch(e=>{if(e.code!=='25P02')throw e})}
 }
 return client
}
export async function state014(db){return (await db.query(`select jsonb_build_object(
 'orders',(select jsonb_agg(to_jsonb(x) order by id) from public.orders x),
 'items',(select jsonb_agg(to_jsonb(x) order by id) from public.order_items x),
 'components',(select jsonb_agg(to_jsonb(x) order by id) from public.order_item_components x),
 'variants',(select jsonb_agg(to_jsonb(x) order by id) from public.product_variants x),
 'products',(select jsonb_agg(to_jsonb(x) order by id) from public.products x),
 'testers',(select jsonb_agg(to_jsonb(x) order by variant_id) from public.tester_variants x),
 'movements',(select jsonb_agg(to_jsonb(x) order by id) from public.inventory_movements x),
 'payments',(select jsonb_agg(to_jsonb(x) order by id) from public.payments x),
 'history',(select jsonb_agg(to_jsonb(x) order by id) from public.order_status_history x),
 'notes',(select jsonb_agg(to_jsonb(x) order by id) from public.order_notes x),
 'audits',(select jsonb_agg(to_jsonb(x) order by id) from public.admin_audit_logs x),
 'coupons',(select jsonb_agg(to_jsonb(x) order by id) from public.coupons x),
 'redemptions',(select jsonb_agg(to_jsonb(x) order by id) from public.coupon_redemptions x)) state`)).rows[0].state}
