import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { applyRelease } from './singleAdminDatabase.js'
import { fulfillmentDatabase, sqlClient } from './fulfillmentDatabase.js'

// Disposable in-memory PostgreSQL. Never loads env/connection strings or production clients.
export async function testerBaseline() {
 const db=await fulfillmentDatabase()
 // Match Supabase's service-role RLS bypass in this disposable fixture only.
 await db.exec('alter role service_role bypassrls')
 await db.query("select set_config('royal_fusion.canonical_login_verified_for',$1,false)",[db.approvedAdminUUID])
 await db.exec("select set_config('royal_fusion.canonical_verification_reference','disposable-tester-fixture',false)")
 await applyRelease(db,'003_single_admin_retirement.sql',db.approvedAdminUUID)
 return {db,admin:db.approvedAdminUUID}
}
export async function applyTesterMigration(db,style='LF') {
 let sql=(await readFile(new URL('../../../supabase/migrations/012_tester_catalog_foundation.sql',import.meta.url),'utf8')).replaceAll('\r\n','\n')
 if(style==='CRLF')sql=sql.replaceAll('\n','\r\n')
 try {await db.exec(sql)} catch(error) {await db.exec('rollback');throw error}
}
export async function savePack(db,admin,id,product,definition,revision=null,definitionRevision=null) {
 const r=await db.query('select public.save_tester_pack($1,$2::jsonb,$3::jsonb,$4,$5,$6,$7) result',[id,JSON.stringify(product),JSON.stringify(definition),revision,definitionRevision,admin,'tester-fixture-request'])
 return r.rows[0].result
}
export async function saveTester(db,admin,id,product,variant,source=null,revision=null) {
 const r=await db.query('select public.save_tester_product($1,$2::jsonb,$3::jsonb,$4,$5,$6,$7) result',[id,JSON.stringify(product),JSON.stringify(variant),source,revision,admin,'tester-fixture-request'])
 return r.rows[0].result
}
export function productPatch(extra={}) {const id=randomUUID();return {name:'Synthetic tester',slug:id,sku:id,price:250,scent_family:'Woody',main_image_url:'/fixture.webp',status:'Published',...extra}}
export function variantPatch(extra={}) {return {optionName:'Size',optionValue:'5 ml',sku:randomUUID(),regularPrice:250,salePrice:null,stockQuantity:12,active:true,available:true,displayOrder:0,...extra}}
export async function testerFixture(db,admin,extra={}) {return saveTester(db,admin,null,productPatch(),variantPatch(extra))}
export function testerSqlClient(db) {
 const read=sqlClient(db)
 return {...read,async rpc(name,args) {
  try {
   let r
   if(name==='catalog_sale_prices_009')r=await db.query('select public.catalog_sale_prices_009($1::uuid[],$2::uuid[]) result',[args.p_variant_ids,args.p_pack_ids])
   else if(name==='save_catalog_product')r=await db.query('select public.save_catalog_product($1,$2::jsonb,$3::jsonb,$4) result',[args.p_product_id,JSON.stringify(args.p_patch),args.p_variants==null?null:JSON.stringify(args.p_variants),args.p_expected_revision??null])
   else if(name==='save_tester_pack') r=await db.query('select public.save_tester_pack($1,$2::jsonb,$3::jsonb,$4,$5,$6,$7) result',[args.p_product_id,JSON.stringify(args.p_patch),JSON.stringify(args.p_definition),args.p_expected_revision,args.p_expected_definition_revision,args.p_actor_id,args.p_request_id])
   else if(name==='save_tester_product')r=await db.query('select public.save_tester_product($1,$2::jsonb,$3::jsonb,$4,$5,$6,$7) result',[args.p_product_id,JSON.stringify(args.p_patch),JSON.stringify(args.p_variant),args.p_source_product_id,args.p_expected_revision,args.p_actor_id,args.p_request_id])
   else if(name==='save_normal_collection_products')r=await db.query('select public.save_normal_collection_products($1,$2::uuid[],$3,$4) result',[args.p_collection_id,args.p_product_ids,args.p_actor_id,args.p_request_id])
   else return read.rpc(name,args)
   return {data:r.rows[0].result,error:null}
  }catch(e){return {data:null,error:{code:e.code,message:e.message}}}
 }}
}
