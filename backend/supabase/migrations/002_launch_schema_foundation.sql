-- Royal Fusion launch schema foundation.
-- Additive to 001_initial_schema.sql. Safe to run again after a completed run.

begin;

create extension if not exists pgcrypto;

-- Identity and permission model ------------------------------------------------

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'Home',
  recipient_name text not null,
  phone text not null,
  address_line_1 text not null,
  address_line_2 text not null default '',
  city text not null,
  province text not null,
  postal_code text not null default '',
  country_code text not null default 'PK',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_addresses_country_code check (country_code ~ '^[A-Z]{2}$')
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null default '',
  is_system boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  active boolean not null default true,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create unique index if not exists roles_key_lower_uidx on public.roles (lower(key));
create unique index if not exists permissions_key_lower_uidx on public.permissions (lower(key));
create unique index if not exists profiles_email_lower_uidx
  on public.profiles(lower(email)) where nullif(trim(email), '') is not null;
create unique index if not exists profiles_phone_uidx
  on public.profiles(phone) where nullif(trim(phone), '') is not null;
create index if not exists customer_addresses_customer_idx on public.customer_addresses(customer_id);
create unique index if not exists customer_addresses_one_default_uidx
  on public.customer_addresses(customer_id) where is_default;
create index if not exists user_roles_role_idx on public.user_roles(role_id) where active;
create index if not exists role_permissions_permission_idx on public.role_permissions(permission_id);

insert into public.roles (key, name, description, is_system)
values
  ('owner_admin', 'Owner/Admin', 'Full Royal Fusion administrative access.', true),
  ('shop_manager', 'Shop Manager', 'Catalog, inventory, promotions, shipping, and order operations.', true),
  ('order_manager', 'Order Manager', 'Order, customer, payment-status, and shipping operations.', true),
  ('content_editor', 'Content Editor', 'Homepage promotions, reviews, and SEO without customer or payment access.', true),
  ('blog_writer', 'Blog Writer', 'Editorial access is managed in Sanity.', true)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  is_system = excluded.is_system,
  updated_at = now();

insert into public.permissions (key, description)
values
  ('*', 'All permissions.'),
  ('dashboard.read', 'Read non-sensitive dashboard summaries.'),
  ('products.read', 'Read all product records.'),
  ('products.manage', 'Create and update products and variants.'),
  ('categories.manage', 'Manage product categories.'),
  ('collections.manage', 'Manage product collections.'),
  ('inventory.manage', 'Adjust inventory and read inventory history.'),
  ('promotions.manage', 'Manage homepage banners and promotions.'),
  ('orders.read', 'Read orders and related operational data.'),
  ('orders.manage', 'Update order status, tracking, and notes.'),
  ('customers.read', 'Read customer profiles and addresses.'),
  ('customers.manage', 'Manage customer account status.'),
  ('coupons.manage', 'Manage coupons and redemption rules.'),
  ('reviews.manage', 'Moderate customer reviews.'),
  ('newsletter.manage', 'Manage newsletter subscribers.'),
  ('contact_messages.manage', 'Manage contact messages.'),
  ('shipping.manage', 'Manage shipping methods and rates.'),
  ('payments.read', 'Read payment and refund status.'),
  ('payments.manage', 'Manage payment and refund records.'),
  ('settings.read', 'Read private administrative settings.'),
  ('settings.manage', 'Manage public and private settings.'),
  ('seo.manage', 'Manage commerce SEO settings.'),
  ('users.manage', 'Manage administrator access.'),
  ('roles.manage', 'Manage roles and permissions.'),
  ('audit.read', 'Read immutable administrative audit logs.')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles roles
join public.permissions permissions on (
  (roles.key = 'owner_admin' and permissions.key = '*')
  or (roles.key = 'shop_manager' and permissions.key = any(array[
    'dashboard.read','products.read','products.manage','categories.manage','collections.manage',
    'inventory.manage','promotions.manage','orders.read','orders.manage','customers.read',
    'coupons.manage','shipping.manage','payments.read','settings.read'
  ]))
  or (roles.key = 'order_manager' and permissions.key = any(array[
    'dashboard.read','orders.read','orders.manage','customers.read','shipping.manage','payments.read'
  ]))
  or (roles.key = 'content_editor' and permissions.key = any(array[
    'dashboard.read','promotions.manage','reviews.manage','seo.manage'
  ]))
  or (roles.key = 'blog_writer' and permissions.key = 'dashboard.read')
)
on conflict do nothing;

-- Copy legacy admin memberships when this migration is applied over prototype data.
insert into public.user_roles (user_id, role_id, active)
select memberships.user_id, roles.id, memberships.status = 'Active'
from public.admin_memberships memberships
join public.roles roles on roles.name = memberships.role::text
on conflict (user_id, role_id) do update set active = excluded.active, updated_at = now();

