-- Royal Fusion authentication schema and RLS hardening.
-- Additive database foundation only: no application Auth flow is activated here.

begin;

do $$
declare
  missing_objects text[];
begin
  select array_agg(object_name order by object_name)
  into missing_objects
  from unnest(array[
    'profiles', 'customer_addresses', 'roles', 'permissions', 'role_permissions',
    'user_roles', 'orders', 'order_items', 'order_status_history', 'order_notes',
    'admin_audit_logs'
  ]) object_name
  where to_regclass('public.' || object_name) is null;

  if missing_objects is not null then
    raise exception 'Migration 003 prerequisites are missing: %', missing_objects;
  end if;

  if to_regclass('public.auth_bootstrap_state') is null and exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where r.key = 'owner'
  ) then
    raise exception 'Pre-existing canonical Owner assignments require an explicit reviewed transition.';
  end if;
end $$;

-- Canonical roles and exact permission bundles --------------------------------

insert into public.permissions (key, description)
values
  ('access.manage', 'Manage administrative users, roles, and permission assignments.'),
  ('sessions.revoke', 'Revoke application sessions through an authorized backend operation.'),
  ('catalog.read', 'Read complete catalog records required by the administration dashboard.'),
  ('catalog.manage', 'Manage products, variants, and catalog relationships through Express.'),
  ('catalog.cost.read', 'Read restricted product and variant cost fields.'),
  ('catalog.cost.manage', 'Manage restricted product and variant cost fields.'),
  ('inventory.read', 'Read variant inventory and movement history.'),
  ('inventory.adjust', 'Create validated inventory adjustments through Express.'),
  ('media.commerce.manage', 'Manage commerce media metadata and signed upload workflows.'),
  ('media.delete', 'Delete unreferenced commerce media after backend reference checks.'),
  ('homepage.manage', 'Manage fixed homepage sections, campaigns, and testimonials.'),
  ('seo.content.manage', 'Manage catalog and homepage presentation SEO.'),
  ('seo.global.manage', 'Manage protected global SEO configuration.'),
  ('settings.public.manage', 'Manage approved public store settings.'),
  ('settings.private.manage', 'Manage protected system settings.'),
  ('payments.configure', 'Manage non-secret payment activation settings.'),
  ('tax.configure', 'Manage protected tax configuration.'),
  ('invoice.configure', 'Manage protected invoice legal configuration.'),
  ('reports.read', 'Read authorized operational reports.')
on conflict (key) do update set description = excluded.description;

insert into public.roles (key, name, description, is_system, active)
values
  ('owner', 'Owner', 'Canonical full-access operational role.', true, true),
  ('manager', 'Manager', 'Canonical limited catalog, inventory, media, and homepage role.', true, true)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  is_system = true,
  active = true,
  updated_at = now();

-- Legacy roles remain addressable for transition records but cannot authorize
-- new Supabase workflows. Existing users are deliberately not auto-mapped.
update public.roles
set active = false, updated_at = now()
where key in ('owner_admin', 'shop_manager');

-- A prior successful run installs these guards. Replace them around the
-- deterministic canonical-bundle reseed so migration re-runs remain safe.
drop trigger if exists role_permissions_protect_owner_bundle on public.role_permissions;
drop trigger if exists permissions_protect_owner_wildcard on public.permissions;

delete from public.role_permissions role_permissions
using public.roles roles
where role_permissions.role_id = roles.id
  and roles.key in ('owner', 'manager', 'owner_admin', 'shop_manager');

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles roles
join public.permissions permissions on (
  (roles.key = 'owner' and permissions.key = '*')
  or (roles.key = 'manager' and permissions.key = any(array[
    'dashboard.read',
    'catalog.read',
    'catalog.manage',
    'categories.manage',
    'collections.manage',
    'inventory.read',
    'inventory.adjust',
    'media.commerce.manage',
    'media.delete',
    'homepage.manage',
    'seo.content.manage'
  ]))
);

comment on table public.admin_memberships is
  'DEPRECATED authority model retained temporarily for prototype compatibility. New authorization uses user_roles and permission keys.';
comment on column public.profiles.address is
  'DEPRECATED legacy address field. customer_addresses is authoritative.';
