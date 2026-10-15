-- Release 007: checked V1 confirmation. Local only; ordering stays disabled.
-- One-shot exact post-006 PG17 predecessor, read committed; maintenance writes quiesced.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
set local search_path=pg_catalog,public;
do $pre$
declare shape text; acl jsonb;
begin
 if current_user <> 'postgres' or current_setting('server_version_num')::int not between 170000 and 179999
 or current_setting('transaction_isolation') <> 'read committed' then raise exception 'RF_RELEASE007_EXECUTION_CONTEXT'; end if;
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
 defaclrole=(select oid from pg_roles where rolname='postgres') and defaclnamespace=0 and defaclobjtype='r')) then raise exception 'RF_RELEASE007_SECURITY_DRIFT'; end if;
 perform pg_advisory_xact_lock(6007,14007);
 -- Variant-first, like checkout/admin. Failure to obtain these locks rolls back.
 lock table public.product_variants,public.products,public.orders in access exclusive mode;
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
 if shape <> '56e23c44b26187f5cd2a8d6407be3da0b21cedf07aa29d181e9a89052c7042b8' then raise exception 'RF_RELEASE007_BASELINE_DRIFT'; end if;
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
 ) x) then raise exception 'RF_RELEASE007_RELEASE005_REQUIRED'; end if;
end;
$pre$;