create or replace function public.has_permission(required_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles user_roles
    join public.roles roles on roles.id = user_roles.role_id
    join public.role_permissions role_permissions on role_permissions.role_id = roles.id
    join public.permissions permissions on permissions.id = role_permissions.permission_id
    where user_roles.user_id = auth.uid()
      and user_roles.active
      and roles.active
      and (permissions.key = required_permission or permissions.key = '*')
  );
$$;

revoke all on function public.has_permission(text) from public;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.has_permission(text) to service_role;

-- Harden the legacy helper retained from migration 001. The launch policies
-- below use has_permission, but rollback support still depends on is_admin.
create or replace function public.is_admin(required_roles public.admin_role[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_memberships membership
    where membership.user_id = auth.uid()
      and membership.status = 'Active'
      and (required_roles is null or membership.role = any(required_roles))
  );
$$;

revoke all on function public.is_admin(public.admin_role[]) from public;
grant execute on function public.is_admin(public.admin_role[]) to authenticated;
grant execute on function public.is_admin(public.admin_role[]) to service_role;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    nullif(lower(trim(coalesce(new.email, ''))), ''),
    nullif(trim(coalesce(new.phone, '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.protect_profile_restricted_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() = old.id and not public.has_permission('customers.manage') then
    new.id := old.id;
    new.status := old.status;
    new.email := old.email;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_restricted_fields on public.profiles;
create trigger profiles_protect_restricted_fields
before update on public.profiles
for each row execute function public.protect_profile_restricted_fields();

revoke all on function public.protect_profile_restricted_fields() from public;

-- Catalog ---------------------------------------------------------------------

alter table public.categories add column if not exists active boolean not null default true;
alter table public.categories add column if not exists cloudinary_public_id text not null default '';

alter table public.products add column if not exists active boolean not null default true;
alter table public.products add column if not exists manual_best_seller_pin boolean not null default false;
alter table public.products add column if not exists manual_best_seller_rank integer;
alter table public.products add column if not exists published_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_manual_best_seller_rank_positive') then
    alter table public.products add constraint products_manual_best_seller_rank_positive
      check (manual_best_seller_rank is null or manual_best_seller_rank > 0);
  end if;
end $$;

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  active boolean not null default true,
  display_order integer not null default 0,
  featured boolean not null default false,
  banner_cloudinary_public_id text not null default '',
  banner_secure_url text not null default '',
  banner_alt_text text not null default '',
  seo_title text not null default '',
  seo_description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  option_name text not null default 'Size',
  option_value text not null,
  sku text not null unique,
  regular_price numeric(12,2) not null check (regular_price > 0),
  sale_price numeric(12,2),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  available boolean not null default true,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_sale_price_valid check (
    sale_price is null or (sale_price > 0 and sale_price < regular_price)
  ),
  constraint product_variants_option_value_required check (length(trim(option_value)) > 0)
);

create table if not exists public.product_categories (
  product_id uuid not null references public.products(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (product_id, category_id)
);

create table if not exists public.product_collections (
  product_id uuid not null references public.products(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (product_id, collection_id)
);

create table if not exists public.product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  cloudinary_public_id text not null,
  secure_url text not null,
  alt_text text not null default '',
  media_type text not null default 'image',
  display_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_media_type_valid check (media_type in ('image', 'video')),
  constraint product_media_secure_url check (secure_url ~ '^https://')
);

create unique index if not exists collections_slug_lower_uidx on public.collections(lower(slug));
create unique index if not exists products_slug_lower_uidx on public.products(lower(slug));
create unique index if not exists products_sku_lower_uidx on public.products(lower(sku));
create unique index if not exists categories_slug_lower_uidx on public.categories(lower(slug));
create unique index if not exists product_variants_sku_lower_uidx on public.product_variants(lower(sku));
create unique index if not exists product_variants_option_uidx
  on public.product_variants(product_id, lower(option_name), lower(option_value));
create unique index if not exists product_categories_one_primary_uidx
  on public.product_categories(product_id) where is_primary;
create unique index if not exists product_media_public_id_uidx
  on public.product_media(cloudinary_public_id);
create unique index if not exists product_media_one_primary_uidx
  on public.product_media(product_id) where is_primary;
create index if not exists product_variants_product_idx on public.product_variants(product_id);
create index if not exists product_variants_available_idx
  on public.product_variants(product_id, active, available) where active and available;
create index if not exists product_categories_category_idx on public.product_categories(category_id);
create index if not exists product_collections_collection_idx on public.product_collections(collection_id);
create index if not exists product_media_product_order_idx on public.product_media(product_id, display_order);
create index if not exists products_public_catalog_idx on public.products(status, active, created_at desc);
create index if not exists collections_public_idx on public.collections(active, featured, display_order);

-- Inventory -------------------------------------------------------------------

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity_delta integer not null check (quantity_delta <> 0),
  balance_after integer not null check (balance_after >= 0),
  reason text not null,
  reference_type text not null default '',
  reference_id uuid,
  note text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_variant_created_idx
  on public.inventory_movements(variant_id, created_at desc);
create index if not exists inventory_movements_reference_idx
  on public.inventory_movements(reference_type, reference_id);

create or replace function public.sync_product_stock_from_variants()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_product_id uuid;
  total_stock integer;
begin
  for target_product_id in
    select distinct affected.product_id
    from (values
      (case when tg_op <> 'INSERT' then old.product_id end),
      (case when tg_op <> 'DELETE' then new.product_id end)
    ) as affected(product_id)
    where affected.product_id is not null
  loop
    select coalesce(sum(stock_quantity), 0)::integer
    into total_stock
    from public.product_variants
    where product_id = target_product_id and active;

    update public.products
    set stock_quantity = total_stock,
        stock_status = case
          when total_stock = 0 then 'Out of Stock'
          when total_stock <= 5 then 'Low Stock'
          else 'In Stock'
        end,
        updated_at = now()
    where id = target_product_id;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_product_stock_from_variants() from public;

drop trigger if exists product_variants_sync_product_stock on public.product_variants;
create trigger product_variants_sync_product_stock
after insert or update or delete on public.product_variants
for each row execute function public.sync_product_stock_from_variants();

-- Promotions and coupons -------------------------------------------------------

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  promotion_type text not null,
  title text not null,
  subtitle text not null default '',
  body text not null default '',
  cta_text text not null default '',
  cta_url text not null default '',
  placement text not null,
  cloudinary_public_id text not null default '',
  secure_image_url text not null default '',
  image_alt_text text not null default '',
  active boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotions_type_valid check (promotion_type in ('banner', 'campaign', 'featured_section')),
  constraint promotions_date_order check (ends_at is null or starts_at is null or ends_at >= starts_at),
  constraint promotions_secure_url check (secure_image_url = '' or secure_image_url ~ '^https://')
);

alter table public.coupons add column if not exists max_discount_amount numeric(12,2);
alter table public.coupons add column if not exists description text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'coupons_max_discount_nonnegative') then
    alter table public.coupons add constraint coupons_max_discount_nonnegative
      check (max_discount_amount is null or max_discount_amount >= 0);
  end if;
end $$;

create table if not exists public.coupon_products (
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  primary key (coupon_id, product_id)
);

create table if not exists public.coupon_categories (
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (coupon_id, category_id)
);

create unique index if not exists promotions_slug_lower_uidx on public.promotions(lower(slug));
create unique index if not exists coupons_code_lower_uidx on public.coupons(lower(code));
create unique index if not exists newsletter_email_lower_uidx
  on public.newsletter_subscribers(lower(email));
create index if not exists promotions_public_idx on public.promotions(active, placement, display_order);
create index if not exists coupon_products_product_idx on public.coupon_products(product_id);
create index if not exists coupon_categories_category_idx on public.coupon_categories(category_id);

-- Shipping and configuration --------------------------------------------------

create table if not exists public.shipping_methods (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',
  base_fee numeric(12,2) not null default 0 check (base_fee >= 0),
  free_shipping_threshold numeric(12,2) check (free_shipping_threshold is null or free_shipping_threshold >= 0),
  estimated_days_min integer check (estimated_days_min is null or estimated_days_min >= 0),
  estimated_days_max integer check (estimated_days_max is null or estimated_days_max >= 0),
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipping_methods_day_order check (
    estimated_days_max is null or estimated_days_min is null or estimated_days_max >= estimated_days_min
  )
);

create table if not exists public.shipping_rates (
  id uuid primary key default gen_random_uuid(),
  shipping_method_id uuid not null references public.shipping_methods(id) on delete cascade,
  scope_type text not null default 'default',
  scope_value text not null default '',
  fee numeric(12,2) not null check (fee >= 0),
  minimum_subtotal numeric(12,2) not null default 0 check (minimum_subtotal >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipping_rates_scope_valid check (scope_type in ('default', 'city', 'province')),
  constraint shipping_rates_scope_value check (scope_type = 'default' or length(trim(scope_value)) > 0)
);

alter table public.site_settings add column if not exists public_settings jsonb not null default '{}'::jsonb;
alter table public.site_settings add column if not exists private_settings jsonb not null default '{}'::jsonb;

create table if not exists public.public_site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.seo_settings (
  id uuid primary key default gen_random_uuid(),
  page_key text not null unique,
  route_path text not null,
  title text not null default '',
  description text not null default '',
  canonical_url text not null default '',
  robots text not null default 'index,follow',
  og_title text not null default '',
  og_description text not null default '',
  og_image_cloudinary_public_id text not null default '',
  og_image_secure_url text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seo_settings_route_path check (route_path like '/%'),
  constraint seo_settings_og_url check (og_image_secure_url = '' or og_image_secure_url ~ '^https://')
);

create unique index if not exists shipping_methods_code_lower_uidx on public.shipping_methods(lower(code));
create unique index if not exists shipping_rates_scope_uidx
  on public.shipping_rates(shipping_method_id, scope_type, lower(scope_value));
create unique index if not exists seo_settings_page_key_lower_uidx on public.seo_settings(lower(page_key));
create unique index if not exists seo_settings_route_lower_uidx on public.seo_settings(lower(route_path));

-- Orders, payments, and coupon usage ------------------------------------------

alter table public.orders add column if not exists idempotency_key text;
alter table public.orders add column if not exists coupon_id uuid references public.coupons(id) on delete set null;
alter table public.orders add column if not exists shipping_method_id uuid references public.shipping_methods(id) on delete set null;
alter table public.orders add column if not exists currency text not null default 'PKR';

alter table public.order_items add column if not exists variant_id uuid references public.product_variants(id) on delete set null;
alter table public.order_items add column if not exists sku text not null default '';
alter table public.order_items add column if not exists line_total numeric(12,2)
  generated always as (quantity * unit_price) stored;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_variant_required_for_new_rows') then
    alter table public.order_items add constraint order_items_variant_required_for_new_rows
      check (variant_id is not null) not valid;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_discount_not_above_subtotal') then
    alter table public.orders add constraint orders_discount_not_above_subtotal
      check (discount <= subtotal) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_total_matches_components') then
    alter table public.orders add constraint orders_total_matches_components
      check (total = greatest(0, subtotal - discount + shipping_fee)) not valid;
  end if;
end $$;

create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  customer_id uuid references public.profiles(id) on delete set null,
  customer_email text not null default '',
  discount_amount numeric(12,2) not null check (discount_amount >= 0),
  created_at timestamptz not null default now(),
  unique (order_id)
);

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status order_status,
  to_status order_status not null,
  note text not null default '',
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.order_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  note text not null,
  is_customer_visible boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint order_notes_note_required check (length(trim(note)) > 0)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null,
  provider_reference text not null default '',
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'PKR',
  status payment_status not null default 'Pending',
  idempotency_key text,
  processed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  provider_reference text not null default '',
  amount numeric(12,2) not null check (amount > 0),
  reason text not null default '',
  status text not null default 'Pending',
  processed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refunds_status_valid check (status in ('Pending', 'Processing', 'Succeeded', 'Failed', 'Cancelled'))
);

create unique index if not exists orders_idempotency_uidx on public.orders(idempotency_key)
  where idempotency_key is not null;
create index if not exists orders_status_created_idx on public.orders(status, created_at desc);
create index if not exists orders_customer_created_idx on public.orders(customer_id, created_at desc);
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists order_items_variant_idx on public.order_items(variant_id);
create index if not exists coupon_redemptions_coupon_created_idx on public.coupon_redemptions(coupon_id, created_at);
create index if not exists coupon_redemptions_customer_idx on public.coupon_redemptions(customer_id, coupon_id);
create index if not exists coupon_redemptions_email_idx on public.coupon_redemptions(lower(customer_email), coupon_id);
create index if not exists order_status_history_order_idx on public.order_status_history(order_id, created_at);
create index if not exists order_notes_order_idx on public.order_notes(order_id, created_at);
create index if not exists payments_order_idx on public.payments(order_id, created_at);
create unique index if not exists payments_provider_reference_uidx
  on public.payments(provider, provider_reference) where provider_reference <> '';
create unique index if not exists payments_idempotency_uidx
  on public.payments(idempotency_key) where idempotency_key is not null;
create index if not exists refunds_order_idx on public.refunds(order_id, created_at);

alter table public.admin_audit_logs add column if not exists permission_key text not null default '';
alter table public.admin_audit_logs add column if not exists request_id text not null default '';
create index if not exists admin_audit_logs_admin_created_idx
  on public.admin_audit_logs(admin_id, created_at desc);
create index if not exists admin_audit_logs_resource_idx
  on public.admin_audit_logs(resource, resource_id, created_at desc);

-- Updated-at triggers ----------------------------------------------------------

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'customer_addresses','roles','user_roles','collections','product_variants','product_media',
    'promotions','shipping_methods','shipping_rates','public_site_settings','seo_settings',
    'payments','refunds'
  ] loop
    execute format(
      'drop trigger if exists %I on public.%I',
      table_name || '_set_updated_at',
      table_name
    );
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_set_updated_at',
      table_name
    );
  end loop;
