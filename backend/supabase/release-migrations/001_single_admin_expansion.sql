-- RELEASE ONLY: manual EXPAND before ordinary 010/011, not part of automatic numeric replay.
-- Requires royal_fusion.approved_admin_uuid on this release connection. No identity inference.
begin;

set local lock_timeout='5s';
set local statement_timeout='60s';
lock table public.roles,public.user_roles,public.role_permissions,public.profiles in share row exclusive mode;
do $preconditions$
declare approved uuid; n integer; boot uuid;
begin
  if coalesce(current_setting('royal_fusion.approved_admin_uuid',true),'') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'RF_APPROVED_ADMIN_REQUIRED'; end if;
  approved:=current_setting('royal_fusion.approved_admin_uuid')::uuid;
  if not exists(select 1 from auth.users u join public.profiles pr on pr.id=u.id where u.id=approved and pr.status='Active') then raise exception 'RF_APPROVED_PROFILE_NOT_ACTIVE'; end if;
  select count(*) into n from public.user_roles ur join public.roles r on r.id=ur.role_id where r.key='owner_admin' and ur.active;
  if n<>1 or not exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=approved and ur.active and r.active and r.key='owner_admin') then raise exception 'RF_LEGACY_ADMIN_PRECONDITION'; end if;
  if (select array_agg(pe.key order by pe.key) from public.roles r join public.role_permissions rp on rp.role_id=r.id join public.permissions pe on pe.id=rp.permission_id where r.key='owner_admin') is distinct from array['*']::text[] then raise exception 'RF_LEGACY_WILDCARD_REQUIRED'; end if;
  if exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.active and (ur.user_id<>approved or r.key not in ('admin','owner_admin'))) then raise exception 'RF_UNEXPECTED_ADMIN_ASSIGNMENT'; end if;
  if exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where r.key='admin' and (ur.user_id<>approved or not ur.active)) then raise exception 'RF_CONFLICTING_ADMIN'; end if;
  if to_regclass('public.auth_bootstrap_state') is not null then
    execute 'select count(*) from public.auth_bootstrap_state' into n;
    if n>1 then raise exception 'RF_CONFLICTING_BOOTSTRAP'; end if;
    execute 'select completed_by from public.auth_bootstrap_state where id=''first_admin''' into boot;
    if boot is not null and (boot<>approved or not exists(select 1 from public.admin_audit_logs where action='authorization.expanded' and resource_id=approved::text and metadata->>'transition'='single_admin_v1')) then raise exception 'RF_CONFLICTING_BOOTSTRAP'; end if;
  end if;
  if exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where r.key='admin') and boot is null then raise exception 'RF_CONFLICTING_BOOTSTRAP'; end if;
end;
$preconditions$;
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
on conflict (key) do nothing;

