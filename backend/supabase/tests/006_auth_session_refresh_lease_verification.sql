-- LOCAL OR DISPOSABLE STAGING ONLY.
-- Apply migrations 001 through 004 first. This test rolls back all fixtures.

begin;

do $$
begin
  if to_regprocedure(
    'public.claim_application_session_refresh(text,text,timestamptz,integer)'
  ) is null then
    raise exception 'Refresh claim function is missing.';
  end if;
  if to_regprocedure(
    'public.release_application_session_refresh(text,text)'
  ) is null then
    raise exception 'Refresh release function is missing.';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.claim_application_session_refresh(text,text,timestamptz,integer)',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.release_application_session_refresh(text,text)',
    'execute'
  ) then
    raise exception 'Browser role can execute a refresh lease function.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'application_sessions'
      and column_name = 'authentication_context'
  ) then
    raise exception 'Authentication session context is missing.';
  end if;
end $$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values (
  '99000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'session-test@example.invalid',
  crypt('SessionTestOnly!', gen_salt('bf')), now(), '{}'::jsonb,
  '{"full_name":"Session Test"}'::jsonb, now(), now(), '', '', '', ''
)
on conflict (id) do nothing;

insert into public.application_sessions (
  id, user_id, session_class, idle_expires_at, absolute_expires_at,
  mfa_assurance, session_key_hash
) values (
  '99100000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000001',
  'customer', now() + interval '7 days', now() + interval '30 days',
  'aal1', repeat('a', 64)
);

do $$
begin
  if not public.claim_application_session_refresh(
    repeat('a', 64), repeat('b', 64), now(), 30
  ) then
    raise exception 'First refresh lease was not acquired.';
  end if;
  if public.claim_application_session_refresh(
    repeat('a', 64), repeat('c', 64), now(), 30
  ) then
    raise exception 'Concurrent refresh lease was acquired.';
  end if;
  if public.release_application_session_refresh(
    repeat('a', 64), repeat('c', 64)
  ) then
    raise exception 'Refresh lease was released with the wrong owner hash.';
  end if;
  if not public.release_application_session_refresh(
    repeat('a', 64), repeat('b', 64)
  ) then
    raise exception 'Refresh lease was not released.';
  end if;
end $$;

update public.application_sessions
set last_seen_at = now() + interval '1 minute',
    idle_expires_at = now() + interval '7 days'
where id = '99100000-0000-4000-8000-000000000001';

do $$
begin
  if (
    select count(*) from public.admin_audit_logs
    where resource = 'application_sessions'
      and resource_id = '99100000-0000-4000-8000-000000000001'
  ) <> 1 then
    raise exception 'Session heartbeat created noisy audit events.';
  end if;
end $$;

update public.application_sessions
set revoked_at = now(),
    revoked_by = '99000000-0000-4000-8000-000000000001',
    revocation_reason = 'Fictional verification'
where id = '99100000-0000-4000-8000-000000000001';

do $$
begin
  if (
    select count(*) from public.admin_audit_logs
    where resource = 'application_sessions'
      and resource_id = '99100000-0000-4000-8000-000000000001'
  ) <> 2 then
    raise exception 'Session revocation audit event is missing.';
  end if;
end $$;

rollback;
