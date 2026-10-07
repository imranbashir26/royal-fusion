-- Forward-only Phase 013. Owner-only v2 orders until fulfillment 014.
-- Semantic PG17/18 manifests: strict nullability/constraint flags and effective ACLs.
-- Only generated NOT NULL names and redundant owner/service view MAINTAIN bits normalize.
-- Function bodies normalize CRLF to LF; runtime DDL is unchanged.
-- Exact disposable / verified production catalogs, including event-trigger metadata.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public;
do $install013$
declare shape text;
begin
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
 if exists(select 1 from pg_attribute where attrelid='public.orders'::regclass and attname='checkout_version' and not attisdropped) then
  if shape not in ('ed337222eb5fdd9c9b3809ea550f939b9914e2ad2034d42e3e6a648205726261','e195cbf3221767a490c8c340c128b3f4ea8bdf42711d4845e3629160aa366557') then raise exception 'RF_CHECKOUT_013_TARGET_DRIFT'; end if;
 else
  if shape not in ('b6ac24d547a5d1c27079fd6cb9cdb4efbb57fa6589797a1e7b2f662e5752c69e','a2ad954731059c790d88e4cdb49682979548a83a3a3fa52379551763a06464dc') then raise exception 'RF_CHECKOUT_013_BASELINE_DRIFT'; end if;
  execute $ddl013$
-- @013-DDL-BEGIN
alter table public.orders add column checkout_version smallint not null default 1;
alter table public.orders add column snapshot_version smallint not null default 0;
alter table public.orders alter column snapshot_version set default 1;
alter table public.orders add column canonical_request jsonb;
alter table public.orders add column request_fingerprint text;
alter table public.orders add column quote_fingerprint text;
-- Frozen resolver output proves component completeness without consulting future catalog state.
alter table public.orders add column quote_snapshot jsonb;
alter table public.orders add constraint orders_versions_013 check (
 (checkout_version=1 and snapshot_version in (0,1) and canonical_request is null and request_fingerprint is null and quote_fingerprint is null and quote_snapshot is null)
 or (checkout_version=2 and snapshot_version=2 and jsonb_typeof(canonical_request)='array'
 and canonical_request is not null and request_fingerprint ~ '^[0-9a-f]{64}$' and request_fingerprint is not null
 and quote_fingerprint ~ '^[0-9a-f]{64}$' and quote_fingerprint is not null and quote_snapshot is not null and jsonb_typeof(quote_snapshot)='object'));
alter table public.order_items add column snapshot_version smallint not null default 0;
alter table public.order_items alter column snapshot_version set default 1;
alter table public.order_items add column line_kind text not null default 'normal_variant';
alter table public.order_items add column pack_id uuid references public.tester_packs(product_id) on delete restrict;
alter table public.order_items add column pack_definition_revision bigint;
alter table public.order_items add column pack_definition_fingerprint text;
alter table public.order_items add column canonical_line_identity jsonb;
alter table public.order_items add column line_identity_hash text;
alter table public.order_items add column position integer;
alter table public.order_items drop constraint order_items_variant_required_for_new_rows;
alter table public.order_items add constraint order_items_identity_013 check (
 snapshot_version in (0,1,2) and line_kind in ('normal_variant','fixed_tester_pack','configurable_tester_pack') and (
 (snapshot_version=0 and line_kind='normal_variant' and pack_id is null and pack_definition_revision is null
  and pack_definition_fingerprint is null and canonical_line_identity is null and line_identity_hash is null and position is null)
 or (snapshot_version in (1,2) and product_id is not null and (
  (line_kind='normal_variant' and variant_id is not null and pack_id is null and pack_definition_revision is null and pack_definition_fingerprint is null)
  or (snapshot_version=2 and line_kind in ('fixed_tester_pack','configurable_tester_pack') and variant_id is null
   and pack_id is not null and product_id=pack_id and pack_definition_revision is not null and pack_definition_revision>0
   and pack_definition_fingerprint is not null and pack_definition_fingerprint ~ '^[0-9a-f]{64}$'))
 and ((snapshot_version=1 and canonical_line_identity is null and line_identity_hash is null and position is null)
  or (snapshot_version=2 and canonical_line_identity is not null and jsonb_typeof(canonical_line_identity)='array'
   and line_identity_hash is not null and line_identity_hash ~ '^[0-9a-f]{64}$' and position is not null and position>=0)))));
alter table public.order_items add constraint order_items_owner_013 unique(id,order_id);
alter table public.order_items add constraint order_items_price_013 check(snapshot_version<>2 or (unit_price>0 and unit_price<>'NaN'::numeric));
alter table public.orders add constraint orders_money_013 check(checkout_version<>2 or
 (subtotal<>'NaN'::numeric and discount<>'NaN'::numeric and shipping_fee<>'NaN'::numeric and total<>'NaN'::numeric));
-- Existing authenticated SELECT grants include newly added columns. Prevent a
-- browser from bypassing private components through orders.quote_snapshot.
-- Restrictive policies compose with existing ownership/Admin policies.
create policy orders_v1_browser_013 on public.orders as restrictive for select to anon,authenticated using(checkout_version=1);
create policy order_items_v1_browser_013 on public.order_items as restrictive for select to anon,authenticated using(snapshot_version<>2);
create unique index order_items_identity_013_idx on public.order_items(order_id,line_identity_hash) where snapshot_version=2;
create unique index order_items_position_013_idx on public.order_items(order_id,position) where snapshot_version=2;
create table public.order_item_components (
 id uuid primary key default gen_random_uuid(), order_id uuid not null, order_item_id uuid not null,
 tester_variant_id uuid not null references public.tester_variants(variant_id) on delete restrict,
 tester_product_id uuid not null, tester_name text not null check(length(tester_name)>0), sku text not null,
 size text not null check(size='5 ml'), volume_ml numeric(4,2) not null check(volume_ml=5),
 quantity_per_pack integer not null check(quantity_per_pack>0),
 total_physical_quantity integer not null check(total_physical_quantity>0),
 reference_unit_price numeric(12,2) not null check(reference_unit_price>0 and reference_unit_price<>'NaN'::numeric),
 position integer not null check(position>=0), created_at timestamptz not null default now(),
 constraint components_parent_013 foreign key(order_item_id,order_id) references public.order_items(id,order_id) on delete restrict,
 constraint components_tester_owner_013 foreign key(tester_variant_id,tester_product_id) references public.product_variants(id,product_id) on delete restrict,
 unique(order_item_id,tester_variant_id), unique(order_item_id,position)
);
create index components_order_013_idx on public.order_item_components(order_id);
create index components_variant_013_idx on public.order_item_components(tester_variant_id);
alter table public.order_item_components enable row level security;
revoke all on public.order_item_components from public,anon,authenticated,service_role;
grant select on public.order_item_components to service_role;

-- All identities contain only ASCII UUIDs, revision strings and integral counts.
-- Compact JSON is constructed recursively, never by removing spaces inside strings.
create function public.checkout_v2_compact(p_value jsonb) returns text
language plpgsql immutable set search_path='' as $fn$
declare result text;
begin
 if jsonb_typeof(p_value)='array' then
  select '['||coalesce(string_agg(public.checkout_v2_compact(v),',' order by n),'')||']' into result
  from jsonb_array_elements(p_value) with ordinality a(v,n); return result;
 end if;
 return p_value::text;
end; $fn$;
create function public.checkout_v2_hash(p_value jsonb) returns text
language sql immutable set search_path='' as $fn$
 select encode(sha256(convert_to(public.checkout_v2_compact(p_value),'UTF8')),'hex'); $fn$;
create function public.checkout_v2_keys(p_value jsonb,p_keys text[]) returns boolean
language sql immutable set search_path='' as $fn$
 select coalesce(jsonb_typeof(p_value)='object' and p_value ?& p_keys
 and not exists(select 1 from jsonb_object_keys(p_value) k where not(k=any(p_keys))),false); $fn$;