insert into public.roles(key,name,description,is_system,active) values('admin','Admin','Full Royal Fusion application administration.',true,true) on conflict(key) do update set active=true,name='Admin',is_system=true;
do $bundle$ begin if exists(select 1 from public.roles r join public.role_permissions rp on rp.role_id=r.id join public.permissions pe on pe.id=rp.permission_id where r.key='admin' and pe.key<>'*') then raise exception 'RF_UNEXPECTED_ADMIN_BUNDLE'; end if; end; $bundle$;
insert into public.role_permissions(role_id,permission_id) select r.id,pe.id from public.roles r cross join public.permissions pe where r.key='admin' and pe.key='*' on conflict do nothing;
create table if not exists public.auth_bootstrap_state (
  id text primary key,
  completed_at timestamptz not null default now(),
  completed_by uuid not null references auth.users(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  constraint auth_bootstrap_state_singleton check (id = 'first_admin'),
  constraint auth_bootstrap_state_metadata_object check (jsonb_typeof(metadata) = 'object')
);

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
create schema rf_auth_shape_check;
create table rf_auth_shape_check.rf_expected_auth_bootstrap_state (
  id text primary key,
  completed_at timestamptz not null default now(),
  completed_by uuid not null references auth.users(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  constraint auth_bootstrap_state_singleton check (id = 'first_admin'),
  constraint auth_bootstrap_state_metadata_object check (jsonb_typeof(metadata) = 'object')
);
do $compatibility$ begin
 if exists(select 1 from pg_attribute e left join pg_attribute a on a.attrelid='public.auth_bootstrap_state'::regclass and a.attname=e.attname and a.attnum>0 and not a.attisdropped where e.attrelid='rf_auth_shape_check.rf_expected_auth_bootstrap_state'::regclass and e.attnum>0 and not e.attisdropped and (a.attname is null or a.atttypid<>e.atttypid or a.attnotnull<>e.attnotnull)) then raise exception 'RF_INCOMPATIBLE_TABLE: auth_bootstrap_state'; end if;
 if exists(select 1 from pg_constraint e where e.conrelid='rf_auth_shape_check.rf_expected_auth_bootstrap_state'::regclass and not exists(select 1 from pg_constraint a where a.conrelid='public.auth_bootstrap_state'::regclass and a.convalidated and a.contype=e.contype and pg_get_constraintdef(a.oid)=pg_get_constraintdef(e.oid))) then raise exception 'RF_INCOMPATIBLE_CONSTRAINT: auth_bootstrap_state'; end if;
end; $compatibility$;
drop table rf_auth_shape_check.rf_expected_auth_bootstrap_state;
create table rf_auth_shape_check.rf_expected_application_sessions (
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
do $compatibility$ begin
 if exists(select 1 from pg_attribute e left join pg_attribute a on a.attrelid='public.application_sessions'::regclass and a.attname=e.attname and a.attnum>0 and not a.attisdropped where e.attrelid='rf_auth_shape_check.rf_expected_application_sessions'::regclass and e.attnum>0 and not e.attisdropped and (a.attname is null or a.atttypid<>e.atttypid or a.attnotnull<>e.attnotnull)) then raise exception 'RF_INCOMPATIBLE_TABLE: application_sessions'; end if;
 if exists(select 1 from pg_constraint e where e.conrelid='rf_auth_shape_check.rf_expected_application_sessions'::regclass and not exists(select 1 from pg_constraint a where a.conrelid='public.application_sessions'::regclass and a.convalidated and a.contype=e.contype and pg_get_constraintdef(a.oid)=pg_get_constraintdef(e.oid))) then raise exception 'RF_INCOMPATIBLE_CONSTRAINT: application_sessions'; end if;
end; $compatibility$;
drop table rf_auth_shape_check.rf_expected_application_sessions;
create table rf_auth_shape_check.rf_expected_guest_order_claims (
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
do $compatibility$ begin
 if exists(select 1 from pg_attribute e left join pg_attribute a on a.attrelid='public.guest_order_claims'::regclass and a.attname=e.attname and a.attnum>0 and not a.attisdropped where e.attrelid='rf_auth_shape_check.rf_expected_guest_order_claims'::regclass and e.attnum>0 and not e.attisdropped and (a.attname is null or a.atttypid<>e.atttypid or a.attnotnull<>e.attnotnull)) then raise exception 'RF_INCOMPATIBLE_TABLE: guest_order_claims'; end if;
 if exists(select 1 from pg_constraint e where e.conrelid='rf_auth_shape_check.rf_expected_guest_order_claims'::regclass and not exists(select 1 from pg_constraint a where a.conrelid='public.guest_order_claims'::regclass and a.convalidated and a.contype=e.contype and pg_get_constraintdef(a.oid)=pg_get_constraintdef(e.oid))) then raise exception 'RF_INCOMPATIBLE_CONSTRAINT: guest_order_claims'; end if;
end; $compatibility$;
drop table rf_auth_shape_check.rf_expected_guest_order_claims;
drop schema rf_auth_shape_check;
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
create unique index if not exists guest_order_claims_token_hash_uidx
  on public.guest_order_claims(claim_token_hash);
create index if not exists guest_order_claims_expiry_idx
  on public.guest_order_claims(expires_at)
  where used_at is null and revoked_at is null;
create index if not exists guest_order_claims_order_idx
  on public.guest_order_claims(order_id);
create index if not exists admin_audit_logs_action_created_idx
  on public.admin_audit_logs(action, created_at desc);

do $identity_indexes$ declare i pg_index%rowtype; begin
 select * into i from pg_index where indexrelid='public.application_sessions_key_hash_uidx'::regclass;
 if not i.indisunique or not i.indisvalid or i.indnkeyatts<>1 or pg_get_indexdef(i.indexrelid,1,true)<>'session_key_hash'
 or regexp_replace(upper(pg_get_expr(i.indpred,i.indrelid)), '[()\s]', '', 'g') is distinct from 'SESSION_KEY_HASHISNOTNULL' then raise exception 'RF_INCOMPATIBLE_SESSION_IDENTITY_INDEX'; end if;
 select * into i from pg_index where indexrelid='public.guest_order_claims_token_hash_uidx'::regclass;
 if not i.indisunique or not i.indisvalid or i.indnkeyatts<>1 or i.indpred is not null or pg_get_indexdef(i.indexrelid,1,true)<>'claim_token_hash' then raise exception 'RF_INCOMPATIBLE_CLAIM_IDENTITY_INDEX'; end if;
end; $identity_indexes$;

alter table public.order_status_history add column if not exists is_customer_visible boolean not null default false;
-- Exact reviewed LF/CRLF bodies only; trim outer whitespace, never installed SQL tokens.
-- Overlap fallback is pinned to the immutable, approved bootstrap identity, never a GUC.
do $permission_install$
declare
  p pg_proc%rowtype;
  installed_body text;
  -- Only these reviewed constants are converted to LF. Installed SQL is never normalized.
  approved_target_lf text:=btrim(replace($expected$
  select exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
    join public.profiles pr on pr.id=ur.user_id join public.role_permissions rp on rp.role_id=r.id
    join public.permissions pe on pe.id=rp.permission_id
    where ur.user_id=auth.uid() and ur.active and pr.status='Active' and r.active
      and pe.key='*' and (r.key='admin' or (r.key='owner_admin' and exists(
        select 1 from public.auth_bootstrap_state boot
        where boot.id='first_admin' and boot.completed_by=ur.user_id))));
$expected$,E'\r\n',E'\n'),E' \t\r\n');
  approved_source_lf text:=btrim(replace($verified_source$
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
$verified_source$,E'\r\n',E'\n'),E' \t\r\n');
begin
  select * into p from pg_proc where oid=to_regprocedure('public.has_permission(text)');
  if not found then raise exception 'RF_INCOMPATIBLE_FUNCTION: has_permission'; end if;
  if p.pronargs<>1 or p.proargtypes<>'25'::oidvector
    or p.proargnames is distinct from array['required_permission']::text[]
    or p.proallargtypes is not null or p.proargmodes is not null or p.pronargdefaults<>0
    or p.prokind<>'f' or p.proretset or p.prorettype<>'boolean'::regtype
    or p.proisstrict or p.proleakproof or p.proparallel<>'u' or p.prosupport<>0
    or p.prolang is distinct from (select oid from pg_language where lanname='sql')
    or p.prosecdef is distinct from true or p.provolatile<>'s'
    or p.proconfig is distinct from array['search_path=""']::text[]
    or p.proowner is distinct from (select oid from pg_roles where rolname='postgres')
    or has_function_privilege('anon',p.oid,'EXECUTE') is distinct from false
    or has_function_privilege('authenticated',p.oid,'EXECUTE') is distinct from true
    or has_function_privilege('service_role',p.oid,'EXECUTE') is distinct from true then
    raise exception 'RF_INCOMPATIBLE_FUNCTION: has_permission';
  end if;
  installed_body:=btrim(p.prosrc,E' \t\r\n');
  if installed_body in (approved_target_lf,replace(approved_target_lf,E'\n',E'\r\n')) then return; end if;
  if installed_body not in (approved_source_lf,replace(approved_source_lf,E'\n',E'\r\n')) then
    raise exception 'RF_INCOMPATIBLE_FUNCTION: has_permission';
  end if;
  execute $ddl$create or replace function public.has_permission(required_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
    join public.profiles pr on pr.id=ur.user_id join public.role_permissions rp on rp.role_id=r.id
    join public.permissions pe on pe.id=rp.permission_id
    where ur.user_id=auth.uid() and ur.active and pr.status='Active' and r.active
      and pe.key='*' and (r.key='admin' or (r.key='owner_admin' and exists(
        select 1 from public.auth_bootstrap_state boot
        where boot.id='first_admin' and boot.completed_by=ur.user_id))));
$$;$ddl$;
end;
$permission_install$;

do $function_install$
declare
  p pg_proc%rowtype;
  -- Exact reviewed LF/CRLF bodies; never normalize installed SQL internally.
  approved_expected_lf text:=btrim(replace($expected$
declare
  remaining_admins bigint;
begin
  if tg_op='UPDATE' and auth.uid() = old.id then
    if new.id is distinct from old.id
      or new.email is distinct from old.email
      or new.status is distinct from old.status
      or new.created_at is distinct from old.created_at then
      raise exception using errcode = '42501', message = 'RF_PROFILE_IDENTITY_FIELD_PROTECTED';
    end if;
  end if;

  if old.status = 'Active' and (tg_op='DELETE' or new.status <> 'Active') and exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = old.id
      and ur.active
      and r.key = 'admin' and r.active
  ) then
    perform pg_advisory_xact_lock(hashtext('royal_fusion_admin_guard'));
    select count(*) into remaining_admins
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where ur.user_id <> old.id
      and ur.active
      and r.key = 'admin' and r.active
      and p.status = 'Active';
    if remaining_admins = 0 then
      raise exception using errcode = '23514', message = 'RF_FINAL_ADMIN_REQUIRED';
    end if;
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$expected$,E'\r\n',E'\n'),E' \t\r\n');
  approved_previous_0_lf text:=btrim(replace($previous_0$
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
$previous_0$,E'\r\n',E'\n'),E' \t\r\n');
begin
  select * into p from pg_proc where oid=to_regprocedure('public.protect_profile_identity_fields()');
  if found then
    if p.prosecdef is distinct from true or p.proconfig is distinct from array['search_path=""']::text[]
      or p.prorettype<>'trigger'::regtype or p.prolang not in (select oid from pg_language where lanname in ('sql','plpgsql'))
      or p.provolatile<>'v' then raise exception 'RF_INCOMPATIBLE_FUNCTION: protect_profile_identity_fields'; end if;
    if btrim(p.prosrc,E' \t\r\n') in (approved_expected_lf,replace(approved_expected_lf,E'\n',E'\r\n')) then return; end if;
    if not (btrim(p.prosrc,E' \t\r\n') in (approved_previous_0_lf,replace(approved_previous_0_lf,E'\n',E'\r\n'))) then raise exception 'RF_INCOMPATIBLE_FUNCTION: protect_profile_identity_fields'; end if;
  end if;
  execute $ddl$create or replace function public.protect_profile_identity_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining_admins bigint;
begin
  if tg_op='UPDATE' and auth.uid() = old.id then
    if new.id is distinct from old.id
      or new.email is distinct from old.email
      or new.status is distinct from old.status
      or new.created_at is distinct from old.created_at then
      raise exception using errcode = '42501', message = 'RF_PROFILE_IDENTITY_FIELD_PROTECTED';
    end if;
  end if;

  if old.status = 'Active' and (tg_op='DELETE' or new.status <> 'Active') and exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = old.id
      and ur.active
      and r.key = 'admin' and r.active
  ) then
    perform pg_advisory_xact_lock(hashtext('royal_fusion_admin_guard'));
    select count(*) into remaining_admins
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where ur.user_id <> old.id
      and ur.active
      and r.key = 'admin' and r.active
      and p.status = 'Active';
    if remaining_admins = 0 then
      raise exception using errcode = '23514', message = 'RF_FINAL_ADMIN_REQUIRED';
    end if;
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;$ddl$;
end;
$function_install$;

do $function_install$
declare
  p pg_proc%rowtype;
  -- Exact reviewed LF/CRLF bodies; never normalize installed SQL internally.
  approved_expected_lf text:=btrim(replace($expected$
declare
  admin_role_id uuid;
  remaining_admins bigint;
  assignment_user_id uuid;
  previous_user_id uuid;
  previous_role_id uuid;
  touches_owner boolean := false;
  activates_owner boolean := false;
  removes_owner boolean := false;
begin
  select id into admin_role_id from public.roles where key = 'admin';
  if admin_role_id is null then
    raise exception using errcode = '55000', message = 'RF_ADMIN_ROLE_MISSING';
  end if;

  if tg_op = 'INSERT' then
    touches_owner := new.role_id = admin_role_id;
    activates_owner := new.role_id = admin_role_id
      and new.active;
  elsif tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id or new.role_id is distinct from old.role_id then
      raise exception using errcode = '23514', message = 'RF_ROLE_ASSIGNMENT_IDENTITY_IMMUTABLE';
    end if;
    touches_owner := old.role_id = admin_role_id or new.role_id = admin_role_id;
    previous_user_id := old.user_id;
    previous_role_id := old.role_id;
    activates_owner := new.role_id = admin_role_id
      and new.active
      and not (old.role_id = admin_role_id and old.active);
    removes_owner := old.role_id = admin_role_id and old.active
      and (new.role_id <> admin_role_id or not new.active);
  else
    touches_owner := old.role_id = admin_role_id;
    removes_owner := old.role_id = admin_role_id and old.active;
  end if;

  if touches_owner then
    perform pg_advisory_xact_lock(hashtext('royal_fusion_admin_guard'));
  end if;

  if tg_op <> 'DELETE' then
    if new.role_id = admin_role_id and new.active
      and not exists (
        select 1 from public.profiles p
        where p.id = new.user_id and p.status = 'Active'
      ) then
      raise exception using errcode = '23514', message = 'RF_ADMIN_PROFILE_NOT_ACTIVE';
    end if;
  end if;

  if activates_owner then
    select count(*) into remaining_admins
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where r.key = 'admin' and r.active
      and ur.active
      and p.status = 'Active'
      and (previous_user_id is null or ur.user_id <> previous_user_id or ur.role_id <> previous_role_id);

    if remaining_admins = 0 then
      if exists (select 1 from public.auth_bootstrap_state where id = 'first_admin') then
        raise exception using errcode = '23514', message = 'RF_ADMIN_BOOTSTRAP_CLOSED';
      end if;
      insert into public.auth_bootstrap_state (id, completed_by)
      values ('first_admin', new.user_id);
      insert into public.admin_audit_logs (admin_id, action, resource, resource_id, metadata)
      values (new.user_id, 'admin.bootstrap', 'user_role', new.user_id::text, '{"source":"release_only"}'::jsonb);
    end if;
  end if;

  if tg_op = 'DELETE' then
    assignment_user_id := old.user_id;
  else
    assignment_user_id := new.user_id;
  end if;

  if removes_owner then
    select count(*) into remaining_admins
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where r.key = 'admin' and r.active
      and ur.user_id <> assignment_user_id
      and ur.active
      and p.status = 'Active';
    if remaining_admins = 0 then
      raise exception using errcode = '23514', message = 'RF_FINAL_ADMIN_REQUIRED';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$expected$,E'\r\n',E'\n'),E' \t\r\n');
begin
  select * into p from pg_proc where oid=to_regprocedure('public.protect_admin_role_assignment()');
  if found then
    if p.prosecdef is distinct from true or p.proconfig is distinct from array['search_path=""']::text[]
      or p.prorettype<>'trigger'::regtype or p.prolang not in (select oid from pg_language where lanname in ('sql','plpgsql'))
      or p.provolatile<>'v' then raise exception 'RF_INCOMPATIBLE_FUNCTION: protect_admin_role_assignment'; end if;
    if btrim(p.prosrc,E' \t\r\n') in (approved_expected_lf,replace(approved_expected_lf,E'\n',E'\r\n')) then return; end if;
    if not (false) then raise exception 'RF_INCOMPATIBLE_FUNCTION: protect_admin_role_assignment'; end if;
  end if;
  execute $ddl$create or replace function public.protect_admin_role_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_role_id uuid;
  remaining_admins bigint;
  assignment_user_id uuid;
  previous_user_id uuid;
  previous_role_id uuid;
  touches_owner boolean := false;
  activates_owner boolean := false;
  removes_owner boolean := false;
begin
  select id into admin_role_id from public.roles where key = 'admin';
  if admin_role_id is null then
    raise exception using errcode = '55000', message = 'RF_ADMIN_ROLE_MISSING';
  end if;

  if tg_op = 'INSERT' then
    touches_owner := new.role_id = admin_role_id;
    activates_owner := new.role_id = admin_role_id
      and new.active;
  elsif tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id or new.role_id is distinct from old.role_id then
      raise exception using errcode = '23514', message = 'RF_ROLE_ASSIGNMENT_IDENTITY_IMMUTABLE';
    end if;
    touches_owner := old.role_id = admin_role_id or new.role_id = admin_role_id;
    previous_user_id := old.user_id;
    previous_role_id := old.role_id;
    activates_owner := new.role_id = admin_role_id
      and new.active
      and not (old.role_id = admin_role_id and old.active);
    removes_owner := old.role_id = admin_role_id and old.active
      and (new.role_id <> admin_role_id or not new.active);
  else
    touches_owner := old.role_id = admin_role_id;
    removes_owner := old.role_id = admin_role_id and old.active;
  end if;

  if touches_owner then
    perform pg_advisory_xact_lock(hashtext('royal_fusion_admin_guard'));
  end if;

  if tg_op <> 'DELETE' then
    if new.role_id = admin_role_id and new.active
      and not exists (
        select 1 from public.profiles p
        where p.id = new.user_id and p.status = 'Active'
      ) then
      raise exception using errcode = '23514', message = 'RF_ADMIN_PROFILE_NOT_ACTIVE';
    end if;
  end if;

  if activates_owner then
    select count(*) into remaining_admins
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where r.key = 'admin' and r.active
      and ur.active
      and p.status = 'Active'
      and (previous_user_id is null or ur.user_id <> previous_user_id or ur.role_id <> previous_role_id);

    if remaining_admins = 0 then
      if exists (select 1 from public.auth_bootstrap_state where id = 'first_admin') then
        raise exception using errcode = '23514', message = 'RF_ADMIN_BOOTSTRAP_CLOSED';
      end if;
      insert into public.auth_bootstrap_state (id, completed_by)
      values ('first_admin', new.user_id);
      insert into public.admin_audit_logs (admin_id, action, resource, resource_id, metadata)
      values (new.user_id, 'admin.bootstrap', 'user_role', new.user_id::text, '{"source":"release_only"}'::jsonb);
    end if;
  end if;

  if tg_op = 'DELETE' then
    assignment_user_id := old.user_id;
  else
    assignment_user_id := new.user_id;
  end if;

  if removes_owner then
    select count(*) into remaining_admins
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where r.key = 'admin' and r.active
      and ur.user_id <> assignment_user_id
      and ur.active
      and p.status = 'Active';
    if remaining_admins = 0 then
      raise exception using errcode = '23514', message = 'RF_FINAL_ADMIN_REQUIRED';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;$ddl$;
end;
$function_install$;

do $function_install$
declare
  p pg_proc%rowtype;
  -- Exact reviewed LF/CRLF bodies; never normalize installed SQL internally.
  approved_expected_lf text:=btrim(replace($expected$
declare
  role_being_disabled boolean := false;
begin
  if tg_op = 'DELETE' then
    role_being_disabled := old.key = 'admin';
  else
    role_being_disabled := old.key = 'admin'
      and (new.key <> 'admin' or not new.active);
  end if;

  if role_being_disabled then
    raise exception using errcode = '23514', message = 'RF_ACTIVE_ADMIN_ROLE_PROTECTED';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$expected$,E'\r\n',E'\n'),E' \t\r\n');
begin
  select * into p from pg_proc where oid=to_regprocedure('public.protect_admin_role_definition()');
  if found then
    if p.prosecdef is distinct from true or p.proconfig is distinct from array['search_path=""']::text[]
      or p.prorettype<>'trigger'::regtype or p.prolang not in (select oid from pg_language where lanname in ('sql','plpgsql'))
      or p.provolatile<>'v' then raise exception 'RF_INCOMPATIBLE_FUNCTION: protect_admin_role_definition'; end if;
    if btrim(p.prosrc,E' \t\r\n') in (approved_expected_lf,replace(approved_expected_lf,E'\n',E'\r\n')) then return; end if;
    if not (false) then raise exception 'RF_INCOMPATIBLE_FUNCTION: protect_admin_role_definition'; end if;
  end if;
  execute $ddl$create or replace function public.protect_admin_role_definition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_being_disabled boolean := false;
begin
  if tg_op = 'DELETE' then
    role_being_disabled := old.key = 'admin';
  else
    role_being_disabled := old.key = 'admin'
      and (new.key <> 'admin' or not new.active);
  end if;

  if role_being_disabled then
    raise exception using errcode = '23514', message = 'RF_ACTIVE_ADMIN_ROLE_PROTECTED';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;$ddl$;
end;
$function_install$;

do $function_install$
declare
  p pg_proc%rowtype;
  -- Exact reviewed LF/CRLF bodies; never normalize installed SQL internally.
  approved_expected_lf text:=btrim(replace($expected$
declare
  protected_owner_grant boolean;
  owner_grant_being_removed boolean := false;
begin
  if tg_table_name = 'role_permissions' then
    select exists (
      select 1
      from public.roles r
      join public.permissions p on p.id = old.permission_id
      where r.id = old.role_id and r.key = 'admin' and p.key = '*'
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
      raise exception using errcode = '23514', message = 'RF_ADMIN_PERMISSION_BUNDLE_PROTECTED';
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
      where rp.permission_id = old.id and r.key = 'admin'
    ) then
      raise exception using errcode = '23514', message = 'RF_ADMIN_PERMISSION_BUNDLE_PROTECTED';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$expected$,E'\r\n',E'\n'),E' \t\r\n');
begin
  select * into p from pg_proc where oid=to_regprocedure('public.protect_admin_permission_bundle()');
  if found then
    if p.prosecdef is distinct from true or p.proconfig is distinct from array['search_path=""']::text[]
      or p.prorettype<>'trigger'::regtype or p.prolang not in (select oid from pg_language where lanname in ('sql','plpgsql'))
      or p.provolatile<>'v' then raise exception 'RF_INCOMPATIBLE_FUNCTION: protect_admin_permission_bundle'; end if;
    if btrim(p.prosrc,E' \t\r\n') in (approved_expected_lf,replace(approved_expected_lf,E'\n',E'\r\n')) then return; end if;
    if not (false) then raise exception 'RF_INCOMPATIBLE_FUNCTION: protect_admin_permission_bundle'; end if;
  end if;
  execute $ddl$create or replace function public.protect_admin_permission_bundle()
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
      where r.id = old.role_id and r.key = 'admin' and p.key = '*'
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
      raise exception using errcode = '23514', message = 'RF_ADMIN_PERMISSION_BUNDLE_PROTECTED';
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
      where rp.permission_id = old.id and r.key = 'admin'
    ) then
      raise exception using errcode = '23514', message = 'RF_ADMIN_PERMISSION_BUNDLE_PROTECTED';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;$ddl$;
