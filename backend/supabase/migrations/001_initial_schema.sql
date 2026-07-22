-- Royal Fusion production schema for Supabase/Postgres.
-- Apply from the Supabase SQL editor or Supabase CLI after creating the project.

create extension if not exists pgcrypto;

create type public.admin_role as enum (
  'Owner/Admin',
  'Shop Manager',
  'Order Manager',
  'Content Editor',
  'Blog Writer'
);

create type public.account_status as enum ('Active', 'Inactive');
create type public.publish_status as enum ('Published', 'Draft', 'Unpublished', 'Archived');
create type public.order_status as enum (
  'Pending',
  'Confirmed',
  'Processing',
  'Shipped',
  'Delivered',
  'Cancelled',
  'Returned',
  'Refunded'
);
create type public.payment_status as enum ('Unpaid', 'Pending', 'Paid', 'Failed', 'Refunded');
create type public.gender_type as enum ('Men', 'Women', 'Unisex');
create type public.coupon_type as enum ('Percentage', 'Fixed Amount', 'Free Shipping');
create type public.review_status as enum ('Approved', 'Pending', 'Rejected');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  phone text,
  address text not null default '',
  city text not null default '',
  province text not null default '',
  status account_status not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_contact_required check (
    nullif(trim(coalesce(email, '')), '') is not null
    or nullif(trim(coalesce(phone, '')), '') is not null
  )
);

create table public.admin_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role admin_role not null,
  status account_status not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  image_url text not null default '',
  display_order integer not null default 0,
  show_on_homepage boolean not null default false,
  status publish_status not null default 'Published',
  seo_title text not null default '',
  seo_description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  sku text not null unique,
  short_description text not null default '',
  description text not null default '',
  price numeric(12,2) not null check (price > 0),
  sale_price numeric(12,2) check (sale_price is null or sale_price >= 0),
  old_price numeric(12,2) check (old_price is null or old_price >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  stock_status text not null default 'In Stock',
  category_id uuid references public.categories(id) on delete set null,
  category_name text not null default '',
  collection text not null default '',
  gender gender_type not null default 'Unisex',
  scent_family text not null,
  top_notes text[] not null default '{}',
  middle_notes text[] not null default '{}',
  base_notes text[] not null default '{}',
  bottle_size text not null default '',
  concentration text not null default '',
  longevity text not null default '',
  sillage text not null default '',
  occasion text[] not null default '{}',
  inspired_by text not null default '',
  main_image_url text not null,
  gallery_urls text[] not null default '{}',
  image_alt text not null default '',
  badge text not null default '',
  tags text[] not null default '{}',
  size_options jsonb not null default '[]'::jsonb,
  variations jsonb not null default '[]'::jsonb,
  is_featured boolean not null default false,
  is_best_seller boolean not null default false,
  is_new_arrival boolean not null default false,
  is_premium boolean not null default false,
  is_attar boolean not null default false,
  status publish_status not null default 'Draft',
  seo_title text not null default '',
  seo_description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_sale_below_price check (sale_price is null or sale_price = 0 or sale_price < price),
  constraint products_image_required check (length(trim(main_image_url)) > 0)
);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  type coupon_type not null,
  discount_value numeric(12,2) not null default 0 check (discount_value >= 0),
  minimum_order_amount numeric(12,2) not null default 0 check (minimum_order_amount >= 0),
  applicable_product_ids uuid[] not null default '{}',
  applicable_category_ids uuid[] not null default '{}',
  start_date date,
  end_date date,
  usage_limit integer not null default 0 check (usage_limit >= 0),
  used_count integer not null default 0 check (used_count >= 0),
  per_customer_usage_limit integer not null default 0 check (per_customer_usage_limit >= 0),
  status account_status not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_percentage_limit check (type <> 'Percentage' or discount_value <= 100),
  constraint coupons_value_required check (type = 'Free Shipping' or discount_value > 0),
  constraint coupons_date_order check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid references public.profiles(id) on delete set null,
  customer_name text not null,
  customer_email text,
  customer_phone text,
  shipping_address text not null,
  shipping_city text not null,
  shipping_province text not null default '',
  order_notes text not null default '',
  status order_status not null default 'Pending',
  payment_method text not null,
  payment_status payment_status not null default 'Pending',
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  shipping_fee numeric(12,2) not null default 0 check (shipping_fee >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  coupon_code text not null default '',
  courier_name text not null default '',
  tracking_number text not null default '',
  internal_notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_contact_required check (
    nullif(trim(coalesce(customer_email, '')), '') is not null
    or nullif(trim(coalesce(customer_phone, '')), '') is not null
  )
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  size text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  customer_id uuid references public.profiles(id) on delete set null,
  name text not null,
  city text not null default '',
  rating integer not null check (rating between 1 and 5),
  product text not null default '',
  text text not null,
  featured boolean not null default false,
  status review_status not null default 'Pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  subscribed_at timestamptz not null default now()
);

create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text not null default '',
  subject text not null,
  message text not null,
  status text not null default 'Unread',
  created_at timestamptz not null default now()
);

