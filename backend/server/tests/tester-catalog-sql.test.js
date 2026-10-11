import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test, { before,after } from 'node:test'
import { testerBaseline,applyTesterMigration,testerFixture,saveTester,savePack,productPatch,variantPatch } from './support/testerCatalogDatabase.js'

let db,admin,tester,fixed,configurable
const tables=['products','product_variants','tester_variants','tester_packs','tester_pack_components','tester_pack_allowed_variants','admin_audit_logs']
async function snapshot(database=db){return Promise.all(tables.map(async t=>(await database.query(`select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') rows from public.${t} r`)).rows[0].rows))}
async function rejected(fn,pattern){const old=await snapshot();await assert.rejects(fn,pattern);assert.deepEqual(await snapshot(),old,'failure must roll back all rows/revisions/audits')}
const packPatch=(extra={})=>{const p=productPatch(extra);delete p.price;return p}
const component=(id=tester.tester.variant_id,extra={})=>({testerVariantId:id,quantityPerPack:1,displayOrder:0,...extra})
const member=(id=tester.tester.variant_id,extra={})=>({testerVariantId:id,active:true,displayOrder:0,...extra})
async function current(id){return (await db.query('select to_jsonb(p) product,to_jsonb(d) definition from public.products p join public.tester_packs d on d.product_id=p.id where p.id=$1',[id])).rows[0]}
async function change(id,product={},definition={}){const row=await current(id);return savePack(db,admin,id,product,definition,String(row.product.catalog_revision),String(row.definition.definition_revision))}
before(async()=>{({db,admin}=await testerBaseline());await applyTesterMigration(db);tester=await testerFixture(db,admin)
 fixed=await savePack(db,admin,null,packPatch(),{mode:'fixed',fixedRegularPrice:500,components:[component()]})
 configurable=await savePack(db,admin,null,packPatch(),{mode:'configurable',allowedVariants:[member()]})})
after(async()=>{if(db)await db.close()})

