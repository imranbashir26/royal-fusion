// One semantic catalog manifest for the 013/014 generators and drift tests.
// No row data, OIDs, UUIDs or sequence state. No server-version/patch whitelist.
const acl = (value, ignore = 'false') => `(select jsonb_agg(
 jsonb_build_array(coalesce(grantor.rolname,'PUBLIC'),coalesce(grantee.rolname,'PUBLIC'),a.privilege_type,a.is_grantable)
 order by coalesce(grantee.rolname,'PUBLIC'),a.privilege_type,coalesce(grantor.rolname,'PUBLIC'),a.is_grantable)
 from aclexplode(${value}) a left join pg_roles grantor on grantor.oid=a.grantor
 left join pg_roles grantee on grantee.oid=a.grantee where not (${ignore}))`

// PG17 attnotnull denotes a validated, enforced, nondeferrable NOT NULL.
// PG18 stores the same property as a named pg_constraint row. Keep its semantic
// flags (including NOT VALID / NO INHERIT), not its version-generated name.
const notNull = `coalesce((select jsonb_agg(jsonb_build_array(
 k.convalidated,coalesce((to_jsonb(k)->>'conenforced')::boolean,true),k.condeferrable,k.condeferred,
 k.conislocal,k.coninhcount,k.connoinherit,cardinality(k.conkey),k.conparentid=0)
 order by k.convalidated,k.condeferrable,k.condeferred,k.conislocal,k.coninhcount,k.connoinherit,k.conname)
 from pg_constraint k where k.conrelid=c.oid and k.contype='n' and a.attnum=any(k.conkey)),
 case when a.attnotnull then jsonb_build_array(jsonb_build_array(true,true,false,false,a.attislocal,a.attinhcount,false,1,true)) end)`

// MAINTAIN on an ordinary view can authorize LOCK TABLE. The reviewed owner/
// service_role GRANT ALL encoding already authorizes every lock mode through
// UPDATE/DELETE/TRUNCATE. Normalize only that redundant, nondelegable bit;
// retain other grantees/options and explicitly fingerprint full-lock capability.
const viewMaintain = `c.relkind='v' and a.privilege_type='MAINTAIN' and not a.is_grantable
 and a.grantor=c.relowner and (a.grantee=c.relowner or grantee.rolname='service_role')
 and has_table_privilege(a.grantee,c.oid,'UPDATE,DELETE,TRUNCATE')`
const roles = "('anon','authenticated','service_role')"

export const shapeSQL = `select encode(sha256(convert_to(jsonb_build_object(
 'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,r.rolname,
  (select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),
   ${acl('a.attacl')},${notNull},
   (select jsonb_agg(jsonb_build_array(rr.rolname,priv.name,has_column_privilege(rr.oid,c.oid,a.attnum,priv.name)) order by rr.rolname,priv.name)
    from pg_roles rr cross join (values('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) priv(name) where rr.rolname in ${roles}))
   order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  (select jsonb_agg(jsonb_build_array(x.conname,pg_get_constraintdef(x.oid,false),x.convalidated,
   coalesce((to_jsonb(x)->>'conenforced')::boolean,true),x.condeferrable,x.condeferred,x.conislocal,x.coninhcount,x.connoinherit)
   order by x.conname) from pg_constraint x where x.conrelid=c.oid and x.contype<>'n'),
  (select jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid,false),t.tgenabled) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
  (select jsonb_agg(jsonb_build_array(i.relname,pg_get_indexdef(i.oid)) order by i.relname) from pg_index ix join pg_class i on i.oid=ix.indexrelid where ix.indrelid=c.oid),
  (select jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid),(select jsonb_agg(rr.rolname order by rr.rolname) from unnest(p.polroles) pr(id) join pg_roles rr on rr.oid=pr.id)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
  ${acl("coalesce(c.relacl,acldefault('r',c.relowner))", viewMaintain)},
  (select jsonb_agg(jsonb_build_array(rr.rolname,
   case when c.relkind='v' and priv.name='MAINTAIN' then 'LOCK_ANY_MODE' else priv.name end,
   case when c.relkind='v' and priv.name='MAINTAIN' then has_table_privilege(rr.oid,c.oid,'MAINTAIN,UPDATE,DELETE,TRUNCATE')
    else has_table_privilege(rr.oid,c.oid,priv.name) end) order by rr.rolname,priv.name)
   from pg_roles rr cross join (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) priv(name)
   where rr.rolname in ${roles})) order by c.relname)
  from pg_class c join pg_roles r on r.oid=c.relowner where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v')
   and not exists(select 1 from pg_depend dep where dep.classid='pg_class'::regclass and dep.objid=c.oid and dep.deptype='e')),
 'functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),r.rolname,l.lanname,p.prosecdef,p.provolatile,p.proisstrict,p.proleakproof,p.proparallel,p.proconfig,
  replace(p.prosrc,E'\\r\\n',E'\\n'),${acl("coalesce(p.proacl,acldefault('f',p.proowner))")},
  (select jsonb_agg(jsonb_build_array(rr.rolname,has_function_privilege(rr.oid,p.oid,'EXECUTE')) order by rr.rolname) from pg_roles rr where rr.rolname in ${roles}))
  order by p.proname,pg_get_function_identity_arguments(p.oid))
  from pg_proc p join pg_roles r on r.oid=p.proowner join pg_language l on l.oid=p.prolang where p.pronamespace='public'::regnamespace and p.prokind='f'
   and not exists(select 1 from pg_depend dep where dep.classid='pg_proc'::regclass and dep.objid=p.oid and dep.deptype='e'))
 )::text,'UTF8')),'hex') as shape`