end;
$function_install$;

do $function_install$
declare
  p pg_proc%rowtype;
  -- Exact reviewed LF/CRLF bodies; never normalize installed SQL internally.
  approved_expected_lf text:=btrim(replace($expected$
begin
  raise exception using errcode = '42501', message = 'RF_ADMIN_BOOTSTRAP_IMMUTABLE';
end;
$expected$,E'\r\n',E'\n'),E' \t\r\n');
  approved_previous_0_lf text:=btrim(replace($previous_0$
begin
  raise exception using errcode = '42501', message = 'RF_OWNER_BOOTSTRAP_IMMUTABLE';
end;
$previous_0$,E'\r\n',E'\n'),E' \t\r\n');
begin
  select * into p from pg_proc where oid=to_regprocedure('public.protect_auth_bootstrap_state()');
  if found then
    if p.prosecdef is distinct from true or p.proconfig is distinct from array['search_path=""']::text[]
      or p.prorettype<>'trigger'::regtype or p.prolang not in (select oid from pg_language where lanname in ('sql','plpgsql'))
      or p.provolatile<>'v' then raise exception 'RF_INCOMPATIBLE_FUNCTION: protect_auth_bootstrap_state'; end if;
    if btrim(p.prosrc,E' \t\r\n') in (approved_expected_lf,replace(approved_expected_lf,E'\n',E'\r\n')) then return; end if;
    if not (btrim(p.prosrc,E' \t\r\n') in (approved_previous_0_lf,replace(approved_previous_0_lf,E'\n',E'\r\n'))) then raise exception 'RF_INCOMPATIBLE_FUNCTION: protect_auth_bootstrap_state'; end if;
  end if;
  execute $ddl$create or replace function public.protect_auth_bootstrap_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'RF_ADMIN_BOOTSTRAP_IMMUTABLE';