for(const style of ['LF','CRLF']) test(`${style} first application and exact rerun preserve populated rows, timestamps, revisions, audits and ACLs`,async()=>{
 const fixture=await testerBaseline();try{
  const product='45852db8-8b83-425e-8d1f-4112958ed505',variant='b35b3be7-a7dd-4c70-9c14-d1a9394d4711'
  await fixture.db.query("insert into public.products(id,name,slug,sku,price,scent_family,main_image_url,bottle_size,status,active) values($1,'Baraan','baraan','RF-BAR-001',2900,'Woody','/baraan.webp','50 ml','Published',true)",[product])
  await fixture.db.query("insert into public.product_variants(id,product_id,option_value,sku,regular_price,stock_quantity) values($1,$2,'50 ml','RF-BAR-001',2900,12)",[variant,product])
  const oldProduct=(await fixture.db.query('select * from public.products where id=$1',[product])).rows[0],oldVariant=(await fixture.db.query('select * from public.product_variants where id=$1',[variant])).rows[0]
  await applyTesterMigration(fixture.db,style)
  assert.deepEqual((await fixture.db.query('select * from public.products where id=$1',[product])).rows[0],{...oldProduct,commerce_kind:'standard'})
  assert.deepEqual((await fixture.db.query('select * from public.product_variants where id=$1',[variant])).rows[0],oldVariant)
  const t=await testerFixture(fixture.db,fixture.admin),p=await savePack(fixture.db,fixture.admin,null,packPatch(),{mode:'fixed',fixedRegularPrice:999,components:[{testerVariantId:t.tester.variant_id,quantityPerPack:2,displayOrder:0}]})
  await savePack(fixture.db,fixture.admin,null,packPatch(),{mode:'configurable',allowedVariants:[{testerVariantId:t.tester.variant_id,active:true,displayOrder:3}]})
  const state=async()=>({business:await snapshot(fixture.db),acl:(await fixture.db.query("select relname,relacl,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname in ('tester_variants','tester_packs','tester_pack_components','tester_pack_allowed_variants') order by relname")).rows,functions:(await fixture.db.query("select proname,prosrc,proowner,proacl,proconfig from pg_proc where pronamespace='public'::regnamespace and proname in ('validate_tester_catalog','derive_tester_availability','sync_tester_manual_availability','save_tester_product','save_tester_pack','save_normal_collection_products') order by proname")).rows})
  await testerFixture(fixture.db,fixture.admin,{available:false});await testerFixture(fixture.db,fixture.admin,{stockQuantity:0});
  const before=await state()
  await applyTesterMigration(fixture.db,style);await applyTesterMigration(fixture.db,style==='LF'?'CRLF':'LF')
  assert.deepEqual(await state(),before)
 }finally{await fixture.db.close()}
})
test('Baraan IDs, SKU, 50 ml price and independent stock survive ordinary writer and default classification',async()=>{
 const product='45852db8-8b83-425e-8d1f-4112958ed505',variant='b35b3be7-a7dd-4c70-9c14-d1a9394d4711'
 await db.query("insert into public.products(id,name,slug,sku,price,scent_family,main_image_url,bottle_size,status,active) values($1,'Baraan','baraan','RF-BAR-001',2900,'Woody','/baraan.webp','50 ml','Published',true)",[product])
 await db.query("insert into public.product_variants(id,product_id,option_value,sku,regular_price,stock_quantity) values($1,$2,'50 ml','RF-BAR-001',2900,12)",[variant,product])
 let p=(await db.query('select * from public.products where id=$1',[product])).rows[0]
 await db.query('select public.save_catalog_product($1,$2::jsonb,null,$3)',[product,JSON.stringify({name:'Baraan'}),String(p.catalog_revision)])
 p=(await db.query('select * from public.products where id=$1',[product])).rows[0];const v=(await db.query('select * from public.product_variants where id=$1',[variant])).rows[0]
 assert.equal(p.commerce_kind,'standard');assert.equal(Number(p.price),2900);assert.equal(p.sku,'RF-BAR-001');assert.equal(v.product_id,product);assert.equal(v.option_value,'50 ml');assert.equal(Number(v.regular_price),2900);assert.equal(v.stock_quantity,12);assert.equal(p.stock_quantity,12)
})
for(const [name,sql,args] of [
 ['kind immutable',"update public.products set commerce_kind='standard' where id=$1",()=>[tester.product.id]],
 ['unknown kind',"insert into public.products(name,slug,sku,price,scent_family,main_image_url,commerce_kind) values('Invalid',$1,$1,100,'Woody','/fixture.webp','future')",()=>[randomUUID()]],
 ['standard null price',"update public.products set price=null where commerce_kind='standard'",()=>[]],
 ['tester null price',"update public.products set price=null where id=$1",()=>[tester.product.id]],
 ['pack ordinary price',"update public.products set price=1 where id=$1",()=>[fixed.product.id]],
 ['pack fake stock',"update public.products set stock_quantity=1 where id=$1",()=>[fixed.product.id]],
 ['pack physical variant',"insert into public.product_variants(product_id,option_value,sku,regular_price) values($1,'5 ml',$2,100)",()=>[fixed.product.id,randomUUID()]],
 ['registry wrong owner',"insert into public.tester_variants(variant_id,tester_product_id) values($1,$2)",()=>[tester.tester.variant_id,randomUUID()]],
 ['registry volume immutable',"update public.tester_variants set volume_ml=10 where variant_id=$1",()=>[tester.tester.variant_id]],
 ['registry identity immutable',"update public.tester_variants set tester_product_id=$2 where variant_id=$1",()=>[tester.tester.variant_id,randomUUID()]],
 ['registry self source',"update public.tester_variants set source_product_id=tester_product_id where variant_id=$1",()=>[tester.tester.variant_id]],
 ['registry nonstandard source',"update public.tester_variants set source_product_id=$2 where variant_id=$1",()=>[tester.tester.variant_id,fixed.product.id]],
 ['tester second inventory variant',"insert into public.product_variants(product_id,option_value,sku,regular_price) values($1,'10 ml',$2,100)",()=>[tester.product.id,randomUUID()]],
 ['registry duplicate variant',"insert into public.tester_variants(variant_id,tester_product_id) values($1,$2)",()=>[tester.tester.variant_id,tester.product.id]],
]) test(`${name} fails with complete rollback`,async()=>rejected(()=>db.query(sql,args())))

