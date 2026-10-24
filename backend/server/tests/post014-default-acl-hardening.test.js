import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { nativeFixture, connection } from './support/release005NativeFixture.js'
import { apply005, snapshot005, release005URL, post014Hash, defaultTuplesSQL, expectedTuplesSQL, privileges, updatedTriggersSQL } from './support/post014DefaultAclHardening.js'
import { shapeSQL } from './support/catalogManifest.js'

// Independent expected tuples: do not derive acceptance solely from the SQL helper.
const ownerPrivileges = ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
const browserPrivileges = ['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
const canonical = tuples => tuples.toSorted((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1])||a[2].localeCompare(b[2])||Number(a[3])-Number(b[3]))
const ownerTuples = canonical(ownerPrivileges.map(p=>['postgres','postgres',p,false]))
const serviceTuples = canonical(browserPrivileges.map(p=>['postgres','service_role',p,false]))
const browserTuples = canonical(['anon','authenticated'].flatMap(r=>browserPrivileges.map(p=>['postgres',r,p,false])))
const expectedPreTuples = canonical([...ownerTuples,...serviceTuples,...browserTuples])
const expectedPostTuples = canonical([...ownerTuples,...serviceTuples])
const ownerSubset = tuples => tuples.filter(t=>t[1]==='postgres')
const serviceSubset = tuples => tuples.filter(t=>t[1]==='service_role')

