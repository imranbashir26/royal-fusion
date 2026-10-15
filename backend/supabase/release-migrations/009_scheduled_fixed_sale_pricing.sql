-- Release 009: scheduled fixed sale pricing. Local only; ordering remains disabled.
-- Quiesce catalog/checkout writers; NOWAIT aborts instead of waiting through live traffic.
-- One-shot exact post-008 PG17 predecessor, read committed; maintenance writes quiesced.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
set local search_path=pg_catalog,public;
do $pre$
declare shape text; acl jsonb;
begin
 if current_user <> 'postgres' or current_setting('server_version_num')::int not between 170000 and 179999
 or current_setting('transaction_isolation') <> 'read committed' then raise exception 'RF_RELEASE009_EXECUTION_CONTEXT'; end if;
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
 defaclrole=(select oid from pg_roles where rolname='postgres') and defaclnamespace=0 and defaclobjtype='r')) then raise exception 'RF_RELEASE009_SECURITY_DRIFT'; end if;
 perform pg_advisory_xact_lock(6009,14009);
 -- Variant-first, like checkout/admin. Failure to obtain these locks rolls back.
 lock table public.product_variants,public.products,public.orders,public.tester_packs in access exclusive mode nowait;
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
 if shape <> '00bf3eb3276b0ddf57d260397f117c30c175d29c86d8cc9c9c9c33476a8663b3' then raise exception 'RF_RELEASE009_BASELINE_DRIFT'; end if;
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
 ) x) then raise exception 'RF_RELEASE009_RELEASE005_REQUIRED'; end if;
end;
$pre$;


-- Preserve all existing public-table data, including issued attempts and financial snapshots.
create temporary table rf009_data(name text primary key, rows jsonb) on commit drop;
create temporary table rf009_security on commit drop as select jsonb_build_object(
 'roles',(select jsonb_agg(to_jsonb(r) order by oid) from pg_roles r),
 'memberships',(select jsonb_agg(to_jsonb(m) order by roleid,member,grantor) from pg_auth_members m),
 'defaults',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d),
 'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p)) state;
do $data$
declare name text; rows jsonb;
begin
 for name in select c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' order by c.relname loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)),''[]''::jsonb) from public.%I t',name) into rows;
  insert into pg_temp.rf009_data values(name,rows);
 end loop;
 if exists(select 1 from public.product_variants where regular_price='NaN'::numeric or sale_price='NaN'::numeric)
 or exists(select 1 from public.tester_packs where fixed_regular_price='NaN'::numeric or fixed_sale_price='NaN'::numeric)
 then raise exception 'RF_RELEASE009_INVALID_LEGACY_PRICE'; end if;
end; $data$;
alter table public.product_variants add column sale_starts_at timestamptz, add column sale_ends_at timestamptz;
alter table public.tester_packs add column fixed_sale_starts_at timestamptz, add column fixed_sale_ends_at timestamptz;
alter table public.product_variants add constraint variants_sale_schedule_009 check(
 regular_price<>'NaN'::numeric and (sale_price is null or sale_price<>'NaN'::numeric)
 and (sale_starts_at is null or isfinite(sale_starts_at)) and (sale_ends_at is null or isfinite(sale_ends_at))
 and (sale_price is not null or (sale_starts_at is null and sale_ends_at is null))
 and (sale_starts_at is null or sale_ends_at is null or sale_starts_at<sale_ends_at));
alter table public.tester_packs add constraint packs_sale_schedule_009 check(
 (fixed_regular_price is null or fixed_regular_price<>'NaN'::numeric) and (fixed_sale_price is null or fixed_sale_price<>'NaN'::numeric)
 and (fixed_sale_starts_at is null or isfinite(fixed_sale_starts_at)) and (fixed_sale_ends_at is null or isfinite(fixed_sale_ends_at))
 and (fixed_sale_price is not null or (fixed_sale_starts_at is null and fixed_sale_ends_at is null))
 and (mode='fixed' or (fixed_sale_starts_at is null and fixed_sale_ends_at is null))
 and (fixed_sale_starts_at is null or fixed_sale_ends_at is null or fixed_sale_starts_at<fixed_sale_ends_at));

-- Data-free, invoker arithmetic. Public callers cannot supply checkout's pricing instant.
create function public.effective_sale_price_009(p_regular numeric,p_sale numeric,p_start timestamptz,p_end timestamptz,p_at timestamptz)
returns numeric language plpgsql immutable set search_path='' as $fn$
begin
 if p_regular is null or p_regular::text in ('NaN','Infinity','-Infinity') or p_regular<=0 or p_regular>9999999999.99 or p_regular<>round(p_regular,2)
 or p_at is null or not isfinite(p_at) or (p_start is not null and not isfinite(p_start)) or (p_end is not null and not isfinite(p_end))
 or (p_start is not null and p_end is not null and p_start>=p_end)
 or (p_sale is null and (p_start is not null or p_end is not null))
 or (p_sale is not null and (p_sale::text in ('NaN','Infinity','-Infinity') or p_sale<=0 or p_sale>=p_regular or p_sale<>round(p_sale,2)))
 then raise exception using errcode='22023',message='SCHEDULED_PRICE_INVALID'; end if;
 return case when p_sale is not null and (p_start is null or p_at>=p_start) and (p_end is null or p_at<p_end) then p_sale else p_regular end;
