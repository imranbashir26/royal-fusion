-- Atomic refresh leasing and focused application-session auditing.
-- This additive correction supports backend cookie-session rotation without
-- storing access tokens, refresh tokens, or cookie values.

begin;

do $$
begin
  if to_regclass('public.application_sessions') is null
    or to_regclass('public.admin_audit_logs') is null
    or to_regprocedure('public.write_auth_security_audit()') is null then
    raise exception 'Migration 004 requires migration 003 authentication tables.';
  end if;
end $$;

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

create index if not exists application_sessions_refresh_lease_idx
  on public.application_sessions(refresh_locked_until)
  where refresh_locked_until is not null and revoked_at is null;

create or replace function public.claim_application_session_refresh(
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
$$;

create or replace function public.release_application_session_refresh(
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
$$;

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
create or replace function public.write_application_session_security_audit()
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
$$;

revoke all on function public.write_application_session_security_audit()
  from public, anon, authenticated;
drop trigger if exists application_sessions_security_audit on public.application_sessions;
create trigger application_sessions_security_audit
after insert or update on public.application_sessions
for each row execute function public.write_application_session_security_audit();

commit;
