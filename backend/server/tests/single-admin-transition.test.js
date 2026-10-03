import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { legacyAdminDatabase, applyRelease, sessionSqlClient } from './support/singleAdminDatabase.js'
import { AdminAuthorizationService } from '../services/adminAuthorizationService.js'
import { SupabaseSessionRepository } from '../services/sessionRepository.js'
import { AuthSessionService } from '../services/authSessionService.js'
import { createAuthConfig } from '../auth/config.js'

const expansion='001_single_admin_expansion.sql', retirement='003_single_admin_retirement.sql'
test('actual SQL: single-admin expansion, secure sessions and verified retirement',async t=>{
 const {db,admin,customer}=await legacyAdminDatabase();t.after(()=>db.close())
 await applyRelease(db,expansion,admin)
 await applyRelease(db,expansion,admin) // repeat safely, without duplicating authority/audit
 const auth=new AdminAuthorizationService(sessionSqlClient(db))
 assert.deepEqual((await auth.resolve(admin)).permissions,['*']);assert.equal((await auth.resolve(admin)).roleKey,'admin')
 assert.equal(await auth.resolve(customer),null)
 assert.equal((await db.query("select count(*)::int n from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=$1 and ur.active and r.key in ('admin','owner_admin')",[admin])).rows[0].n,2)
 assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='user_roles' and column_name in ('expires_at','revoked_at')")).rows[0].n,0)
 await t.test('database resolver/ownership and browser DML/operational RPC boundaries',async()=>{
   await db.exec("create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('fixture.user_uuid',true),'')::uuid$$")
   for(const [id,allowed]of [[admin,true],[customer,false]]) {
     await db.query("select set_config('fixture.user_uuid',$1,false)",[id])
     await db.exec('set role authenticated')
     try {
       assert.equal((await db.query("select public.has_permission('orders.manage') allowed")).rows[0].allowed,allowed)
       if(!allowed) assert.deepEqual((await db.query('select id from public.profiles')).rows.map(r=>r.id),[customer])
     } finally { await db.exec('reset role') }
   }
   await db.exec("select set_config('fixture.user_uuid','',false)")
   const privileges=(await db.query("select has_table_privilege('authenticated','public.user_roles','insert') i,has_table_privilege('authenticated','public.orders','update') u,has_table_privilege('anon','public.products','select') p")).rows[0]
   assert.deepEqual(privileges,{i:false,u:false,p:true})
   const rpc=(await db.query("select p.proname,has_function_privilege('authenticated',p.oid,'execute') allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('claim_application_session_refresh','release_application_session_refresh','create_order_transaction','save_catalog_product')")).rows
   assert.ok(rpc.length>=4); assert.ok(rpc.every(row=>row.allowed===false))
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
  ['conflicting bootstrap',async({db,customer})=>db.exec(`create table public.auth_bootstrap_state(id text,completed_by uuid); insert into public.auth_bootstrap_state values('first_admin','${customer}')`),x=>x.admin],
 ]) await t.test(name,async()=>{
   const fixture=await legacyAdminDatabase();try{await prepare(fixture);await assert.rejects(applyRelease(fixture.db,expansion,approved(fixture)),/RF_/); assert.equal((await fixture.db.query("select count(*)::int n from public.roles where key='admin'")).rows[0].n,name==='unexpected canonical admin'?1:0)}finally{await fixture.db.close()}
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
