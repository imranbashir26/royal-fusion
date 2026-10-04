import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { legacyAdminDatabase, applyRelease, sessionSqlClient, verifiedLegacyPermissionBody, installVerifiedLegacyPermission } from './support/singleAdminDatabase.js'
import { verifiedLegacyRevocationBody, installVerifiedLegacyRevocation } from './support/singleAdminDatabase.js'
import { verifiedLegacySessionFunctions, installVerifiedLegacySessionFunction } from './support/singleAdminDatabase.js'
import { verifiedLegacyProfileBody, installVerifiedLegacyProfile, productionShapedAdminDatabase } from './support/singleAdminDatabase.js'
import { AdminAuthorizationService } from '../services/adminAuthorizationService.js'
import { SupabaseSessionRepository } from '../services/sessionRepository.js'
import { AuthSessionService } from '../services/authSessionService.js'
import { createAuthConfig } from '../auth/config.js'

const expansion='001_single_admin_expansion.sql', retirement='003_single_admin_retirement.sql'
async function setIdentity(db,id) {
 await db.query("select set_config('fixture.user_uuid',$1,false)",[id ?? ''])
}
async function permission(db,key) {
 return (await db.query('select public.has_permission($1) allowed',[key])).rows[0].allowed
}
async function authoritySnapshot(db) {
 return (await db.query(`select
   (select jsonb_agg(to_jsonb(r) order by id) from public.roles r) roles,
   (select jsonb_agg(to_jsonb(ur) order by user_id,role_id) from public.user_roles ur) assignments,
   (select jsonb_agg(to_jsonb(rp) order by role_id,permission_id) from public.role_permissions rp) grants,
   (select jsonb_agg(to_jsonb(a) order by id) from public.admin_audit_logs a) audit,
   (select jsonb_agg(to_jsonb(pe) order by id) from public.permissions pe) permissions,
   (select to_jsonb(p) from pg_proc p where oid=to_regprocedure('public.has_permission(text)')) resolver,
   to_regclass('public.auth_bootstrap_state')::text bootstrap`)).rows[0]
}
test('actual SQL: single-admin expansion, secure sessions and verified retirement',async t=>{
 const {db,admin,customer}=await legacyAdminDatabase();t.after(()=>db.close())
 await db.exec("create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('fixture.user_uuid',true),'')::uuid$$")
 await setIdentity(db,admin)
 await db.exec('set role authenticated')
 try {
   assert.equal(await permission(db,'orders.read'),true)
   assert.equal((await db.query('select count(*)::int n from public.profiles')).rows[0].n,2)
 } finally { await db.exec('reset role') }
 await applyRelease(db,expansion,admin)
 await applyRelease(db,expansion,admin) // repeat safely, without duplicating authority/audit
 const auth=new AdminAuthorizationService(sessionSqlClient(db))
 assert.deepEqual((await auth.resolve(admin)).permissions,['*']);assert.equal((await auth.resolve(admin)).roleKey,'admin')
 assert.equal(await auth.resolve(customer),null)
 assert.equal((await db.query("select count(*)::int n from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=$1 and ur.active and r.key in ('admin','owner_admin')",[admin])).rows[0].n,2)
 assert.equal((await db.query("select count(*)::int n from public.admin_audit_logs where action='authorization.expanded'")).rows[0].n,1)
 assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='user_roles' and column_name in ('expires_at','revoked_at')")).rows[0].n,0)
 await t.test('database resolver/ownership and browser DML/operational RPC boundaries',async()=>{
   for(const [id,allowed]of [[admin,true],[customer,false]]) {
     await db.query("select set_config('fixture.user_uuid',$1,false)",[id])
     await db.exec('set role authenticated')
     try {
       for (const key of ['orders.read','orders.manage','products.manage','roles.manage','unlisted.permission']) {
         assert.equal(await permission(db,key),allowed)
       }
       assert.equal((await db.query('select count(*)::int n from public.roles')).rows[0].n>0,allowed)
       if(!allowed) assert.deepEqual((await db.query('select id from public.profiles')).rows.map(r=>r.id),[customer])
     } finally { await db.exec('reset role') }
   }
   await db.exec("select set_config('fixture.user_uuid','',false)")
   const privileges=(await db.query("select has_table_privilege('authenticated','public.user_roles','insert') i,has_table_privilege('authenticated','public.orders','update') u,has_table_privilege('anon','public.products','select') p")).rows[0]
   assert.deepEqual(privileges,{i:false,u:false,p:true})
   const rpc=(await db.query("select p.proname,has_function_privilege('authenticated',p.oid,'execute') allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('claim_application_session_refresh','release_application_session_refresh','create_order_transaction','save_catalog_product')")).rows
   assert.ok(rpc.length>=4); assert.ok(rpc.every(row=>row.allowed===false))
 })
 await t.test('overlap pins legacy authority to approved bootstrap UUID; canonical authority is independent',async()=>{
   await db.exec('begin')
   try {
     // Deliberately simulate a missing canonical assignment only inside this rolled-back fixture.
     await db.exec("alter table public.user_roles disable trigger user_roles_protect_admin; update public.user_roles set active=false where role_id=(select id from public.roles where key='admin')")
     await db.exec("insert into public.roles(key,name) values('owner','Owner'),('manager','Manager') on conflict do nothing")
     await db.exec("insert into public.role_permissions(role_id,permission_id) select r.id,p.id from public.roles r cross join public.permissions p where r.key<>'admin' and p.key='*' on conflict do nothing")
     await db.query("insert into public.user_roles(user_id,role_id) select $1,id from public.roles where key<>'admin'",[customer])
     // Runtime GUC spoofing cannot change the immutable approved fallback identity.
     await db.query("select set_config('royal_fusion.approved_admin_uuid',$1,true)",[customer])
     for (const [id,allowed] of [[admin,true],[customer,false],[randomUUID(),false]]) {
       await setIdentity(db,id)
       await db.exec('set role authenticated')
       try {
         assert.equal(await permission(db,'orders.read'),allowed)
         assert.equal(await permission(db,'products.manage'),allowed)
         if(id===admin) assert.equal((await db.query('select count(*)::int n from public.profiles')).rows[0].n,2)
       } finally { await db.exec('reset role') }
     }
     await setIdentity(db,admin)
     await db.query("update public.user_roles set active=false where user_id=$1 and role_id=(select id from public.roles where key='owner_admin')",[admin])
     await setIdentity(db,admin)
     assert.equal(await permission(db,'orders.read'),false)
   } finally { await db.exec('rollback'); await setIdentity(db,null) }
   await db.exec('begin')
   try {
     await db.exec("update public.user_roles set active=false where role_id=(select id from public.roles where key='owner_admin')")
     await setIdentity(db,admin)
     assert.equal(await permission(db,'orders.read'),true)
     assert.equal(await permission(db,'products.manage'),true)
   } finally { await db.exec('rollback'); await setIdentity(db,null) }
 })
 await t.test('session creation, restoration, refresh and service-only leases',async()=>{
   const identity={id:admin,email:'fixture@example.invalid',emailVerified:true,assuranceLevel:'aal2'}
   const result={identity,accessToken:'opaque-access',refreshToken:'opaque-refresh',accessExpiresAt:new Date(Date.now()+60000).toISOString()}
   const config=createAuthConfig({NODE_ENV:'test',CUSTOMER_AUTH_PROVIDER:'supabase',ADMIN_AUTH_PROVIDER:'supabase',AUTH_CSRF_SECRET:'x'.repeat(40),AUTH_CALLBACK_URL:'https://api.example.invalid/api/v1/auth/verify/callback'})
   const service=new AuthSessionService({config,repository:new SupabaseSessionRepository(sessionSqlClient(db)),gateway:{verifyAccessToken:async()=>({identity}),refresh:async()=>result}})
   const session=await service.createSession(result,{sessionClass:'administrator'})
   assert.equal((await service.restore(session,{requireMfa:true})).identity.id,admin)
   assert.equal((await service.refresh(session)).identity.id,admin)
   const acl=(await db.query("select has_function_privilege('anon','public.claim_application_session_refresh(text,text,timestamptz,integer)','execute') a,has_function_privilege('authenticated','public.claim_application_session_refresh(text,text,timestamptz,integer)','execute') b")).rows[0]
   assert.deepEqual(acl,{a:false,b:false})
 })
 await t.test('last-admin assignment, role, wildcard and profile protections',async()=>{
   for(const sql of ["update public.user_roles set active=false where role_id=(select id from public.roles where key='admin')","update public.roles set active=false where key='admin'","delete from public.role_permissions where role_id=(select id from public.roles where key='admin')",`update public.profiles set status='Inactive' where id='${admin}'`, `delete from public.profiles where id='${admin}'`]) await assert.rejects(db.exec(sql),/RF_/)
 })
 await t.test('retirement refuses missing verification and preserves authority',async()=>{
   await assert.rejects(applyRelease(db,retirement,admin),/RF_CANONICAL_VERIFICATION_REQUIRED/)
   assert.ok(await auth.resolve(admin))
   await db.query("select set_config('royal_fusion.canonical_login_verified_for',$1,false)",[admin])
   await db.exec("select set_config('royal_fusion.canonical_verification_reference','reviewed-local-fixture',false)")
   await applyRelease(db,retirement,admin)
   await applyRelease(db,retirement,admin)
   assert.equal((await db.query("select count(*)::int n from public.admin_audit_logs where action='authorization.retired'")).rows[0].n,1)
   assert.ok(await auth.resolve(admin))
   const body=(await db.query("select prosrc from pg_proc where oid='public.has_permission(text)'::regprocedure")).rows[0].prosrc
   assert.ok(body.includes("r.key='admin'"));assert.ok(!body.includes('owner_admin'));assert.ok(!body.includes('auth_bootstrap_state'))
   await db.exec('begin')
   try {
     await setIdentity(db,admin)
     await db.exec("alter table public.user_roles disable trigger user_roles_protect_admin; update public.user_roles set active=false where role_id=(select id from public.roles where key='admin'); update public.roles set active=true where key='owner_admin'; insert into public.role_permissions(role_id,permission_id) select r.id,p.id from public.roles r cross join public.permissions p where r.key='owner_admin' and p.key='*'")
     await db.query("update public.user_roles set active=true where user_id=$1 and role_id=(select id from public.roles where key='owner_admin')",[admin])
     assert.equal(await permission(db,'orders.read'),false)
   } finally { await db.exec('rollback');await setIdentity(db,null) }
   await setIdentity(db,admin)
   await db.exec('set role authenticated')
   try { assert.equal(await permission(db,'orders.read'),true);assert.equal(await permission(db,'products.manage'),true) }
   finally { await db.exec('reset role');await setIdentity(db,null) }
   assert.equal((await db.query("select count(*)::int n from public.roles where key<>'admin' and active")).rows[0].n,0)
   assert.equal((await db.query("select count(*)::int n from public.role_permissions rp join public.roles r on r.id=rp.role_id where r.key<>'admin'")).rows[0].n,0)
 })
})

