-- REVIEW ONLY: separate SELECT-only post-Release 005 capture. No release execution authorized.
-- Run whole file alone; implicit transaction, only transaction-local search_path normalization.
with context as materialized (select set_config('search_path','pg_catalog,public',true) path),
 catalog as materialized (select q.* from context cross join lateral (select encode(sha256(convert_to(jsonb_build_object(
 'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,r.rolname,
  (select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),
   (select jsonb_agg(
 jsonb_build_array(coalesce(grantor.rolname,'PUBLIC'),coalesce(grantee.rolname,'PUBLIC'),a.privilege_type,a.is_grantable)
 order by coalesce(grantee.rolname,'PUBLIC'),a.privilege_type,coalesce(grantor.rolname,'PUBLIC'),a.is_grantable)
 from aclexplode(a.attacl) a left join pg_roles grantor on grantor.oid=a.grantor
 left join pg_roles grantee on grantee.oid=a.grantee where not (false)),coalesce((select jsonb_agg(jsonb_build_array(
 k.convalidated,coalesce((to_jsonb(k)->>'conenforced')::boolean,true),k.condeferrable,k.condeferred,
 k.conislocal,k.coninhcount,k.connoinherit,cardinality(k.conkey),k.conparentid=0)
 order by k.convalidated,k.condeferrable,k.condeferred,k.conislocal,k.coninhcount,k.connoinherit,k.conname)
 from pg_constraint k where k.conrelid=c.oid and k.contype='n' and a.attnum=any(k.conkey)),
 case when a.attnotnull then jsonb_build_array(jsonb_build_array(true,true,false,false,a.attislocal,a.attinhcount,false,1,true)) end),
   (select jsonb_agg(jsonb_build_array(rr.rolname,priv.name,has_column_privilege(rr.oid,c.oid,a.attnum,priv.name)) order by rr.rolname,priv.name)
    from pg_roles rr cross join (values('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) priv(name) where rr.rolname in ('anon','authenticated','service_role')))
   order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  (select jsonb_agg(jsonb_build_array(x.conname,pg_get_constraintdef(x.oid,false),x.convalidated,
   coalesce((to_jsonb(x)->>'conenforced')::boolean,true),x.condeferrable,x.condeferred,x.conislocal,x.coninhcount,x.connoinherit)
   order by x.conname) from pg_constraint x where x.conrelid=c.oid and x.contype<>'n'),
  (select jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid,false),t.tgenabled) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
  (select jsonb_agg(jsonb_build_array(i.relname,pg_get_indexdef(i.oid)) order by i.relname) from pg_index ix join pg_class i on i.oid=ix.indexrelid where ix.indrelid=c.oid),
  (select jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid),(select jsonb_agg(rr.rolname order by rr.rolname) from unnest(p.polroles) pr(id) join pg_roles rr on rr.oid=pr.id)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
  (select jsonb_agg(
 jsonb_build_array(coalesce(grantor.rolname,'PUBLIC'),coalesce(grantee.rolname,'PUBLIC'),a.privilege_type,a.is_grantable)
 order by coalesce(grantee.rolname,'PUBLIC'),a.privilege_type,coalesce(grantor.rolname,'PUBLIC'),a.is_grantable)
 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a left join pg_roles grantor on grantor.oid=a.grantor
 left join pg_roles grantee on grantee.oid=a.grantee where not (c.relkind='v' and a.privilege_type='MAINTAIN' and not a.is_grantable
 and a.grantor=c.relowner and (a.grantee=c.relowner or grantee.rolname='service_role')
 and has_table_privilege(a.grantee,c.oid,'UPDATE,DELETE,TRUNCATE'))),
  (select jsonb_agg(jsonb_build_array(rr.rolname,
   case when c.relkind='v' and priv.name='MAINTAIN' then 'LOCK_ANY_MODE' else priv.name end,
   case when c.relkind='v' and priv.name='MAINTAIN' then has_table_privilege(rr.oid,c.oid,'MAINTAIN,UPDATE,DELETE,TRUNCATE')
    else has_table_privilege(rr.oid,c.oid,priv.name) end) order by rr.rolname,priv.name)
   from pg_roles rr cross join (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) priv(name)
   where rr.rolname in ('anon','authenticated','service_role'))) order by c.relname)
  from pg_class c join pg_roles r on r.oid=c.relowner where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v')
   and not exists(select 1 from pg_depend dep where dep.classid='pg_class'::regclass and dep.objid=c.oid and dep.deptype='e')),
 'functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),r.rolname,l.lanname,p.prosecdef,p.provolatile,p.proisstrict,p.proleakproof,p.proparallel,p.proconfig,
  replace(p.prosrc,E'\r\n',E'\n'),(select jsonb_agg(
 jsonb_build_array(coalesce(grantor.rolname,'PUBLIC'),coalesce(grantee.rolname,'PUBLIC'),a.privilege_type,a.is_grantable)
 order by coalesce(grantee.rolname,'PUBLIC'),a.privilege_type,coalesce(grantor.rolname,'PUBLIC'),a.is_grantable)
 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles grantor on grantor.oid=a.grantor
 left join pg_roles grantee on grantee.oid=a.grantee where not (false)),
  (select jsonb_agg(jsonb_build_array(rr.rolname,has_function_privilege(rr.oid,p.oid,'EXECUTE')) order by rr.rolname) from pg_roles rr where rr.rolname in ('anon','authenticated','service_role')))
  order by p.proname,pg_get_function_identity_arguments(p.oid))
  from pg_proc p join pg_roles r on r.oid=p.proowner join pg_language l on l.oid=p.prolang where p.pronamespace='public'::regnamespace and p.prokind='f'
   and not exists(select 1 from pg_depend dep where dep.classid='pg_proc'::regclass and dep.objid=p.oid and dep.deptype='e')),
 -- Event triggers are database-wide, including callbacks outside public. Pin every
 -- attachment so deleting, disabling, redirecting, or duplicating ensure_rls fails.
 'eventTriggers',(select jsonb_agg(jsonb_build_array(e.evtname,e.evtevent,r.rolname,e.evtenabled,
  n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),fr.rolname,p.prosecdef,p.proconfig,
  case when e.evttags is null then null else
   coalesce((select jsonb_agg(tag order by tag) from unnest(e.evttags) tag),'[]'::jsonb) end) order by e.evtname)
  from pg_event_trigger e join pg_roles r on r.oid=e.evtowner
  join pg_proc p on p.oid=e.evtfoid join pg_namespace n on n.oid=p.pronamespace
  join pg_roles fr on fr.oid=p.proowner)
 )::text,'UTF8')),'hex') as shape) q where context.path='pg_catalog,public'),
 defaults as materialized (select coalesce(jsonb_agg(jsonb_build_array(g.rolname,r.rolname,a.privilege_type,a.is_grantable)
 order by g.rolname,r.rolname,a.privilege_type,a.is_grantable),'[]'::jsonb) state
 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
 join pg_roles g on g.oid=a.grantor left join pg_roles r on r.oid=a.grantee
 where d.defaclrole=(select oid from pg_roles where rolname='postgres')
 and d.defaclnamespace=to_regnamespace('public') and d.defaclobjtype='r'),
 metadata as materialized (select encode(sha256(convert_to(jsonb_build_object(
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
 )::text,'UTF8')),'hex') state),
 business as materialized (select jsonb_agg(jsonb_build_array(name,row_count,within_cap,rows_sha256,versions_sha256) order by name) state from (select 'admin_audit_logs' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.admin_audit_logs t limit 10001) q
union all
select 'admin_memberships' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.admin_memberships t limit 10001) q
union all
select 'application_sessions' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.application_sessions t limit 10001) q
union all
select 'auth_bootstrap_state' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.auth_bootstrap_state t limit 10001) q
union all
select 'categories' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.categories t limit 10001) q
union all
select 'collections' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.collections t limit 10001) q
union all
select 'contact_messages' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.contact_messages t limit 10001) q
union all
select 'coupon_categories' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.coupon_categories t limit 10001) q
union all
select 'coupon_products' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.coupon_products t limit 10001) q
union all
select 'coupon_redemptions' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.coupon_redemptions t limit 10001) q
union all
select 'coupons' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.coupons t limit 10001) q
union all
select 'customer_addresses' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.customer_addresses t limit 10001) q
union all
select 'guest_order_claims' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.guest_order_claims t limit 10001) q
union all
select 'inventory_movements' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.inventory_movements t limit 10001) q
union all
select 'newsletter_subscribers' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.newsletter_subscribers t limit 10001) q
union all
select 'order_item_components' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.order_item_components t limit 10001) q
union all
select 'order_items' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.order_items t limit 10001) q
union all
select 'order_notes' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.order_notes t limit 10001) q
union all
select 'order_status_history' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.order_status_history t limit 10001) q
union all
select 'orders' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.orders t limit 10001) q
union all
select 'payments' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.payments t limit 10001) q
union all
select 'permissions' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.permissions t limit 10001) q
union all
select 'product_categories' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.product_categories t limit 10001) q
union all
select 'product_collections' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.product_collections t limit 10001) q
union all
select 'product_media' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.product_media t limit 10001) q
union all
select 'product_variants' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.product_variants t limit 10001) q
union all
select 'products' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.products t limit 10001) q
union all
select 'profiles' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.profiles t limit 10001) q
union all
select 'promotions' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.promotions t limit 10001) q
union all
select 'public_site_settings' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.public_site_settings t limit 10001) q
union all
select 'refunds' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.refunds t limit 10001) q
union all
select 'reviews' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.reviews t limit 10001) q
union all
select 'role_permissions' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.role_permissions t limit 10001) q
union all
select 'roles' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.roles t limit 10001) q
union all
select 'seo_settings' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.seo_settings t limit 10001) q
union all
select 'shipping_methods' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.shipping_methods t limit 10001) q
union all
select 'shipping_rates' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.shipping_rates t limit 10001) q
union all
select 'site_settings' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.site_settings t limit 10001) q
union all
select 'tester_pack_allowed_variants' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.tester_pack_allowed_variants t limit 10001) q
union all
select 'tester_pack_components' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.tester_pack_components t limit 10001) q
union all
select 'tester_packs' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.tester_packs t limit 10001) q
union all
select 'tester_variants' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.tester_variants t limit 10001) q
union all
select 'user_roles' name,count(*) row_count,count(*)<=10000 within_cap,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text,'UTF8')),'hex') end rows_sha256,
 case when count(*)<=10000 then encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(location,version,dead) order by location),'[]'::jsonb)::text,'UTF8')),'hex') end versions_sha256
 from (select to_jsonb(t) value,t.ctid::text location,t.xmin::text version,t.xmax::text dead from public.user_roles t limit 10001) q) rows),
 fingerprints as materialized (select jsonb_build_object('product',(select encode(sha256(convert_to(((to_jsonb(p)-'commerce_kind')||jsonb_build_object('created_at',p.created_at at time zone 'UTC','updated_at',p.updated_at at time zone 'UTC'))::text,'UTF8')),'hex') from public.products p where id='45852db8-8b83-425e-8d1f-4112958ed505'),
 'variant',(select encode(sha256(convert_to((to_jsonb(v)||jsonb_build_object('created_at',v.created_at at time zone 'UTC','updated_at',v.updated_at at time zone 'UTC'))::text,'UTF8')),'hex') from public.product_variants v where id='b35b3be7-a7dd-4c70-9c14-d1a9394d4711')) state),
 updated_triggers as materialized (select coalesce(jsonb_agg(jsonb_build_array(c.relname,t.tgname,t.tgenabled,
 pg_get_triggerdef(t.oid,false)) order by c.relname,t.tgname),'[]'::jsonb) state
 from pg_trigger t join pg_class c on c.oid=t.tgrelid
 where c.relnamespace=to_regnamespace('public') and not t.tgisinternal
 and t.tgfoid=to_regprocedure('public.set_updated_at()')),
 checks as materialized (select jsonb_build_object(
 'postgres_major_17',current_setting('server_version_num')::int between 170000 and 179999,
 'postgres_identity',current_user='postgres',
 'read_committed',current_setting('transaction_isolation')='read committed',
 'roles_safe',((select count(*)=5 from pg_roles where rolname in
 ('postgres','anon','authenticated','service_role','supabase_admin'))
 and not exists(select 1 from pg_roles where rolname in ('anon','authenticated')
 and (rolsuper or rolcreaterole or rolcreatedb or rolbypassrls))
 and not exists(select 1 from pg_roles b cross join pg_roles r
 where b.rolname in ('anon','authenticated') and b.oid<>r.oid
 and (r.rolname in ('postgres','service_role','supabase_admin','pg_maintain') or r.rolsuper or r.rolcreaterole or r.rolbypassrls)
 and (pg_has_role(b.oid,r.oid,'USAGE') or pg_has_role(b.oid,r.oid,'SET')))),
 'schema_expected',(exists(select 1 from pg_namespace n join pg_roles r on r.oid=n.nspowner
 where n.nspname='public' and r.rolname in ('postgres','pg_database_owner'))
 and exists(select 1 from pg_database d join pg_roles r on r.oid=d.datdba
 where d.datname=current_database() and r.rolname='postgres')),
 'no_global_postgres_table_defaults',(not exists(select 1 from pg_default_acl where
 defaclrole=(select oid from pg_roles where rolname='postgres') and defaclnamespace=0 and defaclobjtype='r')),
 'exact_post014_catalog',(select shape='9f09f8db7c51e08bb92fd8e0e1fa1de15c628456ba8b8ff88c5a3be2853b3987' from catalog),
 'exact_post_defaults',(select state is not distinct from (select jsonb_agg(jsonb_build_array('postgres',x.grantee,x.privilege,false)
 order by x.grantee,x.privilege) state from (
 select 'postgres' grantee,p.name privilege
 from (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(name)
 union all
 select r.name grantee,p.name privilege from unnest(array['service_role']) r(name)
 cross join (values('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(name)
 ) x) from defaults),
 'seven_event_triggers',(select count(*)=7 from pg_event_trigger),
 'twenty_enabled_updated_at_triggers',(select count(*)=20 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal and t.tgfoid=to_regprocedure('public.set_updated_at()') and t.tgenabled in ('O','A')),
 'updated_at_function_unchanged',exists(select 1 from pg_proc where oid=to_regprocedure('public.set_updated_at()') and proowner='postgres'::regrole and not prosecdef and proconfig is null and proacl is null),
 'forty_four_postgres_relations',(select count(*)=44 from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p','v') and relowner='postgres'::regrole),
 'all_row_scans_within_cap',not exists(select 1 from business,jsonb_array_elements(state) d where d->>2 is distinct from 'true'),
 'baraan_identity_and_stock',exists(select 1 from public.products p join public.product_variants v on v.product_id=p.id where p.id='45852db8-8b83-425e-8d1f-4112958ed505' and v.id='b35b3be7-a7dd-4c70-9c14-d1a9394d4711' and p.slug='baraan' and p.sku='RF-BAR-001' and lower(p.name)='baraan' and p.price=2900 and p.stock_quantity=12 and v.stock_quantity=12 and p.commerce_kind='standard' and p.active and p.status='Published' and v.active),
 'baraan_fingerprints_exact',(select state->>'product'='19f3efa868003a05f6f06936ff0cc419bd49e9036721075786e5a5b514dc3693' and state->>'variant'='0499a08df4c7390b2d91f10987980c402ef25d8c202207424bf0dceaec191f7c' from fingerprints),
 'orders_empty',not exists(select 1 from public.orders),
 'payments_empty',not exists(select 1 from public.payments),
 'movements_empty',not exists(select 1 from public.inventory_movements),
 'components_empty',not exists(select 1 from public.order_item_components),
 'tester_business_empty',not exists(select 1 from public.products where commerce_kind<>'standard') and not exists(select 1 from public.tester_variants) and not exists(select 1 from public.tester_packs) and not exists(select 1 from public.tester_pack_components) and not exists(select 1 from public.tester_pack_allowed_variants)
 ) state from context where context.path='pg_catalog,public')
select jsonb_build_object('phase','post-release005','overall_pass',(select bool_and(value='true'::jsonb) from jsonb_each(checks.state)),
 'checks',checks.state,'server_version',current_setting('server_version'),'execution_role',current_user,
 'post014_manifest_sha256',(select shape from catalog),'postgres_public_table_default_acl',(select state from defaults),
 'preserved_metadata_sha256',(select state from metadata),
 'supabase_admin_defaults_sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(d) order by d.oid),'[]'::jsonb)::text,'UTF8')),'hex') from pg_default_acl d where d.defaclrole=(select oid from pg_roles where rolname='supabase_admin')),
 'updated_at_triggers',(select state from updated_triggers),
 'events',(select jsonb_agg(jsonb_build_object('name',e.evtname,'enabled',e.evtenabled,'callback',n.nspname||'.'||p.proname,'callback_definition_sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')) order by e.evtname) from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid join pg_namespace n on n.oid=p.pronamespace),
 'table_effective_privileges_sha256',(select encode(sha256(convert_to(jsonb_agg(jsonb_build_array(c.relname,r.rolname,v.name,has_table_privilege(r.oid,c.oid,v.name)) order by c.relname,r.rolname,v.name)::text,'UTF8')),'hex') from pg_class c cross join pg_roles r cross join(values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) v(name) where c.relnamespace='public'::regnamespace and c.relkind in('r','v','p') and r.rolname in('anon','authenticated','service_role')),
 'column_effective_privileges_sha256',(select encode(sha256(convert_to(jsonb_agg(jsonb_build_array(c.relname,a.attname,r.rolname,v.name,has_column_privilege(r.oid,c.oid,a.attnum,v.name)) order by c.relname,a.attname,r.rolname,v.name)::text,'UTF8')),'hex') from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped cross join pg_roles r cross join(values('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) v(name) where c.relnamespace='public'::regnamespace and c.relkind in('r','v','p') and r.rolname in('anon','authenticated','service_role')),
 'business_snapshots',(select state from business),'baraan_fingerprints',(select state from fingerprints)) result from checks;