end;
$$;$ddl$;
end;
$function_install$;

do $function_install$
declare
  p pg_proc%rowtype;
  -- Exact reviewed LF/CRLF bodies; never normalize installed SQL internally.
  approved_expected_lf text:=btrim(replace($expected$
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
      when new.revoked_at is not null then 'session.revoked'
      else 'session.changed'
    end;
    event_resource_id := new.id::text;
  else
    event_action := case
      when new.used_at is not null and old.used_at is null then 'guest_order_claim.linked'
      when new.revoked_at is not null then 'guest_order_claim.revoked'
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
$expected$,E'\r\n',E'\n'),E' \t\r\n');
  approved_previous_0_lf text:=btrim(replace($previous_0$
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
$previous_0$,E'\r\n',E'\n'),E' \t\r\n');
begin
  select * into p from pg_proc where oid=to_regprocedure('public.write_auth_security_audit()');
  if found then
    if p.prosecdef is distinct from true or p.proconfig is distinct from array['search_path=""']::text[]
      or p.prorettype<>'trigger'::regtype or p.prolang not in (select oid from pg_language where lanname in ('sql','plpgsql'))
      or p.provolatile<>'v' then raise exception 'RF_INCOMPATIBLE_FUNCTION: write_auth_security_audit'; end if;
    if btrim(p.prosrc,E' \t\r\n') in (approved_expected_lf,replace(approved_expected_lf,E'\n',E'\r\n')) then return; end if;
    if not (btrim(p.prosrc,E' \t\r\n') in (approved_previous_0_lf,replace(approved_previous_0_lf,E'\n',E'\r\n'))) then raise exception 'RF_INCOMPATIBLE_FUNCTION: write_auth_security_audit'; end if;
  end if;
  execute $ddl$create or replace function public.write_auth_security_audit()
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
      when new.revoked_at is not null then 'session.revoked'
      else 'session.changed'
    end;
    event_resource_id := new.id::text;
  else
    event_action := case
      when new.used_at is not null and old.used_at is null then 'guest_order_claim.linked'
      when new.revoked_at is not null then 'guest_order_claim.revoked'
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
$$;$ddl$;
end;
$function_install$;

