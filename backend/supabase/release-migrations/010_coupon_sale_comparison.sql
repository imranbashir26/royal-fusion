-- Release 010: global coupon-versus-sale comparison. Local only; activation gates unchanged.
-- Coordinate with Stage 2I.3 DTO/admin contracts; do not deploy this release alone.
-- Quiesce catalog/checkout writers; NOWAIT aborts instead of waiting through live traffic.
-- One-shot exact post-009 PG17 predecessor, read committed; maintenance writes quiesced.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
set local search_path=pg_catalog,public;
do $pre$
declare shape text; acl jsonb;
begin
 if current_user <> 'postgres' or current_setting('server_version_num')::int not between 170000 and 179999
 or current_setting('transaction_isolation') <> 'read committed' then raise exception 'RF_RELEASE010_EXECUTION_CONTEXT'; end if;
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
 defaclrole=(select oid from pg_roles where rolname='postgres') and defaclnamespace=0 and defaclobjtype='r')) then raise exception 'RF_RELEASE010_SECURITY_DRIFT'; end if;
 perform pg_advisory_xact_lock(6010,14010);
 -- Variant-first, like checkout/admin. Failure to obtain these locks rolls back.
 lock table public.product_variants,public.products,public.orders,public.tester_packs,public.coupons,public.coupon_products,public.coupon_categories,public.order_items,public.payments,public.coupon_redemptions in access exclusive mode nowait;
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
 if shape <> '5de6e703dc17045b6e3d45ea7ab500e94196300f8a205ed8f279a10a894e86b2' then raise exception 'RF_RELEASE010_BASELINE_DRIFT'; end if;
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
 ) x) then raise exception 'RF_RELEASE010_RELEASE005_REQUIRED'; end if;
end;
$pre$;


-- Preserve all existing public-table data, including issued attempts and financial snapshots.
create temporary table rf010_data(name text primary key, rows jsonb) on commit drop;
create temporary table rf010_security on commit drop as select jsonb_build_object(
 'roles',(select jsonb_agg(to_jsonb(r) order by oid) from pg_roles r),
 'memberships',(select jsonb_agg(to_jsonb(m) order by roleid,member,grantor) from pg_auth_members m),
 'defaults',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d),
 'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p)) state;
do $data$
declare name text; rows jsonb;
begin
 for name in select c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' order by c.relname loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)),''[]''::jsonb) from public.%I t',name) into rows;
  insert into pg_temp.rf010_data values(name,rows);
 end loop;
 if exists(select 1 from public.product_variants where regular_price='NaN'::numeric or sale_price='NaN'::numeric)
 or exists(select 1 from public.tester_packs where fixed_regular_price='NaN'::numeric or fixed_sale_price='NaN'::numeric)
 then raise exception 'RF_RELEASE010_INVALID_LEGACY_PRICE'; end if;
end; $data$;
create temporary table rf010_functions on commit drop as
 select p.oid,pg_get_functiondef(p.oid) definition,p.proowner,p.proacl,p.proconfig,p.prosecdef
 from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f';
alter table public.coupons add column pricing_policy text not null default 'LEGACY';
-- Metadata-only grandfathering; existing terms, timestamps and counters are untouched.
alter table public.coupons alter column pricing_policy set default 'GLOBAL_PERCENTAGE_V1';
alter table public.coupons add constraint coupons_policy_010 check(pricing_policy in ('LEGACY','GLOBAL_PERCENTAGE_V1'));
alter table public.coupons add constraint coupons_global_terms_010 check(pricing_policy='LEGACY' or
 (type='Percentage' and discount_value>0 and discount_value<=100 and discount_value<>'NaN'::numeric
 and minimum_order_amount<>'NaN'::numeric and (max_discount_amount is null or max_discount_amount<>'NaN'::numeric)
 and cardinality(applicable_product_ids)=0 and cardinality(applicable_category_ids)=0));
-- V1 cannot use V2's quote_snapshot under orders_versions_013.
alter table public.orders add column pricing_outcome jsonb;
alter table public.orders add constraint orders_pricing_outcome_010 check(pricing_outcome is null or
 (checkout_version=1 and jsonb_typeof(pricing_outcome)='object'));

