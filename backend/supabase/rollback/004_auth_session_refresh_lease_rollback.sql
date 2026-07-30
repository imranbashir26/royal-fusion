-- GUARDED ROLLBACK FOR MIGRATION 004.
-- Use only before backend cookie-session traffic is enabled.

begin;

do $$
begin
  if exists (select 1 from public.application_sessions) then
    raise exception 'Migration 004 rollback refused: application session history exists; use a forward fix.';
  end if;
end $$;

drop trigger if exists application_sessions_security_audit on public.application_sessions;
drop function if exists public.write_application_session_security_audit();
drop function if exists public.claim_application_session_refresh(text, text, timestamptz, integer);
drop function if exists public.release_application_session_refresh(text, text);

-- Restore migration 003 behavior only for a pre-use rollback. A forward fix is
-- preferred once session activity exists because heartbeat audit volume returns.
create trigger application_sessions_security_audit
after insert or update on public.application_sessions
for each row execute function public.write_auth_security_audit();

drop index if exists public.application_sessions_refresh_lease_idx;
alter table public.application_sessions
  drop constraint if exists application_sessions_refresh_lock_check,
  drop constraint if exists application_sessions_auth_context_check,
  drop column if exists authentication_context,
  drop column if exists refresh_locked_until,
  drop column if exists refresh_lock_hash;

commit;