end; $fn$;
revoke all on function public.effective_sale_price_009(numeric,numeric,timestamptz,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.effective_sale_price_009(numeric,numeric,timestamptz,timestamptz,timestamptz) to anon,authenticated,service_role;

-- JSON dates must identify their offset. Null is an explicit clear; absence is handled by each writer.
create function public.sale_timestamp_009(p_value jsonb) returns timestamptz language plpgsql immutable set search_path='' as $fn$
declare value timestamptz;
begin
 if p_value is null or p_value='null'::jsonb then return null; end if;
 if jsonb_typeof(p_value)<>'string' or (p_value#>>'{}') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
 then raise exception using errcode='22023',message='SALE_TIMESTAMP_INVALID'; end if;
 value:=(p_value#>>'{}')::timestamptz;
 if not isfinite(value) then raise exception using errcode='22023',message='SALE_TIMESTAMP_INVALID'; end if;
 return value;
end; $fn$;
revoke all on function public.sale_timestamp_009(jsonb) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.save_catalog_product_012_internal(p_product_id uuid, p_patch jsonb, p_variants jsonb DEFAULT NULL::jsonb, p_expected_revision text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  previous public.products%rowtype;
  saved public.products%rowtype;
  variant public.product_variants%rowtype;
  patch jsonb := p_patch - 'stock_quantity' - 'stock_status';
  item jsonb;
  allowed text[] := array[
    'name','slug','sku','short_description','description','price','sale_price','old_price',
    'stock_quantity','category_id','category_name','collection','gender','scent_family',
    'top_notes','middle_notes','base_notes','bottle_size','concentration','longevity',
    'sillage','occasion','inspired_by','main_image_url','gallery_urls','image_alt','badge',
    'tags','size_options','variations','is_featured','is_best_seller','is_new_arrival',
    'is_premium','is_attar','status','seo_title','seo_description','card_image_url',
    'card_hover_image_url','card_background_color','active','published_at'
  ];
  names text;
  expressions text;
  assignments text;
  size_value text;
  variant_count integer;
  wanted_stock integer;
  seen_ids uuid[] := '{}';
  total_stock integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Catalog saves require the backend service.';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or (p_patch = '{}'::jsonb and (p_product_id is null or p_variants is null))
     or exists (select 1 from jsonb_object_keys(p_patch) k where not (k = any(allowed))) then
    raise exception using errcode = '22023', message = 'Invalid catalog patch.';
  end if;
  if p_variants is not null and (jsonb_typeof(p_variants) <> 'array'
      or jsonb_array_length(p_variants) not between 1 and 50) then
    raise exception using errcode = '22023', message = 'Invalid variants.';
  end if;

  if p_product_id is not null then
    -- Same variant-first order as checkout; never delete or recreate inventory rows.
    perform id from public.product_variants where product_id = p_product_id order by id for update;
    select * into previous from public.products where id = p_product_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Product not found.';
    end if;
  end if;

  if p_product_id is not null then
    if (p_variants is not null or p_patch ? 'stock_quantity') and p_expected_revision is null then
      raise exception using errcode = 'P0001', message = 'CATALOG_STALE';
    end if;
    if p_expected_revision is not null and previous.catalog_revision::text <> p_expected_revision then
      raise exception using errcode = 'P0001', message = 'CATALOG_STALE';
    end if;
  end if;

  if patch ? 'bottle_size' then
    size_value := regexp_replace(trim(patch->>'bottle_size'), '\s+', ' ', 'g');
    size_value := regexp_replace(size_value, '^(\d+(?:\.\d+)?)\s*ml$', '\1 ml', 'i');
    patch := jsonb_set(patch, '{bottle_size}', to_jsonb(size_value));
  end if;
  -- Identifiers originate only in the allowlist above; values remain bound parameters.
  select string_agg(format('%I', k), ',' order by k),
         string_agg(format('r.%I', k), ',' order by k),
         string_agg(format('%I = r.%I', k, k), ',' order by k)
    into names, expressions, assignments
  from jsonb_object_keys(patch) k;

  if p_product_id is null then
    if names is null then
      raise exception using errcode = '22023', message = 'Product fields are required.';
    end if;
    execute format('insert into public.products (%s) select %s from jsonb_populate_record(null::public.products, $1) r returning *', names, expressions)
      into saved using patch;
  else
    if names is not null then
      execute format('update public.products p set %s from jsonb_populate_record(null::public.products, $1) r where p.id = $2 returning p.*', assignments)
        into saved using patch, p_product_id;
    else
      saved := previous;
    end if;
  end if;

  if p_variants is not null then
    for item in select value from jsonb_array_elements(p_variants) loop
      if jsonb_typeof(item) <> 'object' or not (item ?& array['optionName','optionValue','sku','regularPrice','stockQuantity','active','displayOrder']) then
        raise exception using errcode = '22023', message = 'Invalid variant contract.';
      end if;
      perform public.sale_timestamp_009(item->'saleStartsAt');
      perform public.sale_timestamp_009(item->'saleEndsAt');
      if nullif((item->>'salePrice')::numeric,0) is null and
       (coalesce(item->'saleStartsAt','null')<>'null'::jsonb or coalesce(item->'saleEndsAt','null')<>'null'::jsonb)
      then raise exception using errcode='22023',message='SALE_WINDOW_WITHOUT_PRICE'; end if;
      size_value := regexp_replace(trim(item->>'optionValue'), '\s+', ' ', 'g');
      size_value := regexp_replace(size_value, '^(\d+(?:\.\d+)?)\s*ml$', '\1 ml', 'i');
      variant := null;
      if item->>'id' is not null then
        select * into variant from public.product_variants
          where id = (item->>'id')::uuid and product_id = saved.id;
        if not found then
          raise exception using errcode = '22023', message = 'Variant does not belong to this product.';
        end if;
      else
        select count(*) into variant_count from public.product_variants
          where product_id = saved.id and (
            (lower(option_name) = lower(trim(item->>'optionName'))
             and lower(regexp_replace(regexp_replace(trim(option_value), '\s+', ' ', 'g'), '^(\d+(?:\.\d+)?)\s*ml$', '\1 ml', 'i')) = lower(size_value))
            or lower(sku) = lower(trim(item->>'sku'))
          );
        if variant_count > 1 then
          raise exception using errcode = '23505', message = 'Ambiguous variant identity; supply the existing UUID.';
        end if;
        select * into variant from public.product_variants
          where product_id = saved.id and (
            (lower(option_name) = lower(trim(item->>'optionName'))
             and lower(regexp_replace(regexp_replace(trim(option_value), '\s+', ' ', 'g'), '^(\d+(?:\.\d+)?)\s*ml$', '\1 ml', 'i')) = lower(size_value))
            or lower(sku) = lower(trim(item->>'sku'))
          );
      end if;
      if variant.id is null then
        insert into public.product_variants(product_id, option_name, option_value, sku,
          regular_price, sale_price, sale_starts_at, sale_ends_at, stock_quantity, active, available, display_order)
        values (saved.id, trim(item->>'optionName'), size_value, trim(item->>'sku'),
          (item->>'regularPrice')::numeric, nullif((item->>'salePrice')::numeric, 0),
          public.sale_timestamp_009(item->'saleStartsAt'),public.sale_timestamp_009(item->'saleEndsAt'),
          (item->>'stockQuantity')::integer, (item->>'active')::boolean,
          coalesce((item->>'available')::boolean, (item->>'stockQuantity')::integer > 0),
          (item->>'displayOrder')::integer) returning * into variant;
      else
        if variant.id = any(seen_ids) then
          raise exception using errcode = '23505', message = 'Duplicate variant option.';
        end if;
        update public.product_variants set option_name = trim(item->>'optionName'), option_value = size_value,
          sku = trim(item->>'sku'), regular_price = (item->>'regularPrice')::numeric,
          sale_price = nullif((item->>'salePrice')::numeric, 0),
          sale_starts_at = case when nullif((item->>'salePrice')::numeric,0) is null then null when item ? 'saleStartsAt' then public.sale_timestamp_009(item->'saleStartsAt') else variant.sale_starts_at end,
          sale_ends_at = case when nullif((item->>'salePrice')::numeric,0) is null then null when item ? 'saleEndsAt' then public.sale_timestamp_009(item->'saleEndsAt') else variant.sale_ends_at end,
          stock_quantity = (item->>'stockQuantity')::integer,
          active = (item->>'active')::boolean,
          available = coalesce((item->>'available')::boolean, (item->>'stockQuantity')::integer > 0),
          display_order = (item->>'displayOrder')::integer where id = variant.id returning * into variant;
      end if;
      seen_ids := array_append(seen_ids, variant.id);
    end loop;
    -- Omitted variants are retained, not implicitly deleted or deactivated.
  else
    select count(*) into variant_count from public.product_variants where product_id = saved.id;
    if variant_count > 1 then
      if (p_patch ? 'stock_quantity' and (p_patch->>'stock_quantity')::integer is distinct from previous.stock_quantity)
        or (p_patch ? 'price' and saved.price is distinct from previous.price)
        or (p_patch ? 'sale_price' and saved.sale_price is distinct from previous.sale_price)
        or (p_patch ? 'sku' and saved.sku is distinct from previous.sku)
        or (p_patch ? 'bottle_size' and saved.bottle_size is distinct from previous.bottle_size) then
        raise exception using errcode = '22023', message = 'Multi-variant inventory requires explicit variants.';
      end if;
    elsif variant_count = 1 then
      select * into variant from public.product_variants where product_id = saved.id;
      update public.product_variants set
        option_value = case when patch ? 'bottle_size' then saved.bottle_size else option_value end,
        sku = case when patch ? 'sku' then saved.sku else sku end,
        regular_price = case when patch ? 'price' then saved.price else regular_price end,
        sale_price = case when patch ? 'sale_price' then nullif(saved.sale_price, 0) else sale_price end,
        sale_starts_at = case when patch ? 'sale_price' and nullif(saved.sale_price,0) is null then null else sale_starts_at end,
        sale_ends_at = case when patch ? 'sale_price' and nullif(saved.sale_price,0) is null then null else sale_ends_at end,
        stock_quantity = case when p_patch ? 'stock_quantity' then (p_patch->>'stock_quantity')::integer else stock_quantity end,
        available = case when p_patch ? 'stock_quantity' then (p_patch->>'stock_quantity')::integer > 0 else available end
      where id = variant.id;
    elsif trim(saved.bottle_size) <> '' and saved.status <> 'Archived' then
      wanted_stock := coalesce((p_patch->>'stock_quantity')::integer, previous.stock_quantity, 0);
      size_value := regexp_replace(regexp_replace(trim(saved.bottle_size), '\s+', ' ', 'g'), '^(\d+(?:\.\d+)?)\s*ml$', '\1 ml', 'i');
      insert into public.product_variants(product_id, option_name, option_value, sku,
        regular_price, sale_price, stock_quantity, active, available)
      values(saved.id, 'Size', size_value, saved.sku, saved.price,
        nullif(saved.sale_price, 0), wanted_stock, true, wanted_stock > 0);
      update public.products set bottle_size = size_value where id = saved.id;
    elsif saved.status = 'Published' and saved.active then
      raise exception using errcode = '22023', message = 'Published products require a size or explicit variants.';
    elsif coalesce((p_patch->>'stock_quantity')::integer, previous.stock_quantity, 0) <> 0 then
      raise exception using errcode = '22023', message = 'Stock requires a size or explicit variants.';
    end if;
  end if;

  if saved.status = 'Published' and saved.active and not exists (
    select 1 from public.product_variants where product_id = saved.id and active
  ) then
    raise exception using errcode = '22023', message = 'Published products require an active variant.';
  end if;
  select coalesce(sum(stock_quantity), 0)::integer into total_stock
    from public.product_variants where product_id = saved.id and active;
  update public.products set stock_quantity = total_stock,
    stock_status = case when total_stock = 0 then 'Out of Stock' when total_stock <= 5 then 'Low Stock' else 'In Stock' end
    where id = saved.id returning * into saved;
  return jsonb_build_object('product', to_jsonb(saved), 'variants', coalesce((
    select jsonb_agg(to_jsonb(v) order by display_order, id) from public.product_variants v where product_id = saved.id
  ), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_tester_product(p_product_id uuid, p_patch jsonb, p_variant jsonb, p_source_product_id uuid, p_expected_revision text, p_actor_id uuid, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare saved public.products%rowtype; reg public.tester_variants%rowtype; v public.product_variants%rowtype; result jsonb; changed boolean;
begin
 perform public.tester_catalog_assert_admin(p_actor_id,p_request_id);
 if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_variant is null or jsonb_typeof(p_variant)<>'object'
 or octet_length(jsonb_build_array(p_patch,p_variant)::text)>32768
 or p_variant->>'optionName' is distinct from 'Size' or p_variant->>'optionValue' is distinct from '5 ml'
 or exists(select 1 from jsonb_object_keys(p_variant) k where k not in ('id','optionName','optionValue','sku','regularPrice','salePrice','stockQuantity','active','available','displayOrder','saleStartsAt','saleEndsAt'))
 or jsonb_typeof(p_variant->'regularPrice') is distinct from 'number' or jsonb_typeof(p_variant->'stockQuantity') is distinct from 'number'
 or jsonb_typeof(p_variant->'active') is distinct from 'boolean' or jsonb_typeof(p_variant->'available') is distinct from 'boolean'
 or jsonb_typeof(p_variant->'displayOrder') is distinct from 'number' or jsonb_typeof(p_variant->'sku') is distinct from 'string'
 or not(p_variant ?& array['optionName','optionValue','sku','regularPrice','stockQuantity','active','available','displayOrder']) then raise exception 'TESTER_PATCH_INVALID'; end if;
 -- Stock is variant-authoritative, never compare/write the aggregate product alias as inventory.
 p_patch:=p_patch - 'stock_quantity' - 'stock_status';
 if p_product_id is not null then
  -- Match checkout and existing writer: all sibling inventory rows, then parent.
  perform id from public.product_variants where product_id=p_product_id order by id for update;
  select * into saved from public.products where id=p_product_id for update;
  if not found or saved.commerce_kind<>'tester' then raise exception 'TESTER_NOT_FOUND'; end if;
  if p_expected_revision is null or saved.catalog_revision::text<>p_expected_revision then raise exception 'CATALOG_STALE'; end if;
  select * into reg from public.tester_variants where tester_product_id=saved.id;
  select * into v from public.product_variants where id=reg.variant_id;
  if p_variant->>'id' is distinct from reg.variant_id::text then raise exception 'TESTER_IDENTITY_IMMUTABLE'; end if;
  changed:=not(to_jsonb(saved) @> p_patch) or reg.source_product_id is distinct from p_source_product_id
   or jsonb_build_object('id',v.id,'optionName',v.option_name,'optionValue',v.option_value,'sku',v.sku,'regularPrice',v.regular_price,
    'salePrice',v.sale_price,'saleStartsAt',v.sale_starts_at,'saleEndsAt',v.sale_ends_at,'stockQuantity',v.stock_quantity,'active',v.active,'available',reg.manual_available,'displayOrder',v.display_order)
    is distinct from (p_variant || jsonb_build_object('salePrice',p_variant->'salePrice',
     'saleStartsAt',case when nullif((p_variant->>'salePrice')::numeric,0) is null then null when p_variant ? 'saleStartsAt' then public.sale_timestamp_009(p_variant->'saleStartsAt') else v.sale_starts_at end,
     'saleEndsAt',case when nullif((p_variant->>'salePrice')::numeric,0) is null then null when p_variant ? 'saleEndsAt' then public.sale_timestamp_009(p_variant->'saleEndsAt') else v.sale_ends_at end));
  if not changed then return jsonb_build_object('product',to_jsonb(saved),'variants',jsonb_build_array(to_jsonb(v)),'tester',to_jsonb(reg)); end if;
 else
  if p_expected_revision is not null or p_variant ? 'id' then raise exception 'TESTER_PATCH_INVALID'; end if;
 end if;
 if p_source_product_id is not null and not exists(select 1 from public.products where id=p_source_product_id and commerce_kind='standard') then raise exception 'TESTER_SOURCE_INVALID'; end if;
 saved:=public.tester_product_patch(p_product_id,p_patch || jsonb_build_object('bottle_size','5 ml'),'tester');
 -- For this tester-only writer, p_variant.available is manual Admin intent.
 -- Existing registrations are updated only after the variant-first locks above.
 if p_product_id is not null then
  update public.tester_variants set source_product_id=p_source_product_id,manual_available=(p_variant->>'available')::boolean
  where tester_product_id=saved.id and (source_product_id,manual_available) is distinct from (p_source_product_id,(p_variant->>'available')::boolean);
  -- Synchronization may advance the existing aggregate catalog revision.
  select * into saved from public.products where id=saved.id;
 end if;
 result:=public.save_catalog_product_012_internal(saved.id,'{}'::jsonb,
  jsonb_build_array(p_variant || jsonb_build_object('available',(p_variant->>'available')::boolean and (p_variant->>'stockQuantity')::integer>0)),saved.catalog_revision::text);
 if p_product_id is null then
  insert into public.tester_variants(variant_id,tester_product_id,source_product_id,manual_available)
  values((result->'variants'->0->>'id')::uuid,saved.id,p_source_product_id,(p_variant->>'available')::boolean);
 end if;
 insert into public.admin_audit_logs(admin_id,action,resource,resource_id,permission_key,request_id,metadata)
 values(p_actor_id,case when p_product_id is null then 'tester.create' else 'tester.update' end,'products',saved.id::text,'products.manage',p_request_id,'{}');
 return result || jsonb_build_object('variants',(select jsonb_agg(to_jsonb(physical) order by physical.id) from public.product_variants physical where physical.product_id=saved.id),
  'tester',(select to_jsonb(t) from public.tester_variants t where tester_product_id=saved.id));
end;
$function$;

CREATE OR REPLACE FUNCTION public.tester_pack_definition_hash(p_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((pg_catalog.jsonb_build_object(
  'mode',d.mode,'minimum',d.minimum_units,'maximum',d.maximum_units,'regular',d.fixed_regular_price,
  'sale',d.fixed_sale_price,'available',d.manual_available,'status',p.status,'active',p.active,
  'components',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.tester_variant_id,c.quantity_per_pack) order by c.tester_variant_id)
    from public.tester_pack_components c where c.pack_id=d.product_id),'[]'::jsonb),
  'allowed',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.tester_variant_id,a.active) order by a.tester_variant_id)
    from public.tester_pack_allowed_variants a where a.pack_id=d.product_id),'[]'::jsonb)
  ) || case when d.fixed_sale_starts_at is null and d.fixed_sale_ends_at is null then '{}'::jsonb
 else pg_catalog.jsonb_build_object('saleWindow',pg_catalog.jsonb_build_array(extract(epoch from d.fixed_sale_starts_at),extract(epoch from d.fixed_sale_ends_at))) end)::text,'UTF8')),'hex') from public.tester_packs d join public.products p on p.id=d.product_id where d.product_id=p_id;