end $$;

-- Best sellers are calculated from delivered orders, never from editable totals.
create or replace view public.product_sales_rankings
with (security_invoker = true)
as
with completed_sales as (
  select
    order_items.product_id,
    sum(order_items.quantity)::bigint as completed_units
  from public.order_items order_items
  join public.orders orders on orders.id = order_items.order_id
  where orders.status = 'Delivered'
  group by order_items.product_id
), ranked as (
  select
    products.id as product_id,
    coalesce(completed_sales.completed_units, 0) as completed_units,
    products.manual_best_seller_pin,
    products.manual_best_seller_rank,
    dense_rank() over (
      order by coalesce(completed_sales.completed_units, 0) desc, products.created_at asc
    ) as automatic_rank
  from public.products products
  left join completed_sales on completed_sales.product_id = products.id
  where products.active and products.status = 'Published'
)
select
  product_id,
  completed_units,
  manual_best_seller_pin,
  manual_best_seller_rank,
  automatic_rank,
  row_number() over (
    order by
      manual_best_seller_pin desc,
      manual_best_seller_rank asc nulls last,
      automatic_rank asc,
      product_id
  ) as display_rank
from ranked;

-- Backend-only atomic checkout -------------------------------------------------

create or replace function public.create_order_transaction(
  p_idempotency_key text,
  p_items jsonb,
  p_contact jsonb,
  p_shipping jsonb,
  p_payment_method text,
  p_coupon_code text default null,
  p_shipping_method_id uuid default null,
  p_customer_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Checkout is restricted to the backend service.';
  end if;

  if length(v_idempotency_key) < 8 or length(v_idempotency_key) > 160 then
    raise exception using errcode = '22023', message = 'A valid idempotency key is required.';
  end if;
  if length(trim(coalesce(p_payment_method, ''))) < 2 then
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

  perform pg_advisory_xact_lock(hashtextextended(v_idempotency_key, 0));

  select * into v_order
  from public.orders
  where idempotency_key = v_idempotency_key;
  if found then
    return jsonb_build_object(
      'id', v_order.id,
      'orderNumber', v_order.order_number,
      'status', v_order.status,
      'subtotal', v_order.subtotal,
      'discount', v_order.discount,
      'shippingFee', v_order.shipping_fee,
      'total', v_order.total,
      'idempotent', true
    );
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

  -- Deterministic row locking prevents overselling and reduces deadlock risk.
  perform variants.id
  from public.product_variants variants
  join public.products products on products.id = variants.product_id
  where variants.id in (
    select (item ->> 'variantId')::uuid from jsonb_array_elements(p_items) item
  )
  order by variants.id
  for update of variants;

  with requested as (
    select (item ->> 'variantId')::uuid as variant_id, sum((item ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) item
    group by (item ->> 'variantId')::uuid
  )
  select count(*) into v_matched_count
  from requested
  join public.product_variants variants on variants.id = requested.variant_id
  join public.products products on products.id = variants.product_id
  where variants.active and variants.available and products.active and products.status = 'Published';

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
    if v_coupon.start_date is not null and current_date < v_coupon.start_date then
      raise exception using errcode = 'P0001', message = 'Coupon has not started.';
    end if;
    if v_coupon.end_date is not null and current_date > v_coupon.end_date then
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
    order by display_order, created_at
    limit 1;
  end if;
  if not found then
    raise exception using errcode = 'P0001', message = 'No shipping method is available.';
  end if;

  select rates.fee into v_shipping_fee
  from public.shipping_rates rates
  where rates.shipping_method_id = v_shipping_method.id
    and rates.active
    and rates.minimum_subtotal <= (v_subtotal - v_discount)
    and (
      rates.scope_type = 'default'
      or (rates.scope_type = 'city' and lower(rates.scope_value) = lower(coalesce(p_shipping ->> 'city', '')))
      or (rates.scope_type = 'province' and lower(rates.scope_value) = lower(coalesce(p_shipping ->> 'province', '')))
    )
  order by
    case rates.scope_type when 'city' then 1 when 'province' then 2 else 3 end,
    rates.minimum_subtotal desc
  limit 1;
  v_shipping_fee := coalesce(v_shipping_fee, v_shipping_method.base_fee);

  if (v_shipping_method.free_shipping_threshold is not null
      and (v_subtotal - v_discount) >= v_shipping_method.free_shipping_threshold)
     or (v_coupon.id is not null and v_coupon.type = 'Free Shipping') then
    v_shipping_fee := 0;
  end if;

  v_total := greatest(0, v_subtotal - v_discount + v_shipping_fee);
  v_order_id := gen_random_uuid();
  v_order_number := 'RF-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-' ||
    upper(substr(replace(v_order_id::text, '-', ''), 1, 8));

  insert into public.orders (
    id, order_number, customer_id, customer_name, customer_email, customer_phone,
    shipping_address, shipping_city, shipping_province, order_notes,
    status, payment_method, payment_status, subtotal, discount, shipping_fee, total,
    coupon_code, coupon_id, shipping_method_id, currency, idempotency_key
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
    coalesce(v_coupon.code, ''), v_coupon.id, v_shipping_method.id, 'PKR', v_idempotency_key
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
$$;

revoke all on function public.create_order_transaction(text, jsonb, jsonb, jsonb, text, text, uuid, uuid) from public;
revoke all on function public.create_order_transaction(text, jsonb, jsonb, jsonb, text, text, uuid, uuid) from anon;
revoke all on function public.create_order_transaction(text, jsonb, jsonb, jsonb, text, text, uuid, uuid) from authenticated;
grant execute on function public.create_order_transaction(text, jsonb, jsonb, jsonb, text, text, uuid, uuid) to service_role;

-- RLS -------------------------------------------------------------------------

alter table public.customer_addresses enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.collections enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_categories enable row level security;
alter table public.product_collections enable row level security;
alter table public.product_media enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.promotions enable row level security;
alter table public.coupon_products enable row level security;
alter table public.coupon_categories enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.shipping_methods enable row level security;
alter table public.shipping_rates enable row level security;
alter table public.public_site_settings enable row level security;
alter table public.seo_settings enable row level security;
alter table public.order_status_history enable row level security;
alter table public.order_notes enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;

-- Replace policies from migration 001 that are too broad or use legacy roles.
drop policy if exists "profiles self read" on public.profiles;
drop policy if exists "profiles self update" on public.profiles;
drop policy if exists "admin memberships admins only" on public.admin_memberships;
drop policy if exists "published categories readable" on public.categories;
drop policy if exists "categories admin write" on public.categories;
drop policy if exists "published products readable" on public.products;
drop policy if exists "products admin write" on public.products;
drop policy if exists "coupons admin only" on public.coupons;
drop policy if exists "orders customer/admin read" on public.orders;
drop policy if exists "orders customer insert" on public.orders;
drop policy if exists "orders admin update" on public.orders;
drop policy if exists "order items customer/admin read" on public.order_items;
drop policy if exists "approved reviews readable" on public.reviews;
drop policy if exists "reviews customer insert" on public.reviews;
drop policy if exists "reviews admin update" on public.reviews;
drop policy if exists "newsletter insert public" on public.newsletter_subscribers;
drop policy if exists "newsletter admin read" on public.newsletter_subscribers;
drop policy if exists "contact insert public" on public.contact_messages;
drop policy if exists "contact admin manage" on public.contact_messages;
drop policy if exists "site settings public read" on public.site_settings;
drop policy if exists "site settings admin write" on public.site_settings;
drop policy if exists "audit logs owner read" on public.admin_audit_logs;
drop policy if exists "audit logs admin insert" on public.admin_audit_logs;

-- Re-running this migration should replace, not duplicate, its policies.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and policyname like 'rf_%'
  loop
    execute format('drop policy %I on %I.%I', policy_record.policyname, policy_record.schemaname, policy_record.tablename);
  end loop;
end $$;

create policy rf_profiles_select on public.profiles
for select to authenticated
using (id = auth.uid() or public.has_permission('customers.read'));
create policy rf_profiles_update on public.profiles
for update to authenticated
using (id = auth.uid() or public.has_permission('customers.manage'))
with check (id = auth.uid() or public.has_permission('customers.manage'));

create policy rf_addresses_select on public.customer_addresses
for select to authenticated
using (customer_id = auth.uid() or public.has_permission('customers.read'));
create policy rf_addresses_insert on public.customer_addresses
for insert to authenticated
with check (customer_id = auth.uid() or public.has_permission('customers.manage'));
create policy rf_addresses_update on public.customer_addresses
for update to authenticated
using (customer_id = auth.uid() or public.has_permission('customers.manage'))
with check (customer_id = auth.uid() or public.has_permission('customers.manage'));
create policy rf_addresses_delete on public.customer_addresses
for delete to authenticated
using (customer_id = auth.uid() or public.has_permission('customers.manage'));

create policy rf_roles_admin on public.roles for all to authenticated
using (public.has_permission('roles.manage')) with check (public.has_permission('roles.manage'));
create policy rf_permissions_admin on public.permissions for all to authenticated
using (public.has_permission('roles.manage')) with check (public.has_permission('roles.manage'));
create policy rf_role_permissions_admin on public.role_permissions for all to authenticated
using (public.has_permission('roles.manage')) with check (public.has_permission('roles.manage'));
create policy rf_user_roles_admin on public.user_roles for all to authenticated
using (public.has_permission('users.manage')) with check (public.has_permission('users.manage'));

create policy rf_categories_public_read on public.categories
for select to anon, authenticated
using (status = 'Published' and active);
create policy rf_categories_admin on public.categories for all to authenticated
using (public.has_permission('categories.manage')) with check (public.has_permission('categories.manage'));

create policy rf_products_public_read on public.products
for select to anon, authenticated
using (status = 'Published' and active);
create policy rf_products_admin on public.products for all to authenticated
using (public.has_permission('products.manage')) with check (public.has_permission('products.manage'));

create policy rf_collections_public_read on public.collections
for select to anon, authenticated
using (active);
create policy rf_collections_admin on public.collections for all to authenticated
using (public.has_permission('collections.manage')) with check (public.has_permission('collections.manage'));

create policy rf_variants_public_read on public.product_variants
for select to anon, authenticated
using (
  (active and available and exists (
    select 1 from public.products products
    where products.id = product_variants.product_id and products.active and products.status = 'Published'
  ))
);
create policy rf_variants_admin on public.product_variants for all to authenticated
using (public.has_permission('products.manage')) with check (public.has_permission('products.manage'));

create policy rf_product_categories_public_read on public.product_categories
for select to anon, authenticated
using (exists (
  select 1 from public.products products
  where products.id = product_categories.product_id and products.active and products.status = 'Published'
));
create policy rf_product_categories_admin on public.product_categories for all to authenticated
using (public.has_permission('products.manage')) with check (public.has_permission('products.manage'));

create policy rf_product_collections_public_read on public.product_collections
for select to anon, authenticated
using (exists (
  select 1 from public.products products
  where products.id = product_collections.product_id and products.active and products.status = 'Published'
));
create policy rf_product_collections_admin on public.product_collections for all to authenticated
using (public.has_permission('products.manage')) with check (public.has_permission('products.manage'));

create policy rf_product_media_public_read on public.product_media
for select to anon, authenticated
using (exists (
  select 1 from public.products products
  where products.id = product_media.product_id and products.active and products.status = 'Published'
));
create policy rf_product_media_admin on public.product_media for all to authenticated
using (public.has_permission('products.manage')) with check (public.has_permission('products.manage'));

create policy rf_inventory_admin_read on public.inventory_movements for select to authenticated
using (public.has_permission('inventory.manage'));
create policy rf_inventory_admin_write on public.inventory_movements for insert to authenticated
with check (public.has_permission('inventory.manage'));

create policy rf_promotions_public_read on public.promotions
for select to anon, authenticated
using (
  active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at >= now())
);
create policy rf_promotions_admin on public.promotions for all to authenticated
using (public.has_permission('promotions.manage')) with check (public.has_permission('promotions.manage'));

create policy rf_coupons_admin on public.coupons for all to authenticated
using (public.has_permission('coupons.manage')) with check (public.has_permission('coupons.manage'));
create policy rf_coupon_products_admin on public.coupon_products for all to authenticated
using (public.has_permission('coupons.manage')) with check (public.has_permission('coupons.manage'));
create policy rf_coupon_categories_admin on public.coupon_categories for all to authenticated
using (public.has_permission('coupons.manage')) with check (public.has_permission('coupons.manage'));
create policy rf_coupon_redemptions_customer_read on public.coupon_redemptions for select to authenticated
using (customer_id = auth.uid() or public.has_permission('coupons.manage') or public.has_permission('orders.read'));

create policy rf_orders_read on public.orders for select to authenticated
using (customer_id = auth.uid() or public.has_permission('orders.read'));
create policy rf_orders_admin_update on public.orders for update to authenticated
using (public.has_permission('orders.manage')) with check (public.has_permission('orders.manage'));
-- There is deliberately no anon/authenticated insert policy for orders.

create policy rf_order_items_read on public.order_items for select to authenticated
using (exists (
  select 1 from public.orders orders
  where orders.id = order_items.order_id
    and (orders.customer_id = auth.uid() or public.has_permission('orders.read'))
));
create policy rf_order_history_read on public.order_status_history for select to authenticated
using (exists (
  select 1 from public.orders orders
  where orders.id = order_status_history.order_id
    and (orders.customer_id = auth.uid() or public.has_permission('orders.read'))
));
create policy rf_order_history_admin_write on public.order_status_history for insert to authenticated
with check (public.has_permission('orders.manage'));
create policy rf_order_notes_admin on public.order_notes for all to authenticated
using (public.has_permission('orders.read')) with check (public.has_permission('orders.manage'));

create policy rf_payments_admin_read on public.payments for select to authenticated
using (public.has_permission('payments.read'));
create policy rf_payments_admin_write on public.payments for all to authenticated
using (public.has_permission('payments.manage')) with check (public.has_permission('payments.manage'));
create policy rf_refunds_admin_read on public.refunds for select to authenticated
using (public.has_permission('payments.read'));
create policy rf_refunds_admin_write on public.refunds for all to authenticated
using (public.has_permission('payments.manage')) with check (public.has_permission('payments.manage'));

create policy rf_reviews_public_read on public.reviews for select to anon, authenticated
using (status = 'Approved' or customer_id = auth.uid());
create policy rf_reviews_admin on public.reviews for all to authenticated
using (public.has_permission('reviews.manage')) with check (public.has_permission('reviews.manage'));

create policy rf_newsletter_admin on public.newsletter_subscribers for all to authenticated
using (public.has_permission('newsletter.manage')) with check (public.has_permission('newsletter.manage'));
create policy rf_contact_admin on public.contact_messages for all to authenticated
using (public.has_permission('contact_messages.manage')) with check (public.has_permission('contact_messages.manage'));

create policy rf_shipping_methods_public_read on public.shipping_methods
for select to anon, authenticated using (active);
create policy rf_shipping_methods_admin on public.shipping_methods for all to authenticated
using (public.has_permission('shipping.manage')) with check (public.has_permission('shipping.manage'));
create policy rf_shipping_rates_public_read on public.shipping_rates
for select to anon, authenticated using (active);
create policy rf_shipping_rates_admin on public.shipping_rates for all to authenticated
using (public.has_permission('shipping.manage')) with check (public.has_permission('shipping.manage'));

create policy rf_public_settings_read on public.public_site_settings
for select to anon, authenticated using (active);
create policy rf_public_settings_admin on public.public_site_settings for all to authenticated
using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));
create policy rf_private_settings_admin_read on public.site_settings for select to authenticated
using (public.has_permission('settings.manage'));
create policy rf_private_settings_admin_write on public.site_settings for all to authenticated
using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));