for(const [name,definition] of [
 ['fixed zero price',{mode:'fixed',fixedRegularPrice:0}],['fixed sale above regular',{mode:'fixed',fixedRegularPrice:500,fixedSalePrice:500}],
 ['configurable fixed price',{mode:'configurable',fixedRegularPrice:500}],['configurable minimum one',{mode:'configurable',minimumUnits:1}],
 ['configurable maximum one',{mode:'configurable',maximumUnits:1}],['published fixed empty',{mode:'fixed',fixedRegularPrice:500}],
 ['published configurable empty',{mode:'configurable'}],
])test(`${name} leaves no partial pack or audit`,async()=>rejected(()=>savePack(db,admin,null,packPatch(),definition)))
test('draft fixed pack may be empty; valid fixed and configurable shapes retain NULL legacy prices',async()=>{
 const p=await savePack(db,admin,null,packPatch({status:'Draft'}),{mode:'fixed',fixedRegularPrice:500})
 assert.equal(p.product.price,null);assert.equal(p.product.sale_price,null);assert.equal(p.product.old_price,null);assert.equal(p.product.stock_quantity,0)
 assert.equal(configurable.definition.minimum_units,2);assert.equal(configurable.definition.maximum_units,null)
})
for(const [name,definition] of [
 ['zero component',()=>({components:[component(undefined,{quantityPerPack:0})]})],
 ['negative component',()=>({components:[component(undefined,{quantityPerPack:-1})]})],
 ['non-tester component',()=>({components:[component(randomUUID())]})],
 ['duplicate membership',()=>({components:[component(),component()]})],
 ['wrong-mode allowlist',()=>({allowedVariants:[member()]})],
 ['101 memberships',()=>({components:Array.from({length:101},()=>component())})],
])test(`${name} rejects atomically`,async()=>rejected(()=>change(fixed.product.id,{},definition())))
test('wrong-mode configurable components rejected',async()=>rejected(()=>change(configurable.product.id,{}, {components:[component()]})))
test('stale catalog and definition revisions fail closed',async()=>{
 await rejected(()=>savePack(db,admin,fixed.product.id,{name:'stale'},{},'999','1'),/CATALOG_STALE/)
 const c=await current(fixed.product.id);await rejected(()=>savePack(db,admin,fixed.product.id,{name:'stale'},{},String(c.product.catalog_revision),'999'),/CATALOG_STALE/)
})
test('definition changes increment once; presentation/input order/no-op do not; snapshots remain deterministic',async()=>{
 const t2=await testerFixture(db,admin),id=fixed.product.id
 let c=await current(id),rev=Number(c.definition.definition_revision),hash=c.definition.definition_fingerprint
 let result=await change(id,{name:'Presentation-only',description:'Only copy',main_image_url:'/new.webp'})
 assert.equal(Number(result.definition.definition_revision),rev);assert.equal(result.definition.definition_fingerprint,hash)
 const before=await snapshot();await change(id,{},{});assert.deepEqual(await snapshot(),before)
 result=await change(id,{}, {components:[component(),component(t2.tester.variant_id,{quantityPerPack:2,displayOrder:1})],fixedRegularPrice:700})
 assert.equal(Number(result.definition.definition_revision),++rev);hash=result.definition.definition_fingerprint
 result=await change(id,{}, {components:[component(t2.tester.variant_id,{quantityPerPack:2,displayOrder:0}),component(undefined,{displayOrder:1})]})
 assert.equal(Number(result.definition.definition_revision),rev);assert.equal(result.definition.definition_fingerprint,hash)
 const noOp=await snapshot();await change(id,{}, {components:[component(undefined,{displayOrder:1}),component(t2.tester.variant_id,{quantityPerPack:2,displayOrder:0})]});assert.deepEqual(await snapshot(),noOp)
 for(const definition of [{fixedSalePrice:500},{manualAvailable:false},{components:[component()] }]) {result=await change(id,{},definition);assert.equal(Number(result.definition.definition_revision),++rev)}
 result=await change(id,{status:'Unpublished'},{});assert.equal(Number(result.definition.definition_revision),++rev)
})
test('allowlist active state changes purchase revision; display order does not',async()=>{
 const id=configurable.product.id,c=await current(id)
 let r=await change(id,{}, {allowedVariants:[member(undefined,{displayOrder:10})]});assert.equal(r.definition.definition_fingerprint,c.definition.definition_fingerprint)
 r=await change(id,{status:'Draft'},{allowedVariants:[member(undefined,{active:false})]});assert.equal(Number(r.definition.definition_revision),Number(c.definition.definition_revision)+1)
})
test('tester no-op, optional standard source, price and stock do not revise pack definitions',async()=>{
 const packBefore=(await current(fixed.product.id)).definition
 const t=tester,id=t.product.id
 const v=(await db.query('select * from public.product_variants where id=$1',[t.tester.variant_id])).rows[0],p=(await db.query('select * from public.products where id=$1',[id])).rows[0]
 const input=variantPatch({id:v.id,sku:v.sku,regularPrice:Number(v.regular_price),salePrice:null,stockQuantity:v.stock_quantity})
 const before=await snapshot();await saveTester(db,admin,id,{},input,null,String(p.catalog_revision));assert.deepEqual(await snapshot(),before)
 const standard=(await db.query("select id from public.products where commerce_kind='standard' limit 1")).rows[0].id
 await saveTester(db,admin,id,{price:300}, {...input,regularPrice:300,stockQuantity:7},standard,String(p.catalog_revision))
 const reg=(await db.query('select * from public.tester_variants where tester_product_id=$1',[id])).rows[0];assert.equal(reg.source_product_id,standard)
 assert.deepEqual((await current(fixed.product.id)).definition,packBefore)
})
test('normal catalog writer cannot save packs or redefine tester ownership',async()=>{
 const c=await current(fixed.product.id);await rejected(()=>db.query('select public.save_catalog_product($1,$2::jsonb,null,$3)',[fixed.product.id,'{"name":"forged"}',String(c.product.catalog_revision)]),/NORMAL_WRITER_DENIED/)
 await rejected(()=>saveTester(db,admin,null,productPatch(),variantPatch({optionValue:'50 ml'})),/TESTER_PATCH_INVALID/)
})
test('canonical active Admin and service context required; forged customer/inactive Admin denied',async()=>{
 const customer=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[customer,'synthetic@example.invalid'])
 await rejected(()=>saveTester(db,customer,null,productPatch(),variantPatch()),/PERMISSION_DENIED/)
 await db.exec("select set_config('request.jwt.claim.role','authenticated',false)")
 await rejected(()=>savePack(db,admin,null,packPatch({status:'Draft'}),{mode:'fixed',fixedRegularPrice:500}),/PERMISSION_DENIED/)
 await db.exec("select set_config('request.jwt.claim.role','service_role',false)")
 const secondAdmin=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[secondAdmin,'second-admin@example.invalid'])
 await db.query("insert into public.user_roles(user_id,role_id) select $1,id from public.roles where key='admin'",[secondAdmin])
 await db.query("update public.profiles set status='Inactive' where id=$1",[secondAdmin])
 await rejected(()=>saveTester(db,secondAdmin,null,productPatch(),variantPatch()),/PERMISSION_DENIED/)
 await db.query("update public.profiles set status='Active' where id=$1",[admin])
})
test('every new table/function has exact least privileges, postgres ownership and hardened paths',async()=>{
 for(const table of tables.filter(t=>t.startsWith('tester_'))) {
  assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass',[`public.${table}`])).rows[0].relrowsecurity,true)
  for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) {
   assert.equal((await db.query('select has_table_privilege($1,$2,$3) ok',[role,`public.${table}`,privilege])).rows[0].ok,role==='service_role'&&privilege==='SELECT',`${role} ${table} ${privilege}`)
  }
 }
 const rows=(await db.query("select p.oid,p.proname,p.prosecdef,p.proconfig,r.rolname from pg_proc p join pg_roles r on r.oid=p.proowner where p.pronamespace='public'::regnamespace and p.proname in ('save_tester_pack','save_tester_product','tester_catalog_assert_admin','tester_pack_definition_hash','tester_product_patch','validate_tester_catalog','derive_tester_availability','sync_tester_manual_availability','set_tester_updated_at','save_normal_collection_products','save_catalog_product_012_internal')")).rows
 for(const f of rows){assert.equal(f.rolname,'postgres');assert.deepEqual(f.proconfig,['search_path=""']);assert.equal(f.prosecdef,f.proname!=='set_tester_updated_at')
  for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query('select has_function_privilege($1,$2::oid,\'EXECUTE\') ok',[role,f.oid])).rows[0].ok,role==='service_role'&&['save_tester_product','save_tester_pack','save_normal_collection_products'].includes(f.proname))
 }
 await db.exec('set role anon');await assert.rejects(()=>db.query('select * from public.tester_packs'),/permission denied/);await assert.rejects(()=>db.query("insert into public.tester_packs(product_id,mode,definition_fingerprint) values(gen_random_uuid(),'fixed',repeat('0',64))"),/permission denied/);await db.exec('reset role')
 await db.exec('set role authenticated');await assert.rejects(()=>savePack(db,admin,null,packPatch({status:'Draft'}),{mode:'fixed',fixedRegularPrice:500}),/permission denied/);await db.exec('reset role')
 await db.exec('set role service_role')
 assert.ok((await db.query('select * from public.tester_packs')).rows.length>0)
 await assert.rejects(()=>db.query("update public.tester_packs set manual_available=false"),/permission denied/)
 const created=await savePack(db,admin,null,packPatch({status:'Draft'}),{mode:'fixed',fixedRegularPrice:500})
 assert.equal(created.product.commerce_kind,'tester_pack')
 await assert.rejects(()=>db.query('select public.tester_pack_definition_hash($1)',[created.product.id]),/permission denied/)
 await db.exec('reset role')
})
test('atomic normal collection replacement preserves excluded pack memberships and rejects forged pack assignment',async()=>{
 const collection=randomUUID();await db.query("insert into public.collections(id,name,slug) values($1::uuid,'Fixture',$1::text)",[collection])
 await db.query('insert into public.product_collections(product_id,collection_id) values($1,$2),($3,$2)',[tester.product.id,collection,fixed.product.id])
 await db.query('select public.save_normal_collection_products($1,$2::uuid[],$3,$4)',[collection,[],admin,'collection-fixture-request'])
 assert.deepEqual((await db.query('select product_id from public.product_collections where collection_id=$1',[collection])).rows,[{product_id:fixed.product.id}])
 await rejected(()=>db.query('select public.save_normal_collection_products($1,$2::uuid[],$3,$4)',[collection,[fixed.product.id],admin,'collection-fixture-request']))
})
test('mutated target body, constraint, policy and ACL fail closed on rerun without repairs',async()=>{
 const f=await testerBaseline();try{await applyTesterMigration(f.db)
  for(const mutation of ["grant update on public.tester_packs to service_role","grant select(mode) on public.tester_packs to anon","alter table public.tester_packs drop constraint tester_pack_mode_shape","alter policy rf_products_public_read on public.products using(true)","create or replace function public.tester_pack_definition_hash(p_id uuid) returns text language sql stable security definer set search_path='' as $$select 'mutated'::text$$","create or replace function public.validate_tester_catalog() returns trigger language plpgsql security definer set search_path='' as $$begin return null; end;$$","alter table public.products disable trigger products_tester_validate","alter table public.product_variants disable trigger variants_tester_availability","alter table public.tester_variants disable trigger registry_tester_availability"]){
   await f.db.exec('begin');await f.db.exec(mutation);await assert.rejects(()=>applyTesterMigration(f.db),/RF_TESTER_012_TARGET/);await f.db.exec('rollback')
  }
 }finally{await f.db.close()}
})
test('SQL rejects string coercion, invalid 5 ml registration and malformed membership objects atomically',async()=>{
 await rejected(()=>saveTester(db,admin,null,productPatch(),variantPatch({regularPrice:'250'})),/TESTER_PATCH_INVALID/)
 await rejected(()=>change(fixed.product.id,{}, {components:[component(undefined,{quantityPerPack:'2'})]}),/TESTER_MEMBERSHIP_INVALID/)
 await rejected(()=>change(configurable.product.id,{}, {allowedVariants:[member(undefined,{active:'false'})]}),/TESTER_MEMBERSHIP_INVALID/)
 const t=tester;const revision=String((await db.query('select catalog_revision from public.products where id=$1',[t.product.id])).rows[0].catalog_revision)
 await rejected(()=>db.query('select public.save_catalog_product($1,$2::jsonb,null,$3)',[t.product.id,'{"bottle_size":"50 ml"}',revision]),/SPECIAL_WRITER_REQUIRED/)
})
test('inactive tester no-op ignores the product aggregate alias without losing physical stock or adding audit',async()=>{
 const t=await saveTester(db,admin,null,productPatch({status:'Draft'}),variantPatch({active:false,stockQuantity:12}))
 const v=(await db.query('select * from public.product_variants where id=$1',[t.tester.variant_id])).rows[0]
 const input=variantPatch({id:v.id,sku:v.sku,active:false,stockQuantity:12})
 const old=await snapshot();await saveTester(db,admin,t.product.id,{stock_quantity:12},input,null,String(t.product.catalog_revision));assert.deepEqual(await snapshot(),old)
})
test('unknown baseline writer prevents all schema changes',async()=>{
 const f=await testerBaseline();try{await f.db.exec("create or replace function public.save_catalog_product(p_product_id uuid,p_patch jsonb,p_variants jsonb default null,p_expected_revision text default null) returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$")
  await assert.rejects(()=>applyTesterMigration(f.db),/BASELINE_WRITER/);assert.equal((await f.db.query("select to_regclass('public.tester_packs') t")).rows[0].t,null)
  assert.equal((await f.db.query("select attnotnull from pg_attribute where attrelid='public.products'::regclass and attname='price'")).rows[0].attnotnull,true)
 }finally{await f.db.close()}
})
test('unknown additional historical price constraint blocks migration and rolls back schema changes',async()=>{
 const f=await testerBaseline();try{
  await f.db.exec('alter table public.products add constraint unknown_price_rule check(price is not null)')
  await assert.rejects(()=>applyTesterMigration(f.db),/BASELINE_SHAPE/)
  assert.equal((await f.db.query("select to_regclass('public.tester_packs') t")).rows[0].t,null)
 }finally{await f.db.close()}
})

