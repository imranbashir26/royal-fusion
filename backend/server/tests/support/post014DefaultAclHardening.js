import { readFile } from 'node:fs/promises'
import { shapeSQL } from './catalogManifest.js'

export const post014Hash = '9f09f8db7c51e08bb92fd8e0e1fa1de15c628456ba8b8ff88c5a3be2853b3987'
export const release005URL = new URL('../../../supabase/release-migrations/005_post014_browser_default_acl_hardening.sql', import.meta.url)
export const privileges = ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
export const defaultTuplesSQL = `select coalesce(jsonb_agg(jsonb_build_array(g.rolname,r.rolname,a.privilege_type,a.is_grantable)
 order by g.rolname,r.rolname,a.privilege_type,a.is_grantable),'[]'::jsonb) state
 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
 join pg_roles g on g.oid=a.grantor left join pg_roles r on r.oid=a.grantee
 where d.defaclrole=(select oid from pg_roles where rolname='postgres')
 and d.defaclnamespace=to_regnamespace('public') and d.defaclobjtype='r'`
// Always preserve the eight explicit owner tuples observed in production.
// The parameter lists only non-owner grantees: pre=browser/service, post=service.
export const expectedTuplesSQL = roles => `select jsonb_agg(jsonb_build_array('postgres',x.grantee,x.privilege,false)
 order by x.grantee,x.privilege) state from (
 select 'postgres' grantee,p.name privilege
 from (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(name)
 union all
 select r.name grantee,p.name privilege from unnest(array[${roles.map(r => `'${r}'`).join(',')}]) r(name)
 cross join (values('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(name)
 ) x`
export const globalDefaultsSafeSQL = `not exists(select 1 from pg_default_acl where
 defaclrole=(select oid from pg_roles where rolname='postgres') and defaclnamespace=0 and defaclobjtype='r')`
export const rolesSafeSQL = `(select count(*)=5 from pg_roles where rolname in
 ('postgres','anon','authenticated','service_role','supabase_admin'))
 and not exists(select 1 from pg_roles where rolname in ('anon','authenticated')
 and (rolsuper or rolcreaterole or rolcreatedb or rolbypassrls))
 and not exists(select 1 from pg_roles b cross join pg_roles r
 where b.rolname in ('anon','authenticated') and b.oid<>r.oid
 and (r.rolname in ('postgres','service_role','supabase_admin','pg_maintain') or r.rolsuper or r.rolcreaterole or r.rolbypassrls)
 and (pg_has_role(b.oid,r.oid,'USAGE') or pg_has_role(b.oid,r.oid,'SET')))`
export const schemaSafeSQL = `exists(select 1 from pg_namespace n join pg_roles r on r.oid=n.nspowner
 where n.nspname='public' and r.rolname in ('postgres','pg_database_owner'))
 and exists(select 1 from pg_database d join pg_roles r on r.oid=d.datdba
 where d.datname=current_database() and r.rolname='postgres')`
export const preservedMetadataSQL = `select encode(sha256(convert_to(jsonb_build_object(
 'defaults',(select coalesce(jsonb_agg(to_jsonb(d) order by d.oid),'[]'::jsonb) from pg_default_acl d
 where not (d.defaclrole=(select oid from pg_roles where rolname='postgres')
 and d.defaclnamespace=to_regnamespace('public') and d.defaclobjtype='r')),
 'schemas',(select jsonb_agg(to_jsonb(n) order by n.oid) from pg_namespace n),
 'roles',(select jsonb_agg(to_jsonb(r) order by r.oid) from pg_roles r),
 'memberships',(select coalesce(jsonb_agg(to_jsonb(m) order by m.roleid,m.member,m.grantor),'[]'::jsonb) from pg_auth_members m),
 'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname not like 'pg_%' and n.nspname<>'information_schema'),
 'events',(select jsonb_agg(to_jsonb(e) order by e.oid) from pg_event_trigger e),
 'relations',(select jsonb_agg(to_jsonb(c) - 'reltuples' - 'relpages' - 'relallvisible' - 'relfrozenxid' - 'relminmxid' order by c.oid)
 from pg_class c where c.relnamespace=to_regnamespace('public')),
 'columns',(select jsonb_agg(to_jsonb(a) order by a.attrelid,a.attnum) from pg_attribute a
 join pg_class c on c.oid=a.attrelid where c.relnamespace=to_regnamespace('public')),
 'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t
 join pg_class c on c.oid=t.tgrelid where c.relnamespace=to_regnamespace('public')),
 'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p),
 'constraints',(select jsonb_agg(to_jsonb(k) order by k.oid) from pg_constraint k
 join pg_namespace n on n.oid=k.connamespace where n.nspname='public'),
 'indexes',(select jsonb_agg(to_jsonb(i) order by i.indexrelid) from pg_index i
 join pg_class c on c.oid=i.indrelid where c.relnamespace=to_regnamespace('public')),
 'rewrites',(select jsonb_agg(to_jsonb(w) order by w.oid) from pg_rewrite w
 join pg_class c on c.oid=w.ev_class where c.relnamespace=to_regnamespace('public')),
 'columnDefaults',(select jsonb_agg(to_jsonb(d) order by d.oid) from pg_attrdef d
 join pg_class c on c.oid=d.adrelid where c.relnamespace=to_regnamespace('public'))
 )::text,'UTF8')),'hex') state`

export const updatedTriggersSQL = `select coalesce(jsonb_agg(jsonb_build_array(c.relname,t.tgname,t.tgenabled,
 pg_get_triggerdef(t.oid,false)) order by c.relname,t.tgname),'[]'::jsonb) state
 from pg_trigger t join pg_class c on c.oid=t.tgrelid
 where c.relnamespace=to_regnamespace('public') and not t.tgisinternal
 and t.tgfoid=to_regprocedure('public.set_updated_at()')`

export async function apply005(db, style = 'LF', source = null) {
 let sql = (source ?? await readFile(release005URL, 'utf8')).replaceAll('\r\n', '\n')
 if (style === 'CRLF') sql = sql.replaceAll('\n', '\r\n')
 try { await db.query(sql) } catch (error) { await db.query('rollback'); throw error }
}
export async function snapshot005(db) {
 const tables = (await db.query("select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' order by relname")).rows
 const data = {}
 for (const { relname } of tables) data[relname] = (await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) rows from public."${relname.replaceAll('"', '""')}" t`)).rows[0].rows
 return { shape: (await db.query(shapeSQL)).rows[0].shape, metadata: (await db.query(preservedMetadataSQL)).rows[0].state,
 defaults: (await db.query(defaultTuplesSQL)).rows[0].state, data }
}
