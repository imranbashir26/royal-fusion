-- GUARDED ROLLBACK FOR MIGRATION 003.
-- Prefer a forward-fix migration after any authentication feature has used the
-- new objects. This rollback intentionally does not restore the excessive
-- legacy Shop Manager permission bundle.

begin;

do $$
begin
  if exists (select 1 from public.auth_bootstrap_state)
    or exists (select 1 from public.admin_invitations)
    or exists (select 1 from public.application_sessions)
    or exists (select 1 from public.guest_order_claims) then
    raise exception 'Migration 003 rollback refused: authentication lifecycle data exists. Use a forward-fix migration.';
  end if;

  if exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where r.key in ('owner', 'manager')
  ) then
    raise exception 'Migration 003 rollback refused: canonical role assignments exist.';
  end if;

  if exists (
    select 1 from public.admin_audit_logs
    where action in (
      'owner.bootstrap', 'role.assigned', 'role.removed', 'role.changed',
      'invitation.created', 'invitation.accepted', 'invitation.revoked', 'invitation.resent', 'invitation.changed',
      'session.created', 'session.revoked', 'session.changed',
      'guest_order_claim.linked', 'guest_order_claim.revoked', 'guest_order_claim.changed'
    )
  ) then
    raise exception 'Migration 003 rollback refused: security audit evidence exists.';
  end if;
end $$;

drop trigger if exists admin_audit_logs_immutable on public.admin_audit_logs;
drop trigger if exists guest_order_claims_security_audit on public.guest_order_claims;
drop trigger if exists application_sessions_security_audit on public.application_sessions;
drop trigger if exists application_sessions_prevent_delete on public.application_sessions;
drop trigger if exists admin_invitations_security_audit on public.admin_invitations;
drop trigger if exists user_roles_security_audit on public.user_roles;
drop trigger if exists guest_order_claims_protect on public.guest_order_claims;
drop trigger if exists admin_invitations_validate on public.admin_invitations;
drop trigger if exists roles_protect_owner on public.roles;
drop trigger if exists auth_bootstrap_state_immutable on public.auth_bootstrap_state;
drop trigger if exists role_permissions_protect_owner_bundle on public.role_permissions;
drop trigger if exists permissions_protect_owner_wildcard on public.permissions;
drop trigger if exists user_roles_protect_owner on public.user_roles;
drop trigger if exists profiles_protect_restricted_fields on public.profiles;

drop function if exists public.protect_admin_audit_log();
drop function if exists public.write_auth_security_audit();
drop function if exists public.require_session_revocation();
drop function if exists public.protect_guest_order_claim();
drop function if exists public.validate_admin_invitation();
drop function if exists public.protect_owner_role_definition();
drop function if exists public.protect_auth_bootstrap_state();
drop function if exists public.protect_owner_permission_bundle();
drop function if exists public.protect_owner_role_assignment();
drop function if exists public.protect_profile_identity_fields();

drop policy if exists rf_order_notes_read on public.order_notes;
drop policy if exists rf_order_history_read on public.order_status_history;
drop policy if exists rf_promotions_admin on public.promotions;
drop policy if exists rf_inventory_admin_read on public.inventory_movements;
drop policy if exists rf_product_media_admin on public.product_media;
drop policy if exists rf_product_collections_admin on public.product_collections;
drop policy if exists rf_product_categories_admin on public.product_categories;
drop policy if exists rf_variants_admin on public.product_variants;
drop policy if exists rf_products_admin on public.products;
drop policy if exists rf_addresses_delete on public.customer_addresses;
drop policy if exists rf_addresses_update on public.customer_addresses;
drop policy if exists rf_addresses_insert on public.customer_addresses;
drop policy if exists rf_addresses_select on public.customer_addresses;
drop policy if exists rf_profiles_update on public.profiles;
drop policy if exists rf_profiles_select on public.profiles;

create policy rf_roles_admin on public.roles for all to authenticated
using (public.has_permission('roles.manage')) with check (public.has_permission('roles.manage'));
create policy rf_permissions_admin on public.permissions for all to authenticated
using (public.has_permission('roles.manage')) with check (public.has_permission('roles.manage'));
create policy rf_role_permissions_admin on public.role_permissions for all to authenticated
using (public.has_permission('roles.manage')) with check (public.has_permission('roles.manage'));
create policy rf_user_roles_admin on public.user_roles for all to authenticated
using (public.has_permission('users.manage')) with check (public.has_permission('users.manage'));
create policy rf_legacy_memberships_owner on public.admin_memberships for all to authenticated
using (public.has_permission('roles.manage')) with check (public.has_permission('roles.manage'));

