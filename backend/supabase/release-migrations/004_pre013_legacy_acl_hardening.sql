-- RELEASE ONLY: after verified 012, before 013. Exact reviewed legacy ACL repair.
-- No business data, functions, policies, defaults, service grants or ordering flags change.
-- Only the supplied production state or the exact already-hardened state is accepted.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public;
do $pre013_acl$
declare
 shape text;
 relation_name text;
 role_name text;
 privilege_name text;
 column_name text;
 expected_kind text;
 relation pg_class%rowtype;
 relations constant text[]:=array['admin_audit_logs','admin_memberships','categories','collections','contact_messages','coupon_categories','coupon_products','coupon_redemptions','coupons','customer_addresses','inventory_movements','newsletter_subscribers','order_items','order_notes','order_status_history','orders','payments','permissions','product_categories','product_collections','product_media','product_sales_rankings','product_variants','products','profiles','promotions','public_site_settings','refunds','reviews','role_permissions','roles','seo_settings','shipping_methods','shipping_rates','site_settings','user_roles'];
begin
 if current_user<>'postgres' then raise exception 'RF_PRE013_ACL_POSTGRES_REQUIRED'; end if;
 if (select count(*) from pg_roles where rolname in ('postgres','anon','authenticated','service_role'))<>4 then
  raise exception 'RF_PRE013_ACL_ROLES_REQUIRED';
 end if;
 foreach relation_name in array relations loop
  select c.* into relation from pg_class c where c.relnamespace=to_regnamespace('public') and c.relname=relation_name;
  expected_kind:=case when relation_name='product_sales_rankings' then 'v' else 'r' end;
  if not found or relation.relkind::text<>expected_kind or relation.relowner<>(select oid from pg_roles where rolname='postgres') then
   raise exception 'RF_PRE013_ACL_OBJECT_DRIFT: %',relation_name;
  end if;
  -- The view lock also locks its underlying relations. Timeouts bound lock acquisition.
  execute format('lock table public.%I in share row exclusive mode',relation_name);
 end loop;
 select encode(sha256(convert_to(jsonb_build_object(
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
 )::text,'UTF8')),'hex') into shape;
 if shape='a2ad954731059c790d88e4cdb49682979548a83a3a3fa52379551763a06464dc' then
  return; -- Exact pre-013 rerun: no ACL write and no partial/unknown state accepted.
 end if;
 if shape<>'f64ceda44b4f076680f84dc5ac4b7e1b4bf7ff58911929804d456f7d32e506b4' then raise exception 'RF_PRE013_ACL_BASELINE_DRIFT'; end if;

 -- No ALL, CASCADE, PUBLIC, service_role or default-privilege mutation.
 -- ON TABLE accepts ordinary views too; revoke the exact stored view privilege bits.
 revoke truncate,references,trigger,maintain on table
  public.admin_audit_logs,
  public.site_settings
 from authenticated;
 revoke truncate,references,trigger,maintain on table
  public.admin_memberships,
  public.categories,
  public.collections,
  public.contact_messages,
  public.coupon_categories,
  public.coupon_products,
  public.coupon_redemptions,
  public.coupons,
  public.customer_addresses,
  public.inventory_movements,
  public.newsletter_subscribers,
  public.order_items,
  public.order_notes,
  public.order_status_history,
  public.orders,
  public.payments,
  public.permissions,
  public.product_categories,
  public.product_collections,
  public.product_media,
  public.product_sales_rankings,
  public.product_variants,
  public.products,
  public.profiles,
  public.promotions,
  public.public_site_settings,
  public.refunds,
  public.reviews,
  public.role_permissions,
  public.roles,
  public.seo_settings,
  public.shipping_methods,
  public.shipping_rates,
  public.user_roles
 from anon,authenticated;

 -- Verify denial including privileges inherited through roles or explicit column ACLs.
 foreach relation_name in array relations loop
  foreach role_name in array case when relation_name in ('admin_audit_logs','site_settings')
   then array['authenticated'] else array['anon','authenticated'] end loop
   foreach privilege_name in array array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    if has_table_privilege(role_name,format('public.%I',relation_name),privilege_name) then
     raise exception 'RF_PRE013_ACL_PRIVILEGE_REMAINS: %.% %',relation_name,role_name,privilege_name;
    end if;
   end loop;
   for column_name in select attname from pg_attribute where attrelid=format('public.%I',relation_name)::regclass and attnum>0 and not attisdropped loop
    if has_column_privilege(role_name,format('public.%I',relation_name),column_name,'REFERENCES') then
     raise exception 'RF_PRE013_ACL_COLUMN_PRIVILEGE_REMAINS: %.%.%',relation_name,column_name,role_name;
    end if;
   end loop;
  end loop;
 end loop;
 -- @PRE013-POSTCHECK
 select encode(sha256(convert_to(jsonb_build_object(
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
 )::text,'UTF8')),'hex') into shape;
 if shape<>'a2ad954731059c790d88e4cdb49682979548a83a3a3fa52379551763a06464dc' then raise exception 'RF_PRE013_ACL_TARGET_DRIFT'; end if;
end;
$pre013_acl$;
commit;