test('Release 005 native PostgreSQL 17 integration acceptance (stop on first critical failure)', async t => {
 async function scenario(name, body) {
  let passed=false
  await t.test(name,async st=>{await body(st);passed=true})
  if(!passed)throw Error('Stopped on critical verification failure: '+name)
 }
 const source=await readFile(release005URL,'utf8')
 const pre=await readFile(new URL('../../supabase/tests/release005_pre_verification.sql',import.meta.url),'utf8')
 const post=await readFile(new URL('../../supabase/tests/release005_post_verification.sql',import.meta.url),'utf8')
 await scenario('standalone SQL contains the exact shared manifest and one narrowly scoped mutation',async()=>{
  const copy=shapeSQL.replace(' as shape',' into shape')
  assert.equal(source.split(copy).length-1,2)
  const statements=source.replace(/--[^\n]*/g,'')
  assert.doesNotMatch(statements,/revoke\s+all|\bcascade\b|alter\s+(table|function|role|event\s+trigger)|\b(insert|update|delete|truncate)\s+(into|from|public\.)/i)
  assert.equal((statements.match(/alter default privileges/gi)??[]).length,1)
  assert.match(statements,/for role postgres in schema public\s+revoke truncate,references,trigger,maintain on tables from anon,authenticated restrict/)
 })
 for(const [first,second] of [['LF','LF'],['LF','CRLF'],['CRLF','LF'],['CRLF','CRLF']])await scenario('exact baseline, eight removals, complete preservation and rerun '+first+'/'+second,async st=>{
  const db=await nativeFixture(st),before=await snapshot005(db)
  assert.equal(before.shape,post014Hash)
  assert.equal(before.defaults.length,20)
  assert.deepEqual(before.defaults,expectedPreTuples)
  assert.deepEqual(ownerSubset(before.defaults),ownerTuples)
  assert.deepEqual(serviceSubset(before.defaults),serviceTuples)
  assert.deepEqual(before.defaults,(await db.query(expectedTuplesSQL(['anon','authenticated','service_role']))).rows[0].state)
  assert.equal((await db.query(updatedTriggersSQL)).rows[0].state.length,20)
  const service=(await db.query("select count(*)::int n from pg_class where relnamespace='public'::regnamespace and relkind in('r','v') and has_table_privilege('service_role',oid,'TRUNCATE')")).rows[0].n
  assert.equal(service,39)
  await apply005(db,first)
  const after=await snapshot005(db)
  assert.equal(after.shape,before.shape);assert.equal(after.metadata,before.metadata);assert.deepEqual(after.data,before.data)
  assert.deepEqual(after.defaults,(await db.query(expectedTuplesSQL(['service_role']))).rows[0].state)
  assert.equal(after.defaults.length,12)
  assert.deepEqual(after.defaults,expectedPostTuples)
  assert.deepEqual(ownerSubset(after.defaults),ownerSubset(before.defaults))
  assert.deepEqual(serviceSubset(after.defaults),serviceSubset(before.defaults))
  assert.deepEqual(before.defaults.filter(tuple=>!after.defaults.some(other=>JSON.stringify(tuple)===JSON.stringify(other))),browserTuples)
  assert.equal(before.defaults.length-after.defaults.length,8)
  const product=after.data.products.find(p=>p.id==='45852db8-8b83-425e-8d1f-4112958ed505')
  const variant=after.data.product_variants.find(p=>p.id==='b35b3be7-a7dd-4c70-9c14-d1a9394d4711')
  assert.equal(product.stock_quantity,12);assert.equal(variant.stock_quantity,12)
  for(const table of ['orders','payments','inventory_movements','tester_variants','tester_packs','tester_pack_components','tester_pack_allowed_variants','order_item_components'])assert.equal(after.data[table].length,0)
  await apply005(db,second);assert.deepEqual(await snapshot005(db),after)
 })
 await scenario('future tables lose browser grants; service defaults and creator scoping remain',async st=>{
  const db=await nativeFixture(st)
  const future=async(name)=>{
   await db.query(`create table public.${name}(id integer,updated_at timestamptz)`)
   return (await db.query(`select r.rolname,p.name,has_table_privilege(r.oid,'public.${name}',p.name) allowed from pg_roles r cross join(values('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(name) where r.rolname in('anon','authenticated','service_role') order by 1,2`)).rows
  }
  const before=await future('release005_future_before');assert(before.every(r=>r.allowed))
  await db.query('drop table public.release005_future_before');await apply005(db)
  const after=await future('release005_future_after');assert(after.every(r=>r.allowed===(r.rolname==='service_role')))
  await db.query('set role anon');try{await assert.rejects(()=>db.query('truncate public.release005_future_after'),/permission denied/)}finally{await db.query('reset role')}
  // Other creators retain their separate defaults, and unrelated schemas never gained these grants.
  await db.query('create schema release005_other;create table release005_other.probe(id integer)')
  assert.equal((await db.query("select has_table_privilege('anon','release005_other.probe','TRUNCATE') allowed")).rows[0].allowed,false)
  await db.query('set role supabase_admin');try{await db.query('create table public.release005_managed(id integer)')}finally{await db.query('reset role')}
  assert.equal((await db.query("select has_table_privilege('service_role','public.release005_managed','SELECT') allowed")).rows[0].allowed,true)
 })
 const negatives=[
  ['partial hardening','alter default privileges for role postgres in schema public revoke trigger on tables from anon',/DEFAULT_ACL_DRIFT/],
  ['unexpected browser SELECT','alter default privileges for role postgres in schema public grant select on tables to anon',/DEFAULT_ACL_DRIFT/],
  ['unexpected PUBLIC grant','alter default privileges for role postgres in schema public grant trigger on tables to public',/DEFAULT_ACL_DRIFT/],
  // Deliberately invalid disposable states: the real fixture/release never remove owner grants.
  ['missing owner SELECT','alter default privileges for role postgres in schema public revoke select on tables from postgres',/DEFAULT_ACL_DRIFT/],
  ['owner grant option','alter default privileges for role postgres in schema public grant select on tables to postgres with grant option',/DEFAULT_ACL_DRIFT/],
  ['unexpected grantee','alter default privileges for role postgres in schema public grant trigger on tables to pg_monitor',/DEFAULT_ACL_DRIFT/],
  ['former incorrect twelve-tuple baseline','alter default privileges for role postgres in schema public revoke select,insert,update,delete,truncate,references,trigger,maintain on tables from postgres',/DEFAULT_ACL_DRIFT/],
  ['grant option','alter default privileges for role postgres in schema public grant trigger on tables to authenticated with grant option',/DEFAULT_ACL_DRIFT/],
  ['service default removed','alter default privileges for role postgres in schema public revoke trigger on tables from service_role',/DEFAULT_ACL_DRIFT/],
  ['global browser grant','alter default privileges for role postgres grant truncate on tables to anon',/GLOBAL_DEFAULT_DRIFT/],
  ['global PUBLIC grant','alter default privileges for role postgres grant references on tables to public',/GLOBAL_DEFAULT_DRIFT/],
  ['unexpected global owner ACL','alter default privileges for role postgres revoke select on tables from postgres',/GLOBAL_DEFAULT_DRIFT/],
  ['changed existing service ACL','revoke truncate on public.orders from service_role',/POST014_BASELINE_DRIFT/],
  ['changed function ACL','revoke execute on function public.set_updated_at() from public',/POST014_BASELINE_DRIFT/],
  ['changed row trigger','alter table public.categories disable trigger categories_set_updated_at',/POST014_BASELINE_DRIFT/],
  ['changed event trigger','alter event trigger ensure_rls disable',/POST014_BASELINE_DRIFT/],
  ['changed ownership','alter table public.contact_messages owner to service_role',/POST014_BASELINE_DRIFT/],
  ['missing schema','alter schema public rename to release005_missing_public',/SCHEMA_DRIFT/],
  ['schema ownership','alter schema public owner to service_role',/SCHEMA_DRIFT/],
 ]
 for(const [label,mutation,error] of negatives)await scenario('fails closed: '+label,async st=>{
  const db=await nativeFixture(st);await db.query(mutation)
  const sql="select jsonb_agg(to_jsonb(d) order by d.oid) state from pg_default_acl d",before=(await db.query(sql)).rows[0].state
  await assert.rejects(()=>apply005(db),error);assert.deepEqual((await db.query(sql)).rows[0].state,before)
 })
 await scenario('wrong execution role',async st=>{
  const db=await nativeFixture(st),before=await snapshot005(db)
  await db.query('set role service_role');try{await assert.rejects(()=>apply005(db),/POSTGRES_REQUIRED/)}finally{await db.query('reset role')}
  assert.deepEqual(await snapshot005(db),before)
 })
 await scenario('missing required role',async st=>{
  const db=await nativeFixture(st);await db.query('alter role anon rename to release005_missing_anon')
  try{await assert.rejects(()=>apply005(db),/ROLE_DRIFT/)}finally{await db.query('alter role release005_missing_anon rename to anon')}
  assert.equal((await db.query(defaultTuplesSQL)).rows[0].state.length,20)
 })
 for(const role of ['service_role','postgres','pg_maintain'])await scenario('inherited or SET privilege conflicts: '+role,async st=>{
  const db=await nativeFixture(st);await db.query(`grant ${role} to authenticated`)
  try{await assert.rejects(()=>apply005(db),/ROLE_DRIFT/)}finally{await db.query(`revoke ${role} from authenticated`)}
  assert.equal((await db.query(defaultTuplesSQL)).rows[0].state.length,20)
 })
 const rerunDrift=[
  ['owner missing','revoke select on tables from postgres'],
  ['owner grant option','grant select on tables to postgres with grant option'],
  ['service grant option','grant trigger on tables to service_role with grant option'],
  ['unexpected grantee','grant trigger on tables to pg_monitor'],
  ['partial browser return','grant trigger on tables to anon'],
  ['former incorrect four-tuple post-state','revoke select,insert,update,delete,truncate,references,trigger,maintain on tables from postgres'],
 ]
 for(const [label,mutation]of rerunDrift)await scenario('exact rerun rejects '+label,async st=>{
  const db=await nativeFixture(st);await apply005(db)
  assert.deepEqual((await db.query(defaultTuplesSQL)).rows[0].state,expectedPostTuples)
  await db.query('alter default privileges for role postgres in schema public '+mutation)
  const before=await snapshot005(db)
  await assert.rejects(()=>apply005(db),/DEFAULT_ACL_DRIFT/)
  assert.deepEqual(await snapshot005(db),before)
 })
 await scenario('schema REVOKE cannot cancel a global grant (real future-table check)',async st=>{
  const db=await nativeFixture(st)
  await db.query('alter default privileges for role postgres grant truncate on tables to anon;alter default privileges for role postgres in schema public revoke truncate on tables from anon;create table public.release005_global_probe(id integer)')
  assert.equal((await db.query("select has_table_privilege('anon','public.release005_global_probe','TRUNCATE') allowed")).rows[0].allowed,true)
  await assert.rejects(()=>apply005(db),/GLOBAL_DEFAULT_DRIFT/)
 })
 await scenario('late transaction failure rolls back all eight changes',async st=>{
  const db=await nativeFixture(st),before=await snapshot005(db)
  const injected=source.replace('-- @RELEASE005-POSTCHECK',"raise exception 'RF_RELEASE005_TEST_LATE_FAILURE';\n-- @RELEASE005-POSTCHECK")
  assert.notEqual(injected,source);await assert.rejects(()=>apply005(db,'LF',injected),/TEST_LATE_FAILURE/)
  assert.deepEqual(await snapshot005(db),before)
 })
 await scenario('non-READ-COMMITTED execution rejected without mutation',async st=>{
  const db=await nativeFixture(st),before=await snapshot005(db)
  await db.query('begin isolation level repeatable read')
  await assert.rejects(()=>apply005(db),/READ_COMMITTED_REQUIRED/)
  assert.deepEqual(await snapshot005(db),before)
 })
 for(const [label,statement,error] of [
  ['business row',"update public.products set name='Synthetic callback mutation' where id='45852db8-8b83-425e-8d1f-4112958ed505'",/BUSINESS_ROWS_CHANGED/],
  ['existing ACL','grant select on public.orders to anon',/EXISTING_CATALOG_CHANGED/],
 ])await scenario('actual DDL callback '+label+' mutation is detected and rolled back',async st=>{
  const db=await nativeFixture(st)
  // Preserve attachment identity, owner, security and config; only a disposable callback body changes.
  await db.query(`create or replace function extensions.pgrst_ddl_watch() returns event_trigger
   language plpgsql security invoker set search_path='' as $fn$begin
   if tg_tag='ALTER DEFAULT PRIVILEGES' then ${statement}; end if;end;$fn$`)
  const before=await snapshot005(db);assert.equal(before.shape,post014Hash)
  await assert.rejects(()=>apply005(db),error);assert.deepEqual(await snapshot005(db),before)
 })
 await scenario('bounded row snapshot accepts 10000, rejects 10001 before mutation; verification exposes cap',async st=>{
  const db=await nativeFixture(st)
  await db.query("insert into public.newsletter_subscribers(email) select 'synthetic-'||n||'@example.invalid' from generate_series(1,10000) n")
  await apply005(db)
  // Restore only this disposable target to its exact pre-state to test the limit.
  await db.query('alter default privileges for role postgres in schema public grant truncate,references,trigger,maintain on tables to anon,authenticated')
  await db.query("insert into public.newsletter_subscribers(email) values('synthetic-cap@example.invalid')")
  const before=await snapshot005(db);await assert.rejects(()=>apply005(db),/ROW_SCAN_CAP/);assert.deepEqual(await snapshot005(db),before)
  const result=(await db.query(pre)).rows[0].result
  assert.equal(result.checks.all_row_scans_within_cap,false)
  const row=result.business_snapshots.find(x=>x[0]==='newsletter_subscribers')
  assert.deepEqual(row.slice(1),[10001,false,null,null])
 })
 await scenario('real advisory-lock timeout leaves defaults unchanged',async st=>{
  const db=await nativeFixture(st),locker=await connection(db.database),before=await snapshot005(db)
  try{await locker.query('begin;select pg_advisory_xact_lock(5005,14005)');await assert.rejects(()=>apply005(db,'LF',source.replace("lock_timeout='5s'","lock_timeout='100ms'")),e=>e.code==='55P03')}
  finally{await locker.query('rollback');await locker.end()}
  assert.deepEqual(await snapshot005(db),before)
 })
 await scenario('real statement timeout rolls back completed default changes',async st=>{
  const db=await nativeFixture(st),before=await snapshot005(db)
  const injected=source.replace("statement_timeout='60s'","statement_timeout='200ms'").replace('-- @RELEASE005-POSTCHECK','perform pg_sleep(2);\n-- @RELEASE005-POSTCHECK')
  await assert.rejects(()=>apply005(db,'LF',injected),e=>e.code==='57014');assert.deepEqual(await snapshot005(db),before)
 })
 await scenario('set_updated_at EXECUTE is needed at trigger creation; existing triggers still run after test-only revoke',async st=>{
  const db=await nativeFixture(st)
  await db.query(`create schema release005_trigger_lab;grant usage,create on schema release005_trigger_lab to authenticated;
   create table release005_trigger_lab.existing(id integer primary key,updated_at timestamptz);
   grant select,insert,update,trigger on release005_trigger_lab.existing to authenticated;
   insert into release005_trigger_lab.existing values(1,null);`)
  await db.query('set role authenticated')
  try{await db.query('create trigger lab_updated before update on release005_trigger_lab.existing for each row execute function public.set_updated_at()')}finally{await db.query('reset role')}
  await db.query('revoke execute on function public.set_updated_at() from public,anon,authenticated,service_role')
  await db.query('set role authenticated')
  try{
   await db.query('update release005_trigger_lab.existing set updated_at=null where id=1')
   assert((await db.query('select updated_at is not null updated from release005_trigger_lab.existing')).rows[0].updated)
   await assert.rejects(()=>db.query('create trigger lab_second before update on release005_trigger_lab.existing for each row execute function public.set_updated_at()'),/permission denied for function/)
  }finally{await db.query('reset role')}
 })
 await scenario('pre/post SELECT scripts execute under READ ONLY; production fingerprint gate remains strict',async st=>{
  const db=await nativeFixture(st),before=await snapshot005(db)
  async function query(sql){await db.query('begin read only');try{return (await db.query(sql)).rows[0].result}finally{await db.query('rollback')}}
  const a=await query(pre)
  assert.equal(a.checks.baraan_fingerprints_exact,false,'Synthetic fixture rows must never be represented as exact production fingerprints')
  for(const [name,value]of Object.entries(a.checks))if(name!=='baraan_fingerprints_exact')assert.equal(value,true,name)
  assert.equal(a.overall_pass,false);assert.deepEqual(await snapshot005(db),before)
  await apply005(db);const b=await query(post)
  for(const [name,value]of Object.entries(b.checks))if(name!=='baraan_fingerprints_exact')assert.equal(value,true,name)
  for(const name of ['preserved_metadata_sha256','supabase_admin_defaults_sha256','updated_at_triggers','events','table_effective_privileges_sha256','column_effective_privileges_sha256','business_snapshots','baraan_fingerprints'])assert.deepEqual(b[name],a[name],name)
  assert.equal(b.post014_manifest_sha256,a.post014_manifest_sha256)
  assert.equal(b.postgres_public_table_default_acl.length,12);assert.equal(a.postgres_public_table_default_acl.length,20)
  assert.deepEqual(a.postgres_public_table_default_acl,expectedPreTuples)
  assert.deepEqual(b.postgres_public_table_default_acl,expectedPostTuples)
  assert.deepEqual(ownerSubset(a.postgres_public_table_default_acl),ownerSubset(b.postgres_public_table_default_acl))
  assert.deepEqual(serviceSubset(a.postgres_public_table_default_acl),serviceSubset(b.postgres_public_table_default_acl))
  assert.equal((await query(pre)).checks.exact_pre_defaults,false)
 })
})
