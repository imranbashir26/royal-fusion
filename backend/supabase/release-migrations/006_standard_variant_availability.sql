-- Release 006: ONE-SHOT guarded forward correction. No production authorization.
-- Requires exact post-014 catalog plus Release 005 hardened defaults and PG17.
-- Run under a separately approved maintenance window with application writes quiesced.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
set local search_path=pg_catalog,public;
do $pre$
declare shape text; acl jsonb;
begin
 if current_user <> 'postgres' or current_setting('server_version_num')::int not between 170000 and 179999
 or current_setting('transaction_isolation') <> 'read committed' then raise exception 'RF_RELEASE006_EXECUTION_CONTEXT'; end if;
 if not ((select count(*)=5 from pg_roles where rolname in
 ('postgres','anon','authenticated','service_role','supabase_admin'))
 and not exists(select 1 from pg_roles where rolname in ('anon','authenticated')
 and (rolsuper or rolcreaterole or rolcreatedb or rolbypassrls))
 and not exists(select 1 from pg_roles b cross join pg_roles r
 where b.rolname in ('anon','authenticated') and b.oid<>r.oid
 and (r.rolname in ('postgres','service_role','supabase_admin','pg_maintain') or r.rolsuper or r.rolcreaterole or r.rolbypassrls)
 and (pg_has_role(b.oid,r.oid,'USAGE') or pg_has_role(b.oid,r.oid,'SET')))) or not (exists(select 1 from pg_namespace n join pg_roles r on r.oid=n.nspowner
 where n.nspname='public' and r.rolname in ('postgres','pg_database_owner'))
 and exists(select 1 from pg_database d join pg_roles r on r.oid=d.datdba
 where d.datname=current_database() and r.rolname='postgres')) or not (not exists(select 1 from pg_default_acl where
 defaclrole=(select oid from pg_roles where rolname='postgres') and defaclnamespace=0 and defaclobjtype='r')) then raise exception 'RF_RELEASE006_SECURITY_DRIFT'; end if;
 perform pg_advisory_xact_lock(6006,14006);
 -- Variant-first, like checkout/admin. Failure to obtain these locks rolls back.
 lock table public.product_variants,public.products in access exclusive mode;
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
 if shape <> '9f09f8db7c51e08bb92fd8e0e1fa1de15c628456ba8b8ff88c5a3be2853b3987' then raise exception 'RF_RELEASE006_BASELINE_DRIFT'; end if;
 select coalesce(jsonb_agg(jsonb_build_array(g.rolname,r.rolname,a.privilege_type,a.is_grantable)
 order by g.rolname,r.rolname,a.privilege_type,a.is_grantable),'[]'::jsonb) into acl
 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
 join pg_roles g on g.oid=a.grantor left join pg_roles r on r.oid=a.grantee
 where d.defaclrole=(select oid from pg_roles where rolname='postgres')
 and d.defaclnamespace=to_regnamespace('public') and d.defaclobjtype='r';
 if acl is distinct from (select jsonb_agg(jsonb_build_array('postgres',x.grantee,x.privilege,false)
 order by x.grantee,x.privilege) state from (
 select 'postgres' grantee,p.name privilege
 from (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(name)
 union all
 select r.name grantee,p.name privilege from unnest(array['service_role']) r(name)
 cross join (values('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(name)
 ) x) then raise exception 'RF_RELEASE006_RELEASE005_REQUIRED'; end if;
end;
$pre$;
create temporary table rf006_metadata on commit drop as select jsonb_build_object(
 'defaults',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d),
 'roles',(select jsonb_agg(to_jsonb(r) order by oid) from pg_roles r),
 'memberships',(select jsonb_agg(to_jsonb(m) order by roleid,member,grantor) from pg_auth_members m),
 'schemas',(select jsonb_agg(to_jsonb(n) order by oid) from pg_namespace n where nspname !~ '^pg_temp_' and nspname !~ '^pg_toast_temp_'),
 'events',(select jsonb_agg(to_jsonb(e) order by oid) from pg_event_trigger e),
 'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p),
 'relations',(select jsonb_agg(jsonb_build_array(oid,relname,relowner,relacl,relrowsecurity,relforcerowsecurity) order by oid) from pg_class where relnamespace='public'::regnamespace),
 'functions',(select jsonb_agg(to_jsonb(p) - 'prosrc' order by oid) from pg_proc p where pronamespace='public'::regnamespace and proname <> 'derive_standard_availability'),
 'bodies',(select jsonb_agg(jsonb_build_array(oid,prosrc) order by oid) from pg_proc where pronamespace='public'::regnamespace and proname not in ('derive_standard_availability','save_catalog_product')),
 'triggers',(select jsonb_agg(to_jsonb(t) order by oid) from pg_trigger t where tgrelid in (select oid from pg_class where relnamespace='public'::regnamespace) and tgname <> 'variants_standard_availability')
) state;
create temporary table rf006_data(name text primary key,rows jsonb) on commit drop;
create temporary table rf006_triggers(name text,mode "char") on commit drop;
do $initialize$
declare r record; data jsonb; count_rows bigint;
begin
 -- Bound review scope without assuming historical product/order counts.
 for r in select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' order by relname loop
  execute format('select count(*) from public.%I',r.relname) into count_rows;
  if count_rows > 10000 then raise exception 'RF_RELEASE006_DATA_REVIEW_LIMIT: %',r.relname; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb) from public.%I x',r.relname) into data;
  insert into pg_temp.rf006_data values(r.relname,data);
 end loop;
 -- Suspend only row triggers on this exclusively locked table, preserving modes.
 -- No stock changes: prevents timestamp/revision/aggregate side effects of backfill.
 insert into pg_temp.rf006_triggers select tgname,tgenabled from pg_trigger
 where tgrelid='public.product_variants'::regclass and not tgisinternal;
 for r in select * from pg_temp.rf006_triggers loop
  execute format('alter table public.product_variants disable trigger %I',r.name);
 end loop;
 alter table public.product_variants add column standard_manual_available boolean not null default true;
 update public.product_variants v set standard_manual_available=v.available,
 available=v.available and v.stock_quantity>0
 from public.products p where p.id=v.product_id and p.commerce_kind='standard';
 for r in select * from pg_temp.rf006_triggers loop
  execute format('alter table public.product_variants %s trigger %I',
   case r.mode when 'O' then 'enable' when 'A' then 'enable always' when 'R' then 'enable replica' else 'disable' end,r.name);
 end loop;
end;
$initialize$;
create function public.derive_standard_availability() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
 if exists(select 1 from public.products where id=new.product_id and commerce_kind='standard') then
  new.available := new.standard_manual_available and new.stock_quantity>0;
 end if;
 return new;
end;
$fn$;
revoke all on function public.derive_standard_availability() from public,anon,authenticated,service_role;
create trigger variants_standard_availability before insert or update on public.product_variants
for each row execute function public.derive_standard_availability();
-- Keep the historical internal writer/tester writer and checkout/cancel functions intact.
-- Manual intent is resolved from locked BEFORE state, never from a derived stock flag.
create or replace function public.save_catalog_product(p_product_id uuid,p_patch jsonb,p_variants jsonb default null,p_expected_revision text default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare prior jsonb; saved jsonb; item jsonb; row_after jsonb; row_before jsonb;
 target_id uuid; manual boolean; option_value_normalized text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='Catalog saves require the backend service.'; end if;
 if exists(select 1 from public.products where id=p_product_id and commerce_kind='tester_pack') then raise exception 'TESTER_PACK_NORMAL_WRITER_DENIED'; end if;
 if exists(select 1 from public.products where id=p_product_id and commerce_kind='tester') then raise exception 'TESTER_SPECIAL_WRITER_REQUIRED'; end if;
 if p_product_id is not null then
  perform id from public.product_variants where product_id=p_product_id order by id for update;
  perform id from public.products where id=p_product_id for update;
 end if;
 select coalesce(jsonb_agg(to_jsonb(v)),'[]'::jsonb) into prior from public.product_variants v where product_id=p_product_id;
 saved := public.save_catalog_product_012_internal(p_product_id,p_patch,p_variants,p_expected_revision);
 if p_variants is not null then
  for item in select value from jsonb_array_elements(p_variants) loop
   if (item ? 'standardManualAvailable' and jsonb_typeof(item->'standardManualAvailable') <> 'boolean')
    or (item ? 'available' and jsonb_typeof(item->'available') <> 'boolean') then
    raise exception using errcode='22023',message='Invalid availability contract.';
   end if;
   option_value_normalized := regexp_replace(regexp_replace(trim(item->>'optionValue'),'\s+',' ','g'),'^(\d+(?:\.\d+)?)\s*ml$','\1 ml','i');
   select value into row_after from jsonb_array_elements(saved->'variants')
   where case when item->>'id' is not null then value->>'id'=item->>'id'
    else lower(value->>'option_name')=lower(trim(item->>'optionName')) and lower(value->>'option_value')=lower(option_value_normalized) end;
   if row_after is null then raise exception using errcode='22023',message='Variant identity could not be resolved.'; end if;
   target_id := (row_after->>'id')::uuid;
   select value into row_before from jsonb_array_elements(prior) where value->>'id'=target_id::text;
   manual := case
    when item ? 'standardManualAvailable' then (item->>'standardManualAvailable')::boolean
    when row_before is null then coalesce((item->>'available')::boolean,true)
    when item ? 'available' and (item->>'available')::boolean is distinct from (row_before->>'available')::boolean then (item->>'available')::boolean
    else (row_before->>'standard_manual_available')::boolean end;
   update public.product_variants set standard_manual_available=manual
    where id=target_id and standard_manual_available is distinct from manual;
  end loop;
 end if;
 -- Return the final derived state and revision, including any intent update.
 return jsonb_build_object('product',(select to_jsonb(p) from public.products p where id=(saved->'product'->>'id')::uuid),
 'variants',(select coalesce(jsonb_agg(to_jsonb(v) order by display_order,id),'[]'::jsonb) from public.product_variants v where product_id=(saved->'product'->>'id')::uuid));
end;
$fn$;
-- CREATE OR REPLACE preserves the reviewed service-only ACL; assert it below.
do $post$
declare before_state jsonb; after_state jsonb; data_snapshot_record record; actual jsonb; expected jsonb;
begin
 select state into before_state from pg_temp.rf006_metadata;
 select jsonb_build_object(
 'defaults',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d),
 'roles',(select jsonb_agg(to_jsonb(r) order by oid) from pg_roles r),
 'memberships',(select jsonb_agg(to_jsonb(m) order by roleid,member,grantor) from pg_auth_members m),
 'schemas',(select jsonb_agg(to_jsonb(n) order by oid) from pg_namespace n where nspname !~ '^pg_temp_' and nspname !~ '^pg_toast_temp_'),
 'events',(select jsonb_agg(to_jsonb(e) order by oid) from pg_event_trigger e),
 'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p),
 'relations',(select jsonb_agg(jsonb_build_array(oid,relname,relowner,relacl,relrowsecurity,relforcerowsecurity) order by oid) from pg_class where relnamespace='public'::regnamespace),
 'functions',(select jsonb_agg(to_jsonb(p) - 'prosrc' order by oid) from pg_proc p where pronamespace='public'::regnamespace and proname <> 'derive_standard_availability'),
 'bodies',(select jsonb_agg(jsonb_build_array(oid,prosrc) order by oid) from pg_proc where pronamespace='public'::regnamespace and proname not in ('derive_standard_availability','save_catalog_product')),
 'triggers',(select jsonb_agg(to_jsonb(t) order by oid) from pg_trigger t where tgrelid in (select oid from pg_class where relnamespace='public'::regnamespace) and tgname <> 'variants_standard_availability')
) into after_state;
 if after_state is distinct from before_state then raise exception 'RF_RELEASE006_METADATA_PRESERVATION_FAILED'; end if;
 for data_snapshot_record in select * from pg_temp.rf006_data loop
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb) from public.%I x',data_snapshot_record.name) into actual;
  expected:=data_snapshot_record.rows;
  if data_snapshot_record.name='product_variants' then
   select coalesce(jsonb_agg(value || jsonb_build_object('standard_manual_available',case when p.commerce_kind='standard' then (value->>'available')::boolean else true end,
    'available',case when p.commerce_kind='standard' then (value->>'available')::boolean and (value->>'stock_quantity')::int>0 else (value->>'available')::boolean end)
    order by (value || jsonb_build_object('standard_manual_available',case when p.commerce_kind='standard' then (value->>'available')::boolean else true end,
    'available',case when p.commerce_kind='standard' then (value->>'available')::boolean and (value->>'stock_quantity')::int>0 else (value->>'available')::boolean end))::text),'[]'::jsonb)
    into expected from jsonb_array_elements(data_snapshot_record.rows) join public.products p on p.id=(value->>'product_id')::uuid;
  end if;
  if actual is distinct from expected then raise exception 'RF_RELEASE006_DATA_PRESERVATION_FAILED: %',data_snapshot_record.name; end if;
 end loop;
 if exists(select 1 from public.product_variants v join public.products p on p.id=v.product_id
 where p.commerce_kind='standard' and v.available is distinct from (v.standard_manual_available and v.stock_quantity>0)) then raise exception 'RF_RELEASE006_AVAILABILITY_INVARIANT'; end if;
 if has_function_privilege('anon','public.save_catalog_product(uuid,jsonb,jsonb,text)','EXECUTE')
 or has_function_privilege('authenticated','public.save_catalog_product(uuid,jsonb,jsonb,text)','EXECUTE')
 or not has_function_privilege('service_role','public.save_catalog_product(uuid,jsonb,jsonb,text)','EXECUTE')
 or exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role') and has_function_privilege(oid,'public.derive_standard_availability()','EXECUTE')) then raise exception 'RF_RELEASE006_EXECUTION_ACL'; end if;
 if not exists(select 1 from pg_attribute where attrelid='public.product_variants'::regclass and attname='standard_manual_available' and attnotnull and atttypid='boolean'::regtype)
 or not exists(select 1 from pg_trigger where tgrelid='public.product_variants'::regclass and tgname='variants_standard_availability' and tgenabled='O' and tgtype=23)
 then raise exception 'RF_RELEASE006_POSTCONDITION'; end if;
end;
$post$;
commit;