create function public.checkout_v2_integer(p_value jsonb) returns integer
language plpgsql immutable set search_path='' as $fn$
begin
 if p_value is null or jsonb_typeof(p_value)<>'number' or p_value::text !~ '^[1-9][0-9]*$'
 or length(p_value::text)>10 or p_value::numeric>2147483647 then raise exception 'V2_INVALID_REQUEST'; end if;
 return p_value::text::integer;
end; $fn$;
create function public.checkout_v2_uuid(p_value jsonb) returns uuid
language plpgsql immutable set search_path='' as $fn$
begin
 if jsonb_typeof(p_value) is distinct from 'string' or (p_value#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'V2_INVALID_REQUEST'; end if;
 return (p_value#>>'{}')::uuid;
end; $fn$;
-- Recognize legacy textual keys without rewriting orders or payment identities.
-- NULL means this is not a parseable checkout UUID, never an authorization fallback.
create function public.checkout_v2_stored_uuid(p_key text) returns uuid
language plpgsql immutable set search_path='' as $fn$
declare value text:=btrim(p_key);
begin
 if value is null or length(value)>160 or lower(left(value,9))<>'checkout:' then return null; end if;
 return substring(value from 10)::uuid;
exception when invalid_text_representation then return null;
end; $fn$;
create function public.checkout_v2_key(p_key text) returns text
language plpgsql immutable set search_path='' as $fn$
declare identity uuid:=public.checkout_v2_stored_uuid(p_key);
begin
 if identity is null then raise exception 'V2_INVALID_REQUEST'; end if;
 return 'checkout:'||identity::text;
end; $fn$;
-- Nonunique deliberately: pre-existing UUID-equivalent duplicates are detected
-- and rejected, not silently selected, rewritten, or removed during installation.
create index orders_checkout_uuid_013_idx on public.orders(public.checkout_v2_stored_uuid(idempotency_key));
create function public.checkout_v2_existing(p_key text) returns public.orders
language plpgsql security definer set search_path='' as $fn$
declare matches jsonb;
begin
 -- One statement snapshot checks canonical and historical equivalents together.
 select jsonb_agg(to_jsonb(candidate)) into matches from (
  select * from public.orders where public.checkout_v2_stored_uuid(idempotency_key)=public.checkout_v2_stored_uuid(p_key) limit 2
 ) candidate;
 if jsonb_array_length(matches)>1 then raise exception 'V2_IDEMPOTENCY_AMBIGUOUS'; end if;
 return jsonb_populate_record(null::public.orders,matches->0);
end; $fn$;
create function public.checkout_v2_text(p_value jsonb,p_min integer,p_max integer) returns text
language plpgsql immutable set search_path='' as $fn$
declare s text;
begin
 if jsonb_typeof(p_value) is distinct from 'string' then raise exception 'V2_INVALID_REQUEST'; end if;
 s:=btrim(p_value#>>'{}');
 if length(s)<p_min or length(s)>p_max or s ~ '[<>]' then raise exception 'V2_INVALID_REQUEST'; end if;
 return s;
end; $fn$;
create function public.checkout_v2_lines(p_lines jsonb) returns jsonb
language plpgsql immutable set search_path='' as $fn$
#variable_conflict use_column
declare item jsonb; selection jsonb; normalized jsonb:='[]'; selections jsonb; identity jsonb;
 kind text; id uuid; revision text; quantity integer; q integer; sumq bigint; result jsonb;
begin
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 100
 or octet_length(p_lines::text)>32768 then raise exception 'V2_INVALID_REQUEST'; end if;
 for item in select value from jsonb_array_elements(p_lines) loop
  kind:=item->>'kind'; quantity:=public.checkout_v2_integer(item->'quantity');
  if kind='normal_variant' then
   if not public.checkout_v2_keys(item,array['kind','variantId','quantity']) or quantity>99 then raise exception 'V2_INVALID_REQUEST'; end if;
   id:=public.checkout_v2_uuid(item->'variantId'); identity:=jsonb_build_array(kind,id::text);
   item:=jsonb_build_object('kind',kind,'variantId',id,'quantity',quantity);
  elsif kind in ('fixed_tester_pack','configurable_tester_pack') then
   if not public.checkout_v2_keys(item,case when kind='fixed_tester_pack' then array['kind','packId','definitionRevision','quantity'] else array['kind','packId','definitionRevision','quantity','selections'] end)
   or jsonb_typeof(item->'definitionRevision') is distinct from 'string' then raise exception 'V2_INVALID_REQUEST'; end if;
   id:=public.checkout_v2_uuid(item->'packId'); revision:=item->>'definitionRevision';
   if revision !~ '^[1-9][0-9]*$' or length(revision)>19 or revision::numeric>9223372036854775807 then raise exception 'V2_INVALID_REQUEST'; end if;
   if kind='fixed_tester_pack' then identity:=jsonb_build_array(kind,id::text,revision);
   else
    if jsonb_typeof(item->'selections') is distinct from 'array' or jsonb_array_length(item->'selections') not between 1 and 100 then raise exception 'V2_INVALID_REQUEST'; end if;
    selections:='[]';
    for selection in select value from jsonb_array_elements(item->'selections') loop
     if not public.checkout_v2_keys(selection,array['variantId','quantityPerPack']) then raise exception 'V2_INVALID_REQUEST'; end if;
     selections:=selections||jsonb_build_array(jsonb_build_object('variantId',public.checkout_v2_uuid(selection->'variantId'),'quantityPerPack',public.checkout_v2_integer(selection->'quantityPerPack')));
    end loop;
    if exists(select 1 from jsonb_array_elements(selections) s group by s->>'variantId' having sum((s->>'quantityPerPack')::bigint)>2147483647) then raise exception 'V2_INVALID_REQUEST'; end if;
    select jsonb_agg(jsonb_build_object('variantId',id,'quantityPerPack',qty) order by id collate "C") into selections
    from (select s->>'variantId' id,sum((s->>'quantityPerPack')::bigint) qty from jsonb_array_elements(selections) s group by s->>'variantId') x;
    select jsonb_agg(jsonb_build_array(s->>'variantId',(s->>'quantityPerPack')::integer) order by s->>'variantId' collate "C") into identity from jsonb_array_elements(selections) s;
    identity:=jsonb_build_array(kind,id::text,revision,identity);
   end if;
   item:=jsonb_build_object('kind',kind,'packId',id,'definitionRevision',revision,'quantity',quantity)
    ||case when kind='configurable_tester_pack' then jsonb_build_object('selections',selections) else '{}'::jsonb end;
  else raise exception 'V2_INVALID_REQUEST'; end if;
  normalized:=normalized||jsonb_build_array(item||jsonb_build_object('identity',identity,'identityHash',public.checkout_v2_hash(identity)));
 end loop;
 -- Group by the complete identity, not its hash. Hash collisions cannot merge intent.
 if exists(select 1 from jsonb_array_elements(normalized) l group by l->'identity'
  having sum((l->>'quantity')::bigint)>case when min(l->>'kind')='normal_variant' then 99 else 2147483647 end) then raise exception 'V2_INVALID_REQUEST'; end if;
 select jsonb_agg(item||jsonb_build_object('quantity',qty) order by public.checkout_v2_compact(item->'identity') collate "C") into result
 from (select (jsonb_agg(l-(array['quantity']))->0) item,sum((l->>'quantity')::bigint) qty from jsonb_array_elements(normalized) l group by l->'identity') x;
 return result;
end; $fn$;
create function public.checkout_v2_canonical(p_request jsonb,p_customer uuid,p_order boolean) returns jsonb
language plpgsql immutable set search_path='' as $fn$
declare lines jsonb; contact jsonb:=null; shipping jsonb; email text; coupon text; result jsonb;
begin
 if not public.checkout_v2_keys(p_request,case when p_order then array['contractVersion','idempotencyKey','lines','contact','shipping','paymentMethod','couponCode','quoteFingerprint'] else array['contractVersion','lines','shipping','email','couponCode'] end)
 or p_request->'contractVersion' is distinct from '2'::jsonb then raise exception 'V2_INVALID_REQUEST'; end if;
 lines:=public.checkout_v2_lines(p_request->'lines');
 if p_order then
  perform public.checkout_v2_uuid(p_request->'idempotencyKey');
  if not public.checkout_v2_keys(p_request->'contact',array['name','email','phone'])
  or not public.checkout_v2_keys(p_request->'shipping',array['address','city','province','notes'])
  or p_request->>'paymentMethod' not in ('Cash on Delivery','Bank Transfer')
  or jsonb_typeof(p_request->'quoteFingerprint') is distinct from 'string' or p_request->>'quoteFingerprint' !~ '^[0-9a-f]{64}$' then raise exception 'V2_INVALID_REQUEST'; end if;
  email:=lower(public.checkout_v2_text(p_request->'contact'->'email',3,254));
  contact:=jsonb_build_array(public.checkout_v2_text(p_request->'contact'->'name',2,120),email,public.checkout_v2_text(p_request->'contact'->'phone',7,40));
  shipping:=jsonb_build_array(public.checkout_v2_text(p_request->'shipping'->'address',4,500),public.checkout_v2_text(p_request->'shipping'->'city',2,100),public.checkout_v2_text(p_request->'shipping'->'province',2,100),public.checkout_v2_text(p_request->'shipping'->'notes',0,1000));
 else
  if not public.checkout_v2_keys(p_request->'shipping',array['city','province']) then raise exception 'V2_INVALID_REQUEST'; end if;
  email:=lower(public.checkout_v2_text(p_request->'email',0,254));
  shipping:=jsonb_build_array(public.checkout_v2_text(p_request->'shipping'->'city',2,100),public.checkout_v2_text(p_request->'shipping'->'province',2,100));
 end if;
 if email<>'' and email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'V2_INVALID_REQUEST'; end if;
 coupon:=upper(public.checkout_v2_text(p_request->'couponCode',0,40));
 if coupon !~ '^[A-Z0-9_-]*$' then raise exception 'V2_INVALID_REQUEST'; end if;
 result:=jsonb_build_array(2,lines,p_customer,contact,shipping,case when p_order then p_request->>'paymentMethod' else null end,coupon,case when p_order then p_request->>'quoteFingerprint' else null end,email);
 if octet_length(public.checkout_v2_compact(result))>32768 then raise exception 'V2_LIMIT_EXCEEDED'; end if;
 return result;
end; $fn$;

create function public.checkout_v2_resolve(p_canonical jsonb,p_lock boolean) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare line jsonb; component jsonb; selected jsonb; output jsonb:='[]'; components jsonb; demand jsonb:='[]';
 p public.products%rowtype; v public.product_variants%rowtype; t public.tester_variants%rowtype; d public.tester_packs%rowtype;
 c public.coupons%rowtype; method public.shipping_methods%rowtype; rate public.shipping_rates%rowtype;
 physical uuid[]; before_set uuid[]; pack_ids uuid[]; owners jsonb; locked_owners jsonb; q bigint; units bigint; price numeric; subtotal numeric:=0;
 discount numeric:=0; base numeric:=0; shipping numeric; total numeric; free_shipping boolean:=false;
 position integer:=0; component_position integer; component_count integer:=0; count_rates integer; usage_count bigint;
 city text; province text; email text:=p_canonical->>8; coupon text:=p_canonical->>6; customer uuid:=(p_canonical->>2)::uuid;
 payments jsonb:='[]'; private_payments jsonb; public_payments jsonb; commerce jsonb; enabled jsonb; payment text;
 basis jsonb; categories jsonb; applicable boolean; coupon_basis jsonb:=null;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'V2_ISOLATION_UNSUPPORTED'; end if;
 if customer is not null and not exists(select 1 from public.profiles where id=customer and status='Active') then raise exception 'V2_CUSTOMER_UNAVAILABLE'; end if;
 if p_canonical->3='null'::jsonb then city:=p_canonical->4->>0; province:=p_canonical->4->>1;
 else city:=p_canonical->4->>1; province:=p_canonical->4->>2; end if;
 select array_agg(distinct (l->>'packId')::uuid order by (l->>'packId')::uuid) into pack_ids
 from jsonb_array_elements(p_canonical->1) l where l->>'kind'<>'normal_variant';
 if p_lock then
  -- Pack definitions already use parent -> tester locks. Pin every pack first.
  perform id from public.products where id=any(pack_ids) order by id for update;
  perform product_id from public.tester_packs where product_id=any(pack_ids) order by product_id for update;
 end if;
 select array_agg(distinct id order by id) into physical from (
  select (l->>'variantId')::uuid id from jsonb_array_elements(p_canonical->1) l where l->>'kind'='normal_variant'
  union select x.tester_variant_id from jsonb_array_elements(p_canonical->1) l join public.tester_pack_components x on x.pack_id=(l->>'packId')::uuid where l->>'kind'='fixed_tester_pack'
  union select (s->>'variantId')::uuid from jsonb_array_elements(p_canonical->1) l cross join lateral jsonb_array_elements(coalesce(l->'selections','[]')) s
 ) x;
 before_set:=physical;
 if p_lock then
  select jsonb_agg(jsonb_build_array(id,product_id) order by id) into owners from public.product_variants where id=any(physical);
  perform sibling.id from public.product_variants sibling where sibling.id=any(physical) or sibling.product_id in
   (select product_id from public.product_variants where id=any(physical)) order by sibling.id for update;
  select jsonb_agg(jsonb_build_array(id,product_id) order by id) into locked_owners from public.product_variants where id=any(physical);
  if owners is distinct from locked_owners then raise exception 'V2_RESOLUTION_CHANGED'; end if;
  perform id from public.products where id in(select product_id from public.product_variants where id=any(physical)) order by id for update;
  -- No newly discovered physical row may be locked after physical parents.
  select array_agg(distinct id order by id) into physical from (
   select (l->>'variantId')::uuid id from jsonb_array_elements(p_canonical->1) l where l->>'kind'='normal_variant'
   union select x.tester_variant_id from jsonb_array_elements(p_canonical->1) l join public.tester_pack_components x on x.pack_id=(l->>'packId')::uuid where l->>'kind'='fixed_tester_pack'
   union select (s->>'variantId')::uuid from jsonb_array_elements(p_canonical->1) l cross join lateral jsonb_array_elements(coalesce(l->'selections','[]')) s
  ) x;
  if physical is distinct from before_set then raise exception 'V2_RESOLUTION_CHANGED'; end if;
 end if;
 for line in select value from jsonb_array_elements(p_canonical->1) loop
  components:='[]'; component_position:=0;
  if line->>'kind'='normal_variant' then
   select * into v from public.product_variants where id=(line->>'variantId')::uuid;
   if not found then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
   select * into p from public.products where id=v.product_id;
   if p.commerce_kind not in ('standard','tester') then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
   if p.commerce_kind='tester' then
    select * into t from public.tester_variants where variant_id=v.id and tester_product_id=p.id and volume_ml=5;
    if not found or not t.manual_available or v.option_name<>'Size' or v.option_value<>'5 ml' then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
   end if;
   price:=coalesce(v.sale_price,v.regular_price);
   if not p.active or p.status<>'Published' or not v.active or not v.available or v.stock_quantity<=0 then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
   if v.regular_price<=0 or v.regular_price='NaN'::numeric or (v.sale_price is not null and (v.sale_price<=0 or v.sale_price>=v.regular_price or v.sale_price='NaN'::numeric)) then raise exception 'V2_CONFIGURATION_INVALID'; end if;
   demand:=demand||jsonb_build_array(jsonb_build_object('variantId',v.id,'quantity',(line->>'quantity')::bigint));
   line:=line||jsonb_build_object('productId',p.id,'name',p.name,'sku',v.sku,'size',v.option_value,'unitPrice',price,'components',components,'position',position);
  else
   select * into p from public.products where id=(line->>'packId')::uuid;
   if not found or p.commerce_kind<>'tester_pack' or not p.active or p.status<>'Published' then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
   select * into d from public.tester_packs where product_id=p.id;
   if not found or not d.manual_available then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
   if d.definition_revision::text<>line->>'definitionRevision' then raise exception 'V2_DEFINITION_STALE'; end if;
   if (d.mode='fixed') is distinct from (line->>'kind'='fixed_tester_pack') then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
   if d.definition_fingerprint is distinct from public.tester_pack_definition_hash(d.product_id) then raise exception 'V2_CONFIGURATION_INVALID'; end if;
   if d.mode='fixed' then
    select jsonb_agg(jsonb_build_object('variantId',tester_variant_id,'quantityPerPack',quantity_per_pack) order by tester_variant_id) into selected from public.tester_pack_components where pack_id=p.id;
    price:=coalesce(d.fixed_sale_price,d.fixed_regular_price);
   else selected:=line->'selections'; price:=0; end if;
   if selected is null or jsonb_array_length(selected) not between 1 and 100 then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
   units:=0;
   for component in select value from jsonb_array_elements(selected) loop
    q:=(component->>'quantityPerPack')::bigint; units:=units+q;
    if units>2147483647 or q*(line->>'quantity')::numeric>2147483647 then raise exception 'V2_LIMIT_EXCEEDED'; end if;
    if d.mode='configurable' and not exists(select 1 from public.tester_pack_allowed_variants where pack_id=p.id and tester_variant_id=(component->>'variantId')::uuid and active) then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
    select * into t from public.tester_variants where variant_id=(component->>'variantId')::uuid;
    if not found or t.volume_ml<>5 or not t.manual_available then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
    select * into v from public.product_variants where id=t.variant_id and product_id=t.tester_product_id;
    if not found or not v.active or not v.available or v.stock_quantity<=0 or v.option_name<>'Size' or v.option_value<>'5 ml'
    or not exists(select 1 from public.products where id=t.tester_product_id and commerce_kind='tester' and active and status='Published') then raise exception 'V2_SELECTION_UNAVAILABLE'; end if;
    if v.regular_price<=0 or v.regular_price='NaN'::numeric or (v.sale_price is not null and (v.sale_price<=0 or v.sale_price>=v.regular_price or v.sale_price='NaN'::numeric)) then raise exception 'V2_CONFIGURATION_INVALID'; end if;
    if d.mode='configurable' then price:=price+coalesce(v.sale_price,v.regular_price)*q; end if;
    components:=components||jsonb_build_array(jsonb_build_object('testerVariantId',t.variant_id,'testerProductId',t.tester_product_id,
     'testerName',(select name from public.products where id=t.tester_product_id),'sku',v.sku,'size','5 ml','volumeMl',5,
     'quantityPerPack',q,'totalPhysicalQuantity',q*(line->>'quantity')::bigint,'referenceUnitPrice',coalesce(v.sale_price,v.regular_price),'position',component_position));
    demand:=demand||jsonb_build_array(jsonb_build_object('variantId',v.id,'quantity',q*(line->>'quantity')::bigint));
    component_position:=component_position+1; component_count:=component_count+1;
    if component_count>2000 then raise exception 'V2_LIMIT_EXCEEDED'; end if;
   end loop;
   if d.mode='configurable' and (units<d.minimum_units or (d.maximum_units is not null and units>d.maximum_units)) then raise exception 'V2_PACK_UNITS_INVALID'; end if;
   line:=line||jsonb_build_object('productId',p.id,'name',p.name,'sku',p.sku,'size','Tester pack','unitPrice',price,
    'definitionFingerprint',d.definition_fingerprint,'components',components,'position',position);
  end if;
  if price<=0 or price='NaN'::numeric or price>9999999999.99 or price*(line->>'quantity')::numeric>9999999999.99 then raise exception 'V2_LIMIT_EXCEEDED'; end if;
  line:=line||jsonb_build_object('lineTotal',price*(line->>'quantity')::numeric);
  subtotal:=subtotal+(line->>'lineTotal')::numeric;
  if subtotal>9999999999.99 then raise exception 'V2_LIMIT_EXCEEDED'; end if;
  output:=output||jsonb_build_array(line); position:=position+1;
 end loop;
 if exists(select 1 from jsonb_array_elements(demand) x group by x->>'variantId' having sum((x->>'quantity')::bigint)>2147483647) then raise exception 'V2_LIMIT_EXCEEDED'; end if;
 select jsonb_agg(jsonb_build_object('variantId',id,'quantity',qty) order by id collate "C") into demand
 from (select x->>'variantId' id,sum((x->>'quantity')::bigint) qty from jsonb_array_elements(demand) x group by x->>'variantId') x;
 if exists(select 1 from jsonb_array_elements(demand) x left join public.product_variants physical_row on physical_row.id=(x->>'variantId')::uuid where physical_row.id is null or physical_row.stock_quantity<(x->>'quantity')::bigint) then raise exception 'V2_INSUFFICIENT_STOCK'; end if;
 if coupon<>'' then
  if p_lock then perform id from public.coupons where lower(code)=lower(coupon) order by id for update; end if;
  select * into c from public.coupons where lower(code)=lower(coupon);
  if not found or c.status<>'Active' or ((statement_timestamp() at time zone 'UTC')::date<c.start_date)
  or ((statement_timestamp() at time zone 'UTC')::date>c.end_date) or subtotal<c.minimum_order_amount
  or (c.usage_limit>0 and c.used_count>=c.usage_limit) then raise exception 'V2_INVALID_COUPON'; end if;
  if c.per_customer_usage_limit>0 then
   select count(*) into usage_count from public.coupon_redemptions where coupon_id=c.id and
    ((customer is not null and customer_id=customer) or (email<>'' and lower(customer_email)=email));
   if (customer is null and email='') or usage_count>=c.per_customer_usage_limit then raise exception 'V2_INVALID_COUPON'; end if;
  end if;
  if p_lock then
   perform product_id from public.coupon_products where coupon_id=c.id order by product_id for share;
   perform category_id from public.coupon_categories where coupon_id=c.id order by category_id for share;
   perform product_id from public.product_categories where product_id in(select (l->>'productId')::uuid from jsonb_array_elements(output) l) order by product_id,category_id for share;
  end if;
  for line in select value from jsonb_array_elements(output) loop
   select coalesce(jsonb_agg(distinct category_id order by category_id),'[]') into categories from (
    select category_id from public.product_categories where product_id=(line->>'productId')::uuid
    union select category_id from public.products where id=(line->>'productId')::uuid and commerce_kind in ('tester','tester_pack') and category_id is not null
   ) cats;
   applicable:=(not exists(select 1 from public.coupon_products where coupon_id=c.id) or exists(select 1 from public.coupon_products where coupon_id=c.id and product_id=(line->>'productId')::uuid))
    and (not exists(select 1 from public.coupon_categories where coupon_id=c.id) or exists(select 1 from public.coupon_categories where coupon_id=c.id and category_id in(select value::text::uuid from jsonb_array_elements_text(categories))));
   if applicable then base:=base+(line->>'lineTotal')::numeric; end if;
   coupon_basis:=coalesce(coupon_basis,'[]')||jsonb_build_array(jsonb_build_array(line->'identity',categories,applicable));
  end loop;
  if base<=0 then raise exception 'V2_INVALID_COUPON'; end if;
  if c.type='Percentage' then discount:=round(base*c.discount_value/100,2);
  elsif c.type='Fixed Amount' then discount:=least(base,c.discount_value);
  elsif c.type='Free Shipping' then free_shipping:=true;
  else raise exception 'V2_INVALID_COUPON'; end if;
  if c.max_discount_amount is not null then discount:=least(discount,c.max_discount_amount); end if;
  coupon_basis:=jsonb_build_array(c.id,c.type,c.discount_value,c.max_discount_amount,c.minimum_order_amount,c.start_date,c.end_date,base,discount,free_shipping,coupon_basis);
 end if;
 if p_lock then
  perform id from public.site_settings where id='site' for share;
  perform key from public.public_site_settings where key in ('payments','commerce') order by key for share;
  perform id from public.shipping_methods order by id for share;
  perform id from public.shipping_rates order by id for share;
 end if;
 select * into method from public.shipping_methods where active order by display_order,created_at,id limit 1;
 if not found then raise exception 'V2_CONFIGURATION_INVALID'; end if;
 -- Count and select from one statement snapshot: a concurrent insert cannot
 -- appear between a separate ambiguity check and winner selection.
 with ranked as (
  select rates.*,dense_rank() over(order by case scope_type when 'city' then 1 when 'province' then 2 else 3 end,minimum_subtotal desc) selection_rank
  from public.shipping_rates rates where shipping_method_id=method.id and active and minimum_subtotal<=subtotal-discount
  and (scope_type='default' or (scope_type='city' and lower(scope_value)=lower(city)) or (scope_type='province' and lower(scope_value)=lower(province)))
 ) select count(*),(jsonb_agg(to_jsonb(ranked)-'selection_rank' order by ranked.id)->0) into count_rates,enabled from ranked where selection_rank=1;
 if count_rates>1 then raise exception 'V2_CONFIGURATION_INVALID'; end if;
 select * into rate from jsonb_populate_record(null::public.shipping_rates,enabled);
 shipping:=coalesce(rate.fee,method.base_fee);
 if free_shipping or (method.free_shipping_threshold is not null and subtotal-discount>=method.free_shipping_threshold) then shipping:=0; end if;
 select s.payments into private_payments from public.site_settings s where id='site';
 select value into public_payments from public.public_site_settings where key='payments';
 select value into commerce from public.public_site_settings where key='commerce';
 foreach payment in array array['Cash on Delivery','Bank Transfer'] loop
  enabled:=null;
  if jsonb_typeof(private_payments)='array' then select x->'active' into enabled from jsonb_array_elements(private_payments) x where x->>'name'=payment limit 1; end if;
  if enabled is null or enabled='null'::jsonb then
   if jsonb_typeof(public_payments)='array' then select x->'active' into enabled from jsonb_array_elements(public_payments) x where x->>'name'=payment limit 1; end if;
  end if;
  if enabled is null or enabled='null'::jsonb then enabled:=commerce->case when payment='Cash on Delivery' then 'codEnabled' else 'bankTransferEnabled' end; end if;
  if enabled='true'::jsonb then payments:=payments||jsonb_build_array(payment); end if;
 end loop;
 if jsonb_array_length(payments)=0 then raise exception 'V2_PAYMENT_UNAVAILABLE'; end if;
 if p_canonical->5<>'null'::jsonb and not(payments ? (p_canonical->>5)) then raise exception 'V2_PAYMENT_UNAVAILABLE'; end if;
 total:=subtotal-discount+shipping;
 if total>9999999999.99 or discount<0 or discount>subtotal or shipping<0 then raise exception 'V2_LIMIT_EXCEEDED'; end if;
 -- Snapshots contain eligibility-proven values, not volatile stock/timestamps.
 basis:=jsonb_build_array(2,output,demand,true,coupon_basis,city,province,method.id,rate.id,method.base_fee,method.free_shipping_threshold,shipping,payments,'PKR',subtotal,discount,total);
 return jsonb_build_object('contractVersion',2,'quoteFingerprint',public.checkout_v2_hash(basis),'lines',output,'subtotal',subtotal,'discount',discount,'shippingFee',shipping,'total',total,
  'currency','PKR','shippingMethodId',method.id,'paymentMethods',payments,'orderingEnabled',false,'_demand',demand,'_couponId',c.id);
end; $fn$;
create function public.quote_checkout_v2(p_request jsonb,p_customer_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $fn$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='V2_PERMISSION_DENIED'; end if;
 return public.checkout_v2_resolve(public.checkout_v2_canonical(p_request,p_customer_id,false),false)-array['_demand','_couponId'];
end; $fn$;

create function public.checkout_v2_receipt(p_order_id uuid,p_replay boolean) returns jsonb
language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('contractVersion',2,'snapshotVersion',2,'id',o.id,'idempotencyKey',substring(o.idempotency_key from 10),
 'requestFingerprint',o.request_fingerprint,'quoteFingerprint',o.quote_fingerprint,'orderNumber',o.order_number,'status',o.status,
 'paymentStatus',o.payment_status,'paymentMethod',o.payment_method,'subtotal',o.subtotal,'discount',o.discount,'shippingFee',o.shipping_fee,
 'total',o.total,'currency',o.currency,'idempotent',p_replay,'lines',coalesce((
  select jsonb_agg((o.quote_snapshot->'lines'->i.position)||jsonb_build_object('id',i.id,'components',coalesce((
   select jsonb_agg(jsonb_build_object('id',c.id,'testerVariantId',c.tester_variant_id,'testerProductId',c.tester_product_id,
    'testerName',c.tester_name,'sku',c.sku,'size',c.size,'volumeMl',c.volume_ml,'quantityPerPack',c.quantity_per_pack,
    'totalPhysicalQuantity',c.total_physical_quantity,'referenceUnitPrice',c.reference_unit_price,'position',c.position) order by c.position)
   from public.order_item_components c where c.order_item_id=i.id),'[]'::jsonb)) order by i.position)
  from public.order_items i where i.order_id=o.id),'[]'::jsonb)) from public.orders o where o.id=p_order_id and o.checkout_version=2;
$fn$;
create function public.create_order_transaction_v2(p_request jsonb,p_customer_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare canonical jsonb; fingerprint text; key text; previous public.orders%rowtype; quote jsonb;
 order_id uuid; item_id uuid; line jsonb; component jsonb; physical jsonb; balance integer;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='V2_PERMISSION_DENIED'; end if;
 canonical:=public.checkout_v2_canonical(p_request,p_customer_id,true); fingerprint:=public.checkout_v2_hash(canonical);
 key:=public.checkout_v2_key('checkout:'||public.checkout_v2_uuid(p_request->'idempotencyKey')::text);
 if p_customer_id is not null and not exists(select 1 from public.profiles where id=p_customer_id and status='Active') then raise exception 'V2_CUSTOMER_UNAVAILABLE'; end if;
 perform pg_advisory_xact_lock(hashtextextended(key,0));
 previous:=public.checkout_v2_existing(key);
 if previous.id is not null then
  if previous.checkout_version<>2 or previous.canonical_request is distinct from canonical or previous.request_fingerprint is distinct from fingerprint then raise exception 'V2_IDEMPOTENCY_CONFLICT'; end if;
  return public.checkout_v2_receipt(previous.id,true);
 end if;
 quote:=public.checkout_v2_resolve(canonical,true);
 if quote->>'quoteFingerprint'<>p_request->>'quoteFingerprint' then raise exception 'V2_QUOTE_CHANGED'; end if;
 order_id:=gen_random_uuid();
 insert into public.orders(id,order_number,customer_id,customer_name,customer_email,customer_phone,shipping_address,shipping_city,shipping_province,order_notes,
  status,payment_method,payment_status,subtotal,discount,shipping_fee,total,coupon_code,coupon_id,shipping_method_id,currency,idempotency_key,
  checkout_version,snapshot_version,canonical_request,request_fingerprint,quote_fingerprint,quote_snapshot)
 values(order_id,'RF-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||upper(substr(replace(order_id::text,'-',''),1,8)),p_customer_id,
  canonical->3->>0,canonical->3->>1,canonical->3->>2,canonical->4->>0,canonical->4->>1,canonical->4->>2,canonical->4->>3,
  'Pending',canonical->>5,case when canonical->>5='Cash on Delivery' then 'Unpaid'::public.payment_status else 'Pending'::public.payment_status end,
  (quote->>'subtotal')::numeric,(quote->>'discount')::numeric,(quote->>'shippingFee')::numeric,(quote->>'total')::numeric,canonical->>6,
  (quote->>'_couponId')::uuid,(quote->>'shippingMethodId')::uuid,'PKR',key,2,2,canonical,fingerprint,quote->>'quoteFingerprint',quote-array['_demand','_couponId']);
 for line in select value from jsonb_array_elements(quote->'lines') loop
  item_id:=gen_random_uuid();
  insert into public.order_items(id,order_id,product_id,variant_id,product_name,size,sku,quantity,unit_price,snapshot_version,line_kind,
   pack_id,pack_definition_revision,pack_definition_fingerprint,canonical_line_identity,line_identity_hash,position)
  values(item_id,order_id,(line->>'productId')::uuid,(line->>'variantId')::uuid,line->>'name',line->>'size',line->>'sku',(line->>'quantity')::integer,
   (line->>'unitPrice')::numeric,2,line->>'kind',(line->>'packId')::uuid,(line->>'definitionRevision')::bigint,line->>'definitionFingerprint',line->'identity',line->>'identityHash',(line->>'position')::integer);
  for component in select value from jsonb_array_elements(line->'components') loop
   insert into public.order_item_components(order_id,order_item_id,tester_variant_id,tester_product_id,tester_name,sku,size,volume_ml,
    quantity_per_pack,total_physical_quantity,reference_unit_price,position)
   values(order_id,item_id,(component->>'testerVariantId')::uuid,(component->>'testerProductId')::uuid,component->>'testerName',component->>'sku','5 ml',5,
    (component->>'quantityPerPack')::integer,(component->>'totalPhysicalQuantity')::integer,(component->>'referenceUnitPrice')::numeric,(component->>'position')::integer);
  end loop;
 end loop;
 for physical in select value from jsonb_array_elements(quote->'_demand') loop
  update public.product_variants set stock_quantity=stock_quantity-(physical->>'quantity')::integer,
   available=case when exists(select 1 from public.tester_variants registry where registry.variant_id=product_variants.id)
    then product_variants.available else stock_quantity-(physical->>'quantity')::integer>0 end,updated_at=now()
   where id=(physical->>'variantId')::uuid returning stock_quantity into balance;
  insert into public.inventory_movements(variant_id,quantity_delta,balance_after,reason,reference_type,reference_id)
   values((physical->>'variantId')::uuid,-(physical->>'quantity')::integer,balance,'Order placed','order',order_id);
 end loop;
 insert into public.order_status_history(order_id,from_status,to_status,note) values(order_id,null,'Pending','Order created by v2 transactional checkout.');
 insert into public.payments(order_id,provider,amount,currency,status,idempotency_key)
  values(order_id,canonical->>5,(quote->>'total')::numeric,'PKR',case when canonical->>5='Cash on Delivery' then 'Unpaid'::public.payment_status else 'Pending'::public.payment_status end,key||':payment');
 if quote->>'_couponId' is not null then
  insert into public.coupon_redemptions(coupon_id,order_id,customer_id,customer_email,discount_amount)
   values((quote->>'_couponId')::uuid,order_id,p_customer_id,canonical->>8,(quote->>'discount')::numeric);
  update public.coupons set used_count=used_count+1,updated_at=now() where id=(quote->>'_couponId')::uuid;
 end if;
 return public.checkout_v2_receipt(order_id,false);
end; $fn$;

-- Invoker identity is essential: a SECURITY DEFINER guard would always see postgres.
create function public.checkout_snapshot_write_guard_013() returns trigger
language plpgsql set search_path='' as $fn$
declare row_value jsonb; related uuid; version integer;
begin
 if tg_op='TRUNCATE' then
  if current_user<>'postgres' then raise exception using errcode='42501',message='V2_DIRECT_WRITE_DENIED'; end if;
  return null;
 end if;
 row_value:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='orders' then
  version:=(row_value->>'checkout_version')::integer;
  if tg_op='INSERT' and (row_value->>'snapshot_version')::integer=0 then raise exception 'V2_HISTORICAL_SPOOF'; end if;
  if tg_op='UPDATE' then
   if (new.checkout_version,new.snapshot_version) is distinct from (old.checkout_version,old.snapshot_version) then raise exception 'V2_SNAPSHOT_IMMUTABLE'; end if;
   if old.checkout_version=2 and (to_jsonb(new)-array['status','payment_status','courier_name','tracking_number','internal_notes','updated_at','revision'])
    is distinct from (to_jsonb(old)-array['status','payment_status','courier_name','tracking_number','internal_notes','updated_at','revision']) then raise exception 'V2_SNAPSHOT_IMMUTABLE'; end if;
  end if;
  if version=2 and tg_op='DELETE' then raise exception 'V2_SNAPSHOT_IMMUTABLE'; end if;
 elsif tg_table_name in ('order_items','order_item_components') then
  related:=(row_value->>'order_id')::uuid;
  select checkout_version into version from public.orders where id=related;
  if tg_table_name='order_items' and tg_op='INSERT' and (row_value->>'snapshot_version')::integer=0 then raise exception 'V2_HISTORICAL_SPOOF'; end if;
  if tg_table_name='order_items' and tg_op='UPDATE' and to_jsonb(new)->'snapshot_version' is distinct from to_jsonb(old)->'snapshot_version' then raise exception 'V2_SNAPSHOT_IMMUTABLE'; end if;
  if tg_op<>'INSERT' and (version=2 or tg_table_name='order_item_components') then raise exception 'V2_SNAPSHOT_IMMUTABLE'; end if;
  if tg_table_name='order_items' and (row_value->>'snapshot_version')::integer=2 then version:=2; end if;
 else
  related:=case when tg_table_name='inventory_movements' and row_value->>'reference_type'='order' then (row_value->>'reference_id')::uuid else (row_value->>'order_id')::uuid end;
  select checkout_version into version from public.orders where id=related;
  -- Do not move a previously protected effect to a v1 order to bypass its guard.
  if tg_op='UPDATE' and current_user<>'postgres' then
   row_value:=to_jsonb(old);
   related:=case when tg_table_name='inventory_movements' and row_value->>'reference_type'='order' then (row_value->>'reference_id')::uuid else (row_value->>'order_id')::uuid end;
   if exists(select 1 from public.orders where id=related and checkout_version=2) then version:=2; end if;
  end if;
 end if;
 if version=2 and current_user<>'postgres' then raise exception using errcode='42501',message='V2_DIRECT_WRITE_DENIED'; end if;
 return case when tg_op='DELETE' then old else new end;
end; $fn$;
create function public.checkout_snapshot_validate_013() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare target_order_id uuid; o public.orders%rowtype; i public.order_items%rowtype; expected jsonb; actual jsonb; demand jsonb; ledger jsonb;
begin
 target_order_id:=(case when tg_table_name='orders' then to_jsonb(new)->>'id' else to_jsonb(new)->>'order_id' end)::uuid;
 select * into o from public.orders where orders.id=target_order_id;
 if not found then return null; end if;
 if exists(select 1 from public.order_items where order_id=target_order_id and snapshot_version<>o.snapshot_version) then raise exception 'V2_SNAPSHOT_INVALID'; end if;
 if o.checkout_version=1 then
  if exists(select 1 from public.order_item_components where order_id=target_order_id) then raise exception 'V2_SNAPSHOT_INVALID'; end if;
  return null;
 end if;
 if tg_table_name='order_item_components' then
  select * into i from public.order_items where order_items.id=(to_jsonb(new)->>'order_item_id')::uuid;
  expected:=o.quote_snapshot->'lines'->i.position->'components'->((to_jsonb(new)->>'position')::integer);
  actual:=jsonb_build_object('testerVariantId',to_jsonb(new)->'tester_variant_id','testerProductId',to_jsonb(new)->'tester_product_id',
   'testerName',to_jsonb(new)->'tester_name','sku',to_jsonb(new)->'sku','size',to_jsonb(new)->'size','volumeMl',to_jsonb(new)->'volume_ml',
   'quantityPerPack',to_jsonb(new)->'quantity_per_pack','totalPhysicalQuantity',to_jsonb(new)->'total_physical_quantity',
   'referenceUnitPrice',to_jsonb(new)->'reference_unit_price','position',to_jsonb(new)->'position');
  if i.snapshot_version<>2 or i.line_kind='normal_variant' or expected is distinct from actual
   or (to_jsonb(new)->>'total_physical_quantity')::bigint<>i.quantity::bigint*(to_jsonb(new)->>'quantity_per_pack')::bigint then raise exception 'V2_SNAPSHOT_INVALID'; end if;
  return null;
 end if;
 if tg_table_name='orders' then
 if o.request_fingerprint is distinct from public.checkout_v2_hash(o.canonical_request)
 or o.canonical_request->0 is distinct from '2'::jsonb or o.quote_fingerprint is distinct from o.quote_snapshot->>'quoteFingerprint'
 or jsonb_array_length(o.quote_snapshot->'lines') not between 1 and 100
 or (select count(*) from public.order_items where order_id=target_order_id)<>jsonb_array_length(o.quote_snapshot->'lines')
 or (select count(*) from public.order_item_components where order_id=target_order_id)>2000
 or (select coalesce(sum(line_total),0) from public.order_items where order_id=target_order_id)<>o.subtotal
 or (o.subtotal,o.discount,o.shipping_fee,o.total) is distinct from ((o.quote_snapshot->>'subtotal')::numeric,(o.quote_snapshot->>'discount')::numeric,(o.quote_snapshot->>'shippingFee')::numeric,(o.quote_snapshot->>'total')::numeric)
 then raise exception 'V2_SNAPSHOT_INVALID'; end if;
 end if;
 for i in select * from public.order_items where order_id=target_order_id and
  (tg_table_name='orders' or order_items.id=(to_jsonb(new)->>'id')::uuid) order by position loop
  expected:=o.quote_snapshot->'lines'->i.position;
  if expected is null or (i.canonical_line_identity,i.line_identity_hash,i.line_kind,i.product_id,i.variant_id,i.pack_id,i.pack_definition_revision,i.pack_definition_fingerprint,i.quantity,i.unit_price,i.line_total,i.product_name,i.sku,i.size)
   is distinct from (expected->'identity',public.checkout_v2_hash(expected->'identity'),expected->>'kind',(expected->>'productId')::uuid,(expected->>'variantId')::uuid,(expected->>'packId')::uuid,(expected->>'definitionRevision')::bigint,expected->>'definitionFingerprint',(expected->>'quantity')::integer,(expected->>'unitPrice')::numeric,(expected->>'lineTotal')::numeric,expected->>'name',expected->>'sku',expected->>'size')
   or expected->'identity' is distinct from o.canonical_request->1->i.position->'identity'
   or expected->'quantity' is distinct from o.canonical_request->1->i.position->'quantity' then raise exception 'V2_SNAPSHOT_INVALID'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('testerVariantId',c.tester_variant_id,'testerProductId',c.tester_product_id,'testerName',c.tester_name,
   'sku',c.sku,'size',c.size,'volumeMl',c.volume_ml,'quantityPerPack',c.quantity_per_pack,'totalPhysicalQuantity',c.total_physical_quantity,'referenceUnitPrice',c.reference_unit_price,'position',c.position) order by c.position),'[]') into actual
   from public.order_item_components c where c.order_item_id=i.id;
  if actual is distinct from expected->'components' or (i.line_kind='normal_variant' and jsonb_array_length(actual)<>0)
  or (i.line_kind<>'normal_variant' and jsonb_array_length(actual)=0)
  or exists(select 1 from public.order_item_components c where c.order_item_id=i.id and c.total_physical_quantity::bigint<>i.quantity::bigint*c.quantity_per_pack::bigint)
  then raise exception 'V2_SNAPSHOT_INVALID'; end if;
  if i.line_kind='configurable_tester_pack' and (select jsonb_agg(jsonb_build_array(c.tester_variant_id::text,c.quantity_per_pack) order by c.tester_variant_id) from public.order_item_components c where c.order_item_id=i.id) is distinct from i.canonical_line_identity->3 then raise exception 'V2_SNAPSHOT_INVALID'; end if;
 end loop;
 -- Creation-only ledger check. Future 014 status updates may add restoration movements.
 if tg_table_name='orders' and tg_op='INSERT' then
  select jsonb_agg(jsonb_build_array(v,q) order by v) into demand from (
   select v,sum(q) q from (
    select variant_id v,quantity::bigint q from public.order_items where order_id=target_order_id and line_kind='normal_variant'
    union all select tester_variant_id,total_physical_quantity::bigint from public.order_item_components where order_id=target_order_id
   ) physical group by v) x;
  select jsonb_agg(jsonb_build_array(variant_id,-quantity_delta::bigint) order by variant_id) into ledger from public.inventory_movements where reference_type='order' and reference_id=target_order_id and reason='Order placed';
  if demand is distinct from ledger or (select count(*) from public.payments where order_id=target_order_id and idempotency_key=o.idempotency_key||':payment' and amount=o.total and provider=o.payment_method)<>1 then raise exception 'V2_SNAPSHOT_INVALID'; end if;
 end if;
 return null;
end; $fn$;
do $triggers$
declare name text;
begin
 foreach name in array array['orders','order_items','order_item_components','payments','inventory_movements','coupon_redemptions','order_status_history'] loop
  execute format('create trigger snapshot_write_013 before insert or update or delete on public.%I for each row execute function public.checkout_snapshot_write_guard_013()',name);
  execute format('create trigger snapshot_truncate_013 before truncate on public.%I for each statement execute function public.checkout_snapshot_write_guard_013()',name);
 end loop;
 foreach name in array array['orders','order_items','order_item_components'] loop
  execute format('create constraint trigger snapshot_validate_013 after insert or update on public.%I deferrable initially deferred for each row execute function public.checkout_snapshot_validate_013()',name);
 end loop;
end; $triggers$;

-- Private V1 contracts: replay uses frozen values; commerce checks run only on creation.
create function public.checkout_v2_v1_receipt(p_order_id uuid,p_replay boolean) returns jsonb
language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',o.id,'idempotencyKey',public.checkout_v2_stored_uuid(o.idempotency_key)::text,
  'orderNumber',o.order_number,'status',o.status,'paymentStatus',o.payment_status,'paymentMethod',o.payment_method,
  'subtotal',o.subtotal,'discount',o.discount,'shippingFee',o.shipping_fee,'total',o.total,'currency',o.currency,'idempotent',p_replay)
 from public.orders o where o.id=p_order_id and o.checkout_version=1;
$fn$;
create function public.checkout_v2_v1_commerce(p_items jsonb,p_payment_method text) returns void
language plpgsql set search_path='' as $fn$
declare private_payments jsonb; public_payments jsonb; commerce jsonb; enabled jsonb; payment text; payments jsonb:='[]';
begin
 -- The preserved writer already holds variant/product/coupon locks here.
 if exists(select 1 from public.product_variants v where v.id in(select (x->>'variantId')::uuid from jsonb_array_elements(p_items) x)
  and (v.regular_price<=0 or v.regular_price='NaN'::numeric or (v.sale_price is not null and
   (v.sale_price<=0 or v.sale_price>=v.regular_price or v.sale_price='NaN'::numeric)))) then raise exception 'V1_CONFIGURATION_UNAVAILABLE'; end if;
 perform id from public.site_settings where id='site' for share;
 perform key from public.public_site_settings where key in ('payments','commerce') order by key for share;
 select s.payments into private_payments from public.site_settings s where id='site';
 select value into public_payments from public.public_site_settings where key='payments';
 select value into commerce from public.public_site_settings where key='commerce';
 foreach payment in array array['Cash on Delivery','Bank Transfer'] loop
  enabled:=null;
  if jsonb_typeof(private_payments)='array' then select x->'active' into enabled from jsonb_array_elements(private_payments) x where x->>'name'=payment limit 1; end if;
  if enabled is null or enabled='null'::jsonb then
   if jsonb_typeof(public_payments)='array' then select x->'active' into enabled from jsonb_array_elements(public_payments) x where x->>'name'=payment limit 1; end if;
  end if;
  if enabled is null or enabled='null'::jsonb then enabled:=commerce->case when payment='Cash on Delivery' then 'codEnabled' else 'bankTransferEnabled' end; end if;
  if enabled='true'::jsonb then payments:=payments||jsonb_build_array(payment); end if;
 end loop;
 if jsonb_array_length(payments)=0 then raise exception 'V1_CONFIGURATION_UNAVAILABLE'; end if;
 if not(payments ? p_payment_method) then raise exception 'V1_PAYMENT_UNAVAILABLE'; end if;
end; $fn$;
-- Preserve baseline transaction logic behind signature-preserving version fences.
alter function public.create_order_transaction(text,jsonb,jsonb,jsonb,text,text,uuid,uuid) rename to create_order_transaction_v1_013_internal;
revoke all on function public.create_order_transaction_v1_013_internal(text,jsonb,jsonb,jsonb,text,text,uuid,uuid) from public,anon,authenticated,service_role;
-- The exact baseline manifest pins this body. Add the former service-only checks
-- after existing commerce/row locks and before the first transactional effect.
do $v1_commerce$
declare definition text; anchor text:='  v_order_id := gen_random_uuid();'; shipping_anchor text:='order by display_order, created_at';
begin
 definition:=replace(pg_get_functiondef('public.create_order_transaction_v1_013_internal(text,jsonb,jsonb,jsonb,text,text,uuid,uuid)'::regprocedure),E'\r\n',E'\n');
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1
  or (length(definition)-length(replace(definition,shipping_anchor,'')))/length(shipping_anchor)<>1 then raise exception 'RF_CHECKOUT_013_V1_CONTRACT_DRIFT'; end if;
 definition:=replace(definition,anchor,'  perform public.checkout_v2_v1_commerce(p_items,p_payment_method);'||E'\n'||anchor);
 -- Match the former service's deterministic default-method selection.
 definition:=replace(definition,shipping_anchor,shipping_anchor||', id');
 execute definition;
end; $v1_commerce$;
create function public.create_order_transaction(p_idempotency_key text,p_items jsonb,p_contact jsonb,p_shipping jsonb,p_payment_method text,p_coupon_code text default null,p_shipping_method_id uuid default null,p_customer_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare key text; previous public.orders%rowtype; item jsonb; requested jsonb; stored jsonb; created jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='V2_PERMISSION_DENIED'; end if;
 key:=public.checkout_v2_key(p_idempotency_key);
 if p_customer_id is not null and not exists(select 1 from public.profiles where id=p_customer_id and status='Active') then
  raise exception using errcode='23503',message='Customer account is unavailable.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(key,0));
 previous:=public.checkout_v2_existing(key);
 if previous.id is not null then
  if previous.checkout_version<>1 then raise exception 'V2_IDEMPOTENCY_CONFLICT'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'V2_INVALID_REQUEST'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
   perform public.checkout_v2_uuid(item->'variantId');
   if public.checkout_v2_integer(item->'quantity')>99 then raise exception 'V2_INVALID_REQUEST'; end if;
  end loop;
  select jsonb_agg(jsonb_build_array(id::text,quantity) order by id) into requested from (
   select (x->>'variantId')::uuid id,sum((x->>'quantity')::bigint) quantity from jsonb_array_elements(p_items) x group by (x->>'variantId')::uuid
  ) lines;
  select jsonb_agg(jsonb_build_array(variant_id::text,quantity) order by variant_id) into stored from (
   select variant_id,sum(quantity::bigint) quantity from public.order_items where order_id=previous.id group by variant_id
  ) lines;
  if requested is distinct from stored or previous.customer_id is distinct from p_customer_id
   or previous.customer_name is distinct from btrim(coalesce(p_contact->>'name',''))
   or lower(coalesce(previous.customer_email,''))<>lower(btrim(coalesce(p_contact->>'email','')))
   or coalesce(previous.customer_phone,'')<>btrim(coalesce(p_contact->>'phone',''))
   or previous.shipping_address is distinct from btrim(coalesce(p_shipping->>'address',''))
   or previous.shipping_city is distinct from btrim(coalesce(p_shipping->>'city',''))
   or coalesce(previous.shipping_province,'')<>btrim(coalesce(p_shipping->>'province',''))
   or coalesce(previous.order_notes,'')<>btrim(coalesce(p_shipping->>'notes',''))
   or previous.payment_method is distinct from p_payment_method
   or upper(coalesce(previous.coupon_code,''))<>upper(btrim(coalesce(p_coupon_code,'')))
   or (p_shipping_method_id is not null and p_shipping_method_id is distinct from previous.shipping_method_id)
   then raise exception 'V2_IDEMPOTENCY_CONFLICT'; end if;
  -- Never pass a historical alias to the internal writer; replay is read-only.
  return public.checkout_v2_v1_receipt(previous.id,true);
 end if;
 created:=public.create_order_transaction_v1_013_internal(key,p_items,p_contact,p_shipping,p_payment_method,p_coupon_code,p_shipping_method_id,p_customer_id);
 return public.checkout_v2_v1_receipt((created->>'id')::uuid,(created->>'idempotent')::boolean);
end; $fn$;
alter function public.apply_admin_order_action(uuid,uuid,text,uuid,text,jsonb,text) rename to apply_admin_order_action_v1_013_internal;
revoke all on function public.apply_admin_order_action_v1_013_internal(uuid,uuid,text,uuid,text,jsonb,text) from public,anon,authenticated,service_role;
create function public.apply_admin_order_action(p_order_id uuid,p_actor_id uuid,p_action text,p_mutation_id uuid,p_expected_revision text,p_payload jsonb,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='PERMISSION_DENIED'; end if;
 if exists(select 1 from public.orders where id=p_order_id and checkout_version<>1) then raise exception 'ORDER_VERSION_UNSUPPORTED'; end if;
 return public.apply_admin_order_action_v1_013_internal(p_order_id,p_actor_id,p_action,p_mutation_id,p_expected_revision,p_payload,p_request_id);
end; $fn$;
do $acl$
declare f record;
begin
 for f in select p.oid::regprocedure identity from pg_proc p where p.pronamespace='public'::regnamespace and
  (p.proname like 'checkout_v2_%' or p.proname in ('create_order_transaction_v2','quote_checkout_v2','checkout_snapshot_write_guard_013','checkout_snapshot_validate_013','create_order_transaction','apply_admin_order_action')) loop
  execute format('alter function %s owner to postgres',f.identity);
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.identity);
 end loop;
end; $acl$;
grant execute on function public.quote_checkout_v2(jsonb,uuid) to service_role;
grant execute on function public.create_order_transaction(text,jsonb,jsonb,jsonb,text,text,uuid,uuid) to service_role;
grant execute on function public.apply_admin_order_action(uuid,uuid,text,uuid,text,jsonb,text) to service_role;
-- create_order_transaction_v2 deliberately has NO service execution until 014.
-- @013-DDL-END
$ddl013$;
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
  if shape not in ('ed337222eb5fdd9c9b3809ea550f939b9914e2ad2034d42e3e6a648205726261','e195cbf3221767a490c8c340c128b3f4ea8bdf42711d4845e3629160aa366557') then raise exception 'RF_CHECKOUT_013_INSTALL_DRIFT'; end if;
 end if;
end; $install013$;
commit;
