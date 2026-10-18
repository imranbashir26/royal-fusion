-- Release 008: durable, server-issued V1 checkout attempts. Local only.
-- One-shot exact post-007 PG17 predecessor, read committed; maintenance writes quiesced.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
set local search_path=pg_catalog,public;
do $pre$
declare shape text; acl jsonb;
begin
 if current_user <> 'postgres' or current_setting('server_version_num')::int not between 170000 and 179999
 or current_setting('transaction_isolation') <> 'read committed' then raise exception 'RF_RELEASE008_EXECUTION_CONTEXT'; end if;
 if not ((select count(*)=5 from pg_roles where rolname in
 ('postgres','anon','authenticated','service_role','supabase_admin'))
 and not exists(select 1 from pg_roles where rolname in ('anon','authenticated')
 and (rolsuper or rolcreaterole or rolcreatedb or rolbypassrls))
 and not exists(select 1 from pg_roles b cross join pg_roles r
 where b.rolname in ('anon','authenticated') and b.oid<>r.oid
 and (r.rolname in ('postgres','service_role','supabase_admin','pg_maintain') or r.rolsuper or r.rolcreaterole or r.rolbypassrls)
 and (pg_has_role(b.oid,r.oid,'USAGE') or pg_has_role(b.oid,r.oid,'SET')))) or not (exists(select 1 from pg_namespace n join pg_roles r on r.oid=n.nspowner
 where n.nspname='public' and r.rolname in ('postgres','pg_database_owner'))
 and exists(select 1 from pg_database d join pg_roles r on r.oid=d.datdba
 where d.datname=current_database() and r.rolname='postgres')) or not (not exists(select 1 from pg_default_acl where
 defaclrole=(select oid from pg_roles where rolname='postgres') and defaclnamespace=0 and defaclobjtype='r')) then raise exception 'RF_RELEASE008_SECURITY_DRIFT'; end if;
 perform pg_advisory_xact_lock(6008,14008);
 -- Variant-first, like checkout/admin. Failure to obtain these locks rolls back.
 lock table public.product_variants,public.products,public.orders in access exclusive mode;
 select encode(sha256(convert_to(jsonb_build_object(
 'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,r.rolname,
  (select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),
   (select jsonb_agg(
 jsonb_build_array(coalesce(grantor.rolname,'PUBLIC'),coalesce(grantee.rolname,'PUBLIC'),a.privilege_type,a.is_grantable)
 order by coalesce(grantee.rolname,'PUBLIC'),a.privilege_type,coalesce(grantor.rolname,'PUBLIC'),a.is_grantable)
 from aclexplode(a.attacl) a left join pg_roles grantor on grantor.oid=a.grantor
 left join pg_roles grantee on grantee.oid=a.grantee where not (false)),coalesce((select jsonb_agg(jsonb_build_array(
 k.convalidated,coalesce((to_jsonb(k)->>'conenforced')::boolean,true),k.condeferrable,k.condeferred,
 k.conislocal,k.coninhcount,k.connoinherit,cardinality(k.conkey),k.conparentid=0)
 order by k.convalidated,k.condeferrable,k.condeferred,k.conislocal,k.coninhcount,k.connoinherit,k.conname)
 from pg_constraint k where k.conrelid=c.oid and k.contype='n' and a.attnum=any(k.conkey)),
 case when a.attnotnull then jsonb_build_array(jsonb_build_array(true,true,false,false,a.attislocal,a.attinhcount,false,1,true)) end),
   (select jsonb_agg(jsonb_build_array(rr.rolname,priv.name,has_column_privilege(rr.oid,c.oid,a.attnum,priv.name)) order by rr.rolname,priv.name)
    from pg_roles rr cross join (values('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) priv(name) where rr.rolname in ('anon','authenticated','service_role')))
   order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  (select jsonb_agg(jsonb_build_array(x.conname,pg_get_constraintdef(x.oid,false),x.convalidated,
   coalesce((to_jsonb(x)->>'conenforced')::boolean,true),x.condeferrable,x.condeferred,x.conislocal,x.coninhcount,x.connoinherit)
   order by x.conname) from pg_constraint x where x.conrelid=c.oid and x.contype<>'n'),
  (select jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid,false),t.tgenabled) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
  (select jsonb_agg(jsonb_build_array(i.relname,pg_get_indexdef(i.oid)) order by i.relname) from pg_index ix join pg_class i on i.oid=ix.indexrelid where ix.indrelid=c.oid),
  (select jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid),(select jsonb_agg(rr.rolname order by rr.rolname) from unnest(p.polroles) pr(id) join pg_roles rr on rr.oid=pr.id)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
  (select jsonb_agg(
 jsonb_build_array(coalesce(grantor.rolname,'PUBLIC'),coalesce(grantee.rolname,'PUBLIC'),a.privilege_type,a.is_grantable)
 order by coalesce(grantee.rolname,'PUBLIC'),a.privilege_type,coalesce(grantor.rolname,'PUBLIC'),a.is_grantable)
 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a left join pg_roles grantor on grantor.oid=a.grantor
 left join pg_roles grantee on grantee.oid=a.grantee where not (c.relkind='v' and a.privilege_type='MAINTAIN' and not a.is_grantable
 and a.grantor=c.relowner and (a.grantee=c.relowner or grantee.rolname='service_role')
 and has_table_privilege(a.grantee,c.oid,'UPDATE,DELETE,TRUNCATE'))),
  (select jsonb_agg(jsonb_build_array(rr.rolname,
   case when c.relkind='v' and priv.name='MAINTAIN' then 'LOCK_ANY_MODE' else priv.name end,
   case when c.relkind='v' and priv.name='MAINTAIN' then has_table_privilege(rr.oid,c.oid,'MAINTAIN,UPDATE,DELETE,TRUNCATE')
    else has_table_privilege(rr.oid,c.oid,priv.name) end) order by rr.rolname,priv.name)
   from pg_roles rr cross join (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) priv(name)
   where rr.rolname in ('anon','authenticated','service_role'))) order by c.relname)
  from pg_class c join pg_roles r on r.oid=c.relowner where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v')
   and not exists(select 1 from pg_depend dep where dep.classid='pg_class'::regclass and dep.objid=c.oid and dep.deptype='e')),
 'functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),r.rolname,l.lanname,p.prosecdef,p.provolatile,p.proisstrict,p.proleakproof,p.proparallel,p.proconfig,
  replace(p.prosrc,E'\r\n',E'\n'),(select jsonb_agg(
 jsonb_build_array(coalesce(grantor.rolname,'PUBLIC'),coalesce(grantee.rolname,'PUBLIC'),a.privilege_type,a.is_grantable)
 order by coalesce(grantee.rolname,'PUBLIC'),a.privilege_type,coalesce(grantor.rolname,'PUBLIC'),a.is_grantable)
 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles grantor on grantor.oid=a.grantor
 left join pg_roles grantee on grantee.oid=a.grantee where not (false)),
  (select jsonb_agg(jsonb_build_array(rr.rolname,has_function_privilege(rr.oid,p.oid,'EXECUTE')) order by rr.rolname) from pg_roles rr where rr.rolname in ('anon','authenticated','service_role')))
  order by p.proname,pg_get_function_identity_arguments(p.oid))
  from pg_proc p join pg_roles r on r.oid=p.proowner join pg_language l on l.oid=p.prolang where p.pronamespace='public'::regnamespace and p.prokind='f'
   and not exists(select 1 from pg_depend dep where dep.classid='pg_proc'::regclass and dep.objid=p.oid and dep.deptype='e')),
 -- Event triggers are database-wide, including callbacks outside public. Pin every
 -- attachment so deleting, disabling, redirecting, or duplicating ensure_rls fails.
 'eventTriggers',(select jsonb_agg(jsonb_build_array(e.evtname,e.evtevent,r.rolname,e.evtenabled,
  n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),fr.rolname,p.prosecdef,p.proconfig,
  case when e.evttags is null then null else
   coalesce((select jsonb_agg(tag order by tag) from unnest(e.evttags) tag),'[]'::jsonb) end) order by e.evtname)
  from pg_event_trigger e join pg_roles r on r.oid=e.evtowner
  join pg_proc p on p.oid=e.evtfoid join pg_namespace n on n.oid=p.pronamespace
  join pg_roles fr on fr.oid=p.proowner)
 )::text,'UTF8')),'hex') into shape;
 if shape <> '6076eb77ec31ddf953f6207c193cbebe5afb4c2568592676d19da736e8460fcb' then raise exception 'RF_RELEASE008_BASELINE_DRIFT'; end if;
 select coalesce(jsonb_agg(jsonb_build_array(g.rolname,r.rolname,a.privilege_type,a.is_grantable)
 order by g.rolname,r.rolname,a.privilege_type,a.is_grantable),'[]'::jsonb) into acl
 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
 join pg_roles g on g.oid=a.grantor left join pg_roles r on r.oid=a.grantee
 where d.defaclrole=(select oid from pg_roles where rolname='postgres')
 and d.defaclnamespace=to_regnamespace('public') and d.defaclobjtype='r';
 if acl is distinct from (select jsonb_agg(jsonb_build_array('postgres',x.grantee,x.privilege,false)
 order by x.grantee,x.privilege) state from (
 select 'postgres' grantee,p.name privilege
 from (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(name)
 union all
 select r.name grantee,p.name privilege from unnest(array['service_role']) r(name)
 cross join (values('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(name)
 ) x) then raise exception 'RF_RELEASE008_RELEASE005_REQUIRED'; end if;
end;
$pre$;

-- The predecessor fingerprint covers exact function bodies, ACLs, RLS and schema.
create temporary table rf008_security on commit drop as select jsonb_build_object(
 'defaults',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d),
 'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p),
 'roles',(select jsonb_agg(to_jsonb(r) order by oid) from pg_roles r)) state;
create table public.checkout_v1_attempts (
 token text primary key check(token=public.checkout_v2_key(token)),
 credential text not null unique check(credential ~ '^[0-9a-f]{64}$'),
 customer_id uuid,
 quote_identity jsonb not null,
 price_fingerprint text not null check(price_fingerprint ~ '^[0-9a-f]{64}$'),
 request_identity jsonb,
 state text not null default 'active' check(state in ('active','retired','committed')),
 created_at timestamptz not null default clock_timestamp(),
 retired_at timestamptz,
 check((state='active' and request_identity is null and retired_at is null)
    or (state='retired' and request_identity is not null and retired_at is not null)
    or (state='committed' and request_identity is not null and retired_at is null))
);
alter table public.checkout_v1_attempts enable row level security;
-- Release 005 deliberately preserves some maintenance defaults. Remove them only
-- on this new private relation: nobody outside its postgres definer may access it.
revoke all on table public.checkout_v1_attempts from public,anon,authenticated,service_role,supabase_admin;
create function public.checkout_v1_attempt_guard_008() returns trigger language plpgsql set search_path='' as $fn$
begin
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'V1_ATTEMPT_IMMUTABLE'; end if;
 if current_user<>'postgres' then raise exception using errcode='42501',message='V1_ATTEMPT_PRIVATE'; end if;
 if tg_op='UPDATE' and (old.state<>'active' or new.state not in ('retired','committed')
  or (to_jsonb(old)-array['state','request_identity','retired_at']) is distinct from
     (to_jsonb(new)-array['state','request_identity','retired_at'])) then raise exception 'V1_ATTEMPT_IMMUTABLE'; end if;
 return new;
end; $fn$;
create trigger checkout_v1_attempt_immutable before update or delete on public.checkout_v1_attempts for each row execute function public.checkout_v1_attempt_guard_008();
create trigger checkout_v1_attempt_no_truncate before truncate on public.checkout_v1_attempts for each statement execute function public.checkout_v1_attempt_guard_008();
create function public.checkout_v1_quote_identity_008(p_items jsonb,p_email text,p_shipping jsonb,p_coupon text,p_customer uuid) returns jsonb language sql immutable set search_path='' as $fn$
 select jsonb_build_array(p_customer,lower(btrim(p_email)),btrim(p_shipping->>'city'),btrim(p_shipping->>'province'),upper(btrim(coalesce(p_coupon,''))),
  (select jsonb_agg(jsonb_build_array(id,quantity) order by id) from (
    select (x->>'variantId')::uuid id,sum((x->>'quantity')::integer) quantity from jsonb_array_elements(p_items) x group by (x->>'variantId')::uuid) grouped));
$fn$;
-- Validate the complete new-order contract before touching terminal state. Committed
-- historical replay intentionally continues through the preserved predecessor path.
create function public.checkout_v1_request_identity_008(p_items jsonb,p_contact jsonb,p_shipping jsonb,p_payment text,p_coupon text,p_method uuid,p_customer uuid,p_credential text) returns jsonb language plpgsql immutable set search_path='' as $fn$
declare item jsonb; identity jsonb;
begin
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100
  or not public.checkout_v2_keys(p_contact,array['name','email','phone'])
  or not public.checkout_v2_keys(p_shipping,array['address','city','province','notes'])
  or p_payment is null or p_payment not in ('Cash on Delivery','Bank Transfer')
  or p_credential is null or p_credential !~ '^[0-9a-f]{64}$'
  or octet_length(jsonb_build_array(p_items,p_contact,p_shipping)::text)>32768 then raise exception 'V2_INVALID_REQUEST'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if not public.checkout_v2_keys(item,array['variantId','quantity']) or public.checkout_v2_integer(item->'quantity')>99 then raise exception 'V2_INVALID_REQUEST'; end if;
  perform public.checkout_v2_uuid(item->'variantId');
 end loop;
 if exists(select 1 from jsonb_array_elements(p_items) x group by x->>'variantId' having sum((x->>'quantity')::integer)>99) then raise exception 'V2_INVALID_REQUEST'; end if;
 perform public.checkout_v2_text(p_contact->'name',2,120);perform public.checkout_v2_text(p_contact->'phone',7,40);
 if public.checkout_v2_text(p_contact->'email',3,254) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'V2_INVALID_REQUEST'; end if;
 perform public.checkout_v2_text(p_shipping->'address',4,500);perform public.checkout_v2_text(p_shipping->'city',2,100);
 perform public.checkout_v2_text(p_shipping->'province',2,100);perform public.checkout_v2_text(p_shipping->'notes',0,1000);
 if length(coalesce(p_coupon,''))>40 or coalesce(p_coupon,'') !~ '^[A-Za-z0-9_-]*$' then raise exception 'V2_INVALID_REQUEST'; end if;
 identity:=public.checkout_v1_quote_identity_008(p_items,p_contact->>'email',p_shipping,p_coupon,p_customer);
 return jsonb_build_array(identity,btrim(p_contact->>'name'),btrim(p_contact->>'phone'),btrim(p_shipping->>'address'),btrim(p_shipping->>'notes'),p_payment,p_method,p_credential);
end; $fn$;
alter function public.quote_checkout_v1_checked(jsonb,uuid) rename to quote_checkout_v1_007_internal;
revoke all on function public.quote_checkout_v1_007_internal(jsonb,uuid) from public,anon,authenticated,service_role;
create function public.quote_checkout_v1_checked(p_request jsonb,p_customer_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare q jsonb; token text; credential text;
begin
 -- The unchanged 007 validator/resolver owns all price, coupon and shipping math.
 q:=public.quote_checkout_v1_007_internal(p_request,p_customer_id);
 token:='checkout:'||gen_random_uuid()::text;
 credential:=encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex');
 insert into public.checkout_v1_attempts(token,credential,customer_id,quote_identity,price_fingerprint)
 values(token,credential,p_customer_id,public.checkout_v1_quote_identity_008(p_request->'items',p_request->>'email',p_request->'shipping',p_request->>'couponCode',p_customer_id),q->>'quoteFingerprint');
 -- The public fingerprint is now an opaque quote capability bound to the issued
 -- token. Its underlying 007 price fingerprint remains private and unchanged.
 return q||jsonb_build_object('quoteFingerprint',credential,'idempotencyKey',substring(token from 10));
end; $fn$;
create or replace function public.create_order_transaction_v1_checked(p_idempotency_key text,p_items jsonb,p_contact jsonb,p_shipping jsonb,p_payment_method text,p_coupon_code text default null,p_shipping_method_id uuid default null,p_customer_id uuid default null,p_quote_fingerprint text default null) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare key text; previous public.orders%rowtype; attempt public.checkout_v1_attempts%rowtype; identity jsonb; q jsonb; created jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='V2_PERMISSION_DENIED'; end if;
 key:=public.checkout_v2_key(p_idempotency_key);
 perform pg_advisory_xact_lock(hashtextextended(key,0));
 previous:=public.checkout_v2_existing(key);
 if previous.id is not null then
  if previous.checkout_version=1 and previous.v1_quote_fingerprint is not null and previous.v1_quote_fingerprint is distinct from p_quote_fingerprint then raise exception 'V2_IDEMPOTENCY_CONFLICT'; end if;
  return public.create_order_transaction(key,p_items,p_contact,p_shipping,p_payment_method,p_coupon_code,p_shipping_method_id,p_customer_id);
 end if;
 identity:=public.checkout_v1_request_identity_008(p_items,p_contact,p_shipping,p_payment_method,p_coupon_code,p_shipping_method_id,p_customer_id,p_quote_fingerprint);
 select * into attempt from public.checkout_v1_attempts where token=key;
 if attempt.token is null then raise exception 'V1_ATTEMPT_UNAVAILABLE'; end if;
 if attempt.customer_id is distinct from p_customer_id or attempt.credential is distinct from p_quote_fingerprint
  or attempt.quote_identity is distinct from identity->0
  or (attempt.request_identity is not null and attempt.request_identity is distinct from identity) then raise exception 'V2_IDEMPOTENCY_CONFLICT'; end if;
 if attempt.state='retired' then
  return jsonb_build_object('outcome','retired','code','QUOTE_CHANGED','idempotencyKey',substring(key from 10));
 end if;
 if attempt.state<>'active' then raise exception 'V1_ATTEMPT_UNAVAILABLE'; end if;
 -- Failed authorization, malformed requests, unavailable products/coupons and
 -- other resolver exceptions roll back; none can authorize replacement.
 q:=public.resolve_checkout_v1_007(key,p_items,p_contact,p_shipping,p_payment_method,p_coupon_code,p_shipping_method_id,p_customer_id);
 if q->>'quoteFingerprint' is distinct from attempt.price_fingerprint then
  update public.checkout_v1_attempts set state='retired',request_identity=identity,retired_at=clock_timestamp() where token=key;
  -- Normal return, never RAISE: PostgREST commits before delivering this outcome.
  return jsonb_build_object('outcome','retired','code','QUOTE_CHANGED','idempotencyKey',substring(key from 10));
 end if;
 created:=public.create_order_v1_effects_007(key,p_items,p_contact,p_shipping,p_payment_method,p_coupon_code,p_shipping_method_id,p_customer_id,q||jsonb_build_object('quoteFingerprint',attempt.credential));
 update public.checkout_v1_attempts set state='committed',request_identity=identity where token=key;
 return public.checkout_v2_v1_receipt((created->>'id')::uuid,false);
end; $fn$;
-- Share the UUID namespace with V2. The original V2 implementation, financial
-- calculations and effects are delegated unchanged under the same advisory lock.
alter function public.create_order_transaction_v2(jsonb,uuid) rename to create_order_transaction_v2_008_internal;
revoke all on function public.create_order_transaction_v2_008_internal(jsonb,uuid) from public,anon,authenticated,service_role;
create function public.create_order_transaction_v2(p_request jsonb,p_customer_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare key text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='V2_PERMISSION_DENIED'; end if;
 perform public.checkout_v2_canonical(p_request,p_customer_id,true);
 key:=public.checkout_v2_key('checkout:'||public.checkout_v2_uuid(p_request->'idempotencyKey')::text);
 perform pg_advisory_xact_lock(hashtextextended(key,0));
 if exists(select 1 from public.checkout_v1_attempts where token=key) then raise exception 'V2_IDEMPOTENCY_CONFLICT'; end if;
 return public.create_order_transaction_v2_008_internal(p_request,p_customer_id);
end; $fn$;
revoke all on function public.checkout_v1_attempt_guard_008() from public,anon,authenticated,service_role;
revoke all on function public.checkout_v1_quote_identity_008(jsonb,text,jsonb,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.checkout_v1_request_identity_008(jsonb,jsonb,jsonb,text,text,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.quote_checkout_v1_checked(jsonb,uuid),public.create_order_transaction_v1_checked(text,jsonb,jsonb,jsonb,text,text,uuid,uuid,text),public.create_order_transaction_v2(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.quote_checkout_v1_checked(jsonb,uuid),public.create_order_transaction_v1_checked(text,jsonb,jsonb,jsonb,text,text,uuid,uuid,text),public.create_order_transaction_v2(jsonb,uuid) to service_role;
do $post$
declare after_state jsonb;
begin
 select jsonb_build_object('defaults',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d),'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p),'roles',(select jsonb_agg(to_jsonb(r) order by oid) from pg_roles r)) into after_state;
 if after_state is distinct from (select state from pg_temp.rf008_security) then raise exception 'RF_RELEASE008_SECURITY_PRESERVATION'; end if;
 -- ACLs must be owner-only even for trusted infrastructure roles. Effective
 -- privilege checks cannot deny a superuser; exempt only the identified platform
 -- administrator when it actually IS a superuser, never arbitrary superusers.
 if not exists(select 1 from pg_class c join pg_roles r on r.oid=c.relowner
   where c.oid='public.checkout_v1_attempts'::regclass and r.rolname='postgres' and c.relrowsecurity)
 or exists(select 1 from pg_policy where polrelid='public.checkout_v1_attempts'::regclass)
 or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
   where c.oid='public.checkout_v1_attempts'::regclass and a.grantee<>c.relowner)
 or exists(select 1 from pg_attribute c cross join lateral aclexplode(c.attacl) a
   where c.attrelid='public.checkout_v1_attempts'::regclass and a.grantee<>(select relowner from pg_class where oid=c.attrelid))
 then raise exception 'RF_RELEASE008_PRIVATE_ACL'; end if;
 -- Include authenticator (if installed), custom login/application roles and a
 -- non-superuser supabase_admin. Predefined pg_* roles are infrastructure roles;
 -- every application path to their privileges is checked below, including SET.
 -- Apply Release 007's bounded profiles to managed roles, failing closed
 -- even if a known role loses CREATEROLE. Matching the profile grants no
 -- private-object access: membership, ACL and effective
 -- table/column/function privileges remain checked for these roles below.
 if exists(select 1 from pg_roles b where b.rolname !~ '^pg_' and b.rolname<>'postgres'
   and not (b.rolname='supabase_admin' and b.rolsuper) and (b.rolsuper or b.rolcreaterole
     or b.rolname in ('dashboard_user','supabase_auth_admin','supabase_storage_admin'))
   and not (b.rolcreaterole and not b.rolsuper and not b.rolbypassrls and (
     (b.rolname in ('supabase_auth_admin','supabase_storage_admin')
       and b.rolcanlogin and not b.rolinherit and not b.rolcreatedb and not b.rolreplication)
     or (b.rolname='dashboard_user' and not b.rolcanlogin and b.rolinherit
       and b.rolcreatedb and b.rolreplication))))
 or exists(select 1 from pg_roles b cross join pg_roles r
   where b.rolname !~ '^pg_' and b.rolname<>'postgres' and not (b.rolname='supabase_admin' and b.rolsuper)
   and b.oid<>r.oid and (r.rolname='postgres' or r.rolsuper or r.rolcreaterole)
   and (pg_has_role(b.oid,r.oid,'USAGE') or pg_has_role(b.oid,r.oid,'SET')
     or exists(select 1 from pg_auth_members m where m.member=b.oid and m.roleid=r.oid and m.admin_option)))
 then raise exception 'RF_RELEASE008_PRIVATE_ROLE_PATH'; end if;
 if exists(select 1 from pg_roles b cross join pg_roles r
   where b.rolname !~ '^pg_' and b.rolname<>'postgres' and not (b.rolname='supabase_admin' and b.rolsuper)
   and (b.oid=r.oid or pg_has_role(b.oid,r.oid,'USAGE') or pg_has_role(b.oid,r.oid,'SET'))
   and (has_table_privilege(r.oid,'public.checkout_v1_attempts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     or has_any_column_privilege(r.oid,'public.checkout_v1_attempts','SELECT,INSERT,UPDATE,REFERENCES')))
 then raise exception 'RF_RELEASE008_PRIVATE_ACL'; end if;
 if exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace
   and p.proname in ('checkout_v1_quote_identity_008','checkout_v1_request_identity_008','checkout_v1_attempt_guard_008','quote_checkout_v1_007_internal','create_order_transaction_v2_008_internal')
   and (p.proowner<>(select oid from pg_roles where rolname='postgres') or p.proconfig is distinct from array['search_path=""']::text[]
     or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner)
     or exists(select 1 from pg_roles b cross join pg_roles r
       where b.rolname !~ '^pg_' and b.rolname<>'postgres' and not (b.rolname='supabase_admin' and b.rolsuper)
       and (b.oid=r.oid or pg_has_role(b.oid,r.oid,'USAGE') or pg_has_role(b.oid,r.oid,'SET'))
       and has_function_privilege(r.oid,p.oid,'EXECUTE'))))
 then raise exception 'RF_RELEASE008_PRIVATE_RPC'; end if;
end; $post$;
commit;