comment on column public.profiles.city is
  'DEPRECATED legacy address field. customer_addresses is authoritative.';
comment on column public.profiles.province is
  'DEPRECATED legacy address field. customer_addresses is authoritative.';

-- Role-assignment lifecycle ---------------------------------------------------

alter table public.user_roles
  add column if not exists expires_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references auth.users(id) on delete set null,
  add column if not exists revocation_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_roles_active_lifecycle_check'
  ) then
    alter table public.user_roles add constraint user_roles_active_lifecycle_check check (
      (active and revoked_at is null)
      or (not active)
    );
  end if;
end $$;

create index if not exists user_roles_active_user_idx
  on public.user_roles(user_id, role_id)
  where active and revoked_at is null;
create index if not exists user_roles_expiry_idx
  on public.user_roles(expires_at)
  where active and revoked_at is null and expires_at is not null;

create table if not exists public.auth_bootstrap_state (
  id text primary key,
  completed_at timestamptz not null default now(),
  completed_by uuid not null references auth.users(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  constraint auth_bootstrap_state_singleton check (id = 'first_owner'),
  constraint auth_bootstrap_state_metadata_object check (jsonb_typeof(metadata) = 'object')
);

-- Backend-only invitation, session, and guest-claim records ------------------

create table if not exists public.admin_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  normalized_email text generated always as (lower(btrim(email))) stored,
  intended_role_id uuid not null references public.roles(id) on delete restrict,
  invited_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending',
  expires_at timestamptz not null,
  accepted_user_id uuid references auth.users(id) on delete restrict,
  accepted_at timestamptz,
  revoked_at timestamptz,
  audit_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_invitations_email_required check (normalized_email <> ''),
  constraint admin_invitations_status_check check (status in ('pending', 'accepted', 'expired', 'revoked')),
  constraint admin_invitations_expiry_check check (expires_at > created_at),
  constraint admin_invitations_acceptance_check check (
    (status = 'accepted' and accepted_user_id is not null and accepted_at is not null and revoked_at is null)
    or (status <> 'accepted' and accepted_user_id is null and accepted_at is null)
  ),
  constraint admin_invitations_revocation_check check (
    (status = 'revoked' and revoked_at is not null)
    or (status <> 'revoked' and revoked_at is null)
  ),
  constraint admin_invitations_metadata_object check (jsonb_typeof(audit_metadata) = 'object')
);

create unique index if not exists admin_invitations_pending_email_uidx
  on public.admin_invitations(normalized_email)
  where status = 'pending';
create index if not exists admin_invitations_expiry_idx
  on public.admin_invitations(expires_at)
  where status = 'pending';
create index if not exists admin_invitations_role_idx
  on public.admin_invitations(intended_role_id, status);

create table if not exists public.application_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_class text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revocation_reason text,
  mfa_assurance text not null default 'aal1',
  device_metadata jsonb not null default '{}'::jsonb,
  session_key_hash text,
  constraint application_sessions_class_check check (session_class in ('customer', 'administrator')),
  constraint application_sessions_mfa_check check (mfa_assurance in ('aal1', 'aal2')),
  constraint application_sessions_time_check check (
    created_at <= last_seen_at
    and last_seen_at <= idle_expires_at
    and idle_expires_at <= absolute_expires_at
  ),
  constraint application_sessions_revocation_check check (
    revoked_at is null or revoked_at >= created_at
  ),
  constraint application_sessions_hash_check check (
    session_key_hash is null or session_key_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint application_sessions_device_object check (jsonb_typeof(device_metadata) = 'object')
);

create unique index if not exists application_sessions_key_hash_uidx
  on public.application_sessions(session_key_hash)
  where session_key_hash is not null;
create index if not exists application_sessions_user_idx
  on public.application_sessions(user_id, created_at desc);
create index if not exists application_sessions_idle_expiry_idx
  on public.application_sessions(idle_expires_at)
  where revoked_at is null;
create index if not exists application_sessions_absolute_expiry_idx
  on public.application_sessions(absolute_expires_at)
  where revoked_at is null;
create index if not exists application_sessions_revoked_idx
  on public.application_sessions(revoked_at)
  where revoked_at is not null;