do $function_install$
declare
  p pg_proc%rowtype;
  installed_body text;
  -- Normalize reviewed constants only; preserve every internal installed character.
  approved_target_lf text:=btrim(replace($expected$
begin
  raise exception using errcode = '23514', message = 'RF_SESSION_REVOCATION_REQUIRED';
end;
$expected$,E'\r\n',E'\n'),E' \t\r\n');
  approved_source_lf text:=btrim(replace($previous_0$
begin
  raise exception using
    errcode = '23514',
    message = 'RF_SESSION_REVOCATION_REQUIRED';
end;
$previous_0$,E'\r\n',E'\n'),E' \t\r\n');
begin
  select * into p from pg_proc where oid=to_regprocedure('public.require_session_revocation()');
  if found then
    if p.prosecdef is distinct from true or p.proconfig is distinct from array['search_path=""']::text[]
      or p.prorettype<>'trigger'::regtype or p.prolang not in (select oid from pg_language where lanname in ('sql','plpgsql'))
      or p.provolatile<>'v' then raise exception 'RF_INCOMPATIBLE_FUNCTION: require_session_revocation'; end if;
    installed_body:=btrim(p.prosrc,E' \t\r\n');
    if installed_body in (approved_target_lf,replace(approved_target_lf,E'\n',E'\r\n')) then return; end if;
    if installed_body not in (approved_source_lf,replace(approved_source_lf,E'\n',E'\r\n')) then
      raise exception 'RF_INCOMPATIBLE_FUNCTION: require_session_revocation';
    end if;
  end if;
  execute $ddl$create or replace function public.require_session_revocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '23514', message = 'RF_SESSION_REVOCATION_REQUIRED';
end;
$$;$ddl$;
end;
$function_install$;

do $function_install$
declare
  p pg_proc%rowtype;
  -- Exact reviewed LF/CRLF bodies; never normalize installed SQL internally.
  approved_expected_lf text:=btrim(replace($expected$
begin
  raise exception using errcode = '42501', message = 'RF_AUDIT_LOG_IMMUTABLE';
end;
$expected$,E'\r\n',E'\n'),E' \t\r\n');
  approved_previous_0_lf text:=btrim(replace($previous_0$
begin
  raise exception using errcode = '42501', message = 'RF_AUDIT_LOG_IMMUTABLE';
end;
$previous_0$,E'\r\n',E'\n'),E' \t\r\n');
begin
  select * into p from pg_proc where oid=to_regprocedure('public.protect_admin_audit_log()');
  if found then
    if p.prosecdef is distinct from true or p.proconfig is distinct from array['search_path=""']::text[]
      or p.prorettype<>'trigger'::regtype or p.prolang not in (select oid from pg_language where lanname in ('sql','plpgsql'))
      or p.provolatile<>'v' then raise exception 'RF_INCOMPATIBLE_FUNCTION: protect_admin_audit_log'; end if;
    if btrim(p.prosrc,E' \t\r\n') in (approved_expected_lf,replace(approved_expected_lf,E'\n',E'\r\n')) then return; end if;
    if not (btrim(p.prosrc,E' \t\r\n') in (approved_previous_0_lf,replace(approved_previous_0_lf,E'\n',E'\r\n'))) then raise exception 'RF_INCOMPATIBLE_FUNCTION: protect_admin_audit_log'; end if;
  end if;
  execute $ddl$create or replace function public.protect_admin_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'RF_AUDIT_LOG_IMMUTABLE';
end;
$$;$ddl$;
end;
$function_install$;
alter table public.application_sessions
  add column if not exists refresh_lock_hash text,
  add column if not exists refresh_locked_until timestamptz,
  add column if not exists authentication_context text not null default 'standard';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_sessions_refresh_lock_check'
      and conrelid = 'public.application_sessions'::regclass
  ) then
    alter table public.application_sessions
      add constraint application_sessions_refresh_lock_check check (
        (refresh_lock_hash is null and refresh_locked_until is null)
        or (
          refresh_lock_hash ~ '^[0-9a-f]{64}$'
          and refresh_locked_until is not null
        )
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_sessions_auth_context_check'
      and conrelid = 'public.application_sessions'::regclass
  ) then
    alter table public.application_sessions
      add constraint application_sessions_auth_context_check check (
        authentication_context in ('standard', 'recovery')
      );
  end if;
end $$;


-- Validate pre-existing 004 lease/context columns and checks instead of accepting
-- a same-named weaker constraint. Extra columns and session rows stay intact.
create temporary table rf_expected_session_lease (
 refresh_lock_hash text, refresh_locked_until timestamptz,
 authentication_context text not null default 'standard',
 constraint application_sessions_refresh_lock_check check (
  (refresh_lock_hash is null and refresh_locked_until is null) or (refresh_lock_hash ~ '^[0-9a-f]{64}$' and refresh_locked_until is not null)),
 constraint application_sessions_auth_context_check check (authentication_context in ('standard','recovery'))
);
do $lease_shape$ begin
 if exists(select 1 from pg_attribute e left join pg_attribute a on a.attrelid='public.application_sessions'::regclass and a.attname=e.attname and a.attnum>0 and not a.attisdropped where e.attrelid='pg_temp.rf_expected_session_lease'::regclass and e.attnum>0 and not e.attisdropped and (a.attname is null or a.atttypid<>e.atttypid or a.attnotnull<>e.attnotnull)) then raise exception 'RF_INCOMPATIBLE_SESSION_LEASE_COLUMNS'; end if;
 if exists(select 1 from pg_constraint e where e.conrelid='pg_temp.rf_expected_session_lease'::regclass and e.contype='c' and not exists(select 1 from pg_constraint a where a.conrelid='public.application_sessions'::regclass and a.conname=e.conname and a.convalidated and pg_get_constraintdef(a.oid)=pg_get_constraintdef(e.oid))) then raise exception 'RF_INCOMPATIBLE_SESSION_LEASE_CHECKS'; end if;
end; $lease_shape$;
drop table pg_temp.rf_expected_session_lease;

create index if not exists application_sessions_refresh_lease_idx
  on public.application_sessions(refresh_locked_until)
  where refresh_locked_until is not null and revoked_at is null;