create function public.coupon_policy_guard_010() returns trigger language plpgsql set search_path='' as $fn$
begin
 if tg_op='INSERT' and new.pricing_policy is distinct from 'GLOBAL_PERCENTAGE_V1' then raise exception 'COUPON_POLICY_INVALID'; end if;
 if tg_op='UPDATE' and new.pricing_policy is distinct from old.pricing_policy then raise exception 'COUPON_POLICY_IMMUTABLE'; end if;
 return new;
end; $fn$;
create trigger coupons_policy_010 before insert or update on public.coupons for each row execute function public.coupon_policy_guard_010();
create function public.coupon_scope_guard_010() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 -- Serialize scope changes with checkout and the immutable parent policy.
 perform id from public.coupons where id=new.coupon_id for update;
 if exists(select 1 from public.coupons where id=new.coupon_id and pricing_policy='GLOBAL_PERCENTAGE_V1') then raise exception 'COUPON_SCOPE_INVALID'; end if;
 return new;
end; $fn$;
create trigger coupon_products_policy_010 before insert or update on public.coupon_products for each row execute function public.coupon_scope_guard_010();
create trigger coupon_categories_policy_010 before insert or update on public.coupon_categories for each row execute function public.coupon_scope_guard_010();

-- Private arithmetic only. The existing locked resolvers own authorization,
-- validity/usage checks, catalog prices, identity and the resolution instant.
create function public.coupon_sale_choice_010(p_regular numeric,p_sale numeric,p_coupon public.coupons)
returns jsonb language plpgsql immutable set search_path='' as $fn$
declare d numeric:=0; c numeric; winner text:='SALE'; outcome text:='not_requested';
begin
 if p_regular is null or p_sale is null or p_regular::text in ('NaN','Infinity','-Infinity') or p_sale::text in ('NaN','Infinity','-Infinity')
 or p_regular<=0 or p_sale<=0 or p_sale>p_regular or p_regular>9999999999.99 or p_regular<>round(p_regular,2) or p_sale<>round(p_sale,2)
 then raise exception 'COUPON_PRICING_INVALID'; end if;
 if p_coupon.id is not null then
  if p_coupon.pricing_policy is distinct from 'GLOBAL_PERCENTAGE_V1' or p_coupon.type is distinct from 'Percentage'
  or p_coupon.discount_value is null or p_coupon.discount_value::text in ('NaN','Infinity','-Infinity') or p_coupon.discount_value<=0 or p_coupon.discount_value>100
  or p_coupon.minimum_order_amount is null or p_coupon.minimum_order_amount::text in ('NaN','Infinity','-Infinity') or p_coupon.minimum_order_amount<0
  or (p_coupon.max_discount_amount is not null and (p_coupon.max_discount_amount::text in ('NaN','Infinity','-Infinity') or p_coupon.max_discount_amount<0))
  or cardinality(p_coupon.applicable_product_ids)<>0 or cardinality(p_coupon.applicable_category_ids)<>0
  then raise exception 'COUPON_POLICY_INVALID'; end if;
  if p_regular<p_coupon.minimum_order_amount then raise exception 'Coupon minimum is not met.'; end if;
  d:=round(p_regular*p_coupon.discount_value/100,2);
  if p_coupon.max_discount_amount is not null then d:=least(d,p_coupon.max_discount_amount); end if;
  d:=least(p_regular,greatest(0,d)); c:=p_regular-d;
  if c<p_sale then winner:='COUPON'; outcome:='applied';
  elsif c=p_sale then outcome:='tie'; else outcome:='sale_better'; end if;
 end if;
 return jsonb_build_object('policy','GLOBAL_PERCENTAGE_V1','strategy',winner,'regularSubtotal',p_regular,'saleSubtotal',p_sale,
  'couponSubtotal',c,'couponDiscount',d,'merchandiseTotal',case when winner='COUPON' then c else p_sale end,
  'requestedCouponCode',upper(btrim(coalesce(p_coupon.code,''))),
  'appliedCouponId',case when winner='COUPON' then p_coupon.id end,'appliedCouponCode',case when winner='COUPON' then p_coupon.code end,'couponOutcome',outcome);