create table if not exists public.guest_order_claims (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  claim_token_hash text not null,
  contact_binding_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  linked_customer_id uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  audit_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint guest_order_claims_order_unique unique (order_id),
  constraint guest_order_claims_token_hash_format check (claim_token_hash ~ '^[0-9a-f]{64}$'),
  constraint guest_order_claims_contact_hash_format check (contact_binding_hash ~ '^[0-9a-f]{64}$'),
  constraint guest_order_claims_expiry_check check (expires_at > created_at),
  constraint guest_order_claims_consumption_check check (
    (used_at is null and linked_customer_id is null)
    or (used_at is not null and linked_customer_id is not null)
  ),
  constraint guest_order_claims_revocation_check check (revoked_at is null or used_at is null),
  constraint guest_order_claims_metadata_object check (jsonb_typeof(audit_metadata) = 'object')
);

create unique index if not exists guest_order_claims_token_hash_uidx
  on public.guest_order_claims(claim_token_hash);
create index if not exists guest_order_claims_expiry_idx
  on public.guest_order_claims(expires_at)
  where used_at is null and revoked_at is null;
create index if not exists guest_order_claims_order_idx
  on public.guest_order_claims(order_id);

alter table public.order_status_history
  add column if not exists is_customer_visible boolean not null default false;

-- Safe permission resolution --------------------------------------------------

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
    join public.profiles profiles on profiles.id = user_roles.user_id
    where user_roles.user_id = auth.uid()
      and user_roles.active
      and user_roles.revoked_at is null
      and (user_roles.expires_at is null or user_roles.expires_at > now())
      and roles.active
      and profiles.status = 'Active'
      and (permissions.key = required_permission or permissions.key = '*')
  );
$$;

revoke all on function public.has_permission(text) from public;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.has_permission(text) to service_role;

-- Protected transitions and immutable security audit -------------------------

create or replace function public.protect_profile_identity_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining_owners bigint;
begin
  if auth.uid() = old.id then
    if new.id is distinct from old.id
      or new.email is distinct from old.email
      or new.status is distinct from old.status
      or new.created_at is distinct from old.created_at then
      raise exception using errcode = '42501', message = 'RF_PROFILE_IDENTITY_FIELD_PROTECTED';
    end if;
  end if;

  if old.status = 'Active' and new.status <> 'Active' and exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = old.id
      and ur.active and ur.revoked_at is null
      and (ur.expires_at is null or ur.expires_at > now())
      and r.key = 'owner' and r.active
  ) then
    perform pg_advisory_xact_lock(hashtext('royal_fusion_owner_guard'));
    select count(*) into remaining_owners
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where ur.user_id <> old.id
      and ur.active and ur.revoked_at is null
      and (ur.expires_at is null or ur.expires_at > now())
      and r.key = 'owner' and r.active
      and p.status = 'Active';
    if remaining_owners = 0 then
      raise exception using errcode = '23514', message = 'RF_FINAL_OWNER_REQUIRED';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.protect_profile_identity_fields() from public, anon, authenticated;
drop trigger if exists profiles_protect_restricted_fields on public.profiles;
create trigger profiles_protect_restricted_fields
before update on public.profiles
for each row execute function public.protect_profile_identity_fields();

create or replace function public.protect_owner_role_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_role_id uuid;
  remaining_owners bigint;
  assignment_user_id uuid;
  previous_user_id uuid;
  previous_role_id uuid;
  touches_owner boolean := false;
  activates_owner boolean := false;
  removes_owner boolean := false;