test('actual SQL: expansion rejects unexpected identity/authority atomically',async t=>{
 for(const [name,prepare,approved] of [
  ['zero legacy assignment',async({db})=>db.exec('delete from public.user_roles'),x=>x.admin],
  ['two legacy assignments',async({db,customer})=>db.query("insert into public.user_roles(user_id,role_id) select $1,id from public.roles where key='owner_admin'",[customer]),x=>x.admin],
  ['inactive profile',async({db,admin})=>db.query("update public.profiles set status='Inactive' where id=$1",[admin]),x=>x.admin],
  ['wrong UUID',async()=>{},()=>randomUUID()],
  ['unexpected canonical admin',async({db,customer})=>db.exec("insert into public.roles(key,name) values('admin','Admin'); insert into public.user_roles(user_id,role_id) select '"+customer+"',id from public.roles where key='admin'"),x=>x.admin],
  ['incompatible session table',async({db})=>db.exec('create table public.application_sessions(id uuid primary key)'),x=>x.admin],
  ['unknown permission helper',async({db})=>db.exec("create or replace function public.has_permission(required_permission text) returns boolean language sql stable security definer set search_path='' as $$ select true $$"),x=>x.admin],
  ['failure after resolver replacement',async({db})=>db.exec("create or replace function public.protect_profile_identity_fields() returns trigger language plpgsql security definer set search_path='' as $$begin return new; end;$$"),x=>x.admin],
  ['conflicting bootstrap',async({db,customer})=>db.exec(`create table public.auth_bootstrap_state(id text,completed_by uuid); insert into public.auth_bootstrap_state values('first_admin','${customer}')`),x=>x.admin],
 ]) await t.test(name,async()=>{
   const fixture=await legacyAdminDatabase();try{await prepare(fixture);const before=await authoritySnapshot(fixture.db);await assert.rejects(applyRelease(fixture.db,expansion,approved(fixture)),/RF_/); assert.deepEqual(await authoritySnapshot(fixture.db),before); assert.equal((await fixture.db.query("select count(*)::int n from public.roles where key='admin'")).rows[0].n,name==='unexpected canonical admin'?1:0)}finally{await fixture.db.close()}
 })
})

test('011 correction changes only authorization and keeps historical migration intact',async()=>{
 const original=await readFile(new URL('../../supabase/migrations/011_admin_order_fulfillment.sql',import.meta.url),'utf8')
 const corrected=await readFile(new URL('../../supabase/release-migrations/002_single_admin_fulfillment.sql',import.meta.url),'utf8')
 const body=s=>s.match(/create or replace function public.apply_admin_order_action[\s\S]*?\$\$;/)[0].replace(/\r\n/g,'\n')
 const expected=body(original).replace(/\n    and ur.revoked_at is null and \(ur.expires_at is null or ur.expires_at > now\(\)\)/,'')
  .replace("and r.key in ('owner','manager','order_manager','content_editor','blog_writer')","and r.key='admin'").replace("and pe.key in ('*',permission)","and pe.key='*'")
 assert.equal(body(corrected),expected)
})

test('optional assignment lifecycle columns survive and do not participate in single Admin authority',async t=>{
 const {db,admin}=await legacyAdminDatabase();t.after(()=>db.close())
 await db.exec('alter table public.user_roles add column revoked_at timestamptz; alter table public.user_roles add column expires_at timestamptz')
 await applyRelease(db,expansion,admin)
 await db.query("update public.user_roles set expires_at='2000-01-01T00:00:00Z',revoked_at='2000-01-01T00:00:00Z' where user_id=$1 and role_id=(select id from public.roles where key='admin')",[admin])
 assert.deepEqual((await new AdminAuthorizationService(sessionSqlClient(db)).resolve(admin)).permissions,['*'])
 assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name='user_roles' and column_name in ('expires_at','revoked_at')")).rows[0].n,2)
})


test('actual SQL: permission compatibility rejects unexpected attributes and rolls back all authority',async t=>{
 for(const [name,sql] of [
  ['SECURITY INVOKER',"alter function public.has_permission(text) security invoker"],
  ['STRICT',"alter function public.has_permission(text) strict"],
  ['LEAKPROOF',"alter function public.has_permission(text) leakproof"],
  ['parallel safety',"alter function public.has_permission(text) parallel safe"],
  ['VOLATILE',"alter function public.has_permission(text) volatile"],
  ['IMMUTABLE',"alter function public.has_permission(text) immutable"],
  ['search path',"alter function public.has_permission(text) set search_path='public'"],
  ['owner',"create role unexpected_owner; alter function public.has_permission(text) owner to unexpected_owner"],
  ['anon execution',"grant execute on function public.has_permission(text) to anon"],
  ['PUBLIC execution',"grant execute on function public.has_permission(text) to public"],
  ['authenticated execution missing',"revoke execute on function public.has_permission(text) from authenticated"],
  ['service execution missing',"revoke execute on function public.has_permission(text) from service_role"],
  ['wrong language',"create or replace function public.has_permission(required_permission text) returns boolean language plpgsql stable security definer set search_path='' as $$begin return true; end;$$"],
  ['wrong result',"drop function public.has_permission(text) cascade; create function public.has_permission(required_permission text) returns text language sql stable security definer set search_path='' as $$select 'yes'::text$$"],
  ['set result',"drop function public.has_permission(text) cascade; create function public.has_permission(required_permission text) returns setof boolean language sql stable security definer set search_path='' as $$select true$$"],
  ['wrong argument name',"drop function public.has_permission(text) cascade; create function public.has_permission(other text) returns boolean language sql stable security definer set search_path='' as $$select true$$"],
  ['default argument',"create or replace function public.has_permission(required_permission text default '') returns boolean language sql stable security definer set search_path='' as $$select true$$"],
  ['missing function',"drop function public.has_permission(text) cascade"],
 ]) await t.test(name,async()=>{
   const {db,admin}=await legacyAdminDatabase()
   try {
     await db.exec(sql)
     const before=await authoritySnapshot(db)
     await assert.rejects(applyRelease(db,expansion,admin),/RF_INCOMPATIBLE_FUNCTION: has_permission/)
     assert.deepEqual(await authoritySnapshot(db),before)
   } finally { await db.close() }
 })
})

test('actual SQL: retirement refuses unknown resolver without retiring legacy authority',async t=>{
 const {db,admin}=await legacyAdminDatabase();t.after(()=>db.close())
 await applyRelease(db,expansion,admin)
 await db.query("select set_config('royal_fusion.canonical_login_verified_for',$1,false)",[admin])
 await db.exec("select set_config('royal_fusion.canonical_verification_reference','reviewed-local-fixture',false)")
 await db.exec("create or replace function public.has_permission(required_permission text) returns boolean language sql stable security definer set search_path='' as $$select true$$")
 const before=await authoritySnapshot(db)
 await assert.rejects(applyRelease(db,retirement,admin),/RF_INCOMPATIBLE_FUNCTION: has_permission/)
 assert.deepEqual(await authoritySnapshot(db),before)
})


// Extract reviewed bodies/guards from the actual release SQL, never an approximate resolver copy.
async function reviewedPermissionDefinitions() {
 const sql=await Promise.all([expansion,retirement].map(name=>readFile(new URL('../../supabase/release-migrations/'+name,import.meta.url),'utf8')))
 const extract=source=>{
   const guard=source.match(/do \$permission_install\$[\s\S]*?\$permission_install\$;/)[0]
   const body=tag=>guard.match(new RegExp('\\$'+tag+'\\$([\\s\\S]*?)\\$'+tag+'\\$'))[1].replaceAll('\r\n','\n').trim()
   return {guard,source:body('verified_source'),target:body('expected')}
 }
 const [expand,retire]=sql.map(extract)
 assert.equal(expand.source,verifiedLegacyPermissionBody.replaceAll('\r\n','\n').trim())
 assert.equal(expand.target,retire.source)
 assert.ok(!expand.guard.includes('replace(p.prosrc'))
 assert.ok(!retire.guard.includes('replace(p.prosrc'))
 return {expand,retire}
}
async function permitFixtureRetirement(db,admin) {
 await db.query("select set_config('royal_fusion.canonical_login_verified_for',$1,false)",[admin])
 await db.exec("select set_config('royal_fusion.canonical_verification_reference','reviewed-local-fixture',false)")
}

