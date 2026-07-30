-- LOCAL OR DISPOSABLE STAGING ONLY.
-- Apply migrations 001, 002, and 003 plus the fictional starter seed first.
-- This test uses fictional fixtures inside a transaction and rolls them back.
-- Never run it against production.

begin;

do $$
declare
  missing_tables text[];
begin
  select array_agg(name order by name) into missing_tables
  from unnest(array[
    'auth_bootstrap_state', 'admin_invitations', 'application_sessions',
    'guest_order_claims'
  ]) name
  where to_regclass('public.' || name) is null;
  if missing_tables is not null then
    raise exception 'Missing Auth hardening tables: %', missing_tables;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'application_sessions'
      and column_name in ('access_token', 'refresh_token', 'cookie', 'cookie_value', 'raw_token')
  ) then
    raise exception 'Session registry contains a forbidden raw-token field.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'guest_order_claims'
      and column_name in ('claim_token', 'raw_token')
  ) then
    raise exception 'Guest claim table contains a forbidden raw-token field.';
  end if;
end $$;

-- Fictional identities. The Auth trigger creates matching profiles.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  ('93000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'customer-a@example.invalid', crypt('SchemaTestOnly-A!', gen_salt('bf')), now(), '{}'::jsonb, '{"full_name":"Customer A"}'::jsonb, now(), now(), '', '', '', ''),
  ('93000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'customer-b@example.invalid', crypt('SchemaTestOnly-B!', gen_salt('bf')), now(), '{}'::jsonb, '{"full_name":"Customer B"}'::jsonb, now(), now(), '', '', '', ''),
  ('93000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@example.invalid', crypt('SchemaTestOnly-C!', gen_salt('bf')), now(), '{}'::jsonb, '{"full_name":"Owner"}'::jsonb, now(), now(), '', '', '', ''),
  ('93000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager@example.invalid', crypt('SchemaTestOnly-D!', gen_salt('bf')), now(), '{}'::jsonb, '{"full_name":"Manager"}'::jsonb, now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_id, assigned_by)
select '93000000-0000-4000-8000-000000000003', id, '93000000-0000-4000-8000-000000000003'
from public.roles where key = 'owner';
insert into public.user_roles (user_id, role_id, assigned_by)
select '93000000-0000-4000-8000-000000000004', id, '93000000-0000-4000-8000-000000000003'
from public.roles where key = 'manager';

insert into public.customer_addresses (
  id, customer_id, recipient_name, phone, address_line_1, city, province, is_default
) values
  ('94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'Customer A', '+92 300 0000001', 'Fictional Address A', 'Karachi', 'Sindh', true),
  ('94000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000002', 'Customer B', '+92 300 0000002', 'Fictional Address B', 'Lahore', 'Punjab', true);

insert into public.orders (
  id, order_number, customer_id, customer_name, customer_email, shipping_address,
  shipping_city, payment_method, subtotal, shipping_fee, total
) values
  ('95000000-0000-4000-8000-000000000001', 'RF-TEST-AUTH-0001', '93000000-0000-4000-8000-000000000001', 'Customer A', 'customer-a@example.invalid', 'Fictional Address A', 'Karachi', 'Cash on Delivery', 1000, 300, 1300),
  ('95000000-0000-4000-8000-000000000002', 'RF-TEST-AUTH-0002', '93000000-0000-4000-8000-000000000002', 'Customer B', 'customer-b@example.invalid', 'Fictional Address B', 'Lahore', 'Cash on Delivery', 1000, 300, 1300);

insert into public.order_items (
  order_id, product_id, variant_id, product_name, size, quantity, unit_price, line_total, sku
)
select orders.id, variants.product_id, variants.id, 'Fictional Product', variants.option_value,
  1, variants.regular_price, variants.regular_price, variants.sku
from (
  values
    ('95000000-0000-4000-8000-000000000001'::uuid),
    ('95000000-0000-4000-8000-000000000002'::uuid)
) orders(id)
cross join lateral (
  select id, product_id, option_value, regular_price, sku
  from public.product_variants
  order by created_at
  limit 1
) variants;

insert into public.order_status_history (order_id, to_status, note, is_customer_visible)
values
  ('95000000-0000-4000-8000-000000000001', 'Pending', 'Visible status', true),
  ('95000000-0000-4000-8000-000000000001', 'Pending', 'Internal status', false);
insert into public.order_notes (order_id, note, is_customer_visible)
values
  ('95000000-0000-4000-8000-000000000001', 'Visible note', true),
  ('95000000-0000-4000-8000-000000000001', 'Internal note', false);

-- Customer ownership, field protection, and direct-order denial --------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
begin
  if (select count(*) from public.profiles where id in (
    '93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002'
  )) <> 1 then
    raise exception 'Customer profile isolation failed.';
  end if;
  if (select count(*) from public.customer_addresses) <> 1 then
    raise exception 'Customer address isolation failed.';
  end if;
  if (select count(*) from public.orders where id in (
    '95000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000002'
  )) <> 1 then
    raise exception 'Customer order isolation failed.';
  end if;
  if (select count(*) from public.order_items where order_id in (
    '95000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000002'
  )) <> 1 then
    raise exception 'Customer order-item isolation failed.';
  end if;
  if (select count(*) from public.order_status_history where order_id = '95000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Internal order history was exposed.';
  end if;
  if (select count(*) from public.order_notes where order_id = '95000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Internal order note was exposed.';
  end if;
  if has_table_privilege(current_user, 'public.orders', 'insert') then
    raise exception 'Authenticated browser role can insert orders.';
  end if;
  if has_table_privilege(current_user, 'public.orders', 'update')
    or has_table_privilege(current_user, 'public.payments', 'update') then
    raise exception 'Customer can modify ownership or financial records.';
  end if;
  if has_table_privilege(current_user, 'public.user_roles', 'insert') then
    raise exception 'Customer can assign an administrative role.';
  end if;
end $$;

do $$
begin
  begin
    update public.profiles set email = 'changed@example.invalid'
    where id = '93000000-0000-4000-8000-000000000001';
    raise exception 'Customer changed an identity-managed email.';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- Canonical permission bundles ------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"93000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
do $$
declare
  allowed text;
  denied text;
begin
  foreach allowed in array array[
    'dashboard.read', 'catalog.read', 'catalog.manage', 'categories.manage',
    'collections.manage', 'inventory.read', 'inventory.adjust',
    'media.commerce.manage', 'media.delete', 'homepage.manage', 'seo.content.manage'
  ] loop
    if not public.has_permission(allowed) then
      raise exception 'Manager missing approved permission: %', allowed;
    end if;
  end loop;
  foreach denied in array array[
    'access.manage', 'roles.manage', 'users.manage', 'orders.read', 'orders.manage',
    'customers.read', 'customers.manage', 'payments.read', 'payments.manage',
    'coupons.manage', 'shipping.manage', 'settings.manage', 'settings.private.manage',
    'tax.configure', 'payments.configure', 'audit.read'
  ] loop
    if public.has_permission(denied) then
      raise exception 'Manager received forbidden permission: %', denied;
    end if;
  end loop;
  if exists (
    select 1 from public.orders
    where id in (
      '95000000-0000-4000-8000-000000000001',
      '95000000-0000-4000-8000-000000000002'
    )
  ) then
    raise exception 'Manager can read customer orders.';
  end if;
  if exists (
    select 1 from public.profiles
    where id in (
      '93000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000002'
    )
  ) then
    raise exception 'Manager can read customer profiles.';
  end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"93000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $$
begin
  if not public.has_permission('orders.manage')
    or not public.has_permission('access.manage')
    or not public.has_permission('tax.configure') then
    raise exception 'Owner wildcard permission is incomplete.';
  end if;
end $$;
reset role;

do $$
begin
  if exists (
    select 1 from public.role_permissions rp
    join public.roles r on r.id = rp.role_id
    where r.key = 'shop_manager'
  ) then
    raise exception 'Legacy Shop Manager retained obsolete grants.';
  end if;
  if exists (select 1 from public.roles where key in ('owner_admin', 'shop_manager') and active) then
    raise exception 'Legacy authority roles remain active.';
  end if;
end $$;

-- Invitation/session/claim boundaries ----------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"93000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
do $$
begin
  if has_table_privilege(current_user, 'public.admin_invitations', 'insert')
    or has_table_privilege(current_user, 'public.application_sessions', 'select')
    or has_table_privilege(current_user, 'public.guest_order_claims', 'update') then
    raise exception 'Browser role received privileged Auth table access.';
  end if;
  if has_table_privilege(current_user, 'public.admin_audit_logs', 'delete') then
    raise exception 'Browser role can delete audit records.';
  end if;
end $$;
reset role;

insert into public.admin_invitations (
  id, email, intended_role_id, invited_by, expires_at
)
select '96000000-0000-4000-8000-000000000001', 'manager-invite@example.invalid', id,
  '93000000-0000-4000-8000-000000000003', now() + interval '48 hours'
from public.roles where key = 'manager';

insert into public.admin_invitations (
  id, email, intended_role_id, invited_by, expires_at, created_at
)
select '96000000-0000-4000-8000-000000000002', 'expired-manager@example.invalid', id,
  '93000000-0000-4000-8000-000000000003', now() - interval '1 hour', now() - interval '49 hours'
from public.roles where key = 'manager';

insert into public.admin_invitations (
  id, email, intended_role_id, invited_by, expires_at
)
select '96000000-0000-4000-8000-000000000003', 'revoked-manager@example.invalid', id,
  '93000000-0000-4000-8000-000000000003', now() + interval '48 hours'
from public.roles where key = 'manager';
update public.admin_invitations
set status = 'revoked', revoked_at = now()
where id = '96000000-0000-4000-8000-000000000003';

do $$
begin
  begin
    update public.admin_invitations
    set status = 'accepted', accepted_user_id = '93000000-0000-4000-8000-000000000004', accepted_at = now()
    where id = '96000000-0000-4000-8000-000000000002';
    raise exception 'Expired invitation was accepted.';
  exception when check_violation then null;
  end;
  begin
    update public.admin_invitations
    set status = 'accepted', accepted_user_id = '93000000-0000-4000-8000-000000000004', accepted_at = now(), revoked_at = null
    where id = '96000000-0000-4000-8000-000000000003';
    raise exception 'Revoked invitation was accepted.';
  exception when check_violation then null;
  end;
end $$;

insert into public.application_sessions (
  id, user_id, session_class, idle_expires_at, absolute_expires_at,
  session_key_hash, mfa_assurance
) values (
  '97000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000004', 'administrator',
  now() + interval '30 minutes', now() + interval '8 hours',
  repeat('a', 64), 'aal2'
);
update public.application_sessions
set revoked_at = now(), revoked_by = '93000000-0000-4000-8000-000000000003', revocation_reason = 'Test revocation'
where id = '97000000-0000-4000-8000-000000000001';
do $$
begin
  begin
    delete from public.application_sessions
    where id = '97000000-0000-4000-8000-000000000001';
    raise exception 'Revoked session was hard-deleted.';
  exception when check_violation then null;
  end;
end $$;

insert into public.guest_order_claims (
  id, order_id, claim_token_hash, contact_binding_hash, expires_at
) values (
  '98000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000002', repeat('b', 64), repeat('c', 64),
  now() + interval '7 days'
);
update public.guest_order_claims
set used_at = now(), linked_customer_id = '93000000-0000-4000-8000-000000000002'
where id = '98000000-0000-4000-8000-000000000001';
do $$
begin
  begin
    update public.guest_order_claims
    set linked_customer_id = '93000000-0000-4000-8000-000000000001'
    where id = '98000000-0000-4000-8000-000000000001';
    raise exception 'Consumed guest claim was replayed.';
  exception when check_violation then null;
  end;
end $$;

-- Final-Owner protection and bootstrap closure -------------------------------

do $$
begin
  if not exists (select 1 from public.auth_bootstrap_state where id = 'first_owner') then
    raise exception 'First-Owner provisioning did not close bootstrap.';
  end if;
  update public.profiles set status = 'Inactive'
  where id = '93000000-0000-4000-8000-000000000002';
  begin
    insert into public.user_roles (user_id, role_id, assigned_by)
    select '93000000-0000-4000-8000-000000000002', id,
      '93000000-0000-4000-8000-000000000003'
    from public.roles where key = 'owner';
    raise exception 'Inactive profile received an Owner assignment.';
  exception when check_violation then null;
  end;
  begin
    delete from public.user_roles ur using public.roles r
    where ur.role_id = r.id and r.key = 'owner'
      and ur.user_id = '93000000-0000-4000-8000-000000000003';
    raise exception 'Final Owner assignment was deleted.';
  exception when check_violation then null;
  end;
  begin
    update public.user_roles ur
    set active = false
    from public.roles r
    where ur.role_id = r.id and r.key = 'owner'
      and ur.user_id = '93000000-0000-4000-8000-000000000003';
    raise exception 'Final Owner assignment was deactivated.';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set status = 'Inactive'
    where id = '93000000-0000-4000-8000-000000000003';
    raise exception 'Final Owner profile was deactivated.';
  exception when check_violation then null;
  end;
  begin
    update public.roles set active = false where key = 'owner';
    raise exception 'Canonical Owner role was deactivated while assigned.';
  exception when check_violation then null;
  end;
  begin
    delete from public.role_permissions rp
    using public.roles r, public.permissions p
    where rp.role_id = r.id and rp.permission_id = p.id
      and r.key = 'owner' and p.key = '*';
    raise exception 'Canonical Owner wildcard grant was removed.';
  exception when check_violation then null;
  end;
  begin
    update public.admin_audit_logs
    set metadata = '{"tampered":true}'::jsonb
    where action = 'owner.bootstrap';
    raise exception 'Security audit record was rewritten.';
  exception when insufficient_privilege then null;
  end;
end $$;

-- SECURITY DEFINER search_path and grant checks ------------------------------

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname in (
        'has_permission', 'protect_profile_identity_fields',
        'protect_owner_role_assignment', 'protect_owner_role_definition',
        'protect_owner_permission_bundle',
        'protect_auth_bootstrap_state',
        'validate_admin_invitation', 'protect_guest_order_claim',
        'write_auth_security_audit', 'protect_admin_audit_log'
      )
      and not coalesce(p.proconfig, '{}'::text[]) @> array['search_path=']
  ) then
    raise exception 'A migration 003 SECURITY DEFINER function lacks an empty search_path.';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'public'
      and table_name in (
        'auth_bootstrap_state', 'admin_invitations', 'application_sessions',
        'guest_order_claims', 'user_roles', 'role_permissions'
      )
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'Browser role has an excessive privileged-table grant.';
  end if;
end $$;

rollback;
