-- RELEASE ONLY: AFTER deployed canonical admin and customer-session verification.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table public.roles,public.user_roles,public.role_permissions,public.profiles,
 public.auth_bootstrap_state,public.admin_audit_logs in share row exclusive mode;
do $retire$
declare approved uuid; evidence text:=current_setting('royal_fusion.canonical_verification_reference',true);
begin
 if coalesce(current_setting('royal_fusion.approved_admin_uuid',true),'') !~
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'RF_APPROVED_ADMIN_REQUIRED'; end if;
 approved:=current_setting('royal_fusion.approved_admin_uuid')::uuid;
 if current_setting('royal_fusion.canonical_login_verified_for',true) is distinct from approved::text
  or evidence is null or length(btrim(evidence)) not between 8 and 160 then raise exception 'RF_CANONICAL_VERIFICATION_REQUIRED'; end if;
 if not exists(select 1 from public.profiles pr join public.user_roles ur on ur.user_id=pr.id
   join public.roles r on r.id=ur.role_id join public.role_permissions rp on rp.role_id=r.id
   join public.permissions pe on pe.id=rp.permission_id
   where pr.id=approved and pr.status='Active' and ur.active and r.active and r.key='admin' and pe.key='*') then
  raise exception 'RF_CANONICAL_ADMIN_REQUIRED'; end if;
 if not exists(select 1 from public.auth_bootstrap_state where id='first_admin' and completed_by=approved)
  or not exists(select 1 from public.admin_audit_logs where action='authorization.expanded'
    and resource_id=approved::text and metadata->>'transition'='single_admin_v1') then raise exception 'RF_TRANSITION_EVIDENCE_REQUIRED'; end if;
 if exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.active
  and r.key in ('owner_admin','shop_manager','order_manager','content_editor','blog_writer','owner','manager')
  and (ur.user_id<>approved or r.key<>'owner_admin')) then raise exception 'RF_UNEXPECTED_LEGACY_ASSIGNMENT'; end if;
 update public.user_roles ur set active=false,updated_at=now() from public.roles r
  where ur.role_id=r.id and ur.user_id=approved and r.key='owner_admin' and ur.active;
 update public.roles set active=false,updated_at=now()
  where key in ('owner_admin','shop_manager','order_manager','content_editor','blog_writer','owner','manager') and active;
 delete from public.role_permissions rp using public.roles r
  where rp.role_id=r.id and r.key in ('owner_admin','shop_manager','order_manager','content_editor','blog_writer','owner','manager');
 if not exists(select 1 from public.admin_audit_logs where action='authorization.retired'
   and resource_id=approved::text and metadata->>'transition'='single_admin_v1') then
  insert into public.admin_audit_logs(admin_id,action,resource,resource_id,permission_key,metadata)
   values(approved,'authorization.retired','user_role',approved::text,'access.manage',
    jsonb_build_object('transition','single_admin_v1','verificationReference',btrim(evidence)));
 end if;
end;
$retire$;
drop policy if exists rf_roles_admin on public.roles;
drop policy if exists rf_permissions_admin on public.permissions;
drop policy if exists rf_role_permissions_admin on public.role_permissions;
drop policy if exists rf_user_roles_admin on public.user_roles;
drop policy if exists rf_legacy_memberships_owner on public.admin_memberships;
revoke select on public.roles,public.permissions,public.role_permissions,public.user_roles,
 public.admin_memberships from anon,authenticated;
commit;