test('actual SQL: exact LF, CRLF and outer-whitespace legacy/overlap/final bodies accepted',async t=>{
 const {expand,retire}=await reviewedPermissionDefinitions()
 for(const [name,format] of [
   ['LF',body=>body],
   ['CRLF',body=>body.replaceAll('\n','\r\n')],
   ['outer whitespace',body=>' \t\r\n'+body.replaceAll('\n','\r\n')+'\r\n\t '],
 ]) await t.test(name,async()=>{
   const {db,admin}=await legacyAdminDatabase()
   try {
     await installVerifiedLegacyPermission(db,format(expand.source))
     await applyRelease(db,expansion,admin)
     assert.equal((await db.query("select count(*)::int n from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=$1 and ur.active and r.key in ('admin','owner_admin')",[admin])).rows[0].n,2)
     await installVerifiedLegacyPermission(db,format(expand.target))
     await applyRelease(db,expansion,admin)
     await db.exec(expand.guard.replaceAll('\n','\r\n')) // reviewed guard source itself may use CRLF
     assert.equal((await db.query("select prosrc from pg_proc where oid='public.has_permission(text)'::regprocedure")).rows[0].prosrc,format(expand.target))
     assert.equal((await db.query("select count(*)::int n from public.admin_audit_logs where action='authorization.expanded'")).rows[0].n,1)
     await permitFixtureRetirement(db,admin)
     await applyRelease(db,retirement,admin)
     assert.equal((await db.query("select prosrc from pg_proc where oid='public.has_permission(text)'::regprocedure")).rows[0].prosrc.trim(),retire.target)
     await installVerifiedLegacyPermission(db,format(retire.target))
     await applyRelease(db,retirement,admin)
     await db.exec(retire.guard.replaceAll('\n','\r\n'))
     assert.equal((await db.query("select prosrc from pg_proc where oid='public.has_permission(text)'::regprocedure")).rows[0].prosrc,format(retire.target))
     assert.equal((await db.query("select count(*)::int n from public.admin_audit_logs where action='authorization.retired'")).rows[0].n,1)
   } finally {await db.close()}
 })
})

test('actual SQL: legacy semantic/literal CR differences fail closed with no expansion effects',async t=>{
 const {expand}=await reviewedPermissionDefinitions()
 const {db,admin}=await legacyAdminDatabase();t.after(()=>db.close())
 // The legacy definition has no role-key literals; those cases inject an additional role predicate.
 for(const [name,body] of [
   ['CR in wildcard',expand.source.replace("permissions.key = '*'","permissions.key = '*\r'")],
   ['CRLF inside wildcard',expand.source.replace("permissions.key = '*'","permissions.key = '*\r\n'")],
   ['CR in injected admin literal',expand.source.replace('and roles.active',"and roles.active and roles.key='admin\r'")],
   ['CR in injected owner_admin literal',expand.source.replace('and roles.active',"and roles.active and roles.key='owner_admin\r'")],
   ['changed wildcard',expand.source.replace("permissions.key = '*'","permissions.key = 'orders.read'")],
   ['changed OR to AND',expand.source.replace('or permissions.key','and permissions.key')],
   ['removed active assignment',expand.source.replace('and user_roles.active','and true')],
   ['mixed LF/CRLF',expand.source.replace('\n','\r\n')],
 ]) await t.test(name,async()=>{
   assert.notEqual(body,expand.source)
   await installAlteredPermission(db,body)
   const before=await authoritySnapshot(db)
   await assert.rejects(applyRelease(db,expansion,admin),/RF_INCOMPATIBLE_FUNCTION: has_permission/)
   assert.deepEqual(await authoritySnapshot(db),before)
   assert.equal(before.bootstrap,null)
   assert.ok(before.roles.every(role=>role.key!=='admin'))
   assert.ok(!before.audit?.some(row=>row.action==='authorization.expanded'))
 })
})

async function installAlteredPermission(db,body) {
 // Simulate even invalid definitions stored with creation-time validation disabled.
 // This setting is local to the disposable fixture and restored before migration execution.
 await db.exec('set check_function_bodies=off')
 try { await installVerifiedLegacyPermission(db,body) }
 finally { await db.exec('reset check_function_bodies') }
}
function alteredReviewedBodies(body) {
 const cases=[
   ['CR in wildcard',body.replace("pe.key='*'","pe.key='*\r'")],
   ['CRLF inside wildcard',body.replace("pe.key='*'","pe.key='*\r\n'")],
   ['CR in admin',body.replace("r.key='admin'","r.key='admin\r'")],
   ['changed role key',body.replace("r.key='admin'","r.key='manager'")],
   ['changed wildcard',body.replace("pe.key='*'","pe.key='orders.read'")],
   ['missing active profile',body.replace("and pr.status='Active'",'')],
   ['CR in Active',body.replace("pr.status='Active'","pr.status='Active\r'")],
   ['AND changed to OR',body.replace('and ur.active','or ur.active')],
   ['additional role',body.replace("r.key='admin'","r.key in ('admin','order_manager')")],
   ['mixed LF/CRLF',body.replace('\n','\r\n')],
 ]
 if(body.includes('owner_admin')) cases.push(
   ['CR in owner_admin',body.replace("r.key='owner_admin'","r.key='owner_admin\r'")],
   ['CR in both role keys',body.replace("r.key='admin'","r.key='admin\r'").replace("r.key='owner_admin'","r.key='owner_admin\r'")],
   ['CR in bootstrap identity',body.replace("boot.id='first_admin'","boot.id='first_admin\r'")],
   ['overlap OR changed to AND',body.replace("r.key='admin' or", "r.key='admin' and")],
 )
 return cases
}

test('actual SQL: changed overlap rejected by expansion reruns and retirement atomically',async t=>{
 const {expand}=await reviewedPermissionDefinitions()
 const {db,admin}=await legacyAdminDatabase();t.after(()=>db.close())
 await applyRelease(db,expansion,admin)
 await permitFixtureRetirement(db,admin)
 for(const [name,body] of alteredReviewedBodies(expand.target)) await t.test(name,async()=>{
   assert.notEqual(body,expand.target)
   await installAlteredPermission(db,body)
   const before=await authoritySnapshot(db)
   for(const migration of [expansion,retirement]) {
     await assert.rejects(applyRelease(db,migration,admin),/RF_INCOMPATIBLE_FUNCTION: has_permission/)
     assert.deepEqual(await authoritySnapshot(db),before)
   }
   assert.ok(!before.audit.some(row=>row.action==='authorization.retired'))
 })
})

test('actual SQL: changed final resolver rejected by retirement reruns atomically',async t=>{
 const {retire}=await reviewedPermissionDefinitions()
 const {db,admin}=await legacyAdminDatabase();t.after(()=>db.close())
 await applyRelease(db,expansion,admin)
 await permitFixtureRetirement(db,admin)
 await applyRelease(db,retirement,admin)
 for(const [name,body] of alteredReviewedBodies(retire.target)) await t.test(name,async()=>{
   assert.notEqual(body,retire.target)
   await installAlteredPermission(db,body)
   const before=await authoritySnapshot(db)
   await assert.rejects(applyRelease(db,retirement,admin),/RF_INCOMPATIBLE_FUNCTION: has_permission/)
   assert.deepEqual(await authoritySnapshot(db),before)
 })
})


test('actual SQL: byte-exact 496-byte production prosrc and supplied metadata expand successfully',async t=>{
 const {db,admin}=await legacyAdminDatabase();t.after(()=>db.close())
 const production=(await db.query("select p.*,l.lanname,pg_get_userbyid(p.proowner) owner_name from pg_proc p join pg_language l on l.oid=p.prolang where p.oid='public.has_permission(text)'::regprocedure")).rows[0]
 assert.equal(production.prosrc,verifiedLegacyPermissionBody)
 assert.equal(Buffer.byteLength(production.prosrc,'utf8'),496)
 assert.equal(production.prosrc.length,496)
 assert.equal(createHash('md5').update(production.prosrc).digest('hex'),'4af18d82cf4aa911ff5a11eb02caa7fa')
 assert.equal((production.prosrc.match(/\r/g)||[]).length,12)
 assert.equal((production.prosrc.match(/\n/g)||[]).length,12)
 assert.ok(production.prosrc.startsWith('\r\n  select exists (\r\n    select 1'))
 assert.ok(production.prosrc.endsWith('\r\n  );\r\n'))
 assert.deepEqual({language:production.lanname,owner:production.owner_name,securityDefiner:production.prosecdef,
   volatility:production.provolatile,strict:production.proisstrict,leakproof:production.proleakproof,
   parallel:production.proparallel,support:production.prosupport,configuration:production.proconfig},
   {language:'sql',owner:'postgres',securityDefiner:true,volatility:'s',strict:false,leakproof:false,
    parallel:'u',support:'-',configuration:['search_path=""']})
 const acl=(await db.query("select proacl::text raw_acl,has_function_privilege('anon',oid,'EXECUTE') anon,has_function_privilege('authenticated',oid,'EXECUTE') authenticated,has_function_privilege('service_role',oid,'EXECUTE') service_role from pg_proc where oid='public.has_permission(text)'::regprocedure")).rows[0]
 assert.deepEqual(acl,{raw_acl:'{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}',anon:false,authenticated:true,service_role:true})
 await applyRelease(db,expansion,admin)
 await applyRelease(db,expansion,admin)
 assert.equal((await db.query("select count(*)::int n from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=$1 and ur.active and r.key in ('admin','owner_admin')",[admin])).rows[0].n,2)
 assert.equal((await db.query("select count(*)::int n from public.auth_bootstrap_state where id='first_admin' and completed_by=$1",[admin])).rows[0].n,1)
 assert.equal((await db.query("select count(*)::int n from public.admin_audit_logs where action='authorization.expanded'")).rows[0].n,1)
 assert.deepEqual((await new AdminAuthorizationService(sessionSqlClient(db)).resolve(admin)).permissions,['*'])
})