begin
  select id into owner_role_id from public.roles where key = 'owner';
  if owner_role_id is null then
    raise exception using errcode = '55000', message = 'RF_OWNER_ROLE_MISSING';
  end if;

  if tg_op = 'INSERT' then
    touches_owner := new.role_id = owner_role_id;
    activates_owner := new.role_id = owner_role_id
      and new.active and new.revoked_at is null;
  elsif tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id or new.role_id is distinct from old.role_id then
      raise exception using errcode = '23514', message = 'RF_ROLE_ASSIGNMENT_IDENTITY_IMMUTABLE';
    end if;
    touches_owner := old.role_id = owner_role_id or new.role_id = owner_role_id;
    previous_user_id := old.user_id;
    previous_role_id := old.role_id;
    activates_owner := new.role_id = owner_role_id
      and new.active and new.revoked_at is null
      and not (old.role_id = owner_role_id and old.active and old.revoked_at is null);
    removes_owner := old.role_id = owner_role_id and old.active and old.revoked_at is null
      and (new.role_id <> owner_role_id or not new.active or new.revoked_at is not null
        or (new.expires_at is not null and new.expires_at <= now()));
  else
    touches_owner := old.role_id = owner_role_id;
    removes_owner := old.role_id = owner_role_id and old.active and old.revoked_at is null;
  end if;

  if touches_owner then
    perform pg_advisory_xact_lock(hashtext('royal_fusion_owner_guard'));
  end if;

  if tg_op <> 'DELETE' then
    if new.role_id = owner_role_id
      and new.active and new.revoked_at is null and new.expires_at is not null then
      raise exception using errcode = '23514', message = 'RF_OWNER_ASSIGNMENT_MUST_NOT_EXPIRE';
    end if;
    if new.role_id = owner_role_id and new.active and new.revoked_at is null
      and not exists (
        select 1 from public.profiles p
        where p.id = new.user_id and p.status = 'Active'
      ) then
      raise exception using errcode = '23514', message = 'RF_OWNER_PROFILE_NOT_ACTIVE';
    end if;
  end if;

  if activates_owner then
    select count(*) into remaining_owners
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where r.key = 'owner' and r.active
      and ur.active and ur.revoked_at is null
      and (ur.expires_at is null or ur.expires_at > now())
      and p.status = 'Active'
      and (previous_user_id is null or ur.user_id <> previous_user_id or ur.role_id <> previous_role_id);

    if remaining_owners = 0 then
      if exists (select 1 from public.auth_bootstrap_state where id = 'first_owner') then
        raise exception using errcode = '23514', message = 'RF_OWNER_BOOTSTRAP_CLOSED';
      end if;
      insert into public.auth_bootstrap_state (id, completed_by)
      values ('first_owner', new.user_id);
      insert into public.admin_audit_logs (admin_id, action, resource, resource_id, metadata)
      values (new.user_id, 'owner.bootstrap', 'user_role', new.user_id::text, '{"source":"release_only"}'::jsonb);
    end if;
  end if;

  if tg_op = 'DELETE' then
    assignment_user_id := old.user_id;
  else
    assignment_user_id := new.user_id;
  end if;

  if removes_owner then
    select count(*) into remaining_owners
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where r.key = 'owner' and r.active
      and ur.user_id <> assignment_user_id
      and ur.active and ur.revoked_at is null
      and (ur.expires_at is null or ur.expires_at > now())
      and p.status = 'Active';
    if remaining_owners = 0 then
      raise exception using errcode = '23514', message = 'RF_FINAL_OWNER_REQUIRED';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_owner_role_assignment() from public, anon, authenticated;
drop trigger if exists user_roles_protect_owner on public.user_roles;
create trigger user_roles_protect_owner
before insert or update or delete on public.user_roles
for each row execute function public.protect_owner_role_assignment();

create or replace function public.protect_owner_role_definition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_being_disabled boolean := false;
begin
  if tg_op = 'DELETE' then
    role_being_disabled := old.key = 'owner';
  else
    role_being_disabled := old.key = 'owner'
      and (new.key <> 'owner' or not new.active);
  end if;

  if role_being_disabled then
    raise exception using errcode = '23514', message = 'RF_ACTIVE_OWNER_ROLE_PROTECTED';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_owner_role_definition() from public, anon, authenticated;
drop trigger if exists roles_protect_owner on public.roles;
create trigger roles_protect_owner
before update or delete on public.roles
for each row execute function public.protect_owner_role_definition();

create or replace function public.protect_owner_permission_bundle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  protected_owner_grant boolean;
  owner_grant_being_removed boolean := false;
