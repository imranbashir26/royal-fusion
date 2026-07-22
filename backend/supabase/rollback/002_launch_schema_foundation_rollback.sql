-- DESTRUCTIVE ROLLBACK FOR MIGRATION 002.
-- Prefer restoring the pre-migration database backup. Run only after application
-- traffic is stopped and launch-foundation data has been exported.
-- This intentionally does not restore the unsafe browser order-insert policy or
-- public access to the legacy site_settings row.

begin;

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

drop view if exists public.product_sales_rankings;
drop function if exists public.create_order_transaction(text, jsonb, jsonb, jsonb, text, text, uuid, uuid);

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_auth_user();
drop trigger if exists profiles_protect_restricted_fields on public.profiles;
drop function if exists public.protect_profile_restricted_fields();
drop trigger if exists product_variants_sync_product_stock on public.product_variants;
drop function if exists public.sync_product_stock_from_variants();
drop function if exists public.has_permission(text);

alter table public.order_items
  drop constraint if exists order_items_variant_required_for_new_rows,
  drop column if exists line_total,
  drop column if exists sku,
  drop column if exists variant_id;

alter table public.orders
  drop constraint if exists orders_discount_not_above_subtotal,
  drop constraint if exists orders_total_matches_components,
  drop column if exists idempotency_key,
  drop column if exists coupon_id,
  drop column if exists shipping_method_id,
  drop column if exists currency;

drop table if exists public.refunds;
drop table if exists public.payments;
drop table if exists public.order_notes;
drop table if exists public.order_status_history;
drop table if exists public.coupon_redemptions;
drop table if exists public.inventory_movements;
drop table if exists public.product_media;
drop table if exists public.product_collections;
drop table if exists public.product_categories;
drop table if exists public.product_variants;
drop table if exists public.coupon_products;
drop table if exists public.coupon_categories;
drop table if exists public.promotions;
drop table if exists public.shipping_rates;
drop table if exists public.shipping_methods;
drop table if exists public.collections;
drop table if exists public.seo_settings;
drop table if exists public.public_site_settings;
drop table if exists public.customer_addresses;
drop table if exists public.user_roles;
drop table if exists public.role_permissions;
drop table if exists public.permissions;
drop table if exists public.roles;

alter table public.coupons
  drop constraint if exists coupons_max_discount_nonnegative,
  drop column if exists max_discount_amount,
  drop column if exists description;

alter table public.products
  drop constraint if exists products_manual_best_seller_rank_positive,
  drop column if exists active,
  drop column if exists manual_best_seller_pin,
  drop column if exists manual_best_seller_rank,
  drop column if exists published_at;

alter table public.categories
  drop column if exists active,
  drop column if exists cloudinary_public_id;

alter table public.site_settings
  drop column if exists public_settings,
  drop column if exists private_settings;

alter table public.admin_audit_logs
  drop column if exists permission_key,
  drop column if exists request_id;

drop index if exists public.profiles_email_lower_uidx;
drop index if exists public.profiles_phone_uidx;
drop index if exists public.newsletter_email_lower_uidx;
drop index if exists public.coupons_code_lower_uidx;
drop index if exists public.products_slug_lower_uidx;
drop index if exists public.products_sku_lower_uidx;
drop index if exists public.categories_slug_lower_uidx;

-- Restore safe read behavior from migration 001. Privileged writes should remain
-- backend-only until a replacement migration is approved.
create policy "published categories readable" on public.categories
for select using (status = 'Published' or public.is_admin(null));
create policy "published products readable" on public.products
for select using (status = 'Published' or public.is_admin(null));
create policy "approved reviews readable" on public.reviews
for select using (status = 'Approved' or public.is_admin(array['Owner/Admin','Content Editor','Shop Manager']::admin_role[]));
create policy "profiles self read" on public.profiles
for select using (auth.uid() = id or public.is_admin(null));
create policy "profiles self update" on public.profiles
for update using (auth.uid() = id or public.is_admin(null))
with check (auth.uid() = id or public.is_admin(null));

commit;

-- After rollback: restore the pre-002 backup if any 002-era orders, inventory,
-- coupon redemptions, role assignments, or media mappings must be retained.
