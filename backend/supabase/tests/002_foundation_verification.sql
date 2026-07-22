-- LOCAL OR DISPOSABLE STAGING ONLY.
-- Run after migrations 001/002 and seed/001_starter_catalog.sql.
-- The transaction rolls back all fixtures, orders, and stock changes.

begin;

do $$
declare
  missing_tables text[];
begin
  select array_agg(required.name order by required.name)
  into missing_tables
  from unnest(array[
    'profiles','customer_addresses','roles','permissions','role_permissions','user_roles',
    'products','product_variants','categories','collections','product_categories','product_collections',
    'product_media','inventory_movements','promotions','coupons','coupon_products',
    'coupon_categories','coupon_redemptions','orders','order_items','order_status_history',
    'order_notes','payments','refunds','shipping_methods','shipping_rates','site_settings',
    'public_site_settings','seo_settings','admin_audit_logs'
  ]) required(name)
  where to_regclass('public.' || required.name) is null;

  if missing_tables is not null then
    raise exception 'Missing launch tables: %', missing_tables;
  end if;

  if to_regprocedure('public.create_order_transaction(text,jsonb,jsonb,jsonb,text,text,uuid,uuid)') is null then
    raise exception 'Transactional checkout function is missing.';
  end if;

  if exists (
    select 1
    from pg_class relations
    join pg_namespace namespaces on namespaces.oid = relations.relnamespace
    where namespaces.nspname = 'public'
      and relations.relname = any(array[
        'profiles','customer_addresses','roles','permissions','role_permissions','user_roles',
        'products','product_variants','categories','collections','product_categories',
        'product_collections','product_media','inventory_movements','promotions','coupons',
        'coupon_products','coupon_categories','coupon_redemptions','orders','order_items',
        'order_status_history','order_notes','payments','refunds','shipping_methods',
        'shipping_rates','site_settings','public_site_settings','seo_settings','admin_audit_logs'
      ])
      and not relations.relrowsecurity
  ) then
    raise exception 'One or more launch tables do not have RLS enabled.';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.create_order_transaction(text,jsonb,jsonb,jsonb,text,text,uuid,uuid)',
    'execute'
  ) then
    raise exception 'Authenticated browser role can execute backend checkout.';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'orders'
      and ('anon' = any(roles) or 'authenticated' = any(roles))
      and cmd = 'INSERT'
  ) then
    raise exception 'Browser roles must not have an order insert policy.';
  end if;
end $$;

-- Constraint checks -----------------------------------------------------------

do $$
begin
  begin
    insert into public.product_variants (
      product_id, option_value, sku, regular_price, stock_quantity
    ) values (
      'ffffffff-ffff-4fff-8fff-ffffffffffff', 'Missing product', 'RF-TEST-MISSING-FK', 100, 1
    );
    raise exception 'Product variant foreign key did not reject the row.';
  exception when foreign_key_violation then
    null;
  end;

  begin
    insert into public.product_variants (
      product_id, option_value, sku, regular_price, stock_quantity
    )
    select id, 'Invalid', 'RF-TEST-NEGATIVE-STOCK', 100, -1
    from public.products limit 1;
    raise exception 'Negative stock constraint did not reject the row.';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.product_variants (
      product_id, option_value, sku, regular_price, sale_price, stock_quantity
    )
    select id, 'Invalid sale', 'RF-TEST-SALE', 100, 100, 1
    from public.products limit 1;
    raise exception 'Sale-price constraint did not reject the row.';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.collections (name, slug)
    values ('Duplicate slug test', 'ROYAL-FUSION-ORIGINALS');
    raise exception 'Case-insensitive collection slug rule did not reject the row.';
  exception when unique_violation then
    null;
  end;
end $$;