async function reviewedRevocationDefinition() {
 const source=await readFile(new URL('../../supabase/release-migrations/'+expansion,import.meta.url),'utf8')
 const guard=source.match(/do \$function_install\$[\s\S]*?\$function_install\$;/g)
   .find(block=>block.includes("to_regprocedure('public.require_session_revocation()')"))
 const body=tag=>guard.match(new RegExp('\\$'+tag+'\\$([\\s\\S]*?)\\$'+tag+'\\$'))[1].replaceAll('\r\n','\n').trim()
 assert.ok(guard.includes("installed_body:=btrim(p.prosrc,E' \\t\\r\\n')"))
 assert.ok(!guard.includes('replace(p.prosrc'))
 assert.equal(body('previous_0'),verifiedLegacyRevocationBody.replaceAll('\r\n','\n').trim())
 return {guard,legacy:body('previous_0'),target:body('expected')}
}

test('actual SQL: byte-exact 113-byte production revocation body expands and keeps deletion blocked',async t=>{
 const {db,admin}=await legacyAdminDatabase();t.after(()=>db.close())
 const installed=(await db.query("select p.prosrc,p.prosecdef,p.proconfig,p.provolatile,p.proisstrict,p.proleakproof,p.proparallel,p.prosupport,l.lanname,pg_get_userbyid(p.proowner) owner,p.proacl::text acl from pg_proc p join pg_language l on l.oid=p.prolang where p.oid='public.require_session_revocation()'::regprocedure")).rows[0]
 assert.equal(installed.prosrc,verifiedLegacyRevocationBody)
 assert.equal(installed.prosrc.length,113)
 assert.equal(Buffer.byteLength(installed.prosrc,'utf8'),113)
 assert.equal(createHash('md5').update(installed.prosrc).digest('hex'),'53cb5ceeea8d08e90f859710176b854b')
 assert.equal((installed.prosrc.match(/\r/g)||[]).length,6)
 assert.equal((installed.prosrc.match(/\n/g)||[]).length,6)
 assert.ok(installed.prosrc.startsWith('\r\nbegin\r\n  raise exception using\r\n'))
 assert.ok(installed.prosrc.endsWith('\r\nend;\r\n'))
 const {prosrc,...attributes}=installed
 assert.deepEqual(attributes,{prosecdef:true,proconfig:['search_path=""'],provolatile:'v',proisstrict:false,
   proleakproof:false,proparallel:'u',prosupport:'-',lanname:'plpgsql',owner:'postgres',acl:'{postgres=X/postgres}'})
 assert.deepEqual((await db.query("select has_function_privilege('anon','public.require_session_revocation()','EXECUTE') anon,has_function_privilege('authenticated','public.require_session_revocation()','EXECUTE') authenticated,has_function_privilege('service_role','public.require_session_revocation()','EXECUTE') service_role")).rows[0],{anon:false,authenticated:false,service_role:false})
 await applyRelease(db,expansion,admin)
 await applyRelease(db,expansion,admin)
 assert.equal((await db.query("select count(*)::int n from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=$1 and ur.active and r.active and r.key in ('admin','owner_admin')",[admin])).rows[0].n,2)
 assert.equal((await db.query("select count(*)::int n from public.auth_bootstrap_state where id='first_admin' and completed_by=$1",[admin])).rows[0].n,1)
 assert.equal((await db.query("select count(*)::int n from public.admin_audit_logs where action='authorization.expanded'")).rows[0].n,1)
 assert.deepEqual((await new AdminAuthorizationService(sessionSqlClient(db)).resolve(admin)).permissions,['*'])
 await db.exec('create temporary table revocation_probe(id integer); insert into revocation_probe values(1); create trigger revocation_probe_delete before delete on revocation_probe for each row execute function public.require_session_revocation()')
 await assert.rejects(db.exec('delete from revocation_probe'),error=>error.code==='23514' && error.message==='RF_SESSION_REVOCATION_REQUIRED')
 assert.equal((await db.query('select count(*)::int n from revocation_probe')).rows[0].n,1)
})

test('actual SQL: reviewed revocation legacy/target LF, CRLF and outer whitespace are repeatable',async t=>{
 const {guard,legacy,target}=await reviewedRevocationDefinition()
 const {db}=await legacyAdminDatabase();t.after(()=>db.close())
 for(const [name,format] of [
   ['LF',body=>body],['CRLF',body=>body.replaceAll('\n','\r\n')],
   ['outer whitespace',body=>' \t\r\n'+body.replaceAll('\n','\r\n')+'\r\n\t '],
 ]) for(const [kind,body] of [['legacy',legacy],['target',target]]) await t.test(kind+' '+name,async()=>{
   await installVerifiedLegacyRevocation(db,format(body))
   await db.exec(guard)
   const first=(await db.query("select prosrc from pg_proc where oid='public.require_session_revocation()'::regprocedure")).rows[0].prosrc
   assert.equal(first.replaceAll('\r\n','\n').trim(),target)
   if(kind==='target') assert.equal(first,format(body))
   await db.exec(guard.replaceAll('\r\n','\n').replaceAll('\n','\r\n'))
   assert.equal((await db.query("select prosrc from pg_proc where oid='public.require_session_revocation()'::regprocedure")).rows[0].prosrc,first)
 })
})

test('actual SQL: revocation semantic and internal-character mutations roll back expansion',async t=>{
 const {db,admin}=await legacyAdminDatabase();t.after(()=>db.close())
 for(const [name,body] of [
   ['different SQLSTATE',verifiedLegacyRevocationBody.replace('23514','23505')],
   ['different message',verifiedLegacyRevocationBody.replace('RF_SESSION_REVOCATION_REQUIRED','RF_OTHER_MESSAGE')],
   ['missing exception','\r\nbegin\r\n  return new;\r\nend;\r\n'],
   ['authority-changing statement',verifiedLegacyRevocationBody.replace('begin','begin\r\n  update public.user_roles set active = false;')],
   ['extra statement',verifiedLegacyRevocationBody.replace('begin','begin\r\n  perform 1;')],
   ['CR inside message',verifiedLegacyRevocationBody.replace('RF_SESSION_REVOCATION_REQUIRED','RF_SESSION_REVOCATION_REQUIRED\r')],
   ['mixed internal line endings',verifiedLegacyRevocationBody.replace('using\r\n','using\n')],
   ['internal whitespace',verifiedLegacyRevocationBody.replace('  raise','   raise')],
 ]) await t.test(name,async()=>{
   assert.notEqual(body,verifiedLegacyRevocationBody)
   await installVerifiedLegacyRevocation(db,body)
   const before=await authoritySnapshot(db)
   const resolverBefore=(await db.query("select to_jsonb(p) value from pg_proc p where p.oid='public.require_session_revocation()'::regprocedure")).rows[0].value
   await assert.rejects(applyRelease(db,expansion,admin),/RF_INCOMPATIBLE_FUNCTION: require_session_revocation/)
   assert.deepEqual(await authoritySnapshot(db),before)
   assert.deepEqual((await db.query("select to_jsonb(p) value from pg_proc p where p.oid='public.require_session_revocation()'::regprocedure")).rows[0].value,resolverBefore)
   assert.equal(before.bootstrap,null)
   assert.ok(before.roles.every(role=>role.key!=='admin'))
   assert.ok(!before.audit?.some(row=>row.action==='authorization.expanded'))
 })
})

const absentSingleAdminFunctions=['protect_profile_identity_fields','protect_admin_role_assignment',
 'protect_admin_role_definition','protect_admin_permission_bundle','protect_auth_bootstrap_state',
 'protect_admin_audit_log','protect_guest_order_claim','write_auth_security_audit']
async function reviewedSessionCompatibility() {
 const source=await readFile(new URL('../../supabase/release-migrations/'+expansion,import.meta.url),'utf8')
 return verifiedLegacySessionFunctions.map(spec=>{
   const guard=source.match(/do \$function_install\$[\s\S]*?\$function_install\$;/g)
     .find(block=>block.includes("to_regprocedure('public."+spec.name+'('))
   const body=tag=>guard.match(new RegExp('\\$'+tag+'\\$([\\s\\S]*?)\\$'+tag+'\\$'))[1].replaceAll('\r\n','\n').trim()
   assert.ok(guard.includes("installed_body:=btrim(p.prosrc,E' \\t\\r\\n')"))
   assert.ok(!guard.includes('replace(p.prosrc'))
   assert.equal(body('verified_source'),spec.body.replaceAll('\r\n','\n').trim())
   return {...spec,guard,legacy:body('verified_source'),target:body('expected')}
 })
}
async function sessionCompatibilitySnapshot(db) {
 const names=[...verifiedLegacySessionFunctions.map(spec=>spec.name),...absentSingleAdminFunctions]
 return {authority:await authoritySnapshot(db),
   functions:(await db.query("select to_jsonb(p) value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1::text[]) order by p.proname",[names])).rows,
   tables:(await db.query("select to_regclass('public.application_sessions')::text sessions,to_regclass('public.guest_order_claims')::text claims")).rows[0]}
}