do $function_install$
declare
  p pg_proc%rowtype;
  installed_body text;
  -- Only reviewed constants are converted; installed SQL retains internal characters.
  approved_target_lf text:=btrim(replace($expected$
declare
  claimed_id uuid;
begin
  if p_session_key_hash !~ '^[0-9a-f]{64}$'
    or p_lock_hash !~ '^[0-9a-f]{64}$'
    or p_lease_seconds < 5
    or p_lease_seconds > 120 then
    return false;
  end if;

  update public.application_sessions
  set refresh_lock_hash = p_lock_hash,
      refresh_locked_until = p_now + make_interval(secs => p_lease_seconds)
  where session_key_hash = p_session_key_hash
    and revoked_at is null
    and idle_expires_at > p_now
    and absolute_expires_at > p_now
    and (refresh_locked_until is null or refresh_locked_until <= p_now)
  returning id into claimed_id;

  return claimed_id is not null;
end;
$expected$,E'\r\n',E'\n'),E' \t\r\n');
  approved_source_lf text:=btrim(replace($verified_source$
declare
  claimed_id uuid;
begin
  if p_session_key_hash !~ '^[0-9a-f]{64}$'
    or p_lock_hash !~ '^[0-9a-f]{64}$'
    or p_lease_seconds < 5
    or p_lease_seconds > 120 then
    return false;
  end if;

  update public.application_sessions
  set
    refresh_lock_hash = p_lock_hash,
    refresh_locked_until =
      p_now + make_interval(secs => p_lease_seconds)
  where session_key_hash = p_session_key_hash
    and revoked_at is null
    and idle_expires_at > p_now
    and absolute_expires_at > p_now
    and (
      refresh_locked_until is null
      or refresh_locked_until <= p_now
    )
  returning id into claimed_id;

  return claimed_id is not null;
end;
$verified_source$,E'\r\n',E'\n'),E' \t\r\n');
begin
  select * into p from pg_proc where oid=to_regprocedure('public.claim_application_session_refresh(text,text,timestamptz,integer)');
  if found then
    if p.prosecdef is distinct from true or p.proconfig is distinct from array['search_path=""']::text[]
      or p.prorettype<>'boolean'::regtype or p.prolang not in (select oid from pg_language where lanname in ('sql','plpgsql'))
      or p.provolatile<>'v' then raise exception 'RF_INCOMPATIBLE_FUNCTION: claim_application_session_refresh'; end if;
    installed_body:=btrim(p.prosrc,E' \t\r\n');
    if installed_body in (approved_target_lf,replace(approved_target_lf,E'\n',E'\r\n')) then return; end if;
    if installed_body not in (approved_source_lf,replace(approved_source_lf,E'\n',E'\r\n')) then
      raise exception 'RF_INCOMPATIBLE_FUNCTION: claim_application_session_refresh';
    end if;
  end if;
  execute $ddl$create or replace function public.claim_application_session_refresh(
  p_session_key_hash text,
  p_lock_hash text,
  p_now timestamptz,
  p_lease_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_id uuid;
begin
  if p_session_key_hash !~ '^[0-9a-f]{64}$'
    or p_lock_hash !~ '^[0-9a-f]{64}$'
    or p_lease_seconds < 5
    or p_lease_seconds > 120 then
    return false;
  end if;

  update public.application_sessions
  set refresh_lock_hash = p_lock_hash,
      refresh_locked_until = p_now + make_interval(secs => p_lease_seconds)
  where session_key_hash = p_session_key_hash
    and revoked_at is null
    and idle_expires_at > p_now
    and absolute_expires_at > p_now
    and (refresh_locked_until is null or refresh_locked_until <= p_now)
  returning id into claimed_id;

  return claimed_id is not null;
end;
$$;$ddl$;
end;
$function_install$;

do $function_install$
declare
  p pg_proc%rowtype;
  installed_body text;
  -- Only reviewed constants are converted; installed SQL retains internal characters.
  approved_target_lf text:=btrim(replace($expected$
declare
  released_id uuid;
begin
  update public.application_sessions
  set refresh_lock_hash = null,
      refresh_locked_until = null
  where session_key_hash = p_session_key_hash
    and refresh_lock_hash = p_lock_hash
  returning id into released_id;

  return released_id is not null;
end;
$expected$,E'\r\n',E'\n'),E' \t\r\n');
  approved_source_lf text:=btrim(replace($verified_source$
declare
  released_id uuid;
begin
  update public.application_sessions
  set
    refresh_lock_hash = null,
    refresh_locked_until = null
  where session_key_hash = p_session_key_hash
    and refresh_lock_hash = p_lock_hash
  returning id into released_id;

  return released_id is not null;
end;
$verified_source$,E'\r\n',E'\n'),E' \t\r\n');
begin
  select * into p from pg_proc where oid=to_regprocedure('public.release_application_session_refresh(text,text)');
  if found then
    if p.prosecdef is distinct from true or p.proconfig is distinct from array['search_path=""']::text[]
      or p.prorettype<>'boolean'::regtype or p.prolang not in (select oid from pg_language where lanname in ('sql','plpgsql'))
      or p.provolatile<>'v' then raise exception 'RF_INCOMPATIBLE_FUNCTION: release_application_session_refresh'; end if;
    installed_body:=btrim(p.prosrc,E' \t\r\n');
    if installed_body in (approved_target_lf,replace(approved_target_lf,E'\n',E'\r\n')) then return; end if;
    if installed_body not in (approved_source_lf,replace(approved_source_lf,E'\n',E'\r\n')) then
      raise exception 'RF_INCOMPATIBLE_FUNCTION: release_application_session_refresh';
    end if;
  end if;
  execute $ddl$create or replace function public.release_application_session_refresh(
  p_session_key_hash text,
  p_lock_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  released_id uuid;
begin
  update public.application_sessions
  set refresh_lock_hash = null,
      refresh_locked_until = null
  where session_key_hash = p_session_key_hash
    and refresh_lock_hash = p_lock_hash
  returning id into released_id;

  return released_id is not null;
end;
$$;$ddl$;
end;
$function_install$;

revoke all on function public.claim_application_session_refresh(text, text, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.release_application_session_refresh(text, text)
  from public, anon, authenticated;
grant execute on function public.claim_application_session_refresh(text, text, timestamptz, integer)
  to service_role;
grant execute on function public.release_application_session_refresh(text, text)
  to service_role;

-- Migration 003 used a generic session trigger that also audited last-seen and
-- refresh-lease maintenance. Keep immutable security events, not heartbeat noise.
do $function_install$
declare
  p pg_proc%rowtype;
  installed_body text;
  -- Only reviewed constants are converted; installed SQL retains internal characters.
  approved_target_lf text:=btrim(replace($expected$
declare
  event_action text;
begin
  if tg_op = 'INSERT' then
    event_action := 'session.created';
  elsif new.revoked_at is not null and old.revoked_at is null then
    event_action := 'session.revoked';
  else
    return new;
  end if;

  insert into public.admin_audit_logs (
    admin_id, action, resource, resource_id, metadata
  ) values (
    coalesce(auth.uid(), new.revoked_by),
    event_action,
    'application_sessions',
    new.id::text,
    jsonb_build_object('operation', tg_op)
  );
  return new;
end;
$expected$,E'\r\n',E'\n'),E' \t\r\n');
  approved_source_lf text:=btrim(replace($verified_source$
declare
  event_action text;
begin
  if tg_op = 'INSERT' then
    event_action := 'session.created';

  elsif new.revoked_at is not null
    and old.revoked_at is null then

    event_action := 'session.revoked';

  else
    return new;
  end if;

  insert into public.admin_audit_logs (
    admin_id,
    action,
    resource,
    resource_id,
    metadata
  )
  values (
    coalesce(auth.uid(), new.revoked_by),
    event_action,
    'application_sessions',
    new.id::text,
    jsonb_build_object('operation', tg_op)
  );

  return new;
end;
$verified_source$,E'\r\n',E'\n'),E' \t\r\n');
begin
  select * into p from pg_proc where oid=to_regprocedure('public.write_application_session_security_audit()');
  if found then
    if p.prosecdef is distinct from true or p.proconfig is distinct from array['search_path=""']::text[]
      or p.prorettype<>'trigger'::regtype or p.prolang not in (select oid from pg_language where lanname in ('sql','plpgsql'))
      or p.provolatile<>'v' then raise exception 'RF_INCOMPATIBLE_FUNCTION: write_application_session_security_audit'; end if;
    installed_body:=btrim(p.prosrc,E' \t\r\n');
    if installed_body in (approved_target_lf,replace(approved_target_lf,E'\n',E'\r\n')) then return; end if;
    if installed_body not in (approved_source_lf,replace(approved_source_lf,E'\n',E'\r\n')) then
      raise exception 'RF_INCOMPATIBLE_FUNCTION: write_application_session_security_audit';
    end if;
  end if;
  execute $ddl$create or replace function public.write_application_session_security_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_action text;
begin
  if tg_op = 'INSERT' then
    event_action := 'session.created';
  elsif new.revoked_at is not null and old.revoked_at is null then
    event_action := 'session.revoked';
  else
    return new;
  end if;

  insert into public.admin_audit_logs (
    admin_id, action, resource, resource_id, metadata
  ) values (
    coalesce(auth.uid(), new.revoked_by),
    event_action,
    'application_sessions',
    new.id::text,
    jsonb_build_object('operation', tg_op)
  );
  return new;
end;
$$;$ddl$;
end;
$function_install$;

revoke all on function public.write_application_session_security_audit()
  from public, anon, authenticated;
do $trigger_check$ declare t pg_trigger%rowtype; begin
 select * into t from pg_trigger where tgrelid='public.application_sessions'::regclass and tgname='application_sessions_security_audit' and not tgisinternal;
 if found and (t.tgfoid<>'public.write_application_session_security_audit()'::regprocedure or t.tgtype<>21 or t.tgenabled<>'O' or t.tgqual is not null or t.tgnargs<>0) then raise exception 'RF_INCOMPATIBLE_TRIGGER: application_sessions_security_audit'; end if;
end; $trigger_check$;
drop trigger if exists application_sessions_security_audit on public.application_sessions;
create trigger application_sessions_security_audit
after insert or update on public.application_sessions
for each row execute function public.write_application_session_security_audit();
do $old_guard$
declare
  -- Convert reviewed constants only; preserve all internal installed SQL characters.
  approved_known0_lf text:=btrim(replace($known0$
begin
  if auth.uid() = old.id and not public.has_permission('customers.manage') then
    new.id := old.id;
    new.status := old.status;
    new.email := old.email;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$known0$,E'\r\n',E'\n'),E' \t\r\n');
  approved_known1_lf text:=btrim(replace($known1$
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
$known1$,E'\r\n',E'\n'),E' \t\r\n');
begin
if exists(select 1 from pg_trigger where tgrelid='public.profiles'::regclass and tgname='profiles_protect_restricted_fields') then
  if not exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='public.profiles'::regclass and t.tgname='profiles_protect_restricted_fields' and (btrim(p.prosrc,E' \t\r\n') in (
    approved_known0_lf,replace(approved_known0_lf,E'\n',E'\r\n'),
    approved_known1_lf,replace(approved_known1_lf,E'\n',E'\r\n')
  ) or p.proname='protect_profile_identity_fields')) then raise exception 'RF_UNEXPECTED_EXISTING_GUARD: profiles_protect_restricted_fields'; end if;
  execute 'drop trigger profiles_protect_restricted_fields on public.profiles';
end if; end; $old_guard$;
do $old_guard$ begin
if exists(select 1 from pg_trigger where tgrelid='public.user_roles'::regclass and tgname='user_roles_protect_owner') then
  if not exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='public.user_roles'::regclass and t.tgname='user_roles_protect_owner' and (btrim(replace(p.prosrc,chr(13),''))=btrim($known0$
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
$known0$))) then raise exception 'RF_UNEXPECTED_EXISTING_GUARD: user_roles_protect_owner'; end if;
  execute 'drop trigger user_roles_protect_owner on public.user_roles';
end if; end; $old_guard$;
do $old_guard$ begin
if exists(select 1 from pg_trigger where tgrelid='public.roles'::regclass and tgname='roles_protect_owner') then
  if not exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='public.roles'::regclass and t.tgname='roles_protect_owner' and (btrim(replace(p.prosrc,chr(13),''))=btrim($known0$
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
$known0$))) then raise exception 'RF_UNEXPECTED_EXISTING_GUARD: roles_protect_owner'; end if;
  execute 'drop trigger roles_protect_owner on public.roles';