begin
  if tg_table_name = 'role_permissions' then
    select exists (
      select 1
      from public.roles r
      join public.permissions p on p.id = old.permission_id
      where r.id = old.role_id and r.key = 'owner' and p.key = '*'
    ) into protected_owner_grant;
    if tg_op = 'DELETE' then
      owner_grant_being_removed := protected_owner_grant;
    else
      owner_grant_being_removed := protected_owner_grant and (
        new.role_id is distinct from old.role_id
        or new.permission_id is distinct from old.permission_id
      );
    end if;
    if owner_grant_being_removed then
      raise exception using errcode = '23514', message = 'RF_OWNER_PERMISSION_BUNDLE_PROTECTED';
    end if;
  elsif old.key = '*' then
    if tg_op = 'DELETE' then
      owner_grant_being_removed := true;
    else
      owner_grant_being_removed := new.key is distinct from old.key;
    end if;
    if owner_grant_being_removed and exists (
      select 1
      from public.role_permissions rp
      join public.roles r on r.id = rp.role_id
      where rp.permission_id = old.id and r.key = 'owner'
    ) then
      raise exception using errcode = '23514', message = 'RF_OWNER_PERMISSION_BUNDLE_PROTECTED';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_owner_permission_bundle() from public, anon, authenticated;
create trigger role_permissions_protect_owner_bundle
before update or delete on public.role_permissions
for each row execute function public.protect_owner_permission_bundle();
create trigger permissions_protect_owner_wildcard
before update or delete on public.permissions
for each row execute function public.protect_owner_permission_bundle();

create or replace function public.protect_auth_bootstrap_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'RF_OWNER_BOOTSTRAP_IMMUTABLE';
end;
$$;

revoke all on function public.protect_auth_bootstrap_state() from public, anon, authenticated;
drop trigger if exists auth_bootstrap_state_immutable on public.auth_bootstrap_state;
create trigger auth_bootstrap_state_immutable
before update or delete on public.auth_bootstrap_state
for each row execute function public.protect_auth_bootstrap_state();

create or replace function public.validate_admin_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  intended_role_key text;
begin
  select key into intended_role_key from public.roles where id = new.intended_role_id and active;
  if intended_role_key is distinct from 'manager' then
    raise exception using errcode = '23514', message = 'RF_INVITATION_ROLE_INVALID';
  end if;

  if tg_op = 'INSERT' and new.status <> 'pending' then
    raise exception using errcode = '23514', message = 'RF_INVITATION_MUST_START_PENDING';
  end if;

  if tg_op = 'UPDATE' then
    if new.email is distinct from old.email
      or new.intended_role_id is distinct from old.intended_role_id
      or new.invited_by is distinct from old.invited_by then
      raise exception using errcode = '23514', message = 'RF_INVITATION_IDENTITY_IMMUTABLE';
    end if;
    if old.status <> 'pending' and new.status is distinct from old.status then
      raise exception using errcode = '23514', message = 'RF_INVITATION_TERMINAL';
    end if;
    if new.status = 'accepted' and (old.status <> 'pending' or old.expires_at <= now() or old.revoked_at is not null) then
      raise exception using errcode = '23514', message = 'RF_INVITATION_NOT_ACCEPTABLE';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.validate_admin_invitation() from public, anon, authenticated;
drop trigger if exists admin_invitations_validate on public.admin_invitations;
create trigger admin_invitations_validate
before insert or update on public.admin_invitations
for each row execute function public.validate_admin_invitation();

create or replace function public.protect_guest_order_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.order_id is distinct from old.order_id
      or new.claim_token_hash is distinct from old.claim_token_hash
      or new.contact_binding_hash is distinct from old.contact_binding_hash then
      raise exception using errcode = '23514', message = 'RF_CLAIM_IDENTITY_IMMUTABLE';
    end if;
    if old.used_at is not null and row(new.used_at, new.linked_customer_id) is distinct from row(old.used_at, old.linked_customer_id) then
      raise exception using errcode = '23514', message = 'RF_CLAIM_ALREADY_USED';
    end if;
    if new.used_at is not null and old.used_at is null
      and (old.expires_at <= now() or old.revoked_at is not null) then
      raise exception using errcode = '23514', message = 'RF_CLAIM_NOT_USABLE';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_guest_order_claim() from public, anon, authenticated;
drop trigger if exists guest_order_claims_protect on public.guest_order_claims;
create trigger guest_order_claims_protect
before update on public.guest_order_claims
for each row execute function public.protect_guest_order_claim();

create or replace function public.write_auth_security_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  event_action text;
  event_resource_id text;