test('actual SQL: session compatibility installs all three byte-exact production baselines and expands twice',async t=>{
 const {db,admin}=await legacyAdminDatabase();t.after(()=>db.close())
 const missing=(await db.query("select to_regprocedure('public.'||name||'()')::text value from unnest($1::text[]) names(name)",[absentSingleAdminFunctions])).rows
 assert.ok(missing.every(row=>row.value===null))
 for(const spec of verifiedLegacySessionFunctions) await t.test(spec.name,async()=>{
   const installed=(await db.query("select p.prosrc,p.prorettype::regtype::text result,l.lanname language,p.prosecdef security_definer,p.proconfig configuration,p.provolatile volatility,pg_get_userbyid(p.proowner) owner,p.proacl::text acl,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') service_role from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=$1::regprocedure",['public.'+spec.name+'('+spec.types+')'])).rows[0]
   assert.equal(installed.prosrc,spec.body)
   assert.equal(installed.prosrc.length,spec.length)
   assert.equal(Buffer.byteLength(installed.prosrc,'utf8'),spec.length)
   assert.equal(createHash('md5').update(installed.prosrc).digest('hex'),spec.md5)
   assert.equal((installed.prosrc.match(/\r/g)||[]).length,spec.lines)
   assert.equal((installed.prosrc.match(/\n/g)||[]).length,spec.lines)
   assert.ok(installed.prosrc.startsWith('\r\ndeclare\r\n'))
   assert.ok(installed.prosrc.endsWith('\r\nend;\r\n'))
   const {prosrc,...attributes}=installed
   assert.deepEqual(attributes,{result:spec.result,language:'plpgsql',security_definer:true,
     configuration:['search_path=""'],volatility:'v',owner:'postgres',
     acl:spec.service?'{postgres=X/postgres,service_role=X/postgres}':'{postgres=X/postgres}',
     anon:false,authenticated:false,service_role:spec.service})
 })
 await applyRelease(db,expansion,admin)
 await applyRelease(db,expansion,admin)
 assert.equal((await db.query("select count(*)::int n from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=$1 and ur.active and r.active and r.key in ('admin','owner_admin')",[admin])).rows[0].n,2)
 assert.equal((await db.query("select count(*)::int n from public.auth_bootstrap_state where id='first_admin' and completed_by=$1",[admin])).rows[0].n,1)
 assert.equal((await db.query("select count(*)::int n from public.admin_audit_logs where action='authorization.expanded'")).rows[0].n,1)
 assert.deepEqual((await new AdminAuthorizationService(sessionSqlClient(db)).resolve(admin)).permissions,['*'])
 assert.ok((await db.query("select to_regprocedure('public.'||name||'()')::text value from unnest($1::text[]) names(name)",[absentSingleAdminFunctions])).rows.every(row=>row.value!==null))
})

test('actual SQL: session compatibility accepts only reviewed legacy/target LF, CRLF and outer whitespace',async t=>{
 const definitions=await reviewedSessionCompatibility()
 const {db}=await legacyAdminDatabase();t.after(()=>db.close())
 for(const spec of definitions) for(const [name,format] of [
   ['LF',body=>body],['CRLF',body=>body.replaceAll('\n','\r\n')],
   ['outer whitespace',body=>' \t\r\n'+body.replaceAll('\n','\r\n')+'\r\n\t '],
 ]) for(const [kind,body] of [['legacy',spec.legacy],['target',spec.target]]) await t.test(spec.name+' '+kind+' '+name,async()=>{
   await installVerifiedLegacySessionFunction(db,spec,format(body))
   await db.exec(spec.guard)
   const first=(await db.query('select prosrc from pg_proc where oid=$1::regprocedure',['public.'+spec.name+'('+spec.types+')'])).rows[0].prosrc
   assert.equal(first.replaceAll('\r\n','\n').trim(),spec.target)
   if(kind==='target') assert.equal(first,format(body))
   await db.exec(spec.guard.replaceAll('\r\n','\n').replaceAll('\n','\r\n'))
   assert.equal((await db.query('select prosrc from pg_proc where oid=$1::regprocedure',['public.'+spec.name+'('+spec.types+')'])).rows[0].prosrc,first)
 })
})

function sessionCompatibilityMutations(spec) {
 const change=(from,to)=>spec.body.replace(from,()=>to)
 if(spec.name==='claim_application_session_refresh') return [
   ['hash regex',change("'^[0-9a-f]{64}$'","'^[0-9a-f]{32}$'")],
   ['lease lower bound',change('p_lease_seconds < 5','p_lease_seconds < 1')],
   ['lease upper bound',change('p_lease_seconds > 120','p_lease_seconds > 121')],
   ['revoked condition',change('and revoked_at is null','and true')],
   ['idle expiry',change('and idle_expires_at > p_now','and true')],
   ['absolute expiry',change('and absolute_expires_at > p_now','and true')],
   ['refresh lease logic',change('refresh_locked_until <= p_now','refresh_locked_until >= p_now')],
   ['extra statement',change('begin\r\n','begin\r\n  perform 1;\r\n')],
   ['mixed line endings',change('  set\r\n','  set\n')],
   ['CR inside literal',change("'^[0-9a-f]{64}$'","'^[0-9a-f]{64}$\r'")],
 ]
 if(spec.name==='release_application_session_refresh') return [
   ['lock-hash match',change('and refresh_lock_hash = p_lock_hash','and true')],
   ['session-key condition',change('where session_key_hash = p_session_key_hash','where session_key_hash <> p_session_key_hash')],
   ['update target',change('update public.application_sessions','update public.profiles')],
   ['extra statement',change('begin\r\n','begin\r\n  perform 1;\r\n')],
   ['internal whitespace',change('  set\r\n','   set\r\n')],
   ['mixed line endings',change('  set\r\n','  set\n')],
 ]
 return [
   ['event action',change('session.created','session.updated')],
   ['revoked transition',change('and old.revoked_at is null','and old.revoked_at is not null')],
   ['audit target',change('public.admin_audit_logs','public.profiles')],
   ['resource name',change("'application_sessions'","'profiles'")],
   ['metadata behavior',change("jsonb_build_object('operation', tg_op)","'{}'::jsonb")],
   ['extra statement',change('begin\r\n','begin\r\n  perform 1;\r\n')],
   ['mixed line endings',change('  event_action text;\r\n','  event_action text;\n')],
 ]
}

test('actual SQL: session compatibility rejects semantic mutations and rolls back all expansion effects',async t=>{
 const {db,admin}=await legacyAdminDatabase();t.after(()=>db.close())
 for(const spec of verifiedLegacySessionFunctions) {
   for(const [name,body] of sessionCompatibilityMutations(spec)) await t.test(spec.name+' '+name,async()=>{
     assert.notEqual(body,spec.body)
     await db.exec('set check_function_bodies=off')
     try {await installVerifiedLegacySessionFunction(db,spec,body)} finally {await db.exec('reset check_function_bodies')}
     const before=await sessionCompatibilitySnapshot(db)
     await assert.rejects(applyRelease(db,expansion,admin),new RegExp('RF_INCOMPATIBLE_FUNCTION: '+spec.name))
     assert.deepEqual(await sessionCompatibilitySnapshot(db),before)
     assert.equal(before.authority.bootstrap,null)
     assert.ok(before.authority.roles.every(role=>role.key!=='admin'))
     assert.ok(!before.authority.audit?.some(row=>row.action==='authorization.expanded'))
   })
   await installVerifiedLegacySessionFunction(db,spec)
 }
})

test('actual SQL: session compatibility preserves refresh leases and security events without heartbeat noise',async t=>{
 const {db,admin,customer}=await legacyAdminDatabase();t.after(()=>db.close())
 await applyRelease(db,expansion,admin)
 const epoch=new Date('2030-01-01T00:00:00Z').getTime(),time=seconds=>new Date(epoch+seconds*1000).toISOString()
 const key='a'.repeat(64),lock='b'.repeat(64),other='c'.repeat(64)
 const id=(await db.query("insert into public.application_sessions(user_id,session_class,created_at,last_seen_at,idle_expires_at,absolute_expires_at,session_key_hash) values($1,'customer',$2::timestamptz,$2::timestamptz,$3::timestamptz,$4::timestamptz,$5) returning id",[customer,time(0),time(3600),time(7200),key])).rows[0].id
 const evidence=async()=> (await db.query("select action,count(*)::int n from public.admin_audit_logs where resource='application_sessions' and resource_id=$1 group by action order by action",[id])).rows
 const claim=async(sessionKey,lockKey,seconds=15,now=0)=>(await db.query('select public.claim_application_session_refresh($1,$2,$3::timestamptz,$4) value',[sessionKey,lockKey,time(now),seconds])).rows[0].value
 const release=async(sessionKey,lockKey)=>(await db.query('select public.release_application_session_refresh($1,$2) value',[sessionKey,lockKey])).rows[0].value
 assert.deepEqual(await evidence(),[{action:'session.created',n:1}])
 for(const [sessionKey,lockKey,seconds] of [['bad',lock,15],[key,'bad',15],[key,lock,4],[key,lock,121]]) assert.equal(await claim(sessionKey,lockKey,seconds),false)
 assert.equal(await claim(key,lock),true)
 assert.equal(await claim(key,other),false)
 assert.equal(await release(other,lock),false)
 assert.equal(await release(key,other),false)
 assert.equal(await release(key,lock),true)
 assert.deepEqual((await db.query('select refresh_lock_hash,refresh_locked_until from public.application_sessions where id=$1',[id])).rows[0],{refresh_lock_hash:null,refresh_locked_until:null})
 assert.equal(await claim(key,other),true)
 assert.equal(await claim(key,lock,15,16),true)
 assert.equal(await release(key,lock),true)
 await db.query('update public.application_sessions set last_seen_at=$2::timestamptz where id=$1',[id,time(1)])
 assert.deepEqual(await evidence(),[{action:'session.created',n:1}])
 await db.query("update public.application_sessions set revoked_at=$2::timestamptz,revoked_by=$3,revocation_reason='fixture' where id=$1",[id,time(2),admin])
 assert.equal(await claim(key,lock,15,2),false)
 await db.query("update public.application_sessions set revocation_reason='fixture repeated' where id=$1",[id])
 assert.deepEqual(await evidence(),[{action:'session.created',n:1},{action:'session.revoked',n:1}])
 assert.deepEqual((await db.query("select metadata from public.admin_audit_logs where resource_id=$1 and action='session.revoked'",[id])).rows[0].metadata,{operation:'UPDATE'})
})