end if; end; $old_guard$;
do $old_guard$ begin
if exists(select 1 from pg_trigger where tgrelid='public.role_permissions'::regclass and tgname='role_permissions_protect_owner_bundle') then
  if not exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='public.role_permissions'::regclass and t.tgname='role_permissions_protect_owner_bundle' and (btrim(replace(p.prosrc,chr(13),''))=btrim($known0$
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
$known0$))) then raise exception 'RF_UNEXPECTED_EXISTING_GUARD: role_permissions_protect_owner_bundle'; end if;
  execute 'drop trigger role_permissions_protect_owner_bundle on public.role_permissions';
end if; end; $old_guard$;
do $old_guard$ begin
if exists(select 1 from pg_trigger where tgrelid='public.permissions'::regclass and tgname='permissions_protect_owner_wildcard') then
  if not exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='public.permissions'::regclass and t.tgname='permissions_protect_owner_wildcard' and (btrim(replace(p.prosrc,chr(13),''))=btrim($known0$
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
$known0$))) then raise exception 'RF_UNEXPECTED_EXISTING_GUARD: permissions_protect_owner_wildcard'; end if;
  execute 'drop trigger permissions_protect_owner_wildcard on public.permissions';
end if; end; $old_guard$;-- Protected transitions and immutable security audit -------------------------




do $trigger_check$ declare t pg_trigger%rowtype; begin
 select * into t from pg_trigger where tgrelid='public.profiles'::regclass and tgname='profiles_protect_restricted_fields' and not tgisinternal;
 if found and (t.tgfoid<>'public.protect_profile_identity_fields()'::regprocedure or t.tgtype not in (19,27) or t.tgenabled<>'O' or t.tgqual is not null or t.tgnargs<>0) then raise exception 'RF_INCOMPATIBLE_TRIGGER: profiles_protect_restricted_fields'; end if;
end; $trigger_check$;
drop trigger if exists profiles_protect_restricted_fields on public.profiles;
create trigger profiles_protect_restricted_fields
before update or delete on public.profiles
for each row execute function public.protect_profile_identity_fields();




do $trigger_check$ declare t pg_trigger%rowtype; begin
 select * into t from pg_trigger where tgrelid='public.user_roles'::regclass and tgname='user_roles_protect_admin' and not tgisinternal;
 if found and (t.tgfoid<>'public.protect_admin_role_assignment()'::regprocedure or t.tgtype<>31 or t.tgenabled<>'O' or t.tgqual is not null or t.tgnargs<>0) then raise exception 'RF_INCOMPATIBLE_TRIGGER: user_roles_protect_admin'; end if;
end; $trigger_check$;
drop trigger if exists user_roles_protect_admin on public.user_roles;
create trigger user_roles_protect_admin
before insert or update or delete on public.user_roles
for each row execute function public.protect_admin_role_assignment();




do $trigger_check$ declare t pg_trigger%rowtype; begin
 select * into t from pg_trigger where tgrelid='public.roles'::regclass and tgname='roles_protect_admin' and not tgisinternal;
 if found and (t.tgfoid<>'public.protect_admin_role_definition()'::regprocedure or t.tgtype<>27 or t.tgenabled<>'O' or t.tgqual is not null or t.tgnargs<>0) then raise exception 'RF_INCOMPATIBLE_TRIGGER: roles_protect_admin'; end if;
end; $trigger_check$;
drop trigger if exists roles_protect_admin on public.roles;
create trigger roles_protect_admin
before update or delete on public.roles
for each row execute function public.protect_admin_role_definition();




do $trigger_check$ declare t pg_trigger%rowtype; begin
 select * into t from pg_trigger where tgrelid='public.role_permissions'::regclass and tgname='role_permissions_protect_admin_bundle' and not tgisinternal;
 if found and (t.tgfoid<>'public.protect_admin_permission_bundle()'::regprocedure or t.tgtype<>27 or t.tgenabled<>'O' or t.tgqual is not null or t.tgnargs<>0) then raise exception 'RF_INCOMPATIBLE_TRIGGER: role_permissions_protect_admin_bundle'; end if;
end; $trigger_check$;
drop trigger if exists role_permissions_protect_admin_bundle on public.role_permissions;
create trigger role_permissions_protect_admin_bundle
before update or delete on public.role_permissions
for each row execute function public.protect_admin_permission_bundle();
do $trigger_check$ declare t pg_trigger%rowtype; begin
 select * into t from pg_trigger where tgrelid='public.permissions'::regclass and tgname='permissions_protect_admin_wildcard' and not tgisinternal;
 if found and (t.tgfoid<>'public.protect_admin_permission_bundle()'::regprocedure or t.tgtype<>27 or t.tgenabled<>'O' or t.tgqual is not null or t.tgnargs<>0) then raise exception 'RF_INCOMPATIBLE_TRIGGER: permissions_protect_admin_wildcard'; end if;
end; $trigger_check$;
drop trigger if exists permissions_protect_admin_wildcard on public.permissions;
create trigger permissions_protect_admin_wildcard
before update or delete on public.permissions
for each row execute function public.protect_admin_permission_bundle();




do $trigger_check$ declare t pg_trigger%rowtype; begin
 select * into t from pg_trigger where tgrelid='public.auth_bootstrap_state'::regclass and tgname='auth_bootstrap_state_immutable' and not tgisinternal;
 if found and (t.tgfoid<>'public.protect_auth_bootstrap_state()'::regprocedure or t.tgtype<>27 or t.tgenabled<>'O' or t.tgqual is not null or t.tgnargs<>0) then raise exception 'RF_INCOMPATIBLE_TRIGGER: auth_bootstrap_state_immutable'; end if;