-- Supabase Auth fixtures. The new-user trigger creates matching profiles.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  ('81000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'customer-a@example.invalid', crypt('LocalTestOnly-A!', gen_salt('bf')), now(), '{}'::jsonb, '{"full_name":"Customer A"}'::jsonb, now(), now(), '', '', '', ''),
  ('81000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'customer-b@example.invalid', crypt('LocalTestOnly-B!', gen_salt('bf')), now(), '{}'::jsonb, '{"full_name":"Customer B"}'::jsonb, now(), now(), '', '', '', ''),
  ('81000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@example.invalid', crypt('LocalTestOnly-C!', gen_salt('bf')), now(), '{}'::jsonb, '{"full_name":"Test Owner"}'::jsonb, now(), now(), '', '', '', ''),
  ('81000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'editor@example.invalid', crypt('LocalTestOnly-D!', gen_salt('bf')), now(), '{}'::jsonb, '{"full_name":"Test Editor"}'::jsonb, now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_id)
select '81000000-0000-4000-8000-000000000003', id from public.roles where key = 'owner_admin'
on conflict do nothing;
insert into public.user_roles (user_id, role_id)
select '81000000-0000-4000-8000-000000000004', id from public.roles where key = 'content_editor'
on conflict do nothing;

-- Anonymous visibility --------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  if exists (select 1 from public.products where status <> 'Published' or not active) then
    raise exception 'Anonymous product RLS exposed a non-published product.';
  end if;
  if exists (select 1 from public.collections where not active) then
    raise exception 'Anonymous collection RLS exposed an inactive collection.';
  end if;
  if has_table_privilege(current_user, 'public.site_settings', 'select') then
    raise exception 'Anonymous access exposed private site_settings.';
  end if;
  if not exists (select 1 from public.public_site_settings) then
    raise exception 'Anonymous users cannot read safe public settings.';
  end if;
end $$;

reset role;

-- Customer A versus customer B ------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
do $$
begin
  if has_table_privilege(current_user, 'public.orders', 'insert') then
    raise exception 'Authenticated browser role can insert orders directly.';
  end if;
end $$;
insert into public.customer_addresses (
  id, customer_id, recipient_name, phone, address_line_1, city, province, is_default
) values (
  '82000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  'Customer A', '+92 300 0000001', 'Fictional Address A', 'Karachi', 'Sindh', true
);

select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
do $$
begin
  if exists (
    select 1 from public.customer_addresses
    where id = '82000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Customer B can read Customer A address.';
  end if;
end $$;

-- Permission boundaries -------------------------------------------------------

select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);
do $$
begin
  if not public.has_permission('promotions.manage') then
    raise exception 'Content editor is missing promotions.manage.';
  end if;
  if public.has_permission('orders.read') or public.has_permission('payments.read') or public.has_permission('customers.read') then
    raise exception 'Content editor received transactional or customer permissions.';
  end if;
end $$;

select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
do $$
begin
  if not public.has_permission('orders.manage') or not public.has_permission('roles.manage') then
    raise exception 'Owner wildcard permission is not working.';
  end if;
end $$;

reset role;

-- Checkout, idempotency, coupon limits, stock, and rollback ------------------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

insert into public.coupons (
  id, code, type, discount_value, minimum_order_amount,
  usage_limit, used_count, per_customer_usage_limit, status
) values (
  '83000000-0000-4000-8000-000000000001', 'LOCAL-ONCE', 'Percentage', 10, 0, 1, 0, 1, 'Active'
)
on conflict (code) do update set usage_limit = 1, used_count = 0, per_customer_usage_limit = 1;

do $$
declare
  variant_id uuid;
  stock_before integer;
  first_result jsonb;
  retry_result jsonb;
  order_count integer;
  stock_after integer;
begin
  select id, stock_quantity into variant_id, stock_before
  from public.product_variants
  where sku = 'RF-SHAHEEN-30ML';

  first_result := public.create_order_transaction(
    'local-idempotency-001',
    jsonb_build_array(jsonb_build_object('variantId', variant_id, 'quantity', 2)),
    '{"name":"Local Customer","email":"checkout@example.invalid","phone":"+92 300 0000009"}'::jsonb,
    '{"address":"Fictional Checkout Address","city":"Karachi","province":"Sindh"}'::jsonb,
    'Cash on Delivery',
    'LOCAL-ONCE',
    null,
    null
  );

  retry_result := public.create_order_transaction(
    'local-idempotency-001',
    jsonb_build_array(jsonb_build_object('variantId', variant_id, 'quantity', 2)),
    '{"name":"Local Customer","email":"checkout@example.invalid","phone":"+92 300 0000009"}'::jsonb,
    '{"address":"Fictional Checkout Address","city":"Karachi","province":"Sindh"}'::jsonb,
    'Cash on Delivery',
    'LOCAL-ONCE',
    null,
    null
  );

  select count(*) into order_count from public.orders where idempotency_key = 'local-idempotency-001';
  select stock_quantity into stock_after from public.product_variants where id = variant_id;

  if order_count <> 1 or stock_after <> stock_before - 2 then
    raise exception 'Checkout idempotency or stock reduction failed.';
  end if;
  if coalesce((retry_result ->> 'idempotent')::boolean, false) is not true then
    raise exception 'Idempotent retry was not identified.';
  end if;

  begin
    perform public.create_order_transaction(
      'local-coupon-limit-002',
      jsonb_build_array(jsonb_build_object('variantId', variant_id, 'quantity', 1)),
      '{"name":"Other Customer","email":"other@example.invalid","phone":"+92 300 0000010"}'::jsonb,
      '{"address":"Fictional Address","city":"Karachi","province":"Sindh"}'::jsonb,
      'Cash on Delivery', 'LOCAL-ONCE', null, null
    );
    raise exception 'Coupon usage limit did not reject a second order.';
  exception when raise_exception then
    if sqlerrm = 'Coupon usage limit did not reject a second order.' then raise; end if;
  end;

  begin
    perform public.create_order_transaction(
      'local-rollback-stock-003',
      jsonb_build_array(jsonb_build_object('variantId', variant_id, 'quantity', 99)),
      '{"name":"Rollback Customer","email":"rollback@example.invalid","phone":"+92 300 0000011"}'::jsonb,
      '{"address":"Fictional Address","city":"Karachi","province":"Sindh"}'::jsonb,
      'Cash on Delivery', null, null, null
    );
    raise exception 'Insufficient stock did not roll back checkout.';
  exception when raise_exception then
    if sqlerrm = 'Insufficient stock did not roll back checkout.' then raise; end if;
  end;

  if exists (select 1 from public.orders where idempotency_key = 'local-rollback-stock-003') then
    raise exception 'Failed checkout persisted an order.';
  end if;
end $$;

reset role;
rollback;