// Acceptance negatives: these exercised successful writes before the targeted fix.
for(const [name,product,variant] of [
 ['unpublished tester',{status:'Unpublished'},{}],
 ['inactive tester',{active:false},{}],
 ['inactive variant',{}, {active:false}],
]) test(`published fixed rejects ${name} with complete rollback`,async()=>{
 const t=await testerFixture(db,admin)
 if(Object.keys(product).length)await db.query('update public.products set status=coalesce($2::public.publish_status,status),active=coalesce($3::boolean,active) where id=$1',[t.product.id,product.status??null,product.active??null])
 if(Object.keys(variant).length)await db.query('update public.product_variants set active=coalesce($2::boolean,active),available=coalesce($3::boolean,available) where id=$1',[t.tester.variant_id,variant.active??null,variant.available??null])
 await rejected(()=>savePack(db,admin,null,packPatch(),{mode:'fixed',fixedRegularPrice:500,components:[component(t.tester.variant_id)]}),/TESTER_PUBLICATION_INVALID/)
})
test('published configurable rejects an active allowlist containing only an ineligible tester',async()=>{
 const t=await saveTester(db,admin,null,productPatch({status:'Unpublished'}),variantPatch())
 await rejected(()=>savePack(db,admin,null,packPatch(),{mode:'configurable',allowedVariants:[member(t.tester.variant_id)]}),/TESTER_PUBLICATION_INVALID/)
})
for(const mode of ['fixed','configurable']) test(`${mode} published dependency rejects tester lifecycle changes atomically`,async()=>{
 const t=await testerFixture(db,admin)
 await savePack(db,admin,null,packPatch(),mode==='fixed'?{mode,fixedRegularPrice:500,components:[component(t.tester.variant_id)]}:{mode,allowedVariants:[member(t.tester.variant_id)]})
 const v=(await db.query('select * from public.product_variants where id=$1',[t.tester.variant_id])).rows[0]
 const input=variantPatch({id:v.id,sku:v.sku,stockQuantity:v.stock_quantity})
 for(const patch of [{active:false},{status:'Unpublished'},{status:'Archived',active:false}])await rejected(()=>saveTester(db,admin,t.product.id,patch,input,null,String(t.product.catalog_revision)),/TESTER_PUBLICATION_INVALID/)
 for(const patch of [{active:false}])await rejected(()=>saveTester(db,admin,t.product.id,{}, {...input,...patch},null,String(t.product.catalog_revision)))
 // Direct privileged mutations must enforce the same lifecycle rule.
 await db.exec('set role service_role')
 try{await rejected(()=>db.query('update public.products set active=false where id=$1',[t.product.id]),/TESTER_PUBLICATION_INVALID/)
  await rejected(()=>db.query('update public.product_variants set active=false where id=$1',[v.id]),/TESTER_PUBLICATION_INVALID/)
 }finally{await db.exec('reset role')}
})
test('configurable repeated units need only one eligible tester; another hidden member does not invalidate it',async()=>{
 const eligible=await testerFixture(db,admin),hidden=await saveTester(db,admin,null,productPatch({status:'Unpublished'}),variantPatch())
 const p=await savePack(db,admin,null,packPatch(),{mode:'configurable',allowedVariants:[member(eligible.tester.variant_id),member(hidden.tester.variant_id,{displayOrder:1})]})
 assert.equal(p.definition.minimum_units,2)
 await rejected(()=>db.query('update public.products set active=false where id=$1',[eligible.product.id]),/TESTER_PUBLICATION_INVALID/)
})
test('configurable may deactivate one tester while another eligible active membership remains',async()=>{
 const a=await testerFixture(db,admin),b=await testerFixture(db,admin)
 const p=await savePack(db,admin,null,packPatch(),{mode:'configurable',allowedVariants:[member(a.tester.variant_id),member(b.tester.variant_id,{displayOrder:1})]})
 const before=await current(p.product.id)
 await db.query("update public.products set status='Unpublished' where id=$1",[a.product.id])
 assert.deepEqual(await current(p.product.id),before,'tester lifecycle must not silently revise the pack')
})
test('zero stock and checkout-derived unavailable flag are structurally valid for both pack modes',async()=>{
 const t=await testerFixture(db,admin)
 for(const mode of ['fixed','configurable'])await savePack(db,admin,null,packPatch(),mode==='fixed'?{mode,fixedRegularPrice:500,components:[component(t.tester.variant_id)]}:{mode,allowedVariants:[member(t.tester.variant_id)]})
 await db.query('update public.product_variants set stock_quantity=0,available=false where id=$1',[t.tester.variant_id])
 const v=(await db.query('select stock_quantity,available from public.product_variants where id=$1',[t.tester.variant_id])).rows[0]
 assert.deepEqual(v,{stock_quantity:0,available:false})
 // New publication also accepts a stock shortage; stock is not structural eligibility.
 await savePack(db,admin,null,packPatch(),{mode:'configurable',allowedVariants:[member(t.tester.variant_id)]})
})
for(const [name,sql] of [
 ['variant size',"update public.product_variants set option_value='50 ml' where id=$1"],
 ['variant option name',"update public.product_variants set option_name='Volume' where id=$1"],
 ['product bottle size',"update public.products set bottle_size='50 ml' where id=$1"],
 ['legacy size array',`update public.products set size_options='[{"label":"50 ml","value":"50 ml","price":250}]'::jsonb where id=$1`],
 ['legacy variations',`update public.products set variations='[{"name":"50 ml"}]'::jsonb where id=$1`],
 ['registry volume',"update public.tester_variants set volume_ml=50 where variant_id=$1"],
])test(`direct service ${name} edit fails and rolls back`,async()=>{
 const t=await testerFixture(db,admin)
 // Registry tables intentionally have no service DML; execute its invariant as owner too.
 if(name==='registry volume')await rejected(()=>db.query(sql,[t.tester.variant_id]),/TESTER_IDENTITY_IMMUTABLE/)
 await db.exec('set role service_role')
 try{await rejected(()=>db.query(sql,[name.startsWith('product')||name.startsWith('legacy')?t.product.id:t.tester.variant_id]),name==='registry volume'?/permission denied/:/TESTER_SIZE_INVALID/)}finally{await db.exec('reset role')}
})
test('size enforcement preserves legitimate tester edits and standard variant size edits',async()=>{
 const t=await testerFixture(db,admin)
 await db.exec('set role service_role')
 try{await db.query('update public.product_variants set regular_price=300,sale_price=200,stock_quantity=7,available=false,active=false where id=$1',[t.tester.variant_id])}finally{await db.exec('reset role')}
 const v=(await db.query('select * from public.product_variants where id=$1',[t.tester.variant_id])).rows[0]
 assert.equal(Number(v.regular_price),300);assert.equal(Number(v.sale_price),200);assert.equal(v.stock_quantity,7);assert.equal(v.available,true);assert.equal(v.active,false);assert.equal(v.option_value,'5 ml')
 const standard=(await db.query("select p.id from public.products p where p.commerce_kind='standard' and exists(select 1 from public.product_variants v where v.product_id=p.id) limit 1")).rows[0].id
 await db.query('update public.tester_variants set source_product_id=$2 where variant_id=$1',[v.id,standard])
 assert.equal((await db.query('select source_product_id from public.tester_variants where variant_id=$1',[v.id])).rows[0].source_product_id,standard)
 await db.exec('set role service_role')
 try{await db.query("update public.product_variants set option_name='Size',option_value='75 ml' where product_id=$1",[standard])}finally{await db.exec('reset role')}
 const normalVariants=(await db.query('select option_value from public.product_variants where product_id=$1',[standard])).rows
 assert.ok(normalVariants.length>0);assert.ok(normalVariants.every(row=>row.option_value==='75 ml'))
})
test('published pack cannot replace its required tester with an ineligible one',async()=>{
 const a=await testerFixture(db,admin),hidden=await saveTester(db,admin,null,productPatch({status:'Unpublished'}),variantPatch())
 const p=await savePack(db,admin,null,packPatch(),{mode:'fixed',fixedRegularPrice:500,components:[component(a.tester.variant_id)]})
 await rejected(()=>change(p.product.id,{description:'Must roll back'}, {components:[component(hidden.tester.variant_id)]}),/TESTER_PUBLICATION_INVALID/)
})
test('deliberate pack unpublication permits a later tester lifecycle edit without cascading revisions',async()=>{
 const t=await testerFixture(db,admin),p=await savePack(db,admin,null,packPatch(),{mode:'fixed',fixedRegularPrice:500,components:[component(t.tester.variant_id)]})
 const draft=await change(p.product.id,{status:'Unpublished'},{})
 assert.equal(Number(draft.definition.definition_revision),Number(p.definition.definition_revision)+1)
 await db.query('update public.products set active=false where id=$1',[t.product.id])
 assert.deepEqual(await current(p.product.id),{product:draft.product,definition:draft.definition})
})
test('tester lifecycle mutation fails closed under unsupported snapshot isolation even without known dependent packs',async()=>{
 const t=await testerFixture(db,admin),old=await snapshot()
 await db.exec('begin isolation level repeatable read')
 try{
  await db.query('update public.products set active=false where id=$1',[t.product.id])
  await assert.rejects(()=>db.exec('commit'),/TESTER_PUBLICATION_ISOLATION_UNSUPPORTED/)
 }finally{await db.exec('rollback')}
 assert.deepEqual(await snapshot(),old)
})
test('actual v1 last-unit checkout preserves valid published pack definitions while exhausting tester stock',async()=>{
 const t=await saveTester(db,admin,null,productPatch(),variantPatch({stockQuantity:1})),packs=[]
 for(const mode of ['fixed','configurable'])packs.push(await savePack(db,admin,null,packPatch(),mode==='fixed'?{mode,fixedRegularPrice:500,components:[component(t.tester.variant_id)]}:{mode,allowedVariants:[member(t.tester.variant_id)]}))
 const before=await Promise.all(packs.map(p=>current(p.product.id)))
 await db.exec("insert into public.shipping_methods(code,name,base_fee) values('tester-checkout-fixture','Tester checkout fixture',250) on conflict do nothing")
 const result=await db.query('select public.create_order_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,null,null,null) receipt',[
  `checkout:${randomUUID()}`,JSON.stringify([{variantId:t.tester.variant_id,quantity:1}]),JSON.stringify({name:'Synthetic tester customer',email:'tester-checkout@example.invalid',phone:'03001234567'}),JSON.stringify({address:'Synthetic fixture street',city:'Lahore',province:'Punjab',notes:''}),'Cash on Delivery'])
 assert.ok(result.rows[0].receipt.id)
 assert.deepEqual((await db.query('select stock_quantity,available from public.product_variants where id=$1',[t.tester.variant_id])).rows,[{stock_quantity:0,available:false}])
 assert.deepEqual(await Promise.all(packs.map(p=>current(p.product.id))),before)
 const item=(await db.query('select product_id,variant_id,size,unit_price from public.order_items where order_id=$1',[result.rows[0].receipt.id])).rows[0]
 assert.equal(item.product_id,t.product.id);assert.equal(item.variant_id,t.tester.variant_id);assert.equal(item.size,'5 ml');assert.equal(Number(item.unit_price),250)
})