create table public.site_settings (
  id text primary key default 'site',
  settings jsonb not null default '{}'::jsonb,
  shipping jsonb not null default '{}'::jsonb,
  payments jsonb not null default '[]'::jsonb,
  homepage jsonb not null default '{}'::jsonb,
  seo jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource text not null,
  resource_id text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index products_status_idx on public.products(status);
create index products_slug_idx on public.products(slug);
create index products_category_idx on public.products(category_id);
create index orders_status_idx on public.orders(status);
create index orders_customer_idx on public.orders(customer_id);
create index reviews_status_idx on public.reviews(status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger admin_memberships_set_updated_at before update on public.admin_memberships
for each row execute function public.set_updated_at();
create trigger categories_set_updated_at before update on public.categories
for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products
for each row execute function public.set_updated_at();
create trigger coupons_set_updated_at before update on public.coupons
for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders
for each row execute function public.set_updated_at();
create trigger reviews_set_updated_at before update on public.reviews
for each row execute function public.set_updated_at();

create or replace function public.is_admin(required_roles admin_role[] default null)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_memberships membership
    where membership.user_id = auth.uid()
      and membership.status = 'Active'
      and (required_roles is null or membership.role = any(required_roles))
  );
$$;

alter table public.profiles enable row level security;
alter table public.admin_memberships enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.coupons enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.reviews enable row level security;
alter table public.newsletter_subscribers enable row level security;
alter table public.contact_messages enable row level security;
alter table public.site_settings enable row level security;
alter table public.admin_audit_logs enable row level security;

create policy "profiles self read" on public.profiles
for select using (auth.uid() = id or public.is_admin(null));
create policy "profiles self update" on public.profiles
for update using (auth.uid() = id or public.is_admin(null))
with check (auth.uid() = id or public.is_admin(null));

create policy "admin memberships admins only" on public.admin_memberships
for all using (public.is_admin(array['Owner/Admin']::admin_role[]))
with check (public.is_admin(array['Owner/Admin']::admin_role[]));

create policy "published categories readable" on public.categories
for select using (status = 'Published' or public.is_admin(null));
create policy "categories admin write" on public.categories
for all using (public.is_admin(array['Owner/Admin','Shop Manager','Content Editor']::admin_role[]))
with check (public.is_admin(array['Owner/Admin','Shop Manager','Content Editor']::admin_role[]));

create policy "published products readable" on public.products
for select using (status = 'Published' or public.is_admin(null));
create policy "products admin write" on public.products
for all using (public.is_admin(array['Owner/Admin','Shop Manager']::admin_role[]))
with check (public.is_admin(array['Owner/Admin','Shop Manager']::admin_role[]));

create policy "coupons admin only" on public.coupons
for all using (public.is_admin(array['Owner/Admin','Shop Manager']::admin_role[]))
with check (public.is_admin(array['Owner/Admin','Shop Manager']::admin_role[]));

create policy "orders customer/admin read" on public.orders
for select using (customer_id = auth.uid() or public.is_admin(array['Owner/Admin','Shop Manager','Order Manager']::admin_role[]));
create policy "orders customer insert" on public.orders
for insert with check (customer_id = auth.uid() or customer_id is null);
create policy "orders admin update" on public.orders
for update using (public.is_admin(array['Owner/Admin','Shop Manager','Order Manager']::admin_role[]))
with check (public.is_admin(array['Owner/Admin','Shop Manager','Order Manager']::admin_role[]));

create policy "order items customer/admin read" on public.order_items
for select using (
  exists (
    select 1 from public.orders orders
    where orders.id = order_items.order_id
      and (orders.customer_id = auth.uid() or public.is_admin(array['Owner/Admin','Shop Manager','Order Manager']::admin_role[]))
  )
);

create policy "approved reviews readable" on public.reviews
for select using (status = 'Approved' or public.is_admin(array['Owner/Admin','Content Editor','Shop Manager']::admin_role[]));
create policy "reviews customer insert" on public.reviews
for insert with check (auth.uid() = customer_id or customer_id is null);
create policy "reviews admin update" on public.reviews
for update using (public.is_admin(array['Owner/Admin','Content Editor','Shop Manager']::admin_role[]))
with check (public.is_admin(array['Owner/Admin','Content Editor','Shop Manager']::admin_role[]));

create policy "newsletter insert public" on public.newsletter_subscribers
for insert with check (true);
create policy "newsletter admin read" on public.newsletter_subscribers
for select using (public.is_admin(array['Owner/Admin','Content Editor']::admin_role[]));

create policy "contact insert public" on public.contact_messages
for insert with check (true);
create policy "contact admin manage" on public.contact_messages
for all using (public.is_admin(array['Owner/Admin','Content Editor']::admin_role[]))
with check (public.is_admin(array['Owner/Admin','Content Editor']::admin_role[]));

create policy "site settings public read" on public.site_settings
for select using (true);
create policy "site settings admin write" on public.site_settings
for all using (public.is_admin(array['Owner/Admin','Content Editor','Shop Manager']::admin_role[]))
with check (public.is_admin(array['Owner/Admin','Content Editor','Shop Manager']::admin_role[]));

create policy "audit logs owner read" on public.admin_audit_logs
for select using (public.is_admin(array['Owner/Admin']::admin_role[]));
create policy "audit logs admin insert" on public.admin_audit_logs
for insert with check (public.is_admin(null));