const profileTriggerTargets=[
 ['application_sessions','application_sessions_prevent_delete','require_session_revocation',11],
 ['application_sessions','application_sessions_security_audit','write_application_session_security_audit',21],
 ['profiles','profiles_protect_restricted_fields','protect_profile_identity_fields',27],
 ['user_roles','user_roles_protect_admin','protect_admin_role_assignment',31],
 ['roles','roles_protect_admin','protect_admin_role_definition',27],
 ['role_permissions','role_permissions_protect_admin_bundle','protect_admin_permission_bundle',27],
 ['permissions','permissions_protect_admin_wildcard','protect_admin_permission_bundle',27],
 ['auth_bootstrap_state','auth_bootstrap_state_immutable','protect_auth_bootstrap_state',27],
 ['guest_order_claims','guest_order_claims_protect','protect_guest_order_claim',19],
 ['user_roles','user_roles_security_audit','write_auth_security_audit',29],
 ['guest_order_claims','guest_order_claims_security_audit','write_auth_security_audit',17],
 ['admin_audit_logs','admin_audit_logs_immutable','protect_admin_audit_log',27],
]
const lineEndingForms={LF:sql=>sql.replaceAll('\r\n','\n'),CRLF:sql=>sql.replaceAll('\r\n','\n').replaceAll('\n','\r\n')}
async function profileCompatibilitySource() {
 const source=await readFile(new URL('../../supabase/release-migrations/'+expansion,import.meta.url),'utf8')
 const guard=source.match(/do \$old_guard\$[\s\S]*?\$old_guard\$;/g).find(block=>block.includes("tgrelid='public.profiles'"))
 const known=tag=>guard.match(new RegExp('\\$'+tag+'\\$([\\s\\S]*?)\\$'+tag+'\\$'))[1]
 const historical=await readFile(new URL('../../supabase/migrations/003_auth_schema_hardening.sql',import.meta.url),'utf8')
 const historicalProfile=historical.match(/create or replace function public\.protect_profile_identity_fields\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/)[1]
 assert.equal(lineEndingForms.LF(known('known0')).trim(),lineEndingForms.LF(verifiedLegacyProfileBody).trim())
 assert.equal(lineEndingForms.LF(known('known1')).trim(),lineEndingForms.LF(historicalProfile).trim())
 return {source,guard,known0:verifiedLegacyProfileBody,known1:historicalProfile}
}
async function applyProfileCompatibilitySource(db,source,admin) {
 await db.query("select set_config('royal_fusion.approved_admin_uuid',$1,false)",[admin])
 try {await db.exec(source)} catch(error) {await db.exec('rollback');throw error}
}
async function profileCompatibilitySnapshot(db) {
 return {authority:await authoritySnapshot(db),
   functions:(await db.query("select to_jsonb(p) value from pg_proc p where pronamespace='public'::regnamespace order by oid")).rows,
   triggers:(await db.query("select to_jsonb(t) value from pg_trigger t where tgrelid in ('public.profiles'::regclass,'public.application_sessions'::regclass) order by oid")).rows,
   sessions:(await db.query('select to_jsonb(s) value from public.application_sessions s order by id')).rows}
}

test('actual SQL: profile compatibility retains known0/known1 for LF and CRLF migration input',async t=>{
 const {guard,known0,known1}=await profileCompatibilitySource()
 const {db}=await legacyAdminDatabase();t.after(()=>db.close())
 assert.equal(verifiedLegacyProfileBody.length,244)
 assert.equal(Buffer.byteLength(verifiedLegacyProfileBody),244)
 assert.equal(createHash('md5').update(verifiedLegacyProfileBody).digest('hex'),'14e130fd608e482e2dceb1b79c40b6a6')
 assert.equal((verifiedLegacyProfileBody.match(/\r/g)||[]).length,10)
 assert.equal((verifiedLegacyProfileBody.match(/\n/g)||[]).length,10)
 const installTrigger=()=>db.exec(`create trigger profiles_protect_restricted_fields before update on public.profiles
   for each row execute function public.protect_profile_restricted_fields()`)
 for(const [inputName,input] of Object.entries(lineEndingForms)) {
   for(const [bodyName,body] of [['known0',known0],['known1',known1]]) {
     for(const [formatName,format] of [...Object.entries(lineEndingForms),['outer whitespace',sql=>' \t\r\n'+lineEndingForms.CRLF(sql).trim()+'\r\n\t ']]) {
       await t.test(inputName+' migration / '+bodyName+' '+formatName,async()=>{
         await installVerifiedLegacyProfile(db,format(body))
         await db.exec(input(guard))
         assert.equal((await db.query("select count(*)::int n from pg_trigger where tgrelid='public.profiles'::regclass and tgname='profiles_protect_restricted_fields'")).rows[0].n,0)
         assert.equal((await db.query("select prosrc from pg_proc where oid='public.protect_profile_restricted_fields()'::regprocedure")).rows[0].prosrc,format(body))
         await installTrigger()
       })
     }
   }
 }
 // Preserve the pre-existing canonical function-name acceptance path on reruns.
 for(const [inputName,input] of Object.entries(lineEndingForms)) await t.test(inputName+' canonical name retained',async()=>{
   await db.exec(`drop trigger profiles_protect_restricted_fields on public.profiles;
     create or replace function public.protect_profile_identity_fields() returns trigger language plpgsql as $$begin return new;end;$$;
     create trigger profiles_protect_restricted_fields before update on public.profiles
       for each row execute function public.protect_profile_identity_fields()`)
   await db.exec(input(guard))
   await installTrigger()
 })
})

function profileCompatibilityMutations(body,known1=false) {
 const change=(from,to)=>{assert.ok(body.includes(from));return body.replace(from,()=>to)}
 return known1 ? [
   ['changed owner role',change("r.key = 'owner'","r.key = 'manager'")],
   ['removed protected field',change('      or new.email is distinct from old.email\r\n','')],
   ['changed status protection',change('new.status is distinct from old.status','new.status is not distinct from old.status')],
   ['changed return',change('return new;','return old;')],
   ['extra SQL',change('begin\r\n','begin\r\n  perform 1;\r\n')],
   ['internal whitespace',change('  remaining_owners bigint;','   remaining_owners bigint;')],
   ['mixed line endings',change('declare\r\n','declare\n')],
   ['CR inside literal',change("'Active'","'Active\r'")],
 ] : [
   ['changed permission',change('customers.manage','roles.manage')],
   ['removed protected field',change('    new.email := old.email;\r\n','')],
   ['changed status assignment',change('new.status := old.status','new.status := new.status')],
   ['changed return',change('return new;','return old;')],
   ['extra SQL',change('begin\r\n','begin\r\n  perform 1;\r\n')],
   ['internal whitespace',change('    new.id := old.id;','     new.id := old.id;')],
   ['mixed line endings',change('begin\r\n','begin\n')],
   ['CR inside literal',change("'customers.manage'","'customers.manage\r'")],
 ]
}
test('actual SQL: profile compatibility rejects mutations and rolls back LF/CRLF full expansion',async t=>{
 const {source,known0,known1}=await profileCompatibilitySource()
 const {db,admin}=await productionShapedAdminDatabase();t.after(()=>db.close())
 for(const [bodyName,body] of [['known0',known0],['known1',known1]]) {
   for(const [mutationName,mutated] of profileCompatibilityMutations(lineEndingForms.CRLF(body),bodyName==='known1')) {
     for(const [inputName,input] of Object.entries(lineEndingForms)) await t.test(inputName+' '+bodyName+' '+mutationName,async()=>{
       await installVerifiedLegacyProfile(db,mutated)
       const before=await profileCompatibilitySnapshot(db)
       await assert.rejects(applyProfileCompatibilitySource(db,input(source),admin),/RF_UNEXPECTED_EXISTING_GUARD: profiles_protect_restricted_fields/)
       assert.deepEqual(await profileCompatibilitySnapshot(db),before)
       assert.equal(before.authority.bootstrap,null)
       assert.ok(before.authority.roles.every(role=>role.key!=='admin'))
       assert.ok(!before.authority.audit?.some(row=>row.action==='authorization.expanded'))
     })
   }
 }
})