$function$;

CREATE OR REPLACE FUNCTION public.save_tester_pack(p_product_id uuid, p_patch jsonb, p_definition jsonb, p_expected_revision text, p_expected_definition_revision text, p_actor_id uuid, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare saved public.products%rowtype; d public.tester_packs%rowtype; old_product jsonb; old_definition jsonb;
 item jsonb; ids uuid[]; member_id uuid; hash text; changed boolean:=false; previous_members jsonb;
begin
 perform public.tester_catalog_assert_admin(p_actor_id,p_request_id);
 if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_definition is null or jsonb_typeof(p_definition)<>'object'
 or octet_length(jsonb_build_array(p_patch,p_definition)::text)>32768
 or exists(select 1 from jsonb_each(p_definition) e where (e.key in ('minimumUnits','maximumUnits','fixedRegularPrice','fixedSalePrice') and jsonb_typeof(e.value) not in ('number','null')) or (e.key='manualAvailable' and jsonb_typeof(e.value)<>'boolean'))
 or exists(select 1 from jsonb_each(p_definition) e where e.key in ('fixedSaleStartsAt','fixedSaleEndsAt') and jsonb_typeof(e.value) not in ('string','null'))
  or exists(select 1 from jsonb_object_keys(p_definition) k where k not in ('fixedSaleStartsAt','fixedSaleEndsAt','mode','minimumUnits','maximumUnits','fixedRegularPrice','fixedSalePrice','manualAvailable','components','allowedVariants'))
 or exists(select 1 from jsonb_object_keys(p_patch) k where k in ('price','sale_price','old_price','stock_quantity','stock_status','bottle_size','size_options','variations')) then raise exception 'TESTER_PATCH_INVALID'; end if;
 perform public.sale_timestamp_009(p_definition->'fixedSaleStartsAt');
 perform public.sale_timestamp_009(p_definition->'fixedSaleEndsAt');
 if p_definition ? 'fixedSalePrice' and p_definition->'fixedSalePrice'='null'::jsonb and
  (coalesce(p_definition->'fixedSaleStartsAt','null')<>'null'::jsonb or coalesce(p_definition->'fixedSaleEndsAt','null')<>'null'::jsonb)
 then raise exception using errcode='22023',message='SALE_WINDOW_WITHOUT_PRICE'; end if;
 if p_product_id is not null then
  -- Catalog pack writers never mutate component inventory and acquire only their own parent first.
  select * into saved from public.products where id=p_product_id for update;
  if not found or saved.commerce_kind<>'tester_pack' then raise exception 'TESTER_NOT_FOUND'; end if;
  select * into d from public.tester_packs where product_id=saved.id for update;
  if p_expected_revision is null or p_expected_definition_revision is null
   or saved.catalog_revision::text<>p_expected_revision or d.definition_revision::text<>p_expected_definition_revision then raise exception 'CATALOG_STALE'; end if;
  if p_definition ? 'mode' and p_definition->>'mode' is distinct from d.mode then raise exception 'TESTER_MODE_IMMUTABLE'; end if;
  old_product:=to_jsonb(saved); old_definition:=to_jsonb(d);
 else
  if p_expected_revision is not null or p_expected_definition_revision is not null then raise exception 'TESTER_PATCH_INVALID'; end if;
  changed:=true;
 end if;
 saved:=public.tester_product_patch(p_product_id,case when p_product_id is null then p_patch ||
  jsonb_build_object('price',null,'sale_price',null,'old_price',null,'stock_quantity',0,'bottle_size','','size_options','[]'::jsonb,'variations','[]'::jsonb) else p_patch end,'tester_pack');
 if p_product_id is null then
  insert into public.tester_packs(product_id,mode,minimum_units,maximum_units,fixed_regular_price,fixed_sale_price,fixed_sale_starts_at,fixed_sale_ends_at,manual_available,definition_fingerprint)
  values(saved.id,p_definition->>'mode',case when p_definition->>'mode'='configurable' then coalesce((p_definition->>'minimumUnits')::integer,2) else (p_definition->>'minimumUnits')::integer end,
   (p_definition->>'maximumUnits')::integer,(p_definition->>'fixedRegularPrice')::numeric,(p_definition->>'fixedSalePrice')::numeric,
   public.sale_timestamp_009(p_definition->'fixedSaleStartsAt'),public.sale_timestamp_009(p_definition->'fixedSaleEndsAt'),
   coalesce((p_definition->>'manualAvailable')::boolean,true),repeat('0',64)) returning * into d;
 else
  update public.tester_packs set
   minimum_units=case when p_definition ? 'minimumUnits' then (p_definition->>'minimumUnits')::integer else minimum_units end,
   maximum_units=case when p_definition ? 'maximumUnits' then (p_definition->>'maximumUnits')::integer else maximum_units end,
   fixed_regular_price=case when p_definition ? 'fixedRegularPrice' then (p_definition->>'fixedRegularPrice')::numeric else fixed_regular_price end,
   fixed_sale_price=case when p_definition ? 'fixedSalePrice' then (p_definition->>'fixedSalePrice')::numeric else fixed_sale_price end,
   fixed_sale_starts_at=case when p_definition ? 'fixedSalePrice' and p_definition->'fixedSalePrice'='null'::jsonb then null when p_definition ? 'fixedSaleStartsAt' then public.sale_timestamp_009(p_definition->'fixedSaleStartsAt') else fixed_sale_starts_at end,
   fixed_sale_ends_at=case when p_definition ? 'fixedSalePrice' and p_definition->'fixedSalePrice'='null'::jsonb then null when p_definition ? 'fixedSaleEndsAt' then public.sale_timestamp_009(p_definition->'fixedSaleEndsAt') else fixed_sale_ends_at end,
   manual_available=case when p_definition ? 'manualAvailable' then (p_definition->>'manualAvailable')::boolean else manual_available end
  where product_id=saved.id and (minimum_units,maximum_units,fixed_regular_price,fixed_sale_price,fixed_sale_starts_at,fixed_sale_ends_at,manual_available) is distinct from (
   case when p_definition ? 'minimumUnits' then (p_definition->>'minimumUnits')::integer else minimum_units end,
   case when p_definition ? 'maximumUnits' then (p_definition->>'maximumUnits')::integer else maximum_units end,
   case when p_definition ? 'fixedRegularPrice' then (p_definition->>'fixedRegularPrice')::numeric else fixed_regular_price end,
   case when p_definition ? 'fixedSalePrice' then (p_definition->>'fixedSalePrice')::numeric else fixed_sale_price end,
   case when p_definition ? 'fixedSalePrice' and p_definition->'fixedSalePrice'='null'::jsonb then null when p_definition ? 'fixedSaleStartsAt' then public.sale_timestamp_009(p_definition->'fixedSaleStartsAt') else fixed_sale_starts_at end,
   case when p_definition ? 'fixedSalePrice' and p_definition->'fixedSalePrice'='null'::jsonb then null when p_definition ? 'fixedSaleEndsAt' then public.sale_timestamp_009(p_definition->'fixedSaleEndsAt') else fixed_sale_ends_at end,
   case when p_definition ? 'manualAvailable' then (p_definition->>'manualAvailable')::boolean else manual_available end);
  changed:=changed or found;
 end if;
 if p_definition ? 'components' then
  if d.mode<>'fixed' or jsonb_typeof(p_definition->'components')<>'array' or jsonb_array_length(p_definition->'components')>100 then raise exception 'TESTER_MEMBERSHIP_INVALID'; end if;
  ids:='{}';
  for item in select value from jsonb_array_elements(p_definition->'components') loop
   if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'testerVariantId') is distinct from 'string' or jsonb_typeof(item->'quantityPerPack') is distinct from 'number' or jsonb_typeof(item->'displayOrder') is distinct from 'number' or not(item ?& array['testerVariantId','quantityPerPack','displayOrder'])
    or exists(select 1 from jsonb_object_keys(item) k where k not in ('testerVariantId','quantityPerPack','displayOrder')) then raise exception 'TESTER_MEMBERSHIP_INVALID'; end if;
   member_id:=(item->>'testerVariantId')::uuid;
   if member_id is null or member_id=any(ids) then raise exception 'TESTER_MEMBERSHIP_INVALID'; end if;
   ids:=array_append(ids,member_id);
   insert into public.tester_pack_components(pack_id,tester_variant_id,quantity_per_pack,display_order)
   values(saved.id,member_id,(item->>'quantityPerPack')::integer,(item->>'displayOrder')::integer)
   on conflict(pack_id,tester_variant_id) do update set quantity_per_pack=excluded.quantity_per_pack,display_order=excluded.display_order
    where (tester_pack_components.quantity_per_pack,tester_pack_components.display_order) is distinct from (excluded.quantity_per_pack,excluded.display_order);
   changed:=changed or found;
  end loop;
  delete from public.tester_pack_components where pack_id=saved.id and not(tester_variant_id=any(ids)); changed:=changed or found;
 end if;
 if p_definition ? 'allowedVariants' then
  if d.mode<>'configurable' or jsonb_typeof(p_definition->'allowedVariants')<>'array' or jsonb_array_length(p_definition->'allowedVariants')>100 then raise exception 'TESTER_MEMBERSHIP_INVALID'; end if;
  ids:='{}';
  for item in select value from jsonb_array_elements(p_definition->'allowedVariants') loop
   if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'testerVariantId') is distinct from 'string' or jsonb_typeof(item->'active') is distinct from 'boolean' or jsonb_typeof(item->'displayOrder') is distinct from 'number' or not(item ?& array['testerVariantId','active','displayOrder'])
    or exists(select 1 from jsonb_object_keys(item) k where k not in ('testerVariantId','active','displayOrder')) then raise exception 'TESTER_MEMBERSHIP_INVALID'; end if;
   member_id:=(item->>'testerVariantId')::uuid;
   if member_id is null or member_id=any(ids) then raise exception 'TESTER_MEMBERSHIP_INVALID'; end if;
   ids:=array_append(ids,member_id);
   insert into public.tester_pack_allowed_variants(pack_id,tester_variant_id,active,display_order)
   values(saved.id,member_id,(item->>'active')::boolean,(item->>'displayOrder')::integer)
   on conflict(pack_id,tester_variant_id) do update set active=excluded.active,display_order=excluded.display_order
    where (tester_pack_allowed_variants.active,tester_pack_allowed_variants.display_order) is distinct from (excluded.active,excluded.display_order);
   changed:=changed or found;
  end loop;
  delete from public.tester_pack_allowed_variants where pack_id=saved.id and not(tester_variant_id=any(ids)); changed:=changed or found;
 end if;
 hash:=public.tester_pack_definition_hash(saved.id);
 if p_product_id is not null then
  if hash is distinct from d.definition_fingerprint then
   update public.tester_packs set definition_revision=definition_revision+1,definition_fingerprint=hash where product_id=saved.id;
  end if;
  changed:=changed or old_product is distinct from to_jsonb(saved);
  if changed and old_product=to_jsonb(saved) then update public.products set updated_at=now() where id=saved.id returning * into saved; end if;
 else update public.tester_packs set definition_fingerprint=hash where product_id=saved.id;
 end if;
 if changed then
  insert into public.admin_audit_logs(admin_id,action,resource,resource_id,permission_key,request_id,metadata)
  values(p_actor_id,case when p_product_id is null then 'tester_pack.create' else 'tester_pack.update' end,'tester_packs',saved.id::text,'products.manage',p_request_id,
   jsonb_build_object('definitionRevision',(select definition_revision from public.tester_packs where product_id=saved.id)));
 end if;
 return jsonb_build_object('product',to_jsonb(saved),'definition',(select to_jsonb(t) from public.tester_packs t where product_id=saved.id));
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_checkout_v1_007(p_idempotency_key text, p_items jsonb, p_contact jsonb, p_shipping jsonb, p_payment_method text, p_coupon_code text, p_shipping_method_id uuid, p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_idempotency_key text := trim(coalesce(p_idempotency_key, ''));
  v_order public.orders%rowtype;
  v_coupon public.coupons%rowtype;
  v_shipping_method public.shipping_methods%rowtype;
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric(12,2);
  v_discount_base numeric(12,2);
  v_discount numeric(12,2) := 0;
  v_shipping_fee numeric(12,2) := 0;
  v_total numeric(12,2);
  v_requested_count integer;
  v_matched_count integer;
  v_customer_email text := lower(trim(coalesce(p_contact ->> 'email', '')));
  v_coupon_usage integer;
  v_shipping_rate_count integer;
  payments jsonb; pricing_at timestamptz; canonical jsonb; prices jsonb; basis jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Checkout is restricted to the backend service.';
  end if;

  if length(v_idempotency_key) < 8 or length(v_idempotency_key) > 160 then
    raise exception using errcode = '22023', message = 'A valid idempotency key is required.';
  end if;
  if p_payment_method is not null and length(trim(coalesce(p_payment_method, ''))) < 2 then
    raise exception using errcode = '22023', message = 'A valid payment method is required.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'At least one order item is required.';
  end if;
  if length(trim(coalesce(p_contact ->> 'name', ''))) < 2
     or (v_customer_email = '' and length(trim(coalesce(p_contact ->> 'phone', ''))) < 7) then
    raise exception using errcode = '22023', message = 'Valid customer contact information is required.';
  end if;
  if length(trim(coalesce(p_shipping ->> 'address', ''))) < 4
     or length(trim(coalesce(p_shipping ->> 'city', ''))) < 2 then
    raise exception using errcode = '22023', message = 'A valid shipping address is required.';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.profiles where id = p_customer_id and status = 'Active'
  ) then
    raise exception using errcode = '23503', message = 'Customer account is unavailable.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where not (item ? 'variantId')
       or not (item ? 'quantity')
       or (item ->> 'quantity') !~ '^[1-9][0-9]*$'
       or (item ->> 'quantity')::integer > 99
  ) then
    raise exception using errcode = '22023', message = 'Every item requires a variant ID and quantity from 1 to 99.';
  end if;

  with requested as (
    select (item ->> 'variantId')::uuid as variant_id, sum((item ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) item
    group by (item ->> 'variantId')::uuid
  )
  select count(*) into v_requested_count from requested;

  -- Match Phase 1 save_catalog_product: variants first, then parent products.
  -- Lock every sibling so the aggregate-stock trigger sees serialized decrements.
  perform siblings.id
  from public.product_variants siblings
  where siblings.product_id in (
    select requested.product_id
    from public.product_variants requested
    where requested.id in (
      select (item ->> 'variantId')::uuid from jsonb_array_elements(p_items) item
    )
  )
  order by siblings.id
  for update of siblings;

  perform products.id
  from public.products products
  where products.id in (
    select requested.product_id
    from public.product_variants requested
    where requested.id in (
      select (item ->> 'variantId')::uuid from jsonb_array_elements(p_items) item
    )
  )
  order by products.id
  for update of products;

  with requested as (
    select (item ->> 'variantId')::uuid as variant_id, sum((item ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) item
    group by (item ->> 'variantId')::uuid
  )
  select count(*) into v_matched_count
  from requested
  join public.product_variants variants on variants.id = requested.variant_id
  join public.products products on products.id = variants.product_id
  where variants.active and variants.available and products.active and products.status = 'Published' and products.commerce_kind in ('standard','tester');

  if v_matched_count <> v_requested_count then
    raise exception using errcode = 'P0001', message = 'One or more product variants are unavailable.';
  end if;

  if exists (
    with requested as (
      select (item ->> 'variantId')::uuid as variant_id, sum((item ->> 'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) item
      group by (item ->> 'variantId')::uuid
    )
    select 1
    from requested
    join public.product_variants variants on variants.id = requested.variant_id
    where variants.stock_quantity < requested.quantity
  ) then
    raise exception using errcode = 'P0001', message = 'One or more product variants do not have enough stock.';
  end if;

  -- Match V2: physical rows/parents, coupon eligibility, settings, shipping.
  if p_coupon_code is not null and btrim(p_coupon_code)<>'' then
    perform id from public.coupons where lower(code)=lower(btrim(p_coupon_code)) order by id for update;
    perform product_id from public.coupon_products where coupon_id in(select id from public.coupons where lower(code)=lower(btrim(p_coupon_code))) order by coupon_id,product_id for share;
    perform category_id from public.coupon_categories where coupon_id in(select id from public.coupons where lower(code)=lower(btrim(p_coupon_code))) order by coupon_id,category_id for share;
    perform product_id from public.product_categories where product_id in(select product_id from public.product_variants where id in(select (x->>'variantId')::uuid from jsonb_array_elements(p_items) x)) order by product_id,category_id for share;
  end if;
  payments:=public.checkout_v1_payments_007(p_items);
  if p_payment_method is not null and not(payments ? p_payment_method) then raise exception 'V1_PAYMENT_UNAVAILABLE'; end if;
  perform id from public.shipping_methods order by id for share;
  perform id from public.shipping_rates order by id for share;
  -- Capture only after lock waits. Future schedules must reuse this instant.
  pricing_at:=clock_timestamp();
  with requested as (
    select (item ->> 'variantId')::uuid as variant_id, sum((item ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) item
    group by (item ->> 'variantId')::uuid
  )
  select sum((public.effective_sale_price_009(variants.regular_price,variants.sale_price,variants.sale_starts_at,variants.sale_ends_at,pricing_at)) * requested.quantity)
  into v_subtotal
  from requested
  join public.product_variants variants on variants.id = requested.variant_id;

  if p_coupon_code is not null and trim(p_coupon_code) <> '' then
    select * into v_coupon
    from public.coupons
    where lower(code) = lower(trim(p_coupon_code))
    for update;

    if not found or v_coupon.status <> 'Active' then
      raise exception using errcode = 'P0001', message = 'Coupon is unavailable.';
    end if;
    if v_coupon.start_date is not null and (pricing_at at time zone 'UTC')::date < v_coupon.start_date then
      raise exception using errcode = 'P0001', message = 'Coupon has not started.';
    end if;
    if v_coupon.end_date is not null and (pricing_at at time zone 'UTC')::date > v_coupon.end_date then
      raise exception using errcode = 'P0001', message = 'Coupon has expired.';
    end if;
    if v_subtotal < v_coupon.minimum_order_amount then
      raise exception using errcode = 'P0001', message = 'Order does not meet the coupon minimum.';
    end if;
    if v_coupon.usage_limit > 0 and v_coupon.used_count >= v_coupon.usage_limit then
      raise exception using errcode = 'P0001', message = 'Coupon usage limit has been reached.';
    end if;

    if v_coupon.per_customer_usage_limit > 0 then
      select count(*) into v_coupon_usage
      from public.coupon_redemptions redemptions
      where redemptions.coupon_id = v_coupon.id
        and (
          (p_customer_id is not null and redemptions.customer_id = p_customer_id)
          or (v_customer_email <> '' and lower(redemptions.customer_email) = v_customer_email)
        );
      if v_coupon_usage >= v_coupon.per_customer_usage_limit then
        raise exception using errcode = 'P0001', message = 'Customer coupon usage limit has been reached.';
      end if;
    end if;

    with requested as (
      select (item ->> 'variantId')::uuid as variant_id, sum((item ->> 'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) item
      group by (item ->> 'variantId')::uuid
    )
    select coalesce(sum(
      (public.effective_sale_price_009(variants.regular_price,variants.sale_price,variants.sale_starts_at,variants.sale_ends_at,pricing_at)) * requested.quantity
    ), 0)
    into v_discount_base
    from requested
    join public.product_variants variants on variants.id = requested.variant_id
    where (
      not exists (select 1 from public.coupon_products where coupon_id = v_coupon.id)
      or exists (
        select 1 from public.coupon_products
        where coupon_id = v_coupon.id and product_id = variants.product_id
      )
    )
    and (
      not exists (select 1 from public.coupon_categories where coupon_id = v_coupon.id)
      or exists (
        select 1
        from public.coupon_categories coupon_categories
        join public.product_categories product_categories
          on product_categories.category_id = coupon_categories.category_id
        where coupon_categories.coupon_id = v_coupon.id
          and product_categories.product_id = variants.product_id
      )
    );

    if v_discount_base <= 0 then
      raise exception using errcode = 'P0001', message = 'Coupon does not apply to the selected products.';
    end if;

    if v_coupon.type = 'Percentage' then
      v_discount := round(v_discount_base * v_coupon.discount_value / 100, 2);
    elsif v_coupon.type = 'Fixed Amount' then
      v_discount := least(v_discount_base, v_coupon.discount_value);
    end if;
    if v_coupon.max_discount_amount is not null then
      v_discount := least(v_discount, v_coupon.max_discount_amount);
    end if;
  end if;

  if p_shipping_method_id is not null then
    select * into v_shipping_method
    from public.shipping_methods
    where id = p_shipping_method_id and active;
  else
    select * into v_shipping_method
    from public.shipping_methods
    where active
    order by display_order, created_at, id
    limit 1;
  end if;
  if not found then
    raise exception using errcode = 'P0001', message = 'No shipping method is available.';
  end if;

  -- Reject every tie at the winning priority/threshold, even when fees agree.
  select count(*), min(ranked.fee) into v_shipping_rate_count, v_shipping_fee
  from (
    select rates.fee, dense_rank() over (
      order by case rates.scope_type when 'city' then 1 when 'province' then 2 else 3 end,
        rates.minimum_subtotal desc
    ) as selection_rank
    from public.shipping_rates rates
    where rates.shipping_method_id = v_shipping_method.id
      and rates.active
      and rates.minimum_subtotal <= (v_subtotal - v_discount)
      and (
        rates.scope_type = 'default'
        or (rates.scope_type = 'city' and lower(rates.scope_value) = lower(coalesce(p_shipping ->> 'city', '')))
        or (rates.scope_type = 'province' and lower(rates.scope_value) = lower(coalesce(p_shipping ->> 'province', '')))
      )
  ) ranked
  where ranked.selection_rank = 1;
  if v_shipping_rate_count > 1 then
    raise exception using errcode = 'P0001', message = 'Shipping rate configuration is ambiguous.';
  end if;
  v_shipping_fee := coalesce(v_shipping_fee, v_shipping_method.base_fee);

  if (v_shipping_method.free_shipping_threshold is not null
      and (v_subtotal - v_discount) >= v_shipping_method.free_shipping_threshold)
     or (v_coupon.id is not null and v_coupon.type = 'Free Shipping') then
    v_shipping_fee := 0;
  end if;

  v_total := greatest(0, v_subtotal - v_discount + v_shipping_fee);


  select jsonb_agg(jsonb_build_array(id::text,quantity) order by id) into canonical from (
    select (x->>'variantId')::uuid id,sum((x->>'quantity')::integer) quantity from jsonb_array_elements(p_items) x group by (x->>'variantId')::uuid
  ) normalized;
  canonical:=jsonb_build_array('v1-confirmation-007',canonical,lower(btrim(coalesce(p_contact->>'email',''))),btrim(p_shipping->>'city'),btrim(coalesce(p_shipping->>'province','')),upper(btrim(coalesce(p_coupon_code,''))),p_customer_id);
  select jsonb_agg(jsonb_build_object('variantId',v.id,'productId',v.product_id,'regularPrice',v.regular_price,'salePrice',v.sale_price,'saleStartEpoch',extract(epoch from v.sale_starts_at),'saleEndEpoch',extract(epoch from v.sale_ends_at),'unitPrice',public.effective_sale_price_009(v.regular_price,v.sale_price,v.sale_starts_at,v.sale_ends_at,pricing_at)) order by v.id) into prices from public.product_variants v where v.id in(select (x->>'variantId')::uuid from jsonb_array_elements(p_items) x);
  basis:=jsonb_build_array(canonical,prices,
    case when v_coupon.id is null then null else to_jsonb(v_coupon)-array['used_count','created_at','updated_at'] end,
    to_jsonb(v_shipping_method)-array['created_at','updated_at'],payments,v_subtotal,v_discount,v_shipping_fee,v_total,'PKR');
  return jsonb_build_object('subtotal',v_subtotal,'discount',v_discount,'shippingFee',v_shipping_fee,'total',v_total,'currency','PKR','shippingMethodId',v_shipping_method.id,'paymentMethods',payments,'quoteFingerprint',public.checkout_v2_hash(basis),
    '_coupon',to_jsonb(v_coupon),'_shippingMethod',to_jsonb(v_shipping_method),'_prices',prices);
end;

$function$;

CREATE OR REPLACE FUNCTION public.create_order_v1_effects_007(p_idempotency_key text, p_items jsonb, p_contact jsonb, p_shipping jsonb, p_payment_method text, p_coupon_code text, p_shipping_method_id uuid, p_customer_id uuid, p_quote jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_idempotency_key text := trim(coalesce(p_idempotency_key, ''));
  v_order public.orders%rowtype;
  v_coupon public.coupons%rowtype;
  v_shipping_method public.shipping_methods%rowtype;
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric(12,2);
  v_discount_base numeric(12,2);
  v_discount numeric(12,2) := 0;
  v_shipping_fee numeric(12,2) := 0;
  v_total numeric(12,2);
  v_requested_count integer;
  v_matched_count integer;
  v_customer_email text := lower(trim(coalesce(p_contact ->> 'email', '')));
  v_coupon_usage integer;
  v_shipping_rate_count integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='V2_PERMISSION_DENIED'; end if;
  v_subtotal:=(p_quote->>'subtotal')::numeric;v_discount:=(p_quote->>'discount')::numeric;v_shipping_fee:=(p_quote->>'shippingFee')::numeric;v_total:=(p_quote->>'total')::numeric;
  -- JSON null is the resolver's absent-coupon value, not a composite object.
  if p_quote->'_coupon'='null'::jsonb and nullif(btrim(p_coupon_code),'') is null then
    v_coupon:=null;
  elsif jsonb_typeof(p_quote->'_coupon')='object' then
    v_coupon:=jsonb_populate_record(null::public.coupons,p_quote->'_coupon');
    if v_coupon.id is null or v_coupon.status is distinct from 'Active'
      or lower(v_coupon.code) is distinct from lower(btrim(p_coupon_code))
      or p_quote->'_coupon' is distinct from (select to_jsonb(c) from public.coupons c where c.id=v_coupon.id)
    then raise exception using errcode='22023',message='V1_COUPON_STATE_INVALID'; end if;
  else
    raise exception using errcode='22023',message='V1_COUPON_STATE_INVALID';
  end if;
  v_shipping_method:=jsonb_populate_record(null::public.shipping_methods,p_quote->'_shippingMethod');
  v_order_id := gen_random_uuid();
  if jsonb_typeof(p_quote->'_prices') is distinct from 'array' then
   raise exception using errcode='22023',message='V1_PRICING_STATE_INVALID'; end if;
  if (select count(*) from jsonb_array_elements(p_quote->'_prices')) is distinct from
     (select count(distinct x->>'variantId') from jsonb_array_elements(p_items) x)
   or exists(select 1 from jsonb_array_elements(p_quote->'_prices') x group by x->>'variantId' having count(*)<>1)
   or exists(select 1 from jsonb_array_elements(p_quote->'_prices') x where
    not exists(select 1 from jsonb_array_elements(p_items) i where i->>'variantId'=x->>'variantId')
    or (x->>'unitPrice')::numeric is null or (x->>'unitPrice')::numeric<=0 or (x->>'unitPrice')::numeric='NaN'::numeric)
   or (select sum((x->>'unitPrice')::numeric * (select sum((i->>'quantity')::integer) from jsonb_array_elements(p_items) i where i->>'variantId'=x->>'variantId'))
       from jsonb_array_elements(p_quote->'_prices') x) is distinct from v_subtotal
  then raise exception using errcode='22023',message='V1_PRICING_STATE_INVALID'; end if;
  v_order_number := 'RF-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-' ||
    upper(substr(replace(v_order_id::text, '-', ''), 1, 8));

  insert into public.orders (
    id, order_number, customer_id, customer_name, customer_email, customer_phone,
    shipping_address, shipping_city, shipping_province, order_notes,
    status, payment_method, payment_status, subtotal, discount, shipping_fee, total,
    coupon_code, coupon_id, shipping_method_id, currency, idempotency_key, v1_quote_fingerprint
  ) values (
    v_order_id, v_order_number, p_customer_id,
    trim(coalesce(p_contact ->> 'name', '')),
    nullif(v_customer_email, ''),
    nullif(trim(coalesce(p_contact ->> 'phone', '')), ''),
    trim(coalesce(p_shipping ->> 'address', '')),
    trim(coalesce(p_shipping ->> 'city', '')),
    trim(coalesce(p_shipping ->> 'province', '')),
    trim(coalesce(p_shipping ->> 'notes', '')),
    'Pending', p_payment_method,
    case when lower(p_payment_method) = 'cash on delivery' then 'Unpaid'::public.payment_status else 'Pending'::public.payment_status end,
    v_subtotal, v_discount, v_shipping_fee, v_total,
    coalesce(v_coupon.code, ''), v_coupon.id, v_shipping_method.id, 'PKR', v_idempotency_key, p_quote->>'quoteFingerprint'
  );

  with requested as (
    select (item ->> 'variantId')::uuid as variant_id, sum((item ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) item
    group by (item ->> 'variantId')::uuid
  )
  insert into public.order_items (
    order_id, product_id, variant_id, product_name, size, sku, quantity, unit_price
  )
  select
    v_order_id,
    variants.product_id,
    variants.id,
    products.name,
    variants.option_value,
    variants.sku,
    requested.quantity,
    (select (x->>'unitPrice')::numeric from jsonb_array_elements(p_quote->'_prices') x where x->>'variantId'=variants.id::text)
  from requested
  join public.product_variants variants on variants.id = requested.variant_id
  join public.products products on products.id = variants.product_id;

  with requested as (
    select (item ->> 'variantId')::uuid as variant_id, sum((item ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) item
    group by (item ->> 'variantId')::uuid
  ), updated as (
    update public.product_variants variants
    set stock_quantity = variants.stock_quantity - requested.quantity,
        available = (variants.stock_quantity - requested.quantity) > 0,
        updated_at = now()
    from requested
    where variants.id = requested.variant_id
    returning variants.id, variants.stock_quantity, requested.quantity
  )
  insert into public.inventory_movements (
    variant_id, quantity_delta, balance_after, reason, reference_type, reference_id
  )
  select id, -quantity, stock_quantity, 'Order placed', 'order', v_order_id
  from updated;

  insert into public.order_status_history (order_id, from_status, to_status, note)
  values (v_order_id, null, 'Pending', 'Order created by transactional checkout.');

  insert into public.payments (order_id, provider, amount, currency, status, idempotency_key)
  values (
    v_order_id,
    p_payment_method,
    v_total,
    'PKR',
    case when lower(p_payment_method) = 'cash on delivery' then 'Unpaid'::public.payment_status else 'Pending'::public.payment_status end,
    v_idempotency_key || ':payment'
  );

  if v_coupon.id is not null then
    insert into public.coupon_redemptions (
      coupon_id, order_id, customer_id, customer_email, discount_amount
    ) values (
      v_coupon.id, v_order_id, p_customer_id, v_customer_email, v_discount
    );
    update public.coupons
    set used_count = used_count + 1, updated_at = now()
    where id = v_coupon.id;
  end if;

  return jsonb_build_object(
    'id', v_order_id,
    'orderNumber', v_order_number,
    'status', 'Pending',
    'subtotal', v_subtotal,
    'discount', v_discount,
    'shippingFee', v_shipping_fee,
    'total', v_total,
    'idempotent', false
  );
end;

$function$;

CREATE OR REPLACE FUNCTION public.quote_checkout_v1_007_internal(p_request jsonb, p_customer_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q jsonb; item jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='V2_PERMISSION_DENIED'; end if;
 if not public.checkout_v2_keys(p_request,array['items','shipping','email','couponCode']) or octet_length(p_request::text)>32768
 or jsonb_typeof(p_request->'items') is distinct from 'array' or jsonb_array_length(p_request->'items') not between 1 and 100
 or not public.checkout_v2_keys(p_request->'shipping',array['city','province']) then raise exception 'V2_INVALID_REQUEST'; end if;
 for item in select value from jsonb_array_elements(p_request->'items') loop
  if not public.checkout_v2_keys(item,array['variantId','quantity']) or public.checkout_v2_integer(item->'quantity')>99 then raise exception 'V2_INVALID_REQUEST'; end if;
  perform public.checkout_v2_uuid(item->'variantId');
 end loop;
 perform public.checkout_v2_text(p_request->'shipping'->'city',2,100);
 perform public.checkout_v2_text(p_request->'shipping'->'province',2,100);
 perform public.checkout_v2_text(p_request->'email',0,254);
 if public.checkout_v2_text(p_request->'couponCode',0,40) !~ '^[A-Za-z0-9_-]*$' then raise exception 'V2_INVALID_REQUEST'; end if;
 q:=public.resolve_checkout_v1_007('quote:read-only',p_request->'items',jsonb_build_object('name','Quote','phone','0000000000','email',p_request->>'email'),(p_request->'shipping')||jsonb_build_object('address','Quote placeholder'),null,p_request->>'couponCode',null,p_customer_id);
 return q-array['_coupon','_shippingMethod','_prices'];
end;
$function$;

CREATE OR REPLACE FUNCTION public.checkout_v2_resolve(p_canonical jsonb, p_lock boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare line jsonb; component jsonb; selected jsonb; output jsonb:='[]'; components jsonb; demand jsonb:='[]';
 p public.products%rowtype; v public.product_variants%rowtype; t public.tester_variants%rowtype; d public.tester_packs%rowtype;
 c public.coupons%rowtype; method public.shipping_methods%rowtype; rate public.shipping_rates%rowtype;
 physical uuid[]; before_set uuid[]; pack_ids uuid[]; owners jsonb; locked_owners jsonb; q bigint; units bigint; price numeric; subtotal numeric:=0;
 discount numeric:=0; base numeric:=0; shipping numeric; total numeric; free_shipping boolean:=false;
 position integer:=0; component_position integer; component_count integer:=0; count_rates integer; usage_count bigint;
 city text; province text; email text:=p_canonical->>8; coupon text:=p_canonical->>6; customer uuid:=(p_canonical->>2)::uuid;
 payments jsonb:='[]'; private_payments jsonb; public_payments jsonb; commerce jsonb; enabled jsonb; payment text;
 basis jsonb; categories jsonb; applicable boolean; coupon_basis jsonb:=null;
 pricing_at timestamptz; variants_at jsonb; price_basis jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'V2_ISOLATION_UNSUPPORTED'; end if;
 if customer is not null and not exists(select 1 from public.profiles where id=customer and status='Active') then raise exception 'V2_CUSTOMER_UNAVAILABLE'; end if;
 if p_canonical->3='null'::jsonb then city:=p_canonical->4->>0; province:=p_canonical->4->>1;
 else city:=p_canonical->4->>1; province:=p_canonical->4->>2; end if;
 select array_agg(distinct (l->>'packId')::uuid order by (l->>'packId')::uuid) into pack_ids
 from jsonb_array_elements(p_canonical->1) l where l->>'kind'<>'normal_variant';
 if p_lock then
  -- Pack definitions already use parent -> tester locks. Pin every pack first.
  perform id from public.products where id=any(pack_ids) order by id for update;
  perform product_id from public.tester_packs where product_id=any(pack_ids) order by product_id for update;
 end if;
 select array_agg(distinct id order by id) into physical from (
  select (l->>'variantId')::uuid id from jsonb_array_elements(p_canonical->1) l where l->>'kind'='normal_variant'
  union select x.tester_variant_id from jsonb_array_elements(p_canonical->1) l join public.tester_pack_components x on x.pack_id=(l->>'packId')::uuid where l->>'kind'='fixed_tester_pack'
  union select (s->>'variantId')::uuid from jsonb_array_elements(p_canonical->1) l cross join lateral jsonb_array_elements(coalesce(l->'selections','[]')) s
 ) x;
 before_set:=physical;
 if p_lock then
  select jsonb_agg(jsonb_build_array(id,product_id) order by id) into owners from public.product_variants where id=any(physical);
  perform sibling.id from public.product_variants sibling where sibling.id=any(physical) or sibling.product_id in
   (select product_id from public.product_variants where id=any(physical)) order by sibling.id for update;
  select jsonb_agg(jsonb_build_array(id,product_id) order by id) into locked_owners from public.product_variants where id=any(physical);
  if owners is distinct from locked_owners then raise exception 'V2_RESOLUTION_CHANGED'; end if;
  perform id from public.products where id in(select product_id from public.product_variants where id=any(physical)) order by id for update;
  -- No newly discovered physical row may be locked after physical parents.
  select array_agg(distinct id order by id) into physical from (
   select (l->>'variantId')::uuid id from jsonb_array_elements(p_canonical->1) l where l->>'kind'='normal_variant'
   union select x.tester_variant_id from jsonb_array_elements(p_canonical->1) l join public.tester_pack_components x on x.pack_id=(l->>'packId')::uuid where l->>'kind'='fixed_tester_pack'
   union select (s->>'variantId')::uuid from jsonb_array_elements(p_canonical->1) l cross join lateral jsonb_array_elements(coalesce(l->'selections','[]')) s
  ) x;
  if physical is distinct from before_set then raise exception 'V2_RESOLUTION_CHANGED'; end if;
 end if;
 if p_lock then
  if coupon<>'' then
   perform id from public.coupons where lower(code)=lower(coupon) order by id for update;
   perform product_id from public.coupon_products where coupon_id in(select id from public.coupons where lower(code)=lower(coupon)) order by coupon_id,product_id for share;
   perform category_id from public.coupon_categories where coupon_id in(select id from public.coupons where lower(code)=lower(coupon)) order by coupon_id,category_id for share;
   perform product_id from public.product_categories where product_id in(
    select (l->>'packId')::uuid from jsonb_array_elements(p_canonical->1) l where l->>'kind'<>'normal_variant'
    union select physical_variant.product_id from jsonb_array_elements(p_canonical->1) l join public.product_variants physical_variant on physical_variant.id=(l->>'variantId')::uuid where l->>'kind'='normal_variant'
   ) order by product_id,category_id for share;
  end if;
  perform id from public.site_settings where id='site' for share;
  perform key from public.public_site_settings where key in ('payments','commerce') order by key for share;
  perform id from public.shipping_methods order by id for share;
  perform id from public.shipping_rates order by id for share;
 end if;
 pricing_at:=clock_timestamp();
 select coalesce(jsonb_agg(to_jsonb(cached_variant) order by cached_variant.id),'[]'::jsonb) into variants_at from public.product_variants cached_variant where cached_variant.id=any(physical);
 select jsonb_agg(jsonb_build_array(cached_variant.id,cached_variant.product_id,cached_variant.regular_price,cached_variant.sale_price,extract(epoch from cached_variant.sale_starts_at),extract(epoch from cached_variant.sale_ends_at),public.effective_sale_price_009(cached_variant.regular_price,cached_variant.sale_price,cached_variant.sale_starts_at,cached_variant.sale_ends_at,pricing_at)) order by cached_variant.id)
 into price_basis from jsonb_populate_recordset(null::public.product_variants,variants_at) cached_variant;
 for line in select value from jsonb_array_elements(p_canonical->1) loop
  components:='[]'; component_position:=0;
  if line->>'kind'='normal_variant' then
   select * into v from jsonb_populate_recordset(null::public.product_variants,variants_at) cached where id=(line->>'variantId')::uuid;
   if not found then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
   select * into p from public.products where id=v.product_id;
   if p.commerce_kind not in ('standard','tester') then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
   if p.commerce_kind='tester' then
    select * into t from public.tester_variants where variant_id=v.id and tester_product_id=p.id and volume_ml=5;
    if not found or not t.manual_available or v.option_name<>'Size' or v.option_value<>'5 ml' then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
   end if;
   price:=public.effective_sale_price_009(v.regular_price,v.sale_price,v.sale_starts_at,v.sale_ends_at,pricing_at);
   if not p.active or p.status<>'Published' or not v.active or not v.available or v.stock_quantity<=0 then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
   if v.regular_price<=0 or v.regular_price='NaN'::numeric or (v.sale_price is not null and (v.sale_price<=0 or v.sale_price>=v.regular_price or v.sale_price='NaN'::numeric)) then raise exception 'V2_CONFIGURATION_INVALID'; end if;
   demand:=demand||jsonb_build_array(jsonb_build_object('variantId',v.id,'quantity',(line->>'quantity')::bigint));
   line:=line||jsonb_build_object('productId',p.id,'name',p.name,'sku',v.sku,'size',v.option_value,'unitPrice',price,'components',components,'position',position);
  else
   select * into p from public.products where id=(line->>'packId')::uuid;
   if not found or p.commerce_kind<>'tester_pack' or not p.active or p.status<>'Published' then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
   select * into d from public.tester_packs where product_id=p.id;
   if not found or not d.manual_available then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
   if d.definition_revision::text<>line->>'definitionRevision' then raise exception 'V2_DEFINITION_STALE'; end if;
   if (d.mode='fixed') is distinct from (line->>'kind'='fixed_tester_pack') then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
   if d.definition_fingerprint is distinct from public.tester_pack_definition_hash(d.product_id) then raise exception 'V2_CONFIGURATION_INVALID'; end if;
   if d.mode='fixed' then
    select jsonb_agg(jsonb_build_object('variantId',tester_variant_id,'quantityPerPack',quantity_per_pack) order by tester_variant_id) into selected from public.tester_pack_components where pack_id=p.id;
    price:=public.effective_sale_price_009(d.fixed_regular_price,d.fixed_sale_price,d.fixed_sale_starts_at,d.fixed_sale_ends_at,pricing_at);
   else selected:=line->'selections'; price:=0; end if;
   if selected is null or jsonb_array_length(selected) not between 1 and 100 then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
   units:=0;
   for component in select value from jsonb_array_elements(selected) loop
    q:=(component->>'quantityPerPack')::bigint; units:=units+q;
    if units>2147483647 or q*(line->>'quantity')::numeric>2147483647 then raise exception 'V2_LIMIT_EXCEEDED'; end if;
    if d.mode='configurable' and not exists(select 1 from public.tester_pack_allowed_variants where pack_id=p.id and tester_variant_id=(component->>'variantId')::uuid and active) then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
    select * into t from public.tester_variants where variant_id=(component->>'variantId')::uuid;
    if not found or t.volume_ml<>5 or not t.manual_available then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
    select * into v from jsonb_populate_recordset(null::public.product_variants,variants_at) cached where id=t.variant_id and product_id=t.tester_product_id;
    if not found or not v.active or not v.available or v.stock_quantity<=0 or v.option_name<>'Size' or v.option_value<>'5 ml'
    or not exists(select 1 from public.products where id=t.tester_product_id and commerce_kind='tester' and active and status='Published') then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
    if v.regular_price<=0 or v.regular_price='NaN'::numeric or (v.sale_price is not null and (v.sale_price<=0 or v.sale_price>=v.regular_price or v.sale_price='NaN'::numeric)) then raise exception 'V2_CONFIGURATION_INVALID'; end if;
    if d.mode='configurable' then price:=price+public.effective_sale_price_009(v.regular_price,v.sale_price,v.sale_starts_at,v.sale_ends_at,pricing_at)*q; end if;
    components:=components||jsonb_build_array(jsonb_build_object('testerVariantId',t.variant_id,'testerProductId',t.tester_product_id,
     'testerName',(select name from public.products where id=t.tester_product_id),'sku',v.sku,'size','5 ml','volumeMl',5,
     'quantityPerPack',q,'totalPhysicalQuantity',q*(line->>'quantity')::bigint,'referenceUnitPrice',public.effective_sale_price_009(v.regular_price,v.sale_price,v.sale_starts_at,v.sale_ends_at,pricing_at),'position',component_position));
    demand:=demand||jsonb_build_array(jsonb_build_object('variantId',v.id,'quantity',q*(line->>'quantity')::bigint));
    component_position:=component_position+1; component_count:=component_count+1;
    if component_count>2000 then raise exception 'V2_LIMIT_EXCEEDED'; end if;
   end loop;
   if d.mode='configurable' and (units<d.minimum_units or (d.maximum_units is not null and units>d.maximum_units)) then raise exception 'V2_PACK_UNITS_INVALID'; end if;
   line:=line||jsonb_build_object('productId',p.id,'name',p.name,'sku',p.sku,'size','Tester pack','unitPrice',price,
    'definitionFingerprint',d.definition_fingerprint,'components',components,'position',position);
  end if;
  if price<=0 or price='NaN'::numeric or price>9999999999.99 or price*(line->>'quantity')::numeric>9999999999.99 then raise exception 'V2_LIMIT_EXCEEDED'; end if;
  line:=line||jsonb_build_object('lineTotal',price*(line->>'quantity')::numeric);
  subtotal:=subtotal+(line->>'lineTotal')::numeric;
  if subtotal>9999999999.99 then raise exception 'V2_LIMIT_EXCEEDED'; end if;
  output:=output||jsonb_build_array(line); position:=position+1;
 end loop;
 if exists(select 1 from jsonb_array_elements(demand) x group by x->>'variantId' having sum((x->>'quantity')::bigint)>2147483647) then raise exception 'V2_LIMIT_EXCEEDED'; end if;
 select jsonb_agg(jsonb_build_object('variantId',id,'quantity',qty) order by id collate "C") into demand
 from (select x->>'variantId' id,sum((x->>'quantity')::bigint) qty from jsonb_array_elements(demand) x group by x->>'variantId') x;
 if exists(select 1 from jsonb_array_elements(demand) x left join public.product_variants physical_row on physical_row.id=(x->>'variantId')::uuid where physical_row.id is null or physical_row.stock_quantity<(x->>'quantity')::bigint) then raise exception 'V2_INSUFFICIENT_STOCK'; end if;
 if coupon<>'' then

  select * into c from public.coupons where lower(code)=lower(coupon);
  if not found or c.status<>'Active' or ((pricing_at at time zone 'UTC')::date<c.start_date)
  or ((pricing_at at time zone 'UTC')::date>c.end_date) or subtotal<c.minimum_order_amount
  or (c.usage_limit>0 and c.used_count>=c.usage_limit) then raise exception 'V2_INVALID_COUPON'; end if;
  if c.per_customer_usage_limit>0 then
   select count(*) into usage_count from public.coupon_redemptions where coupon_id=c.id and
    ((customer is not null and customer_id=customer) or (email<>'' and lower(customer_email)=email));
   if (customer is null and email='') or usage_count>=c.per_customer_usage_limit then raise exception 'V2_INVALID_COUPON'; end if;
  end if;

  for line in select value from jsonb_array_elements(output) loop
   select coalesce(jsonb_agg(distinct category_id order by category_id),'[]') into categories from (
    select category_id from public.product_categories where product_id=(line->>'productId')::uuid
    union select category_id from public.products where id=(line->>'productId')::uuid and commerce_kind in ('tester','tester_pack') and category_id is not null
   ) cats;
   applicable:=(not exists(select 1 from public.coupon_products where coupon_id=c.id) or exists(select 1 from public.coupon_products where coupon_id=c.id and product_id=(line->>'productId')::uuid))
    and (not exists(select 1 from public.coupon_categories where coupon_id=c.id) or exists(select 1 from public.coupon_categories where coupon_id=c.id and category_id in(select value::text::uuid from jsonb_array_elements_text(categories))));
   if applicable then base:=base+(line->>'lineTotal')::numeric; end if;
   coupon_basis:=coalesce(coupon_basis,'[]')||jsonb_build_array(jsonb_build_array(line->'identity',categories,applicable));
  end loop;
  if base<=0 then raise exception 'V2_INVALID_COUPON'; end if;
  if c.type='Percentage' then discount:=round(base*c.discount_value/100,2);
  elsif c.type='Fixed Amount' then discount:=least(base,c.discount_value);
  elsif c.type='Free Shipping' then free_shipping:=true;
  else raise exception 'V2_INVALID_COUPON'; end if;
  if c.max_discount_amount is not null then discount:=least(discount,c.max_discount_amount); end if;
  coupon_basis:=jsonb_build_array(c.id,c.type,c.discount_value,c.max_discount_amount,c.minimum_order_amount,c.start_date,c.end_date,base,discount,free_shipping,coupon_basis);
 end if;

 select * into method from public.shipping_methods where active order by display_order,created_at,id limit 1;
 if not found then raise exception 'V2_CONFIGURATION_INVALID'; end if;
 -- Count and select from one statement snapshot: a concurrent insert cannot
 -- appear between a separate ambiguity check and winner selection.
 with ranked as (
  select rates.*,dense_rank() over(order by case scope_type when 'city' then 1 when 'province' then 2 else 3 end,minimum_subtotal desc) selection_rank
  from public.shipping_rates rates where shipping_method_id=method.id and active and minimum_subtotal<=subtotal-discount
  and (scope_type='default' or (scope_type='city' and lower(scope_value)=lower(city)) or (scope_type='province' and lower(scope_value)=lower(province)))
 ) select count(*),(jsonb_agg(to_jsonb(ranked)-'selection_rank' order by ranked.id)->0) into count_rates,enabled from ranked where selection_rank=1;
 if count_rates>1 then raise exception 'V2_CONFIGURATION_INVALID'; end if;
 select * into rate from jsonb_populate_record(null::public.shipping_rates,enabled);
 shipping:=coalesce(rate.fee,method.base_fee);
 if free_shipping or (method.free_shipping_threshold is not null and subtotal-discount>=method.free_shipping_threshold) then shipping:=0; end if;
 select s.payments into private_payments from public.site_settings s where id='site';
 select value into public_payments from public.public_site_settings where key='payments';
 select value into commerce from public.public_site_settings where key='commerce';
 foreach payment in array array['Cash on Delivery','Bank Transfer'] loop
  enabled:=null;
  if jsonb_typeof(private_payments)='array' then select x->'active' into enabled from jsonb_array_elements(private_payments) x where x->>'name'=payment limit 1; end if;
  if enabled is null or enabled='null'::jsonb then
   if jsonb_typeof(public_payments)='array' then select x->'active' into enabled from jsonb_array_elements(public_payments) x where x->>'name'=payment limit 1; end if;
  end if;
  if enabled is null or enabled='null'::jsonb then enabled:=commerce->case when payment='Cash on Delivery' then 'codEnabled' else 'bankTransferEnabled' end; end if;
  if enabled='true'::jsonb then payments:=payments||jsonb_build_array(payment); end if;
 end loop;
 if jsonb_array_length(payments)=0 then raise exception 'V2_PAYMENT_UNAVAILABLE'; end if;
 if p_canonical->5<>'null'::jsonb and not(payments ? (p_canonical->>5)) then raise exception 'V2_PAYMENT_UNAVAILABLE'; end if;
 total:=subtotal-discount+shipping;
 if total>9999999999.99 or discount<0 or discount>subtotal or shipping<0 then raise exception 'V2_LIMIT_EXCEEDED'; end if;
 -- Snapshots contain eligibility-proven values, not volatile stock/timestamps.
 basis:=jsonb_build_array(2,output,demand,true,coupon_basis,city,province,method.id,rate.id,method.base_fee,method.free_shipping_threshold,shipping,payments,'PKR',subtotal,discount,total,price_basis);
 return jsonb_build_object('contractVersion',2,'quoteFingerprint',public.checkout_v2_hash(basis),'lines',output,'subtotal',subtotal,'discount',discount,'shippingFee',shipping,'total',total,
  'currency','PKR','shippingMethodId',method.id,'paymentMethods',payments,'orderingEnabled',false,'_demand',demand,'_couponId',c.id);
end; $function$;


-- Stage 2G.3 normal-catalog contract: the caller's existing variant RLS still applies.
-- price/active/window metadata are one statement-time result. No write grants.
create view public.storefront_variant_prices with (security_invoker=true) as
select v.id,v.product_id,v.option_name,v.option_value,v.sku,v.regular_price,v.sale_price,
 v.stock_quantity,v.active,v.available,v.display_order,v.sale_starts_at,v.sale_ends_at,
 statement_timestamp() as pricing_at,
 public.effective_sale_price_009(v.regular_price,v.sale_price,v.sale_starts_at,v.sale_ends_at,statement_timestamp()) as effective_price,
 v.sale_price is not null and (v.sale_starts_at is null or statement_timestamp()>=v.sale_starts_at)
  and (v.sale_ends_at is null or statement_timestamp()<v.sale_ends_at) as sale_active,
 case when v.sale_price is null then null when v.sale_starts_at>statement_timestamp() then v.sale_starts_at
  when v.sale_ends_at>statement_timestamp() then v.sale_ends_at else null end as valid_until
from public.product_variants v;
revoke all on public.storefront_variant_prices from public,anon,authenticated,service_role;
grant select on public.storefront_variant_prices to anon,authenticated,service_role;

-- Stage 2G.3 trusted-backend contract: <=100 unique IDs of each kind; no caller clock.
-- Returns raw configured prices plus database-resolved effectivePrice/pricingAt/validUntil.
-- Backend public pack handlers must retain their existing publication/membership filtering.
create function public.catalog_sale_prices_009(p_variant_ids uuid[] default '{}',p_pack_ids uuid[] default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare instant timestamptz:=statement_timestamp(); variants jsonb; packs jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='SALE_CATALOG_PERMISSION_DENIED'; end if;
 p_variant_ids:=coalesce(p_variant_ids,'{}');p_pack_ids:=coalesce(p_pack_ids,'{}');
 if cardinality(p_variant_ids)>100 or cardinality(p_pack_ids)>100 or array_position(p_variant_ids,null) is not null or array_position(p_pack_ids,null) is not null
 or cardinality(p_variant_ids)<>(select count(distinct x) from unnest(p_variant_ids) x)
 or cardinality(p_pack_ids)<>(select count(distinct x) from unnest(p_pack_ids) x)
 then raise exception using errcode='22023',message='SALE_CATALOG_IDS_INVALID'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('variantId',v.id,'productId',v.product_id,'regularPrice',v.regular_price,'salePrice',v.sale_price,
  'saleStartsAt',v.sale_starts_at,'saleEndsAt',v.sale_ends_at,'effectivePrice',public.effective_sale_price_009(v.regular_price,v.sale_price,v.sale_starts_at,v.sale_ends_at,instant),
  'saleActive',v.sale_price is not null and (v.sale_starts_at is null or instant>=v.sale_starts_at) and (v.sale_ends_at is null or instant<v.sale_ends_at),
  'validUntil',case when v.sale_price is null then null when v.sale_starts_at>instant then v.sale_starts_at when v.sale_ends_at>instant then v.sale_ends_at else null end) order by v.id),'[]')
 into variants from public.product_variants v where v.id=any(p_variant_ids);
 select coalesce(jsonb_agg(jsonb_build_object('packId',d.product_id,'mode',d.mode,'regularPrice',d.fixed_regular_price,'salePrice',d.fixed_sale_price,
  'saleStartsAt',d.fixed_sale_starts_at,'saleEndsAt',d.fixed_sale_ends_at,
  'effectivePrice',case when d.mode='fixed' then public.effective_sale_price_009(d.fixed_regular_price,d.fixed_sale_price,d.fixed_sale_starts_at,d.fixed_sale_ends_at,instant) else null end,
  'saleActive',d.fixed_sale_price is not null and (d.fixed_sale_starts_at is null or instant>=d.fixed_sale_starts_at) and (d.fixed_sale_ends_at is null or instant<d.fixed_sale_ends_at),
  'validUntil',case when d.fixed_sale_price is null then null when d.fixed_sale_starts_at>instant then d.fixed_sale_starts_at when d.fixed_sale_ends_at>instant then d.fixed_sale_ends_at else null end) order by d.product_id),'[]')
 into packs from public.tester_packs d where d.product_id=any(p_pack_ids);
 return jsonb_build_object('pricingAt',instant,'variants',variants,'packs',packs);
end; $fn$;
revoke all on function public.catalog_sale_prices_009(uuid[],uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.catalog_sale_prices_009(uuid[],uuid[]) to service_role;


-- @RELEASE009-POST-GUARD-BEGIN
do $post$
declare table_name text; actual jsonb; security jsonb; item record;
begin
 select jsonb_build_object('roles',(select jsonb_agg(to_jsonb(r) order by oid) from pg_roles r),
 'memberships',(select jsonb_agg(to_jsonb(m) order by roleid,member,grantor) from pg_auth_members m),
 'defaults',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d),
 'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p)) into security;
 if security is distinct from (select state from pg_temp.rf009_security) then raise exception 'RF_RELEASE009_SECURITY_PRESERVATION'; end if;
 for table_name in select d.name from pg_temp.rf009_data d order by d.name loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)-array[''sale_starts_at'',''sale_ends_at'',''fixed_sale_starts_at'',''fixed_sale_ends_at''] order by to_jsonb(t)-array[''sale_starts_at'',''sale_ends_at'',''fixed_sale_starts_at'',''fixed_sale_ends_at'']),''[]''::jsonb) from public.%I t',table_name) into actual;
  if actual is distinct from (select d.rows from pg_temp.rf009_data d where d.name=table_name) then raise exception 'RF_RELEASE009_DATA_PRESERVATION: %',table_name; end if;
 end loop;
 if exists(select 1 from pg_roles b cross join pg_roles r
  where b.rolname !~ '^pg_' and b.rolname<>'postgres' and not(b.rolname='supabase_admin' and b.rolsuper)
  and ((b.oid=r.oid or pg_has_role(b.oid,r.oid,'USAGE') or pg_has_role(b.oid,r.oid,'SET')) and (r.rolsuper or r.rolcreaterole)
   or pg_has_role(b.oid,'postgres','USAGE') or pg_has_role(b.oid,'postgres','SET')
   or pg_has_role(b.oid,'supabase_admin','USAGE') or pg_has_role(b.oid,'supabase_admin','SET')
   or exists(select 1 from pg_auth_members m where m.member=b.oid and m.admin_option)))
 then raise exception 'RF_RELEASE009_PRIVATE_ROLE_PATH'; end if;
 for item in select p.* from pg_proc p where p.oid=any(array[
  'public.checkout_v1_payments_007(jsonb)'::regprocedure,
  'public.resolve_checkout_v1_007(text,jsonb,jsonb,jsonb,text,text,uuid,uuid)'::regprocedure,
  'public.create_order_v1_effects_007(text,jsonb,jsonb,jsonb,text,text,uuid,uuid,jsonb)'::regprocedure,
  'public.guard_v1_confirmation_007()'::regprocedure,'public.sale_timestamp_009(jsonb)'::regprocedure,
  'public.save_catalog_product_012_internal(uuid,jsonb,jsonb,text)'::regprocedure,
  'public.quote_checkout_v1_007_internal(jsonb,uuid)'::regprocedure,
  'public.checkout_v2_resolve(jsonb,boolean)'::regprocedure,'public.tester_pack_definition_hash(uuid)'::regprocedure]::oid[]) loop
  if item.proowner<>'postgres'::regrole or item.proconfig is distinct from array['search_path=""']::text[]
   or item.prosecdef is distinct from (item.proname not in ('guard_v1_confirmation_007','sale_timestamp_009'))
   or exists(select 1 from aclexplode(coalesce(item.proacl,acldefault('f',item.proowner))) a where a.grantee<>item.proowner)
   or exists(select 1 from pg_roles b cross join pg_roles r where b.rolname !~ '^pg_' and b.rolname<>'postgres' and not(b.rolname='supabase_admin' and b.rolsuper)
    and (b.oid=r.oid or pg_has_role(b.oid,r.oid,'USAGE') or pg_has_role(b.oid,r.oid,'SET')) and has_function_privilege(r.oid,item.oid,'EXECUTE'))
  then raise exception 'RF_RELEASE009_PRIVATE_RPC'; end if;
 end loop;
 if exists(select 1 from pg_proc p where p.oid='public.effective_sale_price_009(numeric,numeric,timestamptz,timestamptz,timestamptz)'::regprocedure
  and (p.proowner<>'postgres'::regrole or p.prosecdef or p.provolatile<>'i' or p.proconfig is distinct from array['search_path=""']::text[]
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole))))
 or exists(select 1 from pg_proc p where p.oid='public.catalog_sale_prices_009(uuid[],uuid[])'::regprocedure
  and (p.proowner<>'postgres'::regrole or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[]
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner,'service_role'::regrole))))
 or not has_function_privilege('service_role','public.catalog_sale_prices_009(uuid[],uuid[])','EXECUTE')
 or has_function_privilege('anon','public.catalog_sale_prices_009(uuid[],uuid[])','EXECUTE')
 or has_function_privilege('authenticated','public.catalog_sale_prices_009(uuid[],uuid[])','EXECUTE')
 then raise exception 'RF_RELEASE009_READ_RPC'; end if;
 if not exists(select 1 from pg_class c where c.oid='public.storefront_variant_prices'::regclass and c.relowner='postgres'::regrole and 'security_invoker=true'=any(c.reloptions))
 or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
  where c.oid='public.storefront_variant_prices'::regclass and a.grantee<>c.relowner
  and (a.grantee not in('anon'::regrole,'authenticated'::regrole,'service_role'::regrole) or a.privilege_type<>'SELECT'))
 then raise exception 'RF_RELEASE009_READ_VIEW'; end if;
end; $post$;
commit;