create policy rf_seo_public_read on public.seo_settings for select to anon, authenticated
using (active);
create policy rf_seo_admin on public.seo_settings for all to authenticated
using (public.has_permission('seo.manage')) with check (public.has_permission('seo.manage'));

create policy rf_audit_read on public.admin_audit_logs for select to authenticated
using (public.has_permission('audit.read'));
-- Audit log insertion is backend-only; authenticated users receive no insert policy.

create policy rf_legacy_memberships_owner on public.admin_memberships for all to authenticated
using (public.has_permission('roles.manage')) with check (public.has_permission('roles.manage'));

-- Explicit API grants. RLS remains the authorization boundary for browser roles.
grant usage on schema public to anon, authenticated;
grant select on public.categories, public.products, public.collections, public.product_variants,
  public.product_categories, public.product_collections, public.product_media, public.promotions,
  public.shipping_methods, public.shipping_rates, public.public_site_settings, public.seo_settings,
  public.reviews to anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.customer_addresses to authenticated;
grant select on public.roles, public.permissions, public.role_permissions,
  public.user_roles, public.categories, public.products, public.collections, public.product_variants,
  public.product_categories, public.product_collections, public.product_media, public.promotions,
  public.coupons, public.coupon_products, public.coupon_categories, public.reviews,
  public.newsletter_subscribers, public.contact_messages, public.shipping_methods, public.shipping_rates,
  public.public_site_settings, public.site_settings, public.seo_settings to authenticated;
grant select on public.orders, public.order_items, public.coupon_redemptions, public.inventory_movements,
  public.order_status_history, public.order_notes, public.payments, public.refunds,
  public.admin_audit_logs, public.admin_memberships, public.product_sales_rankings to authenticated;

-- Privileged mutations are backend-only even when an administrator has an RLS
-- permission. The policies remain a second boundary for future controlled access.
revoke insert, update, delete on public.roles, public.permissions, public.role_permissions,
  public.user_roles, public.categories, public.products, public.collections, public.product_variants,
  public.product_categories, public.product_collections, public.product_media, public.inventory_movements,
  public.promotions, public.coupons, public.coupon_products, public.coupon_categories,
  public.coupon_redemptions, public.orders, public.order_items, public.order_status_history,
  public.order_notes, public.payments, public.refunds, public.reviews, public.newsletter_subscribers,
  public.contact_messages, public.shipping_methods, public.shipping_rates, public.public_site_settings,
  public.site_settings, public.seo_settings, public.admin_audit_logs, public.admin_memberships
  from anon, authenticated;
revoke all on public.site_settings, public.admin_audit_logs from anon;
grant all on all tables in schema public to service_role;

commit;
