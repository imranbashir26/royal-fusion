import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'

const migration=new URL('../../supabase/release-migrations/008_durable_checkout_attempts.sql',import.meta.url)
const digest=value=>createHash('sha256').update(value).digest('hex')
const normalize=value=>value.replaceAll('\r\n','\n')
const helpers=['checkout_v1_quote_identity_008','checkout_v1_request_identity_008','checkout_v1_attempt_guard_008','quote_checkout_v1_007_internal','create_order_transaction_v2_008_internal']

test('Release 008 bounded platform profiles and private-object guards; catalog fixtures only',async t=>{
 // Same guard-predicate/source-fingerprint approach as checked-v1-native.test.js.
 // No migrations, real role changes, object DDL or business functions are executed.
 const sql=normalize(await readFile(migration,'utf8'))
 const start=sql.indexOf(' -- Include authenticator (if installed)')
 const end=sql.indexOf('\n or exists(select 1 from pg_roles b cross join pg_roles r',start)
 assert.ok(start>0 && end>start)
 assert.equal(digest(sql.slice(0,start)+'<BOUNDED_ROLE_PROFILE_GUARD>\n'+sql.slice(end)),
  '7028c043b79fe966a0d4014a466290700084f0a52d5d42056409ed002e4c5d4d',
  'Everything except the documented role-attribute check/comment must remain unchanged')
 assert.match(sql,/if shape <> '6076eb77ec31ddf953f6207c193cbebe5afb4c2568592676d19da736e8460fcb'/)
 const next=await readFile(new URL('../../supabase/release-migrations/009_scheduled_fixed_sale_pricing.sql',import.meta.url),'utf8')
 assert.match(next,/if shape <> '00bf3eb3276b0ddf57d260397f117c30c175d29c86d8cc9c9c9c33476a8663b3'/)
 const previous=normalize(await readFile(new URL('../../supabase/release-migrations/007_checked_v1_checkout.sql',import.meta.url),'utf8'))
 const profile=text=>text.match(/   and not \(b\.rolcreaterole[\s\S]*?(?=\n or exists)/)[0]
 assert.equal(profile(sql),profile(previous),'Use the approved complete Release 007 attribute profile')
 const guards=[...sql.slice(sql.lastIndexOf('do $post$')).matchAll(/^ if ((?:not exists|exists)[\s\S]*?)\n then raise exception '(RF_RELEASE008_PRIVATE_(?:ACL|ROLE_PATH|RPC))'; end if;/gm)].map(m=>({condition:m[1],code:m[2]}))
 assert.deepEqual(guards.map(g=>g.code),['RF_RELEASE008_PRIVATE_ACL','RF_RELEASE008_PRIVATE_ROLE_PATH','RF_RELEASE008_PRIVATE_ACL','RF_RELEASE008_PRIVATE_RPC'])
 for(const [index,hash] of [[0,'e75b653867727eae354382092eb63bc8be6036dc0f1133606c8b716372322f81'],[2,'a8f81b181ca95c615513da19d058b39a2858a832edfadf593fff4c14d0c489aa'],[3,'f1ca68528ba11ca10d12bf59b2c27c81d77e1ae6407ce6619c2595a2cdb87365']])assert.equal(digest(guards[index].condition),hash)
 const membership=guards[1].condition.slice(guards[1].condition.indexOf('\n or exists'))
 const formerRole="exists(select 1 from pg_roles b where b.rolname !~ '^pg_' and b.rolname<>'postgres'\n   and not (b.rolname='supabase_admin' and b.rolsuper) and (b.rolsuper or b.rolcreaterole))"+membership
 assert.equal(digest(formerRole),'50d0bbc955a4c6bd7ed65a7461219c7d0d816e2209130077ac2acbe5fff60a32','Unauthorized membership checks must remain unchanged')

 // Substitute only catalog data/privilege lookups. Evaluate the actual IF
 // predicates as SQL against immutable CTEs, including transitive INHERIT/SET.
 const rewrite=condition=>{
  let result=condition.replaceAll("'public.checkout_v1_attempts'::regclass",'200::oid').replaceAll("'public'::regnamespace",'42::oid')
  result=result.replace(/pg_has_role\(b\.oid,r\.oid,'(USAGE|SET)'\)/g,(_,mode)=>`(exists(select 1 from role_path q where q.member=b.oid and q.roleid=r.oid and q.mode='${mode}'))`)
  result=result.replace("aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))","(select grantee from fixture_acl where object_oid=c.oid and kind='table')")
  result=result.replace('aclexplode(c.attacl)',"(select grantee from fixture_acl where object_oid=c.attrelid and attnum=c.attnum and kind='column')")
  result=result.replace("aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))","(select grantee from fixture_acl where object_oid=p.oid and kind='function')")
  result=result.replace(/has_(table|any_column)_privilege\(r\.oid,'public\.checkout_v1_attempts','([^']+)'\)/g,(_,kind,privileges)=>`(r.rolsuper or exists(
   select 1 from fixture_privilege x join role_path q on q.roleid=x.role_oid and q.member=r.oid and q.mode='USAGE'
   where x.kind='${kind==='table'?'table':'column'}' and x.privilege=any(string_to_array('${privileges}',','))))`)
  result=result.replace("has_function_privilege(r.oid,p.oid,'EXECUTE')",`(r.rolsuper or exists(
   select 1 from fixture_acl x where x.kind='function' and x.object_oid=p.oid and (x.grantee=0 or exists(
    select 1 from role_path q where q.member=r.oid and q.roleid=x.grantee and q.mode='USAGE'))))`)
  assert.doesNotMatch(result,/::regclass|::regnamespace|pg_has_role\(|has_\w+_privilege\(|aclexplode\(|acldefault\(/)
  return result
 }
 const statement=(roleCondition=guards[1].condition)=>`WITH RECURSIVE
  input AS (select $1::jsonb value),
  pg_roles AS (select r.* from input,jsonb_to_recordset(value->'roles') r(oid oid,rolname text,
   rolsuper boolean,rolcreaterole boolean,rolbypassrls boolean,rolcanlogin boolean,rolinherit boolean,rolcreatedb boolean,rolreplication boolean)),
  pg_auth_members AS (select m.* from input,jsonb_to_recordset(value->'memberships') m(member oid,roleid oid,inherit_option boolean,set_option boolean,admin_option boolean)),
  pg_class AS (select c.* from input,jsonb_to_recordset(value->'tables') c(oid oid,relowner oid,relrowsecurity boolean)),
  pg_attribute AS (select a.* from input,jsonb_to_recordset(value->'columns') a(attrelid oid,attnum integer)),
  pg_policy AS (select p.* from input,jsonb_to_recordset(value->'policies') p(polrelid oid)),
  pg_proc AS (select p.* from input,jsonb_to_recordset(value->'functions') p(oid oid,pronamespace oid,proname text,proowner oid,proconfig text[])),
  fixture_acl AS (select a.* from input,jsonb_to_recordset(value->'acl') a(object_oid oid,kind text,attnum integer,grantee oid)),
  fixture_privilege AS (select p.* from input,jsonb_to_recordset(value->'privileges') p(role_oid oid,kind text,privilege text)),
  role_path(member,roleid,mode) AS (
   select b.oid,r.oid,m.mode from pg_roles b cross join pg_roles r cross join (values('USAGE'),('SET')) m(mode) where b.oid=r.oid or b.rolsuper
   union select q.member,m.roleid,q.mode from role_path q join pg_auth_members m on m.member=q.roleid
    where case q.mode when 'USAGE' then m.inherit_option else m.set_option end)
  select case ${guards.map((g,i)=>`when (${rewrite(i===1?roleCondition:g.condition)}) then '${g.code}'`).join('\n')}
   else 'PASS' end result`
 const role=(oid,rolname,patch={})=>({oid,rolname,rolsuper:false,rolcreaterole:false,rolbypassrls:false,rolcanlogin:false,rolinherit:true,rolcreatedb:false,rolreplication:false,...patch})
 const baseline=()=>({roles:[role(10,'postgres'),role(11,'supabase_admin',{rolsuper:true}),role(12,'anon'),role(13,'authenticated'),
  role(14,'service_role',{rolbypassrls:true}),role(15,'dashboard_user',{rolcreaterole:true,rolcreatedb:true,rolreplication:true}),
  role(16,'supabase_auth_admin',{rolcreaterole:true,rolcanlogin:true,rolinherit:false}),role(17,'supabase_storage_admin',{rolcreaterole:true,rolcanlogin:true,rolinherit:false}),role(18,'authenticator')],
  memberships:[],tables:[{oid:200,relowner:10,relrowsecurity:true}],columns:[{attrelid:200,attnum:1}],policies:[],privileges:[],
  functions:helpers.map((proname,i)=>({oid:100+i,pronamespace:42,proname,proowner:10,proconfig:['search_path=""']})),
  acl:[{object_oid:200,kind:'table',grantee:10},...helpers.map((_,i)=>({object_oid:100+i,kind:'function',grantee:10}))]})
 const edge=(member,roleid,mode)=>({member,roleid,inherit_option:mode==='USAGE',set_option:mode==='SET',admin_option:mode==='ADMIN'})
 const db=new PGlite()
 t.after(async()=>{await db.exec('rollback');await db.close()})
 await db.exec('begin read only')
 const evaluate=async(fixture,condition)=>{
  try{return (await db.query(statement(condition),[JSON.stringify(fixture)])).rows[0].result}
  catch(error){throw new Error(error.message)}
 }
 const scenario=(name,mutate,expected='RF_RELEASE008_PRIVATE_ROLE_PATH')=>t.test(name,async()=>{
  const fixture=baseline();mutate(fixture);assert.equal(await evaluate(fixture),expected)
 })
 await t.test('original rejects verified managed profiles; correction passes every remaining guard',async()=>{
  assert.equal(await evaluate(baseline(),formerRole),'RF_RELEASE008_PRIVATE_ROLE_PATH')
  assert.equal(await evaluate(baseline()),'PASS')
 })
 await scenario('optional managed roles absent',f=>{f.roles=f.roles.filter(r=>![15,16,17].includes(r.oid))},'PASS')
 await scenario('non-superuser supabase_admin without private access',f=>{f.roles.find(r=>r.oid===11).rolsuper=false},'PASS')
 for(const attr of ['rolsuper','rolcreaterole'])await scenario('unexpected elevated custom role / '+attr,f=>f.roles.push(role(20,'custom_admin',{[attr]:true})))
 for(const id of [15,16,17]){
  const name=baseline().roles.find(r=>r.oid===id).rolname
  for(const attr of ['rolsuper','rolcreaterole','rolbypassrls','rolcanlogin','rolinherit','rolcreatedb','rolreplication'])await scenario(name+' rejects altered '+attr,f=>{
   const managed=f.roles.find(r=>r.oid===id);managed[attr]=!managed[attr]
  })
  for(const mode of ['USAGE','SET','ADMIN']){
   for(const target of [10,11])await scenario(name+' rejects elevated target '+target+' / '+mode,f=>f.memberships.push(edge(id,target,mode)))
   for(const member of [12,13,14,18])await scenario(name+' rejects application member '+member+' / '+mode,f=>f.memberships.push(edge(member,id,mode)))
  }
  for(const mode of ['USAGE','SET'])await scenario(name+' rejects transitive application path / '+mode,f=>{
   f.roles.push(role(20,'bridge'));f.memberships.push(edge(14,20,mode),edge(20,id,mode))
  })
 }
 await scenario('private table owner drift',f=>{f.tables[0].relowner=14},'RF_RELEASE008_PRIVATE_ACL')
 await scenario('private table RLS disabled',f=>{f.tables[0].relrowsecurity=false},'RF_RELEASE008_PRIVATE_ACL')
 await scenario('private table policy added',f=>f.policies.push({polrelid:200}),'RF_RELEASE008_PRIVATE_ACL')
 for(const grantee of [0,11,12,13,14,15,16,17,18]){
  for(const kind of ['table','column'])await scenario('private '+kind+' grant to '+grantee,f=>f.acl.push({object_oid:200,attnum:1,kind,grantee}),'RF_RELEASE008_PRIVATE_ACL')
  for(let index=0;index<helpers.length;index++)await scenario(helpers[index]+' EXECUTE to '+grantee,f=>f.acl.push({object_oid:100+index,kind:'function',grantee}),'RF_RELEASE008_PRIVATE_RPC')
 }
 for(const kind of ['table','column'])for(const id of [12,13,14,15,16,17,18])await scenario('effective '+kind+' privilege for '+id,f=>f.privileges.push({role_oid:id,kind,privilege:'SELECT'}),'RF_RELEASE008_PRIVATE_ACL')
 for(const mode of ['USAGE','SET'])await scenario('predefined read role reachable via '+mode,f=>{
  f.roles.push(role(30,'pg_read_all_data'));f.memberships.push(edge(14,30,mode));f.privileges.push({role_oid:30,kind:'table',privilege:'SELECT'})
 },'RF_RELEASE008_PRIVATE_ACL')
 for(let index=0;index<helpers.length;index++){
  await scenario(helpers[index]+' owner drift',f=>{f.functions[index].proowner=14},'RF_RELEASE008_PRIVATE_RPC')
  await scenario(helpers[index]+' search_path drift',f=>{f.functions[index].proconfig=['search_path=public']},'RF_RELEASE008_PRIVATE_RPC')
 }
})