test('direct stock/availability DML derives effective flags; direct registry intent synchronizes without recursion',async()=>{
 const t=await testerFixture(db,admin),id=t.tester.variant_id
 await db.query('update public.product_variants set stock_quantity=0,available=true where id=$1',[id])
 assert.deepEqual((await db.query('select stock_quantity,available from public.product_variants where id=$1',[id])).rows[0],{stock_quantity:0,available:false})
 assert.equal((await db.query('select manual_available from public.tester_variants where variant_id=$1',[id])).rows[0].manual_available,true)
 await db.query('update public.product_variants set stock_quantity=3,available=false where id=$1',[id])
 assert.equal((await db.query('select available from public.product_variants where id=$1',[id])).rows[0].available,true)
 await db.query('update public.tester_variants set manual_available=false where variant_id=$1',[id])
 await db.query('update public.product_variants set stock_quantity=7,available=true where id=$1',[id])
 assert.equal((await db.query('select available from public.product_variants where id=$1',[id])).rows[0].available,false)
 await db.query('update public.tester_variants set manual_available=true where variant_id=$1',[id])
 assert.equal((await db.query('select available from public.product_variants where id=$1',[id])).rows[0].available,true)
 await rejected(()=>db.query('update public.tester_variants set manual_available=null where variant_id=$1',[id]),/not-null/)
})

test('deferred invariant rejects inconsistent availability if synchronization is bypassed and rolls back',async()=>{
 const t=await testerFixture(db,admin),before=await snapshot()
 await db.exec('begin')
 try {
  await db.exec('alter table public.product_variants disable trigger variants_tester_availability')
  await db.query('update public.product_variants set available=false where id=$1',[t.tester.variant_id])
  await assert.rejects(()=>db.exec('commit'),/TESTER_AVAILABILITY_INVALID/)
 }finally{await db.exec('rollback')}
 assert.deepEqual(await snapshot(),before)
})

test('manual availability no-op compares registry intent even at zero stock and preserves revisions/audits',async()=>{
 const t=await testerFixture(db,admin,{stockQuantity:0})
 const v=(await db.query('select * from public.product_variants where id=$1',[t.tester.variant_id])).rows[0]
 assert.equal(v.available,false);assert.equal(t.tester.manual_available,true)
 const input=variantPatch({id:v.id,sku:v.sku,stockQuantity:0,available:true})
 const before=await snapshot();await saveTester(db,admin,t.product.id,{},input,null,String(t.product.catalog_revision))
 assert.deepEqual(await snapshot(),before)
})