test('actual SQL: profile compatibility full production-shaped LF/CRLF expansion and rerun preserve sessions',async t=>{
 const {source}=await profileCompatibilitySource()
 for(const [inputName,input] of Object.entries(lineEndingForms)) await t.test(inputName+' complete migration and rerun',async t=>{
   const {db,admin}=await productionShapedAdminDatabase();t.after(()=>db.close())
   const sql=input(source)
   assert.ok(inputName==='LF'?!sql.includes('\r'):!sql.replaceAll('\r\n','').includes('\n'))
   const before=await profileCompatibilitySnapshot(db)
   assert.equal(before.sessions.length,10)
   assert.equal((await db.query("select prosrc from pg_proc where oid='public.protect_profile_restricted_fields()'::regprocedure")).rows[0].prosrc,verifiedLegacyProfileBody)
   for(const [signature,body] of [['has_permission(text)',verifiedLegacyPermissionBody],['require_session_revocation()',verifiedLegacyRevocationBody],
     ...verifiedLegacySessionFunctions.map(spec=>[spec.name+'('+spec.types+')',spec.body])]) {
     assert.equal((await db.query('select prosrc from pg_proc where oid=$1::regprocedure',['public.'+signature])).rows[0].prosrc,body)
   }
   const oldTrigger=(await db.query("select oid,tgtype,tgenabled,tgnargs,octet_length(tgargs) args_bytes,tgqual::text qual,tgfoid='public.protect_profile_restricted_fields()'::regprocedure bound from pg_trigger where tgrelid='public.profiles'::regclass and tgname='profiles_protect_restricted_fields'")).rows[0]
   assert.deepEqual({...oldTrigger,oid:0},{oid:0,tgtype:19,tgenabled:'O',tgnargs:0,args_bytes:0,qual:null,bound:true})
   const allNames=[...profileTriggerTargets.slice(3).map(row=>row[1]),'user_roles_protect_owner','roles_protect_owner','role_permissions_protect_owner_bundle','permissions_protect_owner_wildcard']
   assert.equal((await db.query("select count(*)::int n from pg_trigger where not tgisinternal and tgname=any($1::text[])",[allNames])).rows[0].n,0)
   for(const name of absentSingleAdminFunctions) assert.equal((await db.query("select to_regprocedure($1)::text value",['public.'+name+'()'])).rows[0].value,null)
   await db.exec("create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('fixture.user_uuid',true),'')::uuid$$")
   await setIdentity(db,admin)
   const fingerprint=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex')
   const verify=async()=>{
     const sessions=(await db.query('select to_jsonb(s) value from public.application_sessions s order by id')).rows
     assert.deepEqual(sessions,before.sessions);assert.equal(fingerprint(sessions),fingerprint(before.sessions))
     assert.equal((await db.query("select count(*)::int n from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=$1 and ur.active and r.active and r.key in ('admin','owner_admin')",[admin])).rows[0].n,2)
     assert.equal((await db.query("select completed_by from public.auth_bootstrap_state where id='first_admin'")).rows[0].completed_by,admin)
     assert.equal((await db.query("select count(*)::int n from public.admin_audit_logs where action='authorization.expanded'")).rows[0].n,1)
     assert.equal(await permission(db,'unlisted.permission'),true)
     assert.deepEqual((await new AdminAuthorizationService(sessionSqlClient(db)).resolve(admin)).permissions,['*'])
     for(const [table,name,func,type] of profileTriggerTargets) {
       const trigger=(await db.query("select tgtype,tgenabled,tgnargs,octet_length(tgargs) args_bytes,tgqual::text qual,tgfoid=$3::regprocedure bound from pg_trigger where tgrelid=$1::regclass and tgname=$2 and not tgisinternal",['public.'+table,name,'public.'+func+'()'])).rows[0]
       assert.deepEqual(trigger,{tgtype:type,tgenabled:'O',tgnargs:0,args_bytes:0,qual:null,bound:true},name)
     }
     for(const name of ['require_session_revocation','write_application_session_security_audit']) {
       const initial=before.functions.find(row=>row.value.proname===name).value
       assert.equal(String((await db.query('select $1::regprocedure::oid oid',['public.'+name+'()'])).rows[0].oid),String(initial.oid))
     }
     assert.notEqual((await db.query("select oid from pg_trigger where tgrelid='public.profiles'::regclass and tgname='profiles_protect_restricted_fields'")).rows[0].oid,oldTrigger.oid)
   }
   await applyProfileCompatibilitySource(db,sql,admin);await verify()
   const auditAfterFirst=(await db.query('select to_jsonb(a) value from public.admin_audit_logs a order by id')).rows
   assert.equal(auditAfterFirst.filter(row=>row.value.action==='session.created').length,10)
   for(const initial of before.authority.audit) assert.deepEqual(auditAfterFirst.find(row=>row.value.id===initial.id)?.value,initial)
   await applyProfileCompatibilitySource(db,sql,admin);await verify()
   assert.deepEqual((await db.query('select to_jsonb(a) value from public.admin_audit_logs a order by id')).rows,auditAfterFirst)
 })
})

async function targetHelperCompatibilitySource() {
 const {source}=await profileCompatibilitySource()
 const guards=[...source.match(/do \$function_install\$[\s\S]*?\$function_install\$;/g),
   source.match(/do \$guest_guard\$[\s\S]*?\$guest_guard\$;/)[0]]
 return {source,specs:absentSingleAdminFunctions.map(name=>{
   const guard=guards.find(block=>block.includes("to_regprocedure('public."+name+'('))
   const bodies=[...guard.matchAll(/\$(expected|previous_\d+)\$([\s\S]*?)\$\1\$/g)].map(match=>[match[1],lineEndingForms.LF(match[2]).trim()])
   assert.ok(!guard.includes('replace(p.prosrc'))
   return {name,guard,bodies,target:bodies.find(([tag])=>tag==='expected')[1]}
 })}
}
async function installTargetHelperBody(db,name,body) {
 await db.exec(`create or replace function public.${name}() returns trigger language plpgsql
   security definer set search_path='' as $$${body}$$;`)
}
test('actual SQL: target helper compatibility accepts reviewed LF/CRLF target and previous bodies',async t=>{
 const {source,specs}=await targetHelperCompatibilitySource()
 const {db,admin}=await productionShapedAdminDatabase();t.after(()=>db.close())
 await applyProfileCompatibilitySource(db,lineEndingForms.LF(source),admin)
 for(const spec of specs) for(const [tag,body] of spec.bodies) {
   for(const [inputName,input] of Object.entries(lineEndingForms)) {
     for(const [bodyName,format] of [...Object.entries(lineEndingForms),['outer whitespace',sql=>' \t\r\n'+lineEndingForms.CRLF(sql)+'\r\n\t ']]) {
       await t.test(spec.name+' '+tag+' '+bodyName+' / '+inputName+' input',async()=>{
         await installTargetHelperBody(db,spec.name,format(body))
         await db.exec(input(spec.guard))
         assert.equal(lineEndingForms.LF((await db.query('select prosrc from pg_proc where oid=$1::regprocedure',['public.'+spec.name+'()'])).rows[0].prosrc).trim(),spec.target)
       })
     }
   }
 }
})
test('actual SQL: target helper compatibility rejects internal mutations and rolls back complete reruns',async t=>{
 const {source,specs}=await targetHelperCompatibilitySource()
 const {db,admin}=await productionShapedAdminDatabase();t.after(()=>db.close())
 await applyProfileCompatibilitySource(db,lineEndingForms.LF(source),admin)
 for(const spec of specs) {
   const body=lineEndingForms.CRLF(spec.target)
   const mutations=[
     ['changed literal',body.replace(/'([^'\r\n]+)'/,(_,literal)=>"'"+literal+"_changed'")],
     ['CR in literal',body.replace(/'([^'\r\n]+)'/,(_,literal)=>"'"+literal+"\r'")],
     ['mixed line endings',body.replace('begin\r\n','begin\n')],
     ['internal whitespace',body.replace('  ','   ')],
     ['extra statement',body.replace('begin\r\n','begin\r\n  perform 1;\r\n')],
   ]
   for(const [mutationName,mutated] of mutations) for(const [inputName,input] of Object.entries(lineEndingForms)) {
     await t.test(spec.name+' '+mutationName+' / '+inputName+' input',async()=>{
       assert.notEqual(mutated,body)
       await installTargetHelperBody(db,spec.name,mutated)
       const before=await profileCompatibilitySnapshot(db)
       await assert.rejects(applyProfileCompatibilitySource(db,input(source),admin),
         spec.name==='protect_guest_order_claim'?/RF_INCOMPATIBLE_GUEST_GUARD/:new RegExp('RF_INCOMPATIBLE_FUNCTION: '+spec.name))
       assert.deepEqual(await profileCompatibilitySnapshot(db),before)
       await installTargetHelperBody(db,spec.name,spec.target)
     })
   }
 }
})