begin
  actor_id := auth.uid();
  if tg_table_name = 'user_roles' then
    if tg_op = 'DELETE' then
      actor_id := coalesce(actor_id, old.assigned_by);
      event_resource_id := old.user_id::text;
    else
      actor_id := coalesce(actor_id, new.assigned_by);
      event_resource_id := new.user_id::text;
    end if;
    event_action := case tg_op when 'INSERT' then 'role.assigned' when 'DELETE' then 'role.removed' else 'role.changed' end;
  elsif tg_table_name = 'admin_invitations' then
    if tg_op = 'INSERT' then
      actor_id := coalesce(actor_id, new.invited_by);
    else
      actor_id := coalesce(actor_id, new.invited_by, old.invited_by);
    end if;
    event_action := case
      when tg_op = 'INSERT' then 'invitation.created'
      when new.status = 'accepted' and old.status <> 'accepted' then 'invitation.accepted'
      when new.status = 'revoked' and old.status <> 'revoked' then 'invitation.revoked'
      when new.status = 'pending' and new.expires_at is distinct from old.expires_at then 'invitation.resent'
      else 'invitation.changed'
    end;
    event_resource_id := new.id::text;
  elsif tg_table_name = 'application_sessions' then
    if tg_op = 'INSERT' then
      actor_id := coalesce(actor_id, new.revoked_by);
    else
      actor_id := coalesce(actor_id, new.revoked_by, old.revoked_by);
    end if;
    event_action := case
      when tg_op = 'INSERT' then 'session.created'
      when new.revoked_at is not null and old.revoked_at is null then 'session.revoked'
      else 'session.changed'
    end;
    event_resource_id := new.id::text;
  else
    event_action := case
      when new.used_at is not null and old.used_at is null then 'guest_order_claim.linked'
      when new.revoked_at is not null and old.revoked_at is null then 'guest_order_claim.revoked'
      else 'guest_order_claim.changed'
    end;
    event_resource_id := coalesce(new.id, old.id)::text;
  end if;

  insert into public.admin_audit_logs (admin_id, action, resource, resource_id, metadata)
  values (actor_id, event_action, tg_table_name, event_resource_id, jsonb_build_object('operation', tg_op));
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.write_auth_security_audit() from public, anon, authenticated;

drop trigger if exists user_roles_security_audit on public.user_roles;
create trigger user_roles_security_audit after insert or update or delete on public.user_roles
for each row execute function public.write_auth_security_audit();
drop trigger if exists admin_invitations_security_audit on public.admin_invitations;
create trigger admin_invitations_security_audit after insert or update on public.admin_invitations
for each row execute function public.write_auth_security_audit();
drop trigger if exists application_sessions_security_audit on public.application_sessions;
create trigger application_sessions_security_audit after insert or update on public.application_sessions
for each row execute function public.write_auth_security_audit();
drop trigger if exists guest_order_claims_security_audit on public.guest_order_claims;
create trigger guest_order_claims_security_audit after update on public.guest_order_claims
for each row execute function public.write_auth_security_audit();

create or replace function public.require_session_revocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '23514', message = 'RF_SESSION_REVOCATION_REQUIRED';
end;
$$;

revoke all on function public.require_session_revocation() from public, anon, authenticated;
drop trigger if exists application_sessions_prevent_delete on public.application_sessions;
create trigger application_sessions_prevent_delete
before delete on public.application_sessions
for each row execute function public.require_session_revocation();

create or replace function public.protect_admin_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'RF_AUDIT_LOG_IMMUTABLE';
end;
$$;

revoke all on function public.protect_admin_audit_log() from public, anon, authenticated;
drop trigger if exists admin_audit_logs_immutable on public.admin_audit_logs;
create trigger admin_audit_logs_immutable
before update or delete on public.admin_audit_logs
for each row execute function public.protect_admin_audit_log();

create index if not exists admin_audit_logs_action_created_idx
  on public.admin_audit_logs(action, created_at desc);

-- RLS and browser grant boundaries -------------------------------------------

alter table public.auth_bootstrap_state enable row level security;
alter table public.admin_invitations enable row level security;
alter table public.application_sessions enable row level security;
alter table public.guest_order_claims enable row level security;

