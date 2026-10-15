import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { installVerifiedLegacyPermission, installVerifiedLegacyRevocation, verifiedLegacySessionFunctions, installVerifiedLegacySessionFunction } from './singleAdminDatabase.js'
import { installProductionCatalogMetadata } from './productionCatalogFixture.js'
import { applyV2 } from './checkoutV2Database.js'
import { apply014 } from './fulfillmentV2Database.js'
import { applyTesterMigration } from './testerCatalogDatabase.js'
import { shapeSQL } from './catalogManifest.js'
import { post014Hash } from './post014DefaultAclHardening.js'
let configuration,pg,prototype,legacyPrototype,roleSetup
export async function connection(database='postgres') {
 if(!configuration){
  assert(process.env.RF_RELEASE005_NATIVE_CONFIG,'Use scripts/test-release005-native.mjs; these are native PG17 integration tests')
  configuration=JSON.parse(await readFile(process.env.RF_RELEASE005_NATIVE_CONFIG,'utf8'))
  assert.equal(configuration.port,59705)
  assert.equal(await readFile(configuration.cluster+'/release005-owned-marker','utf8'),configuration.marker)
  pg=(await import(pathToFileURL(configuration.pgModule))).default
 }
 const db=new pg.Client({host:'127.0.0.1',port:59705,user:'postgres',password:'',database,ssl:false,options:'',connectionTimeoutMillis:10000,application_name:'rf_release005_owned_disposable'})
 await db.connect();db.exec=sql=>db.query(sql);db.close=()=>db.end()
 const row=(await db.query("select current_user,version(),current_setting('data_directory') dir,host(inet_server_addr()) host,inet_server_port() port")).rows[0]
 assert.equal(row.current_user,'postgres');assert.match(row.version,/PostgreSQL 17\./)
 assert.equal(row.dir.replaceAll('\\','/'),configuration.cluster);assert.equal(row.host,'127.0.0.1');assert.equal(row.port,59705)
 await db.query("set search_path=pg_catalog,public; set statement_timeout='90s'; select set_config('request.jwt.claim.role','service_role',false)")
 return db
}
async function apply(db,folder,name){try{await db.query(await readFile(new URL(`../../../supabase/${folder}/${name}`,import.meta.url),'utf8'))}catch(e){await db.query('rollback');throw e}}
async function initializeRoles(){
 const owner=await connection()
 try{
  const roles=(await owner.query("select rolname,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role') order by rolname")).rows
  if(!roles.length)await owner.query('create role anon;create role authenticated;create role service_role bypassrls')
  else assert.deepEqual(roles,['anon','authenticated','service_role'].map(rolname=>({rolname,rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolbypassrls:rolname==='service_role'})),'Owned cluster role drift')
 }
 finally{await owner.end()}
}
async function buildPrototype(legacy=false){
 roleSetup??=initializeRoles();await roleSetup
 const template=legacy?'rf_release005_pre013_prototype':'rf_release005_prototype'
 const owner=await connection()
 try {
  const existing=(await owner.query("select shobj_description(oid,'pg_database') marker from pg_database where datname=$1",[template])).rows[0]
  if(existing){assert.equal(existing.marker,configuration.marker+':'+template,'Owned template identity');return template}
  await owner.query('create database '+template)
 } finally { await owner.end() }
 const db=await connection(template)
 try {
  await db.query(`create schema extensions;create extension pgcrypto with schema extensions;
   create schema auth;create table auth.users(id uuid primary key,email text,phone text,raw_user_meta_data jsonb);
   create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
   create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
   grant usage on schema auth to anon,authenticated,service_role;`)
  for(const name of ['001_initial_schema.sql','002_launch_schema_foundation.sql','005_product_card_presentation.sql','009_catalog_product_variants.sql'])await apply(db,'migrations',name)
  const admin=randomUUID()
  await db.query('insert into auth.users(id,email) values($1,$2)',[admin,admin+'@example.invalid'])
  await db.query("insert into public.user_roles(user_id,role_id) select $1,id from public.roles where key='owner_admin'",[admin])
  await installVerifiedLegacyPermission(db);await installVerifiedLegacyRevocation(db)
  for(const f of verifiedLegacySessionFunctions)await installVerifiedLegacySessionFunction(db,f)
  await db.query("select set_config('royal_fusion.approved_admin_uuid',$1,false)",[admin])
  await apply(db,'release-migrations','001_single_admin_expansion.sql')
  for(const name of ['010_checkout_product_locking.sql','011_admin_order_fulfillment.sql'])await apply(db,'migrations',name)
  await apply(db,'release-migrations','002_single_admin_fulfillment.sql')
  await db.query("select set_config('royal_fusion.canonical_login_verified_for',$1,false)",[admin])
  await db.query("select set_config('royal_fusion.canonical_verification_reference','release005-disposable',false)")
  await apply(db,'release-migrations','003_single_admin_retirement.sql')
  await installProductionCatalogMetadata(db);await applyTesterMigration(db)
  if(!legacy){await applyV2(db);await apply014(db)}
  // Keep the shared fixture's eight explicit postgres owner grants unchanged.
  // They are part of the observed 20-tuple production pre-state, not fixture drift.
  // Synthetic managed defaults establish preservation, not a production fingerprint.
  await db.query(`alter default privileges for role supabase_admin in schema public grant select on tables to service_role;
   alter default privileges for role supabase_admin in schema public grant usage on sequences to service_role;
   alter default privileges for role supabase_admin in schema public grant execute on functions to service_role;`)
  await db.query("insert into public.products(id,name,slug,sku,price,scent_family,main_image_url,status,active) values('45852db8-8b83-425e-8d1f-4112958ed505','Baraan','baraan','RF-BAR-001',2900,'Woody','/synthetic.webp','Published',true)")
  await db.query("insert into public.product_variants(id,product_id,option_value,sku,regular_price,stock_quantity) values('b35b3be7-a7dd-4c70-9c14-d1a9394d4711','45852db8-8b83-425e-8d1f-4112958ed505','50 ml','RF-BAR-001-50',2900,12)")
  if(!legacy)assert.equal((await db.query(shapeSQL)).rows[0].shape,post014Hash,'Exact reviewed post-014 catalog prerequisite')
 } finally { await db.end() }
 const markerOwner=await connection()
 try{assert.match(configuration.marker,/^[0-9a-f-]{36}$/);await markerOwner.query(`comment on database ${template} is '${configuration.marker}:${template}'`)}
 finally{await markerOwner.end()}
 return template
}
export async function nativeFixture(t,{pre013=false}={}){
 // The isolated pre-013 template permits genuine historical alias creation before
 // installing the UUID fence. Never seed legacy orders through a checked writer.
 let template
 if(pre013){legacyPrototype??=buildPrototype(true);template=await legacyPrototype}
 else{prototype??=buildPrototype();template=await prototype}
 const name='rf_release005_'+randomUUID().replaceAll('-',''),owner=await connection()
 await owner.query(`create database "${name}" template ${template}`);await owner.end()
 const db=await connection(name)
 t.after(async()=>{await db.end();const owner=await connection();await owner.query(`drop database "${name}"`);await owner.end()})
 return db
}