const fulfillmentCompatibilitySignature='public.apply_admin_order_action(uuid,uuid,text,uuid,text,jsonb,text)'
async function fulfillmentCompatibilitySource() {
 const source=await readFile(new URL('../../supabase/release-migrations/002_single_admin_fulfillment.sql',import.meta.url),'utf8')
 const original=await readFile(new URL('../../supabase/migrations/011_admin_order_fulfillment.sql',import.meta.url),'utf8')
 const body=sql=>sql.match(/create or replace function public\.apply_admin_order_action[\s\S]*?as \$\$([\s\S]*?)\$\$;/)[1]
 const reviewed=source.match(/\$reviewed\$([\s\S]*?)\$reviewed\$/)[1]
 const corrected=source.match(/\$corrected\$([\s\S]*?)\$corrected\$/)[1]
 assert.equal(lineEndingForms.LF(reviewed).trim(),lineEndingForms.LF(body(original)).trim())
 assert.equal(lineEndingForms.LF(corrected).trim(),lineEndingForms.LF(body(source)).trim())
 return {source,original,reviewed,corrected,header:source.match(/create or replace function public\.apply_admin_order_action[\s\S]*?as \$\$/)[0]}
}
async function preFulfillmentCompatibilityDatabase() {
 const fixture=await productionShapedAdminDatabase()
 await applyRelease(fixture.db,expansion,fixture.admin)
 await fixture.db.exec(await readFile(new URL('../../supabase/migrations/010_checkout_product_locking.sql',import.meta.url),'utf8'))
 return fixture
}
async function fulfillmentCompatibilitySnapshot(db) {
 return {authority:await authoritySnapshot(db),
   function:(await db.query('select to_jsonb(p) value from pg_proc p where oid=$1::regprocedure',[fulfillmentCompatibilitySignature])).rows[0].value,
   sessions:(await db.query('select to_jsonb(s) value from public.application_sessions s order by id')).rows,
   orders:(await db.query('select to_jsonb(o) value from public.orders o order by id')).rows,
   payments:(await db.query('select to_jsonb(p) value from public.payments p order by id')).rows,
   inventory:(await db.query('select to_jsonb(i) value from public.inventory_movements i order by id')).rows,
   triggers:(await db.query("select to_jsonb(t) value from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace order by t.oid")).rows}
}
async function verifyFulfillmentCompatibilityState(db,admin,corrected,baseline) {
 const installed=(await db.query(`select p.oid,p.prosrc,p.prosecdef,p.proconfig,p.prorettype::regtype::text result,
   has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,
   has_function_privilege('service_role',p.oid,'execute') service_role
   from pg_proc p where oid=$1::regprocedure`,[fulfillmentCompatibilitySignature])).rows[0]
 assert.equal(lineEndingForms.LF(installed.prosrc).trim(),lineEndingForms.LF(corrected).trim())
 assert.ok(installed.prosrc.includes("and r.key='admin'"));assert.ok(installed.prosrc.includes("and pe.key='*'"))
 assert.ok(!installed.prosrc.includes("r.key in ('owner'"))
 assert.deepEqual({...installed,oid:0,prosrc:''},{oid:0,prosrc:'',prosecdef:true,proconfig:['search_path=""'],result:'jsonb',anon:false,authenticated:false,service_role:true})
 assert.equal(String(installed.oid),String(baseline.function.oid))
 assert.equal((await db.query("select count(*)::int n from public.role_permissions rp join public.roles r on r.id=rp.role_id join public.permissions p on p.id=rp.permission_id where r.key='order_manager' and p.key='payments.manage'")).rows[0].n,0)
 const after=await fulfillmentCompatibilitySnapshot(db)
 for(const key of ['sessions','orders','payments','inventory','triggers']) assert.deepEqual(after[key],baseline[key])
 assert.equal(createHash('sha256').update(JSON.stringify(after.sessions)).digest('hex'),createHash('sha256').update(JSON.stringify(baseline.sessions)).digest('hex'))
 assert.deepEqual(after.authority.audit,baseline.authority.audit)
 assert.deepEqual(after.authority.assignments,baseline.authority.assignments)
 assert.deepEqual(after.authority.roles,baseline.authority.roles)
 assert.deepEqual((await new AdminAuthorizationService(sessionSqlClient(db)).resolve(admin)).permissions,['*'])
 return after
}
test('actual SQL: fulfillment compatibility preserves both reviewed bodies in LF/CRLF input',async t=>{
 const {source,original,reviewed,corrected,header}=await fulfillmentCompatibilitySource()
 const {db,admin}=await preFulfillmentCompatibilityDatabase();t.after(()=>db.close())
 await db.exec(original)
 for(const [bodyName,body] of [['reviewed',reviewed],['corrected',corrected]]) {
   for(const [installedName,format] of [...Object.entries(lineEndingForms),['outer whitespace',sql=>' \t\r\n'+lineEndingForms.CRLF(sql).trim()+'\r\n\t ']]) {
     for(const [inputName,input] of Object.entries(lineEndingForms)) await t.test(bodyName+' '+installedName+' / '+inputName+' migration',async()=>{
       await db.exec(header+format(body)+'$$;')
       const baseline=await fulfillmentCompatibilitySnapshot(db)
       await applyProfileCompatibilitySource(db,input(source),admin)
       const afterFirst=await verifyFulfillmentCompatibilityState(db,admin,corrected,baseline)
       await applyProfileCompatibilitySource(db,input(source),admin)
       assert.deepEqual(await verifyFulfillmentCompatibilityState(db,admin,corrected,baseline),afterFirst)
     })
   }
 }
})
test('actual SQL: fulfillment compatibility exact 011 to 002 LF/CRLF sequence has identical canonical results',async t=>{
 const {source,original,reviewed,corrected}=await fulfillmentCompatibilitySource()
 const results=[]
 for(const [format,input] of Object.entries(lineEndingForms)) await t.test(format+' exact 011, 002 first run and 002 rerun',async()=>{
   // Each exact 011 -> 002 sequence starts from a fresh pre-011 database.
   const {db,admin,customer}=await preFulfillmentCompatibilityDatabase()
   try {
   await db.query("insert into public.user_roles(user_id,role_id) select $1,id from public.roles where key='owner_admin'",[customer])
   await db.exec(input(original))
   const baseline=await fulfillmentCompatibilitySnapshot(db)
   assert.equal(lineEndingForms.LF(baseline.function.prosrc).trim(),lineEndingForms.LF(reviewed).trim())
   assert.equal((await db.query("select count(*)::int n from public.role_permissions rp join public.roles r on r.id=rp.role_id join public.permissions p on p.id=rp.permission_id where r.key='order_manager' and p.key='payments.manage'")).rows[0].n,1)
   await applyProfileCompatibilitySource(db,input(source),admin)
   const first=await verifyFulfillmentCompatibilityState(db,admin,corrected,baseline)
   await applyProfileCompatibilitySource(db,input(source),admin)
   const again=await verifyFulfillmentCompatibilityState(db,admin,corrected,baseline);assert.deepEqual(again,first)
   const probe=actor=>db.query('select public.apply_admin_order_action($1::uuid,$2::uuid,$3,$4::uuid,$5,$6::jsonb,$7)',[randomUUID(),actor,'note',randomUUID(),'0',JSON.stringify({text:'Local authorization probe'}),'req_002_fixture'])
   await db.exec('set role service_role')
   try {
     // Missing local order proves canonical authorization passed; legacy-only actor is denied first.
     await assert.rejects(probe(admin),/ORDER_NOT_FOUND/)
     await assert.rejects(probe(customer),/PERMISSION_DENIED/)
   } finally {await db.exec('reset role')}
   // Compare stable function/authority state; fixture UUIDs, timestamps and OIDs are independent.
   const grants=(await db.query("select r.key role,p.key permission from public.role_permissions rp join public.roles r on r.id=rp.role_id join public.permissions p on p.id=rp.permission_id order by r.key,p.key")).rows
   const sessionClasses=(await db.query('select session_class,mfa_assurance,count(*)::int n from public.application_sessions group by session_class,mfa_assurance order by session_class,mfa_assurance')).rows
   const auditActions=(await db.query('select action,count(*)::int n from public.admin_audit_logs group by action order by action')).rows
   const {oid,prosrc,...attributes}=(await db.query("select oid,prosrc,prosecdef,proconfig,prorettype::regtype::text result,pg_get_userbyid(proowner) owner,proacl::text acl,proargnames,provolatile from pg_proc where oid=$1::regprocedure",[fulfillmentCompatibilitySignature])).rows[0]
   results.push({function:{...attributes,prosrc:lineEndingForms.LF(prosrc)},grants,sessionClasses,auditActions,orders:again.orders,payments:again.payments,inventory:again.inventory})
   } finally {await db.close()}
 })
 assert.deepEqual(results[1],results[0])
})
function fulfillmentCompatibilityMutations(body,canonical) {
 const change=(from,to)=>{assert.ok(body.includes(from));return body.replace(from,()=>to)}
 return [
   [canonical?'canonical admin requirement':'legacy role list',canonical?change("and r.key='admin'","and r.key='manager'"):change("'owner','manager','order_manager','content_editor','blog_writer'","'owner','manager','order_manager','content_editor','blog_writer','admin'")],
   ['permission requirement',canonical?change("and pe.key='*'","and pe.key in ('*',permission)"):change("and pe.key in ('*',permission)","and pe.key='*'")],
   ['business logic',change('o.revision::text <> p_expected_revision','o.revision::text = p_expected_revision')],
   ['extra statement',change('begin\r\n','begin\r\n  perform 1;\r\n')],
   ['internal whitespace',change('  o public.orders%rowtype;','   o public.orders%rowtype;')],
   ['mixed line endings',change('  item record; item_count integer;\r\n','  item record; item_count integer;\n')],
   ['CR inside literal',change("'service_role'","'service_role\r'")],
 ]
}
test('actual SQL: fulfillment compatibility rejects mutations with full migration rollback',async t=>{
 const {source,original,reviewed,corrected,header}=await fulfillmentCompatibilitySource()
 const {db,admin}=await preFulfillmentCompatibilityDatabase();t.after(()=>db.close())
 await db.exec(original)
 for(const [kind,body] of [['reviewed',reviewed],['corrected',corrected]]) {
   for(const [mutation,mutated] of fulfillmentCompatibilityMutations(lineEndingForms.CRLF(body),kind==='corrected')) {
     for(const [format,input] of Object.entries(lineEndingForms)) await t.test(kind+' '+mutation+' / '+format+' input',async()=>{
       await db.exec(header+mutated+'$$;')
       const before=await fulfillmentCompatibilitySnapshot(db)
       await assert.rejects(applyProfileCompatibilitySource(db,input(source),admin),/RF_UNREVIEWED_FULFILLMENT_BODY/)
       assert.deepEqual(await fulfillmentCompatibilitySnapshot(db),before)
     })
   }
 }
})