drop policy if exists rf_profiles_select on public.profiles;
drop policy if exists rf_profiles_update on public.profiles;
create policy rf_profiles_select on public.profiles for select to authenticated
using (id = auth.uid() or public.has_permission('customers.read'));
create policy rf_profiles_update on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists rf_addresses_select on public.customer_addresses;
drop policy if exists rf_addresses_insert on public.customer_addresses;
drop policy if exists rf_addresses_update on public.customer_addresses;
drop policy if exists rf_addresses_delete on public.customer_addresses;
create policy rf_addresses_select on public.customer_addresses for select to authenticated
using (customer_id = auth.uid() or public.has_permission('customers.read'));
create policy rf_addresses_insert on public.customer_addresses for insert to authenticated
with check (customer_id = auth.uid());
create policy rf_addresses_update on public.customer_addresses for update to authenticated
using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create policy rf_addresses_delete on public.customer_addresses for delete to authenticated
using (customer_id = auth.uid());

drop policy if exists rf_roles_admin on public.roles;
drop policy if exists rf_permissions_admin on public.permissions;
drop policy if exists rf_role_permissions_admin on public.role_permissions;
drop policy if exists rf_user_roles_admin on public.user_roles;
-- Role and permission mutations are backend-only. Owner reads are served by
-- permission-checked Express endpoints rather than direct browser table access.

drop policy if exists rf_products_admin on public.products;
create policy rf_products_admin on public.products for select to authenticated
using (public.has_permission('catalog.read') or public.has_permission('products.read'));
drop policy if exists rf_variants_admin on public.product_variants;
create policy rf_variants_admin on public.product_variants for select to authenticated
using (public.has_permission('catalog.read') or public.has_permission('products.read'));
drop policy if exists rf_product_categories_admin on public.product_categories;
create policy rf_product_categories_admin on public.product_categories for select to authenticated
using (public.has_permission('catalog.read') or public.has_permission('products.read'));
drop policy if exists rf_product_collections_admin on public.product_collections;
create policy rf_product_collections_admin on public.product_collections for select to authenticated
using (public.has_permission('catalog.read') or public.has_permission('products.read'));
drop policy if exists rf_product_media_admin on public.product_media;
create policy rf_product_media_admin on public.product_media for select to authenticated
using (public.has_permission('media.commerce.manage') or public.has_permission('products.read'));
drop policy if exists rf_inventory_admin_read on public.inventory_movements;
drop policy if exists rf_inventory_admin_write on public.inventory_movements;
create policy rf_inventory_admin_read on public.inventory_movements for select to authenticated
using (public.has_permission('inventory.read') or public.has_permission('inventory.manage'));
drop policy if exists rf_promotions_admin on public.promotions;
create policy rf_promotions_admin on public.promotions for select to authenticated
using (public.has_permission('homepage.manage') or public.has_permission('promotions.manage'));

drop policy if exists rf_order_history_read on public.order_status_history;
create policy rf_order_history_read on public.order_status_history for select to authenticated
using (exists (
  select 1 from public.orders orders
  where orders.id = order_status_history.order_id
    and (
      public.has_permission('orders.read')
      or (orders.customer_id = auth.uid() and order_status_history.is_customer_visible)
    )
));
drop policy if exists rf_order_notes_admin on public.order_notes;
create policy rf_order_notes_read on public.order_notes for select to authenticated
using (exists (
  select 1 from public.orders orders
  where orders.id = order_notes.order_id
    and (
      public.has_permission('orders.read')
      or (orders.customer_id = auth.uid() and order_notes.is_customer_visible)
    )
));

drop policy if exists rf_legacy_memberships_owner on public.admin_memberships;

revoke all on public.auth_bootstrap_state, public.admin_invitations,
  public.application_sessions, public.guest_order_claims from anon, authenticated;
grant all on public.auth_bootstrap_state, public.admin_invitations,
  public.application_sessions, public.guest_order_claims to service_role;

revoke insert, update, delete on public.roles, public.permissions,
  public.role_permissions, public.user_roles, public.admin_memberships,
  public.admin_audit_logs from anon, authenticated;

-- Browser users do not need direct RBAC table visibility. Permission checks are
-- performed through the narrowly scoped has_permission() resolver and Express.
revoke select on public.roles, public.permissions, public.role_permissions,
  public.user_roles, public.admin_memberships from anon, authenticated;

commit;