end; $trigger_check$;
drop trigger if exists auth_bootstrap_state_immutable on public.auth_bootstrap_state;
create trigger auth_bootstrap_state_immutable
before update or delete on public.auth_bootstrap_state
for each row execute function public.protect_auth_bootstrap_state();









do $guest_guard$ declare
 p pg_proc%rowtype;
 -- Convert only the reviewed body constant; preserve internal installed characters.
 approved_expected_lf text:=btrim(replace($expected$
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
$expected$,E'\r\n',E'\n'),E' \t\r\n');
begin
 select * into p from pg_proc where oid=to_regprocedure('public.protect_guest_order_claim()');
 if found and (btrim(p.prosrc,E' \t\r\n') not in (approved_expected_lf,replace(approved_expected_lf,E'\n',E'\r\n')) or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[]) then raise exception 'RF_INCOMPATIBLE_GUEST_GUARD'; end if;
 execute $ddl$create or replace function public.protect_guest_order_claim()
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
$$;$ddl$;
end; $guest_guard$;

do $trigger_check$ declare t pg_trigger%rowtype; begin
 select * into t from pg_trigger where tgrelid='public.guest_order_claims'::regclass and tgname='guest_order_claims_protect' and not tgisinternal;
 if found and (t.tgfoid<>'public.protect_guest_order_claim()'::regprocedure or t.tgtype<>19 or t.tgenabled<>'O' or t.tgqual is not null or t.tgnargs<>0) then raise exception 'RF_INCOMPATIBLE_TRIGGER: guest_order_claims_protect'; end if;
end; $trigger_check$;
drop trigger if exists guest_order_claims_protect on public.guest_order_claims;
create trigger guest_order_claims_protect
before update on public.guest_order_claims
for each row execute function public.protect_guest_order_claim();





do $trigger_check$ declare t pg_trigger%rowtype; begin
 select * into t from pg_trigger where tgrelid='public.user_roles'::regclass and tgname='user_roles_security_audit' and not tgisinternal;
 if found and (t.tgfoid<>'public.write_auth_security_audit()'::regprocedure or t.tgtype<>29 or t.tgenabled<>'O' or t.tgqual is not null or t.tgnargs<>0) then raise exception 'RF_INCOMPATIBLE_TRIGGER: user_roles_security_audit'; end if;
end; $trigger_check$;
drop trigger if exists user_roles_security_audit on public.user_roles;
create trigger user_roles_security_audit
 after insert or update or delete on public.user_roles
for each row execute function public.write_auth_security_audit();


do $trigger_check$ declare t pg_trigger%rowtype; begin
 select * into t from pg_trigger where tgrelid='public.guest_order_claims'::regclass and tgname='guest_order_claims_security_audit' and not tgisinternal;
 if found and (t.tgfoid<>'public.write_auth_security_audit()'::regprocedure or t.tgtype<>17 or t.tgenabled<>'O' or t.tgqual is not null or t.tgnargs<>0) then raise exception 'RF_INCOMPATIBLE_TRIGGER: guest_order_claims_security_audit'; end if;
end; $trigger_check$;
drop trigger if exists guest_order_claims_security_audit on public.guest_order_claims;
create trigger guest_order_claims_security_audit
 after update on public.guest_order_claims
for each row execute function public.write_auth_security_audit();




do $trigger_check$ declare t pg_trigger%rowtype; begin
 select * into t from pg_trigger where tgrelid='public.application_sessions'::regclass and tgname='application_sessions_prevent_delete' and not tgisinternal;
 if found and (t.tgfoid<>'public.require_session_revocation()'::regprocedure or t.tgtype<>11 or t.tgenabled<>'O' or t.tgqual is not null or t.tgnargs<>0) then raise exception 'RF_INCOMPATIBLE_TRIGGER: application_sessions_prevent_delete'; end if;
end; $trigger_check$;
drop trigger if exists application_sessions_prevent_delete on public.application_sessions;
create trigger application_sessions_prevent_delete
before delete on public.application_sessions
for each row execute function public.require_session_revocation();




do $trigger_check$ declare t pg_trigger%rowtype; begin
 select * into t from pg_trigger where tgrelid='public.admin_audit_logs'::regclass and tgname='admin_audit_logs_immutable' and not tgisinternal;
 if found and (t.tgfoid<>'public.protect_admin_audit_log()'::regprocedure or t.tgtype<>27 or t.tgenabled<>'O' or t.tgqual is not null or t.tgnargs<>0) then raise exception 'RF_INCOMPATIBLE_TRIGGER: admin_audit_logs_immutable'; end if;
end; $trigger_check$;
drop trigger if exists admin_audit_logs_immutable on public.admin_audit_logs;
create trigger admin_audit_logs_immutable
before update or delete on public.admin_audit_logs
for each row execute function public.protect_admin_audit_log();




do $assignment$ declare approved uuid:=current_setting('royal_fusion.approved_admin_uuid')::uuid; begin
  insert into public.user_roles(user_id,role_id,active,assigned_by) select approved,id,true,approved from public.roles where key='admin' on conflict(user_id,role_id) do nothing;
  if not exists(select 1 from public.auth_bootstrap_state where id='first_admin' and completed_by=approved) then raise exception 'RF_ADMIN_BOOTSTRAP_FAILED'; end if;
  if not exists(select 1 from public.admin_audit_logs where action='authorization.expanded' and resource_id=approved::text and metadata->>'transition'='single_admin_v1') then
    insert into public.admin_audit_logs(admin_id,action,resource,resource_id,permission_key,metadata) values(approved,'authorization.expanded','user_role',approved::text,'access.manage',jsonb_build_object('transition','single_admin_v1','legacyRetained',true));
  end if;
end; $assignment$;
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

-- Transitional legacy RBAC read policy retained: rf_roles_admin
-- Transitional legacy RBAC read policy retained: rf_permissions_admin
-- Transitional legacy RBAC read policy retained: rf_role_permissions_admin
-- Transitional legacy RBAC read policy retained: rf_user_roles_admin
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
drop policy if exists rf_order_notes_read on public.order_notes;
create policy rf_order_notes_read on public.order_notes for select to authenticated
using (exists (
  select 1 from public.orders orders
  where orders.id = order_notes.order_id
    and (
      public.has_permission('orders.read')
      or (orders.customer_id = auth.uid() and order_notes.is_customer_visible)
    )
));

-- Transitional legacy RBAC read policy retained: rf_legacy_memberships_owner


alter table public.auth_bootstrap_state enable row level security;
alter table public.application_sessions enable row level security;
alter table public.guest_order_claims enable row level security;
revoke all on public.auth_bootstrap_state,public.application_sessions,public.guest_order_claims from anon,authenticated;
grant all on public.auth_bootstrap_state,public.application_sessions,public.guest_order_claims to service_role;
revoke insert,update,delete on public.roles,public.permissions,public.role_permissions,public.user_roles,public.admin_memberships,
 public.orders,public.order_items,public.payments,public.inventory_movements,public.order_status_history,public.order_notes,public.admin_audit_logs from anon,authenticated;
revoke all on function public.protect_profile_identity_fields() from public,anon,authenticated;
revoke all on function public.protect_admin_role_assignment() from public,anon,authenticated;
revoke all on function public.protect_admin_role_definition() from public,anon,authenticated;
revoke all on function public.protect_admin_permission_bundle() from public,anon,authenticated;
revoke all on function public.protect_auth_bootstrap_state() from public,anon,authenticated;
revoke all on function public.write_auth_security_audit() from public,anon,authenticated;
revoke all on function public.require_session_revocation() from public,anon,authenticated;
revoke all on function public.protect_admin_audit_log() from public,anon,authenticated;
revoke all on function public.protect_guest_order_claim() from public,anon,authenticated;
revoke all on function public.has_permission(text) from public,anon;
grant execute on function public.has_permission(text) to authenticated,service_role;
commit;