-- Restore migration 002 read policies. Privileged table mutations remain
-- backend-only because migration 002 already revoked browser write grants.
create policy rf_profiles_select on public.profiles for select to authenticated
using (id = auth.uid() or public.has_permission('customers.read'));
create policy rf_profiles_update on public.profiles for update to authenticated
using (id = auth.uid() or public.has_permission('customers.manage'))
with check (id = auth.uid() or public.has_permission('customers.manage'));
create policy rf_addresses_select on public.customer_addresses for select to authenticated
using (customer_id = auth.uid() or public.has_permission('customers.read'));
create policy rf_addresses_insert on public.customer_addresses for insert to authenticated
with check (customer_id = auth.uid() or public.has_permission('customers.manage'));
create policy rf_addresses_update on public.customer_addresses for update to authenticated
using (customer_id = auth.uid() or public.has_permission('customers.manage'))
with check (customer_id = auth.uid() or public.has_permission('customers.manage'));
create policy rf_addresses_delete on public.customer_addresses for delete to authenticated
using (customer_id = auth.uid() or public.has_permission('customers.manage'));
create policy rf_products_admin on public.products for all to authenticated
using (public.has_permission('products.manage')) with check (public.has_permission('products.manage'));
create policy rf_variants_admin on public.product_variants for all to authenticated
using (public.has_permission('products.manage')) with check (public.has_permission('products.manage'));
create policy rf_product_categories_admin on public.product_categories for all to authenticated
using (public.has_permission('products.manage')) with check (public.has_permission('products.manage'));
create policy rf_product_collections_admin on public.product_collections for all to authenticated
using (public.has_permission('products.manage')) with check (public.has_permission('products.manage'));
create policy rf_product_media_admin on public.product_media for all to authenticated
using (public.has_permission('products.manage')) with check (public.has_permission('products.manage'));
create policy rf_inventory_admin_read on public.inventory_movements for select to authenticated
using (public.has_permission('inventory.manage'));
create policy rf_inventory_admin_write on public.inventory_movements for insert to authenticated
with check (public.has_permission('inventory.manage'));
create policy rf_promotions_admin on public.promotions for all to authenticated
using (public.has_permission('promotions.manage')) with check (public.has_permission('promotions.manage'));
create policy rf_order_history_read on public.order_status_history for select to authenticated
using (exists (
  select 1 from public.orders orders
  where orders.id = order_status_history.order_id
    and (orders.customer_id = auth.uid() or public.has_permission('orders.read'))
));
create policy rf_order_notes_admin on public.order_notes for all to authenticated
using (public.has_permission('orders.read')) with check (public.has_permission('orders.manage'));

drop table if exists public.guest_order_claims;
drop table if exists public.application_sessions;
drop table if exists public.admin_invitations;
drop table if exists public.auth_bootstrap_state;
drop index if exists public.admin_audit_logs_action_created_idx;

alter table public.order_status_history
  drop column if exists is_customer_visible;

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

revoke all on function public.protect_profile_restricted_fields() from public;
create trigger profiles_protect_restricted_fields
before update on public.profiles
for each row execute function public.protect_profile_restricted_fields();

alter table public.user_roles
  drop constraint if exists user_roles_active_lifecycle_check,
  drop column if exists revocation_reason,
  drop column if exists revoked_by,
  drop column if exists revoked_at,
  drop column if exists expires_at;

delete from public.role_permissions role_permissions
using public.roles roles
where role_permissions.role_id = roles.id and roles.key in ('owner', 'manager');
delete from public.roles where key in ('owner', 'manager');

-- The old owner role can support a controlled pre-003 development rollback.
-- Shop Manager remains inactive and receives no broad grants; restoring its
-- former excessive bundle requires an explicit, separately reviewed decision.
update public.roles set active = true, updated_at = now() where key = 'owner_admin';
insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles roles
join public.permissions permissions on permissions.key = '*'
where roles.key = 'owner_admin'
on conflict do nothing;

grant select on public.roles, public.permissions, public.role_permissions,
  public.user_roles, public.admin_memberships to authenticated;

delete from public.permissions permissions
where permissions.key = any(array[
  'access.manage', 'sessions.revoke', 'catalog.read', 'catalog.manage',
  'catalog.cost.read', 'catalog.cost.manage', 'inventory.read', 'inventory.adjust',
  'media.commerce.manage', 'media.delete', 'homepage.manage', 'seo.content.manage',
  'seo.global.manage', 'settings.public.manage', 'settings.private.manage',
  'payments.configure', 'tax.configure', 'invoice.configure', 'reports.read'
]) and not exists (
  select 1 from public.role_permissions rp where rp.permission_id = permissions.id
);

commit;
