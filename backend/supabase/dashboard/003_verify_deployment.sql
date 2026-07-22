-- Royal Fusion deployment verification.
-- Read-only: this script inspects PostgreSQL catalogs and privileges only.

with required_tables(table_name) as (
  values
    ('profiles'), ('customer_addresses'), ('roles'), ('permissions'),
    ('role_permissions'), ('user_roles'), ('admin_memberships'),
    ('categories'), ('collections'), ('products'), ('product_variants'),
    ('product_categories'), ('product_collections'), ('product_media'),
    ('inventory_movements'), ('promotions'), ('coupons'), ('coupon_products'),
    ('coupon_categories'), ('coupon_redemptions'), ('orders'), ('order_items'),
    ('order_status_history'), ('order_notes'), ('payments'), ('refunds'),
    ('shipping_methods'), ('shipping_rates'), ('site_settings'),
    ('public_site_settings'), ('seo_settings'), ('reviews'),
    ('contact_messages'), ('newsletter_subscribers'), ('admin_audit_logs')
),
required_functions(check_name, function_signature) as (
  values
    ('function: has_permission(text)', 'public.has_permission(text)'),
    ('function: create_order_transaction(text,jsonb,jsonb,jsonb,text,text,uuid,uuid)', 'public.create_order_transaction(text,jsonb,jsonb,jsonb,text,text,uuid,uuid)'),
    ('function: handle_new_auth_user()', 'public.handle_new_auth_user()'),
    ('function: sync_product_stock_from_variants()', 'public.sync_product_stock_from_variants()')
),
required_triggers(check_name, schema_name, table_name, trigger_name) as (
  values
    ('trigger: auth.users/on_auth_user_created', 'auth', 'users', 'on_auth_user_created'),
    ('trigger: product_variants/product_variants_sync_product_stock', 'public', 'product_variants', 'product_variants_sync_product_stock'),
    ('trigger: profiles/profiles_protect_restricted_fields', 'public', 'profiles', 'profiles_protect_restricted_fields')
),
required_indexes(index_name) as (
  values
    ('orders_idempotency_uidx'),
    ('product_variants_sku_lower_uidx'),
    ('coupons_code_lower_uidx'),
    ('product_media_one_primary_uidx')
),
required_policies(table_name, policy_name) as (
  values
    ('profiles', 'rf_profiles_select'),
    ('profiles', 'rf_profiles_update'),
    ('customer_addresses', 'rf_addresses_select'),
    ('customer_addresses', 'rf_addresses_insert'),
    ('customer_addresses', 'rf_addresses_update'),
    ('customer_addresses', 'rf_addresses_delete'),
    ('roles', 'rf_roles_admin'),
    ('permissions', 'rf_permissions_admin'),
    ('role_permissions', 'rf_role_permissions_admin'),
    ('user_roles', 'rf_user_roles_admin'),
    ('categories', 'rf_categories_public_read'),
    ('categories', 'rf_categories_admin'),
    ('products', 'rf_products_public_read'),
    ('products', 'rf_products_admin'),
    ('collections', 'rf_collections_public_read'),
    ('collections', 'rf_collections_admin'),
    ('product_variants', 'rf_variants_public_read'),
    ('product_variants', 'rf_variants_admin'),
    ('product_categories', 'rf_product_categories_public_read'),
    ('product_categories', 'rf_product_categories_admin'),
    ('product_collections', 'rf_product_collections_public_read'),
    ('product_collections', 'rf_product_collections_admin'),
    ('product_media', 'rf_product_media_public_read'),
    ('product_media', 'rf_product_media_admin'),
    ('inventory_movements', 'rf_inventory_admin_read'),
    ('inventory_movements', 'rf_inventory_admin_write'),
    ('promotions', 'rf_promotions_public_read'),
    ('promotions', 'rf_promotions_admin'),
    ('coupons', 'rf_coupons_admin'),
    ('coupon_products', 'rf_coupon_products_admin'),
    ('coupon_categories', 'rf_coupon_categories_admin'),
    ('coupon_redemptions', 'rf_coupon_redemptions_customer_read'),
    ('orders', 'rf_orders_read'),
    ('orders', 'rf_orders_admin_update'),
    ('order_items', 'rf_order_items_read'),
    ('order_status_history', 'rf_order_history_read'),
    ('order_status_history', 'rf_order_history_admin_write'),
    ('order_notes', 'rf_order_notes_admin'),
    ('payments', 'rf_payments_admin_read'),
    ('payments', 'rf_payments_admin_write'),
    ('refunds', 'rf_refunds_admin_read'),
    ('refunds', 'rf_refunds_admin_write'),
    ('reviews', 'rf_reviews_public_read'),
    ('reviews', 'rf_reviews_admin'),
    ('newsletter_subscribers', 'rf_newsletter_admin'),
    ('contact_messages', 'rf_contact_admin'),
    ('shipping_methods', 'rf_shipping_methods_public_read'),
    ('shipping_methods', 'rf_shipping_methods_admin'),
    ('shipping_rates', 'rf_shipping_rates_public_read'),
    ('shipping_rates', 'rf_shipping_rates_admin'),
    ('public_site_settings', 'rf_public_settings_read'),
    ('public_site_settings', 'rf_public_settings_admin'),
    ('site_settings', 'rf_private_settings_admin_read'),
    ('site_settings', 'rf_private_settings_admin_write'),
    ('seo_settings', 'rf_seo_public_read'),
    ('seo_settings', 'rf_seo_admin'),
    ('admin_audit_logs', 'rf_audit_read'),
    ('admin_memberships', 'rf_legacy_memberships_owner')
),
checks(check_name, check_passed, details) as (
  select
    'required table: ' || required_tables.table_name,
    to_regclass('public.' || required_tables.table_name) is not null,
    case
      when to_regclass('public.' || required_tables.table_name) is not null
        then 'Found public.' || required_tables.table_name || '.'
      else 'Missing public.' || required_tables.table_name || '.'
    end
  from required_tables

  union all

  select
    required_functions.check_name,
    to_regprocedure(required_functions.function_signature) is not null,
    case
      when to_regprocedure(required_functions.function_signature) is not null
        then 'Function exists with the required signature.'
      else 'Function is missing or has a different signature.'
    end
  from required_functions

  union all

  select
    required_triggers.check_name,
    exists (
      select 1
      from pg_trigger trigger_record
      join pg_class table_record on table_record.oid = trigger_record.tgrelid
      join pg_namespace schema_record on schema_record.oid = table_record.relnamespace
      where schema_record.nspname = required_triggers.schema_name
        and table_record.relname = required_triggers.table_name
        and trigger_record.tgname = required_triggers.trigger_name
        and not trigger_record.tgisinternal
    ),
    'Required trigger on ' || required_triggers.schema_name || '.' || required_triggers.table_name || '.'
  from required_triggers

  union all

  select
    'required index: ' || required_indexes.index_name,
    to_regclass('public.' || required_indexes.index_name) is not null,
    case
      when to_regclass('public.' || required_indexes.index_name) is not null
        then 'Index exists.'
      else 'Index is missing.'
    end
  from required_indexes

  union all

  select
    'required policy: ' || required_policies.table_name || '/' || required_policies.policy_name,
    exists (
      select 1
      from pg_policies policy_record
      where policy_record.schemaname = 'public'
        and policy_record.tablename = required_policies.table_name
        and policy_record.policyname = required_policies.policy_name
    ),
    'Required RLS policy on public.' || required_policies.table_name || '.'
  from required_policies

  union all

  select
    'RLS enabled on every public table',
    not exists (
      select 1
      from pg_class table_record
      join pg_namespace schema_record on schema_record.oid = table_record.relnamespace
      where schema_record.nspname = 'public'
        and table_record.relkind = 'r'
        and not table_record.relrowsecurity
    ),
    coalesce((
      select 'RLS disabled on: ' || string_agg(table_record.relname, ', ' order by table_record.relname) || '.'
      from pg_class table_record
      join pg_namespace schema_record on schema_record.oid = table_record.relnamespace
      where schema_record.nspname = 'public'
        and table_record.relkind = 'r'
        and not table_record.relrowsecurity
    ), 'RLS is enabled on every public table.')

  union all

  select
    'orders has no anon/authenticated INSERT policy',
    not exists (
      select 1
      from pg_policies policy_record
      where policy_record.schemaname = 'public'
        and policy_record.tablename = 'orders'
        and policy_record.cmd in ('INSERT', 'ALL')
        and (
          policy_record.roles @> array['anon']::name[]
          or policy_record.roles @> array['authenticated']::name[]
          or policy_record.roles @> array['public']::name[]
        )
    ),
    'Browser roles must not have an order INSERT policy.'

  union all

  select
    'anon lacks orders INSERT grant',
    coalesce(not has_table_privilege('anon', to_regclass('public.orders'), 'INSERT'), false),
    'Anonymous users must not have the table-level INSERT privilege.'

  union all

  select
    'authenticated lacks orders INSERT grant',
    coalesce(not has_table_privilege('authenticated', to_regclass('public.orders'), 'INSERT'), false),
    'Authenticated browser users must not have the table-level INSERT privilege.'

  union all

  select
    'anon cannot read private site_settings',
    coalesce(not has_table_privilege('anon', to_regclass('public.site_settings'), 'SELECT'), false),
    'Private site settings must not have an anonymous SELECT grant.'

  union all

  select
    'site_settings has no public read policy',
    not exists (
      select 1
      from pg_policies policy_record
      where policy_record.schemaname = 'public'
        and policy_record.tablename = 'site_settings'
        and policy_record.cmd in ('SELECT', 'ALL')
        and (
          policy_record.roles @> array['anon']::name[]
          or policy_record.roles @> array['public']::name[]
        )
    ),
    'Private site settings must not have a public SELECT policy.'

  union all

  select
    'anon cannot execute checkout',
    coalesce(not has_function_privilege(
      'anon',
      to_regprocedure('public.create_order_transaction(text,jsonb,jsonb,jsonb,text,text,uuid,uuid)'),
      'EXECUTE'
    ), false),
    'Checkout execution must be unavailable to the anonymous role.'

  union all

  select
    'authenticated cannot execute checkout',
    coalesce(not has_function_privilege(
      'authenticated',
      to_regprocedure('public.create_order_transaction(text,jsonb,jsonb,jsonb,text,text,uuid,uuid)'),
      'EXECUTE'
    ), false),
    'Checkout execution must be unavailable to authenticated browser users.'

  union all

  select
    'service_role can execute checkout',
    coalesce(has_function_privilege(
      'service_role',
      to_regprocedure('public.create_order_transaction(text,jsonb,jsonb,jsonb,text,text,uuid,uuid)'),
      'EXECUTE'
    ), false),
    'Only the backend service role receives checkout execution access.'

  union all

  select
    'checkout is SECURITY DEFINER with fixed search_path',
    exists (
      select 1
      from pg_proc function_record
      join pg_namespace schema_record on schema_record.oid = function_record.pronamespace
      where schema_record.nspname = 'public'
        and function_record.proname = 'create_order_transaction'
        and function_record.prosecdef
        and coalesce(array_to_string(function_record.proconfig, ','), '') like '%search_path=""%'
    ),
    'The privileged checkout function must use SECURITY DEFINER and an empty search_path.'
),
consolidated_results as (
  select check_name, check_passed, details
  from checks

  union all

  select
    'overall_verification',
    coalesce(bool_and(check_passed), false),
    case
      when coalesce(bool_and(check_passed), false)
        then 'Every required deployment verification check passed.'
      else 'One or more required deployment verification checks failed. Review the failed rows above.'
    end
  from checks
)
select check_name, check_passed, details
from consolidated_results
order by
  case when check_name = 'overall_verification' then 1 else 0 end,
  check_name;