end; $fn$;
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
  payments jsonb; pricing_at timestamptz; canonical jsonb; prices jsonb; basis jsonb; regular_subtotal numeric; choice jsonb;
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
  select sum((public.effective_sale_price_009(variants.regular_price,variants.sale_price,variants.sale_starts_at,variants.sale_ends_at,pricing_at)) * requested.quantity),sum(variants.regular_price*requested.quantity)
  into v_subtotal,regular_subtotal
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
    if v_coupon.pricing_policy='LEGACY' and v_subtotal < v_coupon.minimum_order_amount then
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

    if v_coupon.pricing_policy='LEGACY' then
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
    else
      choice:=public.coupon_sale_choice_010(regular_subtotal,v_subtotal,v_coupon);
    end if;
  end if;
  if v_coupon.id is null then choice:=public.coupon_sale_choice_010(regular_subtotal,v_subtotal,v_coupon); end if;
  if choice is not null then
    if choice->>'strategy'='COUPON' then v_subtotal:=regular_subtotal;v_discount:=(choice->>'couponDiscount')::numeric;
    else v_discount:=0; end if;
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
  select jsonb_agg(jsonb_build_object('variantId',v.id,'productId',v.product_id,'regularPrice',v.regular_price,'salePrice',v.sale_price,'saleStartEpoch',extract(epoch from v.sale_starts_at),'saleEndEpoch',extract(epoch from v.sale_ends_at),'unitPrice',case when choice->>'strategy'='COUPON' then v.regular_price else public.effective_sale_price_009(v.regular_price,v.sale_price,v.sale_starts_at,v.sale_ends_at,pricing_at) end) order by v.id) into prices from public.product_variants v where v.id in(select (x->>'variantId')::uuid from jsonb_array_elements(p_items) x);
  basis:=jsonb_build_array(canonical,prices,
    case when v_coupon.id is null then null else to_jsonb(v_coupon)-array['used_count','created_at','updated_at'] end,
    to_jsonb(v_shipping_method)-array['created_at','updated_at'],payments,v_subtotal,v_discount,v_shipping_fee,v_total,'PKR');
  if choice is not null then basis:=basis||jsonb_build_array(choice); end if;
  return jsonb_build_object('pricingOutcome',choice,'subtotal',v_subtotal,'discount',v_discount,'shippingFee',v_shipping_fee,'total',v_total,'currency','PKR','shippingMethodId',v_shipping_method.id,'paymentMethods',payments,'quoteFingerprint',public.checkout_v2_hash(basis),
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
  v_shipping_rate_count integer; choice jsonb:=p_quote->'pricingOutcome'; applied boolean;
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
  applied:=v_coupon.id is not null and (choice is null or choice='null'::jsonb or choice->>'strategy'='COUPON');
  if choice is not null and choice<>'null'::jsonb and (choice->>'requestedCouponCode' is distinct from upper(btrim(coalesce(p_coupon_code,'')))
   or choice->>'appliedCouponId' is distinct from case when applied then v_coupon.id::text end) then raise exception 'COUPON_OUTCOME_INVALID'; end if;
  v_shipping_method:=jsonb_populate_record(null::public.shipping_methods,p_quote->'_shippingMethod');
  v_order_id := gen_random_uuid();
  if jsonb_typeof(p_quote->'_prices') is distinct from 'array' then
   raise exception using errcode='22023',message='V1_PRICING_STATE_INVALID'; end if;
  if (select count(*) from jsonb_array_elements(p_quote->'_prices')) is distinct from
     (select count(distinct (x->>'variantId')::uuid) from jsonb_array_elements(p_items) x)
   or exists(select 1 from jsonb_array_elements(p_quote->'_prices') x group by (x->>'variantId')::uuid having count(*)<>1)
   or exists(select 1 from jsonb_array_elements(p_quote->'_prices') x where
    not exists(select 1 from jsonb_array_elements(p_items) i where (i->>'variantId')::uuid=(x->>'variantId')::uuid)
    or (x->>'unitPrice')::numeric is null or (x->>'unitPrice')::numeric<=0 or (x->>'unitPrice')::numeric='NaN'::numeric)
   or (select sum((x->>'unitPrice')::numeric * (select sum((i->>'quantity')::integer) from jsonb_array_elements(p_items) i where (i->>'variantId')::uuid=(x->>'variantId')::uuid))
       from jsonb_array_elements(p_quote->'_prices') x) is distinct from v_subtotal
  then raise exception using errcode='22023',message='V1_PRICING_STATE_INVALID'; end if;
  v_order_number := 'RF-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-' ||
    upper(substr(replace(v_order_id::text, '-', ''), 1, 8));

  insert into public.orders (
    id, order_number, customer_id, customer_name, customer_email, customer_phone,
    shipping_address, shipping_city, shipping_province, order_notes,
    status, payment_method, payment_status, subtotal, discount, shipping_fee, total,
    coupon_code, coupon_id, shipping_method_id, currency, idempotency_key, v1_quote_fingerprint, pricing_outcome
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
    coalesce(v_coupon.code, ''), case when applied then v_coupon.id end, v_shipping_method.id, 'PKR', v_idempotency_key, p_quote->>'quoteFingerprint',
    case when choice is not null and choice<>'null'::jsonb then choice||jsonb_build_object('acceptedQuoteFingerprint',p_quote->>'quoteFingerprint') end
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
    (select (x->>'unitPrice')::numeric from jsonb_array_elements(p_quote->'_prices') x where (x->>'variantId')::uuid=variants.id)
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

  if applied then
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
 pricing_at timestamptz; variants_at jsonb; price_basis jsonb; regular_price numeric; regular_subtotal numeric:=0; choice jsonb;
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
   regular_price:=v.regular_price;
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
    regular_price:=d.fixed_regular_price;
    price:=public.effective_sale_price_009(d.fixed_regular_price,d.fixed_sale_price,d.fixed_sale_starts_at,d.fixed_sale_ends_at,pricing_at);
   else selected:=line->'selections'; price:=0; regular_price:=0; end if;
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
    if d.mode='configurable' then price:=price+public.effective_sale_price_009(v.regular_price,v.sale_price,v.sale_starts_at,v.sale_ends_at,pricing_at)*q; regular_price:=regular_price+v.regular_price*q; end if;
    components:=components||jsonb_build_array(jsonb_build_object('testerVariantId',t.variant_id,'testerProductId',t.tester_product_id,
     'testerName',(select name from public.products where id=t.tester_product_id),'sku',v.sku,'size','5 ml','volumeMl',5,
     'quantityPerPack',q,'totalPhysicalQuantity',q*(line->>'quantity')::bigint,'_regularReference',v.regular_price,'referenceUnitPrice',public.effective_sale_price_009(v.regular_price,v.sale_price,v.sale_starts_at,v.sale_ends_at,pricing_at),'position',component_position));
    demand:=demand||jsonb_build_array(jsonb_build_object('variantId',v.id,'quantity',q*(line->>'quantity')::bigint));
    component_position:=component_position+1; component_count:=component_count+1;
    if component_count>2000 then raise exception 'V2_LIMIT_EXCEEDED'; end if;
   end loop;
   if d.mode='configurable' and (units<d.minimum_units or (d.maximum_units is not null and units>d.maximum_units)) then raise exception 'V2_PACK_UNITS_INVALID'; end if;
   line:=line||jsonb_build_object('productId',p.id,'name',p.name,'sku',p.sku,'size','Tester pack','unitPrice',price,
    'definitionFingerprint',d.definition_fingerprint,'components',components,'position',position);
  end if;
  if price<=0 or price='NaN'::numeric or price>9999999999.99 or price*(line->>'quantity')::numeric>9999999999.99 then raise exception 'V2_LIMIT_EXCEEDED'; end if;
  regular_subtotal:=regular_subtotal+regular_price*(line->>'quantity')::numeric;
  line:=line||jsonb_build_object('_regularPrice',regular_price,'lineTotal',price*(line->>'quantity')::numeric);
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
  or ((pricing_at at time zone 'UTC')::date>c.end_date) or (c.pricing_policy='LEGACY' and subtotal<c.minimum_order_amount)
  or (c.usage_limit>0 and c.used_count>=c.usage_limit) then raise exception 'V2_INVALID_COUPON'; end if;
  if c.per_customer_usage_limit>0 then
   select count(*) into usage_count from public.coupon_redemptions where coupon_id=c.id and
    ((customer is not null and customer_id=customer) or (email<>'' and lower(customer_email)=email));
   if (customer is null and email='') or usage_count>=c.per_customer_usage_limit then raise exception 'V2_INVALID_COUPON'; end if;
  end if;

  if c.pricing_policy='LEGACY' then
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
  else
   begin
    choice:=public.coupon_sale_choice_010(regular_subtotal,subtotal,c);
   exception when raise_exception then
    if sqlerrm='Coupon minimum is not met.' then raise exception 'V2_INVALID_COUPON'; else raise; end if;
   end;
   coupon_basis:=to_jsonb(c)-array['used_count','created_at','updated_at'];
  end if;
 end if;
 if c.id is null then choice:=public.coupon_sale_choice_010(regular_subtotal,subtotal,c); end if;
 if choice->>'strategy'='COUPON' then subtotal:=regular_subtotal;discount:=(choice->>'couponDiscount')::numeric; end if;
 -- Strip private alternatives before fingerprinting or returning frozen lines.
 select jsonb_agg((x-'_regularPrice'-'components')||
  case when choice->>'strategy'='COUPON' then jsonb_build_object('unitPrice',x->'_regularPrice','lineTotal',(x->>'_regularPrice')::numeric*(x->>'quantity')::numeric) else '{}'::jsonb end||
  jsonb_build_object('components',coalesce((select jsonb_agg((z-'_regularReference')||case when choice->>'strategy'='COUPON'
    then jsonb_build_object('referenceUnitPrice',z->'_regularReference') else '{}'::jsonb end order by (z->>'position')::integer)
   from jsonb_array_elements(x->'components') z),'[]'::jsonb)) order by (x->>'position')::integer) into output from jsonb_array_elements(output) x;

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
 if choice is not null then basis:=basis||jsonb_build_array(choice); end if;
 return jsonb_build_object('pricingOutcome',case when choice is not null then choice||jsonb_build_object('acceptedQuoteFingerprint',public.checkout_v2_hash(basis)) end,'contractVersion',2,'quoteFingerprint',public.checkout_v2_hash(basis),'lines',output,'subtotal',subtotal,'discount',discount,'shippingFee',shipping,'total',total,
  'currency','PKR','shippingMethodId',method.id,'paymentMethods',payments,'orderingEnabled',false,'_demand',demand,'_couponId',case when choice is null or choice->>'strategy'='COUPON' then c.id end);
end; $function$;

-- Replace the narrow 009 projection boundary, preserving its validator and single
-- resolver call. Selected private prices must not be obtained by a second read.
CREATE OR REPLACE FUNCTION public.quote_checkout_v1_007_internal(p_request jsonb, p_customer_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q jsonb; item jsonb; lines jsonb;
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
 -- Project already resolved selected prices before discarding private state.
 -- UUID grouping matches the resolver's canonical aggregation, including aliases.
 select coalesce(jsonb_agg(jsonb_build_object(
  'variantId',(price->>'variantId')::uuid,'quantity',requested.quantity,
  'unitPrice',(price->>'unitPrice')::numeric,
  'lineTotal',(price->>'unitPrice')::numeric*requested.quantity
 ) order by (price->>'variantId')::uuid),'[]'::jsonb) into lines
 from jsonb_array_elements(q->'_prices') price
 join (select (x->>'variantId')::uuid variant_id,sum((x->>'quantity')::integer) quantity
       from jsonb_array_elements(p_request->'items') x group by (x->>'variantId')::uuid) requested
 on requested.variant_id=(price->>'variantId')::uuid;
 return (q-array['_coupon','_shippingMethod','_prices'])||jsonb_build_object('lines',lines);
end;
$function$;

create or replace function public.quote_checkout_v1_checked(p_request jsonb,p_customer_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare q jsonb; token text; credential text;
begin
 q:=public.quote_checkout_v1_007_internal(p_request,p_customer_id);
 token:='checkout:'||gen_random_uuid()::text;
 credential:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.checkout_v1_attempts(token,credential_verifier,quote_identity_mac,price_fingerprint_mac)
 values(token,public.checkout_v1_verifier_008(credential),
  public.checkout_v1_mac_008('quote',token,public.checkout_v1_quote_identity_008(p_request->'items',p_request->>'email',p_request->'shipping',p_request->>'couponCode',p_customer_id),credential),
  public.checkout_v1_mac_008('price',token,to_jsonb(q->>'quoteFingerprint'),credential));
 -- Only issuance returns the capability. Order/receipt evidence is its verifier.
 if q->'pricingOutcome' is not null and q->'pricingOutcome'<>'null'::jsonb then q:=jsonb_set(q,'{pricingOutcome}',q->'pricingOutcome'||jsonb_build_object('acceptedQuoteFingerprint',credential)); end if;
 return q||jsonb_build_object('quoteFingerprint',credential,'idempotencyKey',substring(token from 10));
end; $fn$;

create or replace function public.checkout_v2_v1_receipt(p_order_id uuid,p_replay boolean) returns jsonb
language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',o.id,'idempotencyKey',public.checkout_v2_stored_uuid(o.idempotency_key)::text,
  'orderNumber',o.order_number,'status',o.status,'paymentStatus',o.payment_status,'paymentMethod',o.payment_method,
  'subtotal',o.subtotal,'discount',o.discount,'shippingFee',o.shipping_fee,'total',o.total,'currency',o.currency,'idempotent',p_replay,
  'lines',coalesce((select jsonb_agg(jsonb_build_object(
   'id',i.id,'variantId',i.variant_id,'quantity',i.quantity,
   'unitPrice',i.unit_price,'lineTotal',i.line_total
  ) order by i.variant_id nulls last,i.id) from public.order_items i where i.order_id=o.id),'[]'::jsonb))||case when o.pricing_outcome is not null then jsonb_build_object('pricingOutcome',o.pricing_outcome) else '{}'::jsonb end
 from public.orders o where o.id=p_order_id and o.checkout_version=1;
$fn$;

create or replace function public.checkout_v2_receipt(p_order_id uuid,p_replay boolean) returns jsonb
language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('contractVersion',2,'snapshotVersion',2,'id',o.id,'idempotencyKey',substring(o.idempotency_key from 10),
 'requestFingerprint',o.request_fingerprint,'quoteFingerprint',o.quote_fingerprint,'orderNumber',o.order_number,'status',o.status,
 'paymentStatus',o.payment_status,'paymentMethod',o.payment_method,'subtotal',o.subtotal,'discount',o.discount,'shippingFee',o.shipping_fee,
 'total',o.total,'currency',o.currency,'idempotent',p_replay,'lines',coalesce((
  select jsonb_agg((o.quote_snapshot->'lines'->i.position)||jsonb_build_object('id',i.id,'components',coalesce((
   select jsonb_agg(jsonb_build_object('id',c.id,'testerVariantId',c.tester_variant_id,'testerProductId',c.tester_product_id,
    'testerName',c.tester_name,'sku',c.sku,'size',c.size,'volumeMl',c.volume_ml,'quantityPerPack',c.quantity_per_pack,
    'totalPhysicalQuantity',c.total_physical_quantity,'referenceUnitPrice',c.reference_unit_price,'position',c.position) order by c.position)
   from public.order_item_components c where c.order_item_id=i.id),'[]'::jsonb)) order by i.position)
  from public.order_items i where i.order_id=o.id),'[]'::jsonb))||case when o.quote_snapshot->'pricingOutcome' is not null and o.quote_snapshot->'pricingOutcome'<>'null'::jsonb then jsonb_build_object('pricingOutcome',o.quote_snapshot->'pricingOutcome') else '{}'::jsonb end from public.orders o where o.id=p_order_id and o.checkout_version=2;
$fn$;

-- Existing order immutability guards include the additive V1 column. V1's
-- previously unguarded item updates also need protection for new frozen outcomes.
create function public.pricing_items_guard_010() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if exists(select 1 from public.orders where id=old.order_id and pricing_outcome is not null) then
  if tg_table_name<>'payments' or tg_op='DELETE' then raise exception 'PRICING_ITEMS_IMMUTABLE'; end if;
  if (to_jsonb(new)->'order_id',to_jsonb(new)->'amount',to_jsonb(new)->'currency',to_jsonb(new)->'provider',to_jsonb(new)->'idempotency_key')
   is distinct from (to_jsonb(old)->'order_id',to_jsonb(old)->'amount',to_jsonb(old)->'currency',to_jsonb(old)->'provider',to_jsonb(old)->'idempotency_key') then raise exception 'PRICING_ITEMS_IMMUTABLE'; end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end; $fn$;
create trigger pricing_items_immutable_010 before update or delete on public.order_items for each row execute function public.pricing_items_guard_010();
create trigger pricing_payments_immutable_010 before update or delete on public.payments for each row execute function public.pricing_items_guard_010();
create trigger pricing_redemptions_immutable_010 before update or delete on public.coupon_redemptions for each row execute function public.pricing_items_guard_010();
create function public.pricing_outcome_validate_010() returns trigger language plpgsql security definer set search_path='' as $fn$
declare o public.orders%rowtype; evidence jsonb; target uuid; r numeric; s numeric; d numeric; c numeric; m numeric; requested text; applied uuid; winner text; result text;
begin
 target:=(to_jsonb(new)->>case when tg_table_name='orders' then 'id' else 'order_id' end)::uuid;
 select * into o from public.orders where id=target;
 if not found then return null; end if;
 evidence:=case when o.checkout_version=1 then o.pricing_outcome else nullif(o.quote_snapshot->'pricingOutcome','null'::jsonb) end;
 -- Existing historical/legacy orders have no comparison evidence.
 if evidence is null then return null; end if;
 if jsonb_typeof(evidence) is distinct from 'object' or evidence->>'policy' is distinct from 'GLOBAL_PERCENTAGE_V1'
 or evidence->>'acceptedQuoteFingerprint' is distinct from (case when o.checkout_version=1 then o.v1_quote_fingerprint else o.quote_fingerprint end)
 then raise exception 'PRICING_OUTCOME_INVALID'; end if;
 r:=(evidence->>'regularSubtotal')::numeric;s:=(evidence->>'saleSubtotal')::numeric;d:=(evidence->>'couponDiscount')::numeric;
 c:=(evidence->>'couponSubtotal')::numeric;m:=(evidence->>'merchandiseTotal')::numeric;
 winner:=evidence->>'strategy';result:=evidence->>'couponOutcome';requested:=evidence->>'requestedCouponCode';applied:=(evidence->>'appliedCouponId')::uuid;
 if r is null or s is null or d is null or m is null or r::text in ('NaN','Infinity','-Infinity') or s::text in ('NaN','Infinity','-Infinity')
 or d::text in ('NaN','Infinity','-Infinity') or m::text in ('NaN','Infinity','-Infinity') or (c is not null and c::text in ('NaN','Infinity','-Infinity'))
 or r<=0 or s<=0 or s>r or d<0 or d>r or r>9999999999.99 or r<>round(r,2) or s<>round(s,2) or d<>round(d,2) or m<>round(m,2)
 or winner not in ('SALE','COUPON') or winner is null or requested is null or requested is distinct from upper(btrim(o.coupon_code))
 or o.subtotal-o.discount is distinct from m or o.total is distinct from m+o.shipping_fee
 or (select coalesce(sum(line_total),0) from public.order_items where order_id=o.id) is distinct from o.subtotal
 or (select count(*) from public.payments where order_id=o.id and idempotency_key=o.idempotency_key||':payment' and amount=o.total and currency=o.currency and provider=o.payment_method)<>1
 then raise exception 'PRICING_OUTCOME_INVALID'; end if;
 if winner='COUPON' then
  if result is distinct from 'applied' or requested='' or c is null or c is distinct from r-d or not(c<s) or m is distinct from c
  or o.subtotal is distinct from r or o.discount is distinct from d or applied is null or o.coupon_id is distinct from applied
  or nullif(evidence->>'appliedCouponCode','') is null
  or (select count(*) from public.coupon_redemptions where order_id=o.id and coupon_id=applied and discount_amount=d)<>1
  then raise exception 'PRICING_OUTCOME_INVALID'; end if;
 else
  if m is distinct from s or o.subtotal is distinct from s or o.discount<>0 or applied is not null or o.coupon_id is not null
  or evidence->>'appliedCouponCode' is not null or exists(select 1 from public.coupon_redemptions where order_id=o.id)
  or (requested='' and (result is distinct from 'not_requested' or c is not null or d<>0))
  or (requested<>'' and (c is null or c is distinct from r-d or c<s or result is distinct from case when c=s then 'tie' else 'sale_better' end))
  then raise exception 'PRICING_OUTCOME_INVALID'; end if;
 end if;
 return null;
end; $fn$;
create constraint trigger pricing_outcome_orders_010 after insert or update on public.orders deferrable initially deferred for each row execute function public.pricing_outcome_validate_010();
create constraint trigger pricing_outcome_items_010 after insert or update on public.order_items deferrable initially deferred for each row execute function public.pricing_outcome_validate_010();
create constraint trigger pricing_outcome_payments_010 after insert or update on public.payments deferrable initially deferred for each row execute function public.pricing_outcome_validate_010();
create constraint trigger pricing_outcome_redemptions_010 after insert or update on public.coupon_redemptions deferrable initially deferred for each row execute function public.pricing_outcome_validate_010();
revoke all on function public.coupon_policy_guard_010(),public.coupon_scope_guard_010(),public.coupon_sale_choice_010(numeric,numeric,public.coupons),public.pricing_items_guard_010(),public.pricing_outcome_validate_010() from public,anon,authenticated,service_role;

-- @RELEASE010-POST-GUARD-BEGIN
do $post$
declare security jsonb; table_name text; actual jsonb;
begin
 select jsonb_build_object('roles',(select jsonb_agg(to_jsonb(r) order by oid) from pg_roles r),
 'memberships',(select jsonb_agg(to_jsonb(m) order by roleid,member,grantor) from pg_auth_members m),
 'defaults',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d),
 'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p)) into security;
 if security is distinct from (select state from pg_temp.rf010_security) then raise exception 'RF_RELEASE010_SECURITY_PRESERVATION'; end if;
 for table_name in select name from pg_temp.rf010_data order by name loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)-array[''pricing_policy'',''pricing_outcome''] order by to_jsonb(t)-array[''pricing_policy'',''pricing_outcome'']),''[]''::jsonb) from public.%I t',table_name) into actual;
  if actual is distinct from (select rows from pg_temp.rf010_data where name=table_name) then raise exception 'RF_RELEASE010_DATA_PRESERVATION'; end if;
 end loop;
 if exists(select 1 from pg_temp.rf010_functions f left join pg_proc p on p.oid=f.oid
 where p.oid is null or (p.proowner,p.proacl,p.proconfig,p.prosecdef) is distinct from (f.proowner,f.proacl,f.proconfig,f.prosecdef)
 or (p.proname not in ('resolve_checkout_v1_007','create_order_v1_effects_007','checkout_v2_resolve','quote_checkout_v1_007_internal','quote_checkout_v1_checked','checkout_v2_v1_receipt','checkout_v2_receipt') and pg_get_functiondef(p.oid) is distinct from f.definition))
 then raise exception 'RF_RELEASE010_FUNCTION_PRESERVATION'; end if;
 if (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f')<>(select count(*)+5 from pg_temp.rf010_functions)
 or exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('coupon_policy_guard_010','coupon_scope_guard_010','coupon_sale_choice_010','pricing_items_guard_010','pricing_outcome_validate_010')
  and (p.proowner<>'postgres'::regrole or p.proconfig is distinct from array['search_path=""']::text[]
   or p.prosecdef is distinct from (p.proname in ('coupon_scope_guard_010','pricing_items_guard_010','pricing_outcome_validate_010'))
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner)
   or exists(select 1 from pg_roles b cross join pg_roles r where b.rolname !~ '^pg_' and b.rolname<>'postgres' and not(b.rolname='supabase_admin' and b.rolsuper)
    and (b.oid=r.oid or pg_has_role(b.oid,r.oid,'USAGE') or pg_has_role(b.oid,r.oid,'SET')) and has_function_privilege(r.oid,p.oid,'EXECUTE'))))
 then raise exception 'RF_RELEASE010_PRIVATE_RPC'; end if;
 if exists(select 1 from public.coupons where pricing_policy<>'LEGACY') or exists(select 1 from public.orders where pricing_outcome is not null)
 then raise exception 'RF_RELEASE010_HISTORICAL_POLICY'; end if;
end; $post$;
commit;
