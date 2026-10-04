import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { legacyAdminDatabase, applyRelease, sessionSqlClient, verifiedLegacyPermissionBody, installVerifiedLegacyPermission } from './support/singleAdminDatabase.js'
import { verifiedLegacyRevocationBody, installVerifiedLegacyRevocation } from './support/singleAdminDatabase.js'
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