create temporary table rf007_security on commit drop as select jsonb_build_object('defaults',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d),'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p),'roles',(select jsonb_agg(to_jsonb(r) order by oid) from pg_roles r)) state;
alter table public.orders add column v1_quote_fingerprint text;
alter table public.orders add constraint orders_v1_confirmation_007 check(v1_quote_fingerprint is null or checkout_version=1 and v1_quote_fingerprint ~ '^[0-9a-f]{64}$');
create function public.checkout_v1_payments_007(p_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare private_payments jsonb; public_payments jsonb; commerce jsonb; enabled jsonb; payment text; payments jsonb:='[]';
begin
 -- The preserved writer already holds variant/product/coupon locks here.
 if exists(select 1 from public.product_variants v where v.id in(select (x->>'variantId')::uuid from jsonb_array_elements(p_items) x)
  and (v.regular_price<=0 or v.regular_price='NaN'::numeric or (v.sale_price is not null and
   (v.sale_price<=0 or v.sale_price>=v.regular_price or v.sale_price='NaN'::numeric)))) then raise exception 'V1_CONFIGURATION_UNAVAILABLE'; end if;
 perform id from public.site_settings where id='site' for share;
 perform key from public.public_site_settings where key in ('payments','commerce') order by key for share;
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
 if jsonb_array_length(payments)=0 then raise exception 'V1_CONFIGURATION_UNAVAILABLE'; end if;
  return payments;
end;
$fn$;

-- Extracted from the exact preserved V1 writer: V1 coupon/category/shipping semantics.
create function public.resolve_checkout_v1_007(p_idempotency_key text,p_items jsonb,p_contact jsonb,p_shipping jsonb,p_payment_method text,p_coupon_code text,p_shipping_method_id uuid,p_customer_id uuid) returns jsonb language plpgsql security definer set search_path='' as $fn$
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
  select sum((case when variants.sale_price is not null then variants.sale_price else variants.regular_price end) * requested.quantity)
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
      (case when variants.sale_price is not null then variants.sale_price else variants.regular_price end) * requested.quantity
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
  select jsonb_agg(jsonb_build_array(v.id,v.product_id,v.regular_price,v.sale_price,coalesce(v.sale_price,v.regular_price)) order by v.id) into prices from public.product_variants v where v.id in(select (x->>'variantId')::uuid from jsonb_array_elements(p_items) x);
  basis:=jsonb_build_array(canonical,prices,
    case when v_coupon.id is null then null else to_jsonb(v_coupon)-array['used_count','created_at','updated_at'] end,
    to_jsonb(v_shipping_method)-array['created_at','updated_at'],payments,v_subtotal,v_discount,v_shipping_fee,v_total,'PKR');
  return jsonb_build_object('subtotal',v_subtotal,'discount',v_discount,'shippingFee',v_shipping_fee,'total',v_total,'currency','PKR','shippingMethodId',v_shipping_method.id,'paymentMethods',payments,'quoteFingerprint',public.checkout_v2_hash(basis),
    '_coupon',to_jsonb(v_coupon),'_shippingMethod',to_jsonb(v_shipping_method));
end;

$fn$;

-- Original transactional effects; inputs below come only from the locked resolver.
create function public.create_order_v1_effects_007(p_idempotency_key text,p_items jsonb,p_contact jsonb,p_shipping jsonb,p_payment_method text,p_coupon_code text,p_shipping_method_id uuid,p_customer_id uuid,p_quote jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
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
    case when variants.sale_price is not null then variants.sale_price else variants.regular_price end
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

$fn$;

create or replace function public.create_order_transaction(p_idempotency_key text,p_items jsonb,p_contact jsonb,p_shipping jsonb,p_payment_method text,p_coupon_code text default null,p_shipping_method_id uuid default null,p_customer_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare key text; previous public.orders%rowtype; item jsonb; requested jsonb; stored jsonb; created jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='V2_PERMISSION_DENIED'; end if;
 key:=public.checkout_v2_key(p_idempotency_key);
 if p_customer_id is not null and not exists(select 1 from public.profiles where id=p_customer_id and status='Active') then
  raise exception using errcode='23503',message='Customer account is unavailable.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(key,0));
 previous:=public.checkout_v2_existing(key);
 if previous.id is not null then
  if previous.checkout_version<>1 then raise exception 'V2_IDEMPOTENCY_CONFLICT'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'V2_INVALID_REQUEST'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
   perform public.checkout_v2_uuid(item->'variantId');
   if public.checkout_v2_integer(item->'quantity')>99 then raise exception 'V2_INVALID_REQUEST'; end if;
  end loop;
  select jsonb_agg(jsonb_build_array(id::text,quantity) order by id) into requested from (
   select (x->>'variantId')::uuid id,sum((x->>'quantity')::bigint) quantity from jsonb_array_elements(p_items) x group by (x->>'variantId')::uuid
  ) lines;
  select jsonb_agg(jsonb_build_array(variant_id::text,quantity) order by variant_id) into stored from (
   select variant_id,sum(quantity::bigint) quantity from public.order_items where order_id=previous.id group by variant_id
  ) lines;
  if requested is distinct from stored or previous.customer_id is distinct from p_customer_id
   or previous.customer_name is distinct from btrim(coalesce(p_contact->>'name',''))
   or lower(coalesce(previous.customer_email,''))<>lower(btrim(coalesce(p_contact->>'email','')))
   or coalesce(previous.customer_phone,'')<>btrim(coalesce(p_contact->>'phone',''))
   or previous.shipping_address is distinct from btrim(coalesce(p_shipping->>'address',''))
   or previous.shipping_city is distinct from btrim(coalesce(p_shipping->>'city',''))
   or coalesce(previous.shipping_province,'')<>btrim(coalesce(p_shipping->>'province',''))
   or coalesce(previous.order_notes,'')<>btrim(coalesce(p_shipping->>'notes',''))
   or previous.payment_method is distinct from p_payment_method
   or upper(coalesce(previous.coupon_code,''))<>upper(btrim(coalesce(p_coupon_code,'')))
   or (p_shipping_method_id is not null and p_shipping_method_id is distinct from previous.shipping_method_id)
   then raise exception 'V2_IDEMPOTENCY_CONFLICT'; end if;
  -- Never pass a historical alias to the internal writer; replay is read-only.
  return public.checkout_v2_v1_receipt(previous.id,true);
 end if;
  raise exception 'V1_QUOTE_REQUIRED';
end;
$fn$;
create function public.quote_checkout_v1_checked(p_request jsonb,p_customer_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $fn$
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
 return q-array['_coupon','_shippingMethod'];
end;
$fn$;

create function public.create_order_transaction_v1_checked(p_idempotency_key text,p_items jsonb,p_contact jsonb,p_shipping jsonb,p_payment_method text,p_coupon_code text default null,p_shipping_method_id uuid default null,p_customer_id uuid default null,p_quote_fingerprint text default null) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare key text; previous public.orders%rowtype; q jsonb; created jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='V2_PERMISSION_DENIED'; end if;
 key:=public.checkout_v2_key(p_idempotency_key);
 perform pg_advisory_xact_lock(hashtextextended(key,0));
 previous:=public.checkout_v2_existing(key);
 if previous.id is not null then
  if previous.checkout_version=1 and previous.v1_quote_fingerprint is not null and previous.v1_quote_fingerprint is distinct from p_quote_fingerprint then raise exception 'V2_IDEMPOTENCY_CONFLICT'; end if;
  return public.create_order_transaction(key,p_items,p_contact,p_shipping,p_payment_method,p_coupon_code,p_shipping_method_id,p_customer_id);
 end if;
 if p_quote_fingerprint is null then raise exception 'V1_QUOTE_REQUIRED'; end if;
 if p_quote_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'V1_QUOTE_CHANGED'; end if;
 q:=public.resolve_checkout_v1_007(key,p_items,p_contact,p_shipping,p_payment_method,p_coupon_code,p_shipping_method_id,p_customer_id);
 if q->>'quoteFingerprint' is distinct from p_quote_fingerprint then raise exception 'V1_QUOTE_CHANGED'; end if;
 created:=public.create_order_v1_effects_007(key,p_items,p_contact,p_shipping,p_payment_method,p_coupon_code,p_shipping_method_id,p_customer_id,q);
 return public.checkout_v2_v1_receipt((created->>'id')::uuid,false);
end;
$fn$;

create function public.guard_v1_confirmation_007() returns trigger language plpgsql  set search_path='' as $fn$
begin
 if tg_op='DELETE' then
  if old.v1_quote_fingerprint is not null then raise exception 'V1_CONFIRMATION_IMMUTABLE'; end if;
  return old;
 end if;
 if tg_op='INSERT' and new.checkout_version=1 and (new.v1_quote_fingerprint is null or current_user<>'postgres') then raise exception 'V1_QUOTE_REQUIRED'; end if;
 if tg_op='UPDATE' then
  if new.v1_quote_fingerprint is distinct from old.v1_quote_fingerprint then raise exception 'V1_CONFIRMATION_IMMUTABLE'; end if;
  if old.v1_quote_fingerprint is not null and (to_jsonb(new)-array['status','payment_status','courier_name','tracking_number','internal_notes','updated_at','revision']) is distinct from (to_jsonb(old)-array['status','payment_status','courier_name','tracking_number','internal_notes','updated_at','revision']) then raise exception 'V1_CONFIRMATION_IMMUTABLE'; end if;
 end if;
 return new;
end;
$fn$;

create trigger orders_v1_confirmation_007 before insert or update or delete on public.orders for each row execute function public.guard_v1_confirmation_007();
revoke all on function public.checkout_v1_payments_007(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.resolve_checkout_v1_007(text,jsonb,jsonb,jsonb,text,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.create_order_v1_effects_007(text,jsonb,jsonb,jsonb,text,text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.guard_v1_confirmation_007() from public,anon,authenticated,service_role;
revoke all on function public.quote_checkout_v1_checked(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.create_order_transaction_v1_checked(text,jsonb,jsonb,jsonb,text,text,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.quote_checkout_v1_checked(jsonb,uuid),public.create_order_transaction_v1_checked(text,jsonb,jsonb,jsonb,text,text,uuid,uuid,text) to service_role;
do $post$
declare after_state jsonb;
begin
 select jsonb_build_object('defaults',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d),'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p),'roles',(select jsonb_agg(to_jsonb(r) order by oid) from pg_roles r)) into after_state;
 if after_state is distinct from (select state from pg_temp.rf007_security) then raise exception 'RF_RELEASE007_SECURITY_PRESERVATION'; end if;
 if not has_function_privilege('service_role','public.create_order_transaction_v1_checked(text,jsonb,jsonb,jsonb,text,text,uuid,uuid,text)','EXECUTE')
 or has_function_privilege('anon','public.create_order_transaction_v1_checked(text,jsonb,jsonb,jsonb,text,text,uuid,uuid,text)','EXECUTE') or has_function_privilege('authenticated','public.quote_checkout_v1_checked(jsonb,uuid)','EXECUTE') then raise exception 'RF_RELEASE007_ACL'; end if;
 -- @RELEASE007-PRIVATE-GUARD-BEGIN
 -- Preserve defaults, but fail atomically if they expose a newly created helper.
 -- Only the owner and the identified platform administrator when actually SUPERUSER
 -- have trusted administrative access. No application/custom role is name-exempt.
 if exists(select 1 from pg_roles b where b.rolname<>'postgres'
   and not (b.rolname='supabase_admin' and b.rolsuper) and (b.rolsuper or b.rolcreaterole))
 or exists(select 1 from pg_roles b cross join pg_roles r
   where b.rolname<>'postgres' and not (b.rolname='supabase_admin' and b.rolsuper)
   and b.oid<>r.oid and (r.rolname='postgres' or r.rolsuper or r.rolcreaterole)
   and (pg_has_role(b.oid,r.oid,'USAGE') or pg_has_role(b.oid,r.oid,'SET')
     or exists(select 1 from pg_auth_members m where m.member=b.oid and m.roleid=r.oid and m.admin_option)))
 then raise exception 'RF_RELEASE007_PRIVATE_ROLE_PATH'; end if;
 if exists(select 1 from pg_proc p where p.oid=any(array[
   'public.checkout_v1_payments_007(jsonb)'::regprocedure,
   'public.resolve_checkout_v1_007(text,jsonb,jsonb,jsonb,text,text,uuid,uuid)'::regprocedure,
   'public.create_order_v1_effects_007(text,jsonb,jsonb,jsonb,text,text,uuid,uuid,jsonb)'::regprocedure,
   'public.guard_v1_confirmation_007()'::regprocedure]::oid[])
   and (p.proowner<>(select oid from pg_roles where rolname='postgres')
     or p.proconfig is distinct from array['search_path=""']::text[]
     or p.prosecdef is distinct from (p.proname<>'guard_v1_confirmation_007')
     or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner)
     or exists(select 1 from pg_roles b cross join pg_roles r
       where b.rolname<>'postgres' and not (b.rolname='supabase_admin' and b.rolsuper)
       and (b.oid=r.oid or pg_has_role(b.oid,r.oid,'USAGE') or pg_has_role(b.oid,r.oid,'SET'))
       and has_function_privilege(r.oid,p.oid,'EXECUTE'))))
 then raise exception 'RF_RELEASE007_PRIVATE_RPC'; end if;
 -- @RELEASE007-PRIVATE-GUARD-END
end; $post$;
commit;
