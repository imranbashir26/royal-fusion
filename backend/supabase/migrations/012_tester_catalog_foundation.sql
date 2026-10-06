-- Forward-only 012. Exact baseline/target recognition; no production execution or seeds.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public;
do $install$
declare installed_shape jsonb; item record; installed_proc pg_proc%rowtype; table_name text; role_name text; privilege_name text;
begin
 if to_regprocedure('public.save_catalog_product(uuid,jsonb,jsonb,text)') is null
 or not exists(select 1 from public.roles r join public.role_permissions rp on rp.role_id=r.id join public.permissions pe on pe.id=rp.permission_id where r.key='admin' and r.active and pe.key='*') then raise exception 'RF_TESTER_012_PREREQUISITE'; end if;
 if not exists(select 1 from pg_attribute where attrelid='public.products'::regclass and attname='commerce_kind' and not attisdropped) then
  select jsonb_build_object('price', (select jsonb_build_array(format_type(atttypid,atttypmod),attnotnull) from pg_attribute where attrelid='public.products'::regclass and attname='price'), 'constraints',(select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid,false)) order by conname) from pg_constraint where conrelid='public.products'::regclass and contype='c' and conkey && array(select attnum from pg_attribute where attrelid='public.products'::regclass and attname in ('price','sale_price','old_price'))), 'policy',(select jsonb_build_array(polcmd,polpermissive,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid),(select jsonb_agg(r.rolname order by r.rolname) from unnest(polroles) ro(id) join pg_roles r on r.oid=ro.id)) from pg_policy where polrelid='public.products'::regclass and polname='rf_products_public_read')) into installed_shape;
  if installed_shape is distinct from $baseline${"price":["numeric(12,2)",true],"policy":["r",true,"((status = 'Published'::publish_status) AND active)",null,["anon","authenticated"]],"constraints":[["products_old_price_check","CHECK (((old_price IS NULL) OR (old_price >= (0)::numeric)))"],["products_price_check","CHECK ((price > (0)::numeric))"],["products_sale_below_price","CHECK (((sale_price IS NULL) OR (sale_price = (0)::numeric) OR (sale_price < price)))"],["products_sale_price_check","CHECK (((sale_price IS NULL) OR (sale_price >= (0)::numeric)))"]]}$baseline$::jsonb then raise exception 'RF_TESTER_012_BASELINE_SHAPE'; end if;
  select * into installed_proc from pg_proc where oid='public.save_catalog_product(uuid,jsonb,jsonb,text)'::regprocedure;
  if md5(installed_proc.prosrc) not in ('f294a63acf84d64b9650d7389380df81','47a13aa39f3e793792250076de011cd5') or installed_proc.prokind<>'f' or installed_proc.provolatile<>'v' or installed_proc.proisstrict or installed_proc.proleakproof or installed_proc.proparallel<>'u' or installed_proc.prosupport<>0 or installed_proc.prolang<>(select oid from pg_language where lanname='plpgsql') or pg_get_function_arguments(installed_proc.oid) is distinct from 'p_product_id uuid, p_patch jsonb, p_variants jsonb DEFAULT NULL::jsonb, p_expected_revision text DEFAULT NULL::text' or not installed_proc.prosecdef or installed_proc.proowner<>(select oid from pg_roles where rolname='postgres') or installed_proc.proconfig is distinct from array['search_path=""'] or has_function_privilege('anon',installed_proc.oid,'EXECUTE') or has_function_privilege('authenticated',installed_proc.oid,'EXECUTE') or not has_function_privilege('service_role',installed_proc.oid,'EXECUTE') then raise exception 'RF_TESTER_012_BASELINE_WRITER'; end if;
  if exists(select 1 from pg_class where relnamespace='public'::regnamespace and relname in ('tester_variants','tester_packs','tester_pack_components','tester_pack_allowed_variants'))
   or exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in ('tester_catalog_assert_admin','tester_pack_definition_hash','set_tester_updated_at','validate_tester_catalog','derive_tester_availability','sync_tester_manual_availability','tester_product_patch','save_tester_product','save_tester_pack','save_normal_collection_products','save_catalog_product_012_internal'))
   or exists(select 1 from pg_constraint where conname='product_variants_identity_owner_key' and conrelid='public.product_variants'::regclass) then raise exception 'RF_TESTER_012_NAME_COLLISION'; end if;
  execute $catalog_ddl$
-- Local implementation only. No seeds and no checkout/order/fulfillment changes.
-- Installation/rerun envelope and exact compatibility manifests follow below.
alter table public.products add column commerce_kind text not null default 'standard';
alter table public.products alter column price drop not null;
alter table public.products add constraint products_commerce_kind_valid check (commerce_kind in ('standard','tester','tester_pack'));
alter table public.products add constraint products_commerce_price_shape check (
 (commerce_kind in ('standard','tester') and price is not null and price > 0)
 or (commerce_kind='tester_pack' and price is null and sale_price is null and old_price is null
   and stock_quantity=0 and bottle_size='' and size_options='[]'::jsonb and variations='[]'::jsonb));
alter table public.product_variants add constraint product_variants_identity_owner_key unique(id,product_id);

create table public.tester_variants (
 variant_id uuid primary key,
 tester_product_id uuid not null unique references public.products(id) on delete restrict,
 source_product_id uuid references public.products(id) on delete restrict,
 volume_ml numeric(4,2) not null default 5.00 check(volume_ml=5.00),
 manual_available boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint tester_variant_owner_fk foreign key(variant_id,tester_product_id) references public.product_variants(id,product_id) on delete restrict,
 constraint tester_source_distinct check(source_product_id is null or source_product_id<>tester_product_id)
);
create index tester_variants_source_idx on public.tester_variants(source_product_id) where source_product_id is not null;
create table public.tester_packs (
 product_id uuid primary key references public.products(id) on delete restrict,
 mode text not null check(mode in ('fixed','configurable')),
 minimum_units integer, maximum_units integer,
 fixed_regular_price numeric(12,2), fixed_sale_price numeric(12,2),
 manual_available boolean not null default true,
 definition_revision bigint not null default 1 check(definition_revision>0),
 definition_fingerprint text not null check(definition_fingerprint ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint tester_pack_mode_shape check(
  (mode='fixed' and minimum_units is null and maximum_units is null and fixed_regular_price is not null and fixed_regular_price>0
   and (fixed_sale_price is null or (fixed_sale_price>0 and fixed_sale_price<fixed_regular_price)))
  or (mode='configurable' and minimum_units is not null and minimum_units=2 and (maximum_units is null or maximum_units>=2)
    and fixed_regular_price is null and fixed_sale_price is null))
);
create table public.tester_pack_components (
 pack_id uuid not null references public.tester_packs(product_id) on delete restrict,
 tester_variant_id uuid not null references public.tester_variants(variant_id) on delete restrict,
 quantity_per_pack integer not null check(quantity_per_pack>0),
 display_order integer not null default 0 check(display_order>=0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(pack_id,tester_variant_id)
);
create table public.tester_pack_allowed_variants (
 pack_id uuid not null references public.tester_packs(product_id) on delete restrict,
 tester_variant_id uuid not null references public.tester_variants(variant_id) on delete restrict,
 active boolean not null default true,
 display_order integer not null default 0 check(display_order>=0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(pack_id,tester_variant_id)
);
create index tester_components_variant_idx on public.tester_pack_components(tester_variant_id,pack_id);
create index tester_components_display_idx on public.tester_pack_components(pack_id,display_order,tester_variant_id);
create index tester_allowed_variant_idx on public.tester_pack_allowed_variants(tester_variant_id,pack_id);
create index tester_allowed_display_idx on public.tester_pack_allowed_variants(pack_id,display_order,tester_variant_id) where active;

create function public.tester_catalog_assert_admin(p_actor_id uuid,p_request_id text) returns void
language plpgsql security definer set search_path='' as $fn$
begin
 if coalesce(auth.role(),'')<>'service_role' or p_request_id is null or length(p_request_id) not between 8 and 80
 or not exists(select 1 from public.profiles pr join public.user_roles ur on ur.user_id=pr.id
  join public.roles r on r.id=ur.role_id join public.role_permissions rp on rp.role_id=r.id
  join public.permissions pe on pe.id=rp.permission_id
  where pr.id=p_actor_id and pr.status='Active' and ur.active and r.active and r.key='admin' and pe.key='*') then
  raise exception using errcode='42501',message='TESTER_PERMISSION_DENIED';
 end if;
end;
$fn$;
create function public.tester_pack_definition_hash(p_id uuid) returns text
language sql stable security definer set search_path='' as $fn$
 select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
  'mode',d.mode,'minimum',d.minimum_units,'maximum',d.maximum_units,'regular',d.fixed_regular_price,
  'sale',d.fixed_sale_price,'available',d.manual_available,'status',p.status,'active',p.active,
  'components',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.tester_variant_id,c.quantity_per_pack) order by c.tester_variant_id)
    from public.tester_pack_components c where c.pack_id=d.product_id),'[]'::jsonb),
  'allowed',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.tester_variant_id,a.active) order by a.tester_variant_id)
    from public.tester_pack_allowed_variants a where a.pack_id=d.product_id),'[]'::jsonb)
 )::text,'UTF8')),'hex') from public.tester_packs d join public.products p on p.id=d.product_id where d.product_id=p_id;
$fn$;
create function public.set_tester_updated_at() returns trigger language plpgsql set search_path='' as $fn$
begin
 if tg_table_name='products' then
  if new.commerce_kind is distinct from old.commerce_kind then raise exception 'TESTER_KIND_IMMUTABLE'; end if;
 elsif tg_table_name='tester_variants' then
  if (new.variant_id,new.tester_product_id,new.volume_ml) is distinct from (old.variant_id,old.tester_product_id,old.volume_ml) then raise exception 'TESTER_IDENTITY_IMMUTABLE'; end if;
 elsif tg_table_name='tester_packs' then
  if (new.product_id,new.mode) is distinct from (old.product_id,old.mode) then raise exception 'TESTER_MODE_IMMUTABLE'; end if;
 end if;
 if tg_table_name in ('tester_pack_components','tester_pack_allowed_variants') then
  if (new.pack_id,new.tester_variant_id) is distinct from (old.pack_id,old.tester_variant_id) then raise exception 'TESTER_MEMBERSHIP_IDENTITY_IMMUTABLE'; end if;
 end if;
 if tg_table_name<>'products' then new.updated_at:=now(); end if;
 return new;
end;
$fn$;
create trigger products_tester_kind_guard before update on public.products for each row execute function public.set_tester_updated_at();
create trigger tester_variants_update_guard before update on public.tester_variants for each row execute function public.set_tester_updated_at();
create trigger tester_packs_update_guard before update on public.tester_packs for each row execute function public.set_tester_updated_at();
create trigger tester_components_updated before update on public.tester_pack_components for each row execute function public.set_tester_updated_at();
create trigger tester_allowed_updated before update on public.tester_pack_allowed_variants for each row execute function public.set_tester_updated_at();

-- Inventory stays variant-first. Read intent without taking a registry lock here.
-- Registry writes through the approved writer already hold the variant/parent locks.
create function public.derive_tester_availability() returns trigger language plpgsql security definer set search_path='' as $fn$
declare manual boolean;
begin
 select t.manual_available into manual from public.tester_variants t where t.variant_id=new.id;
 if found then new.available:=manual and new.stock_quantity>0; end if;
 return new;
end;
$fn$;
create trigger variants_tester_availability before insert or update on public.product_variants
 for each row execute function public.derive_tester_availability();
create function public.sync_tester_manual_availability() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 -- One-way registry -> variant synchronization; no registry write or recursive loop.
 update public.product_variants set available=new.manual_available and stock_quantity>0
 where id=new.variant_id and available is distinct from (new.manual_available and stock_quantity>0);
 return null;
end;
$fn$;
create trigger registry_tester_availability after insert or update of manual_available on public.tester_variants
 for each row execute function public.sync_tester_manual_availability();

create function public.validate_tester_catalog() returns trigger language plpgsql security definer set search_path='' as $fn$
declare parent_id uuid; row_data jsonb; affected_packs uuid[]; publication_invalid boolean;
begin
 row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 parent_id:=(case tg_table_name when 'products' then row_data->>'id' when 'product_variants' then row_data->>'product_id' when 'tester_variants' then row_data->>'tester_product_id' when 'tester_packs' then row_data->>'product_id' else row_data->>'pack_id' end)::uuid;
 -- Deferred checks inspect final transactional state, never intermediate membership replacement.
 if exists(select 1 from public.product_variants v join public.products p on p.id=v.product_id where p.id=parent_id and p.commerce_kind='tester_pack')
 or exists(select 1 from public.products p where p.id=parent_id and p.commerce_kind='tester_pack' and not exists(select 1 from public.tester_packs d where d.product_id=p.id))
 or exists(select 1 from public.tester_packs d join public.products p on p.id=d.product_id where p.id=parent_id and p.commerce_kind<>'tester_pack') then raise exception 'TESTER_PACK_SHAPE_INVALID'; end if;
 if exists(select 1 from public.tester_variants t join public.products p on p.id=t.tester_product_id
  left join public.products s on s.id=t.source_product_id where p.id=parent_id and (p.commerce_kind<>'tester' or (s.id is not null and s.commerce_kind<>'standard')))
 or exists(select 1 from public.products p where p.id=parent_id and p.commerce_kind='tester' and
   ((select count(*) from public.tester_variants t where t.tester_product_id=p.id)<>1
    or (select count(*) from public.product_variants v where v.product_id=p.id)<>1)) then raise exception 'TESTER_REGISTRY_INVALID'; end if;
 -- The numeric registry is authoritative, and its physical/display identity must agree.
 -- Testers use the relational variant exclusively; alternative legacy size arrays are empty.
 if exists(select 1 from public.tester_variants t join public.products p on p.id=t.tester_product_id
  join public.product_variants v on v.id=t.variant_id where p.id=parent_id and (
   t.volume_ml<>5.00 or v.product_id<>p.id or v.option_name<>'Size' or v.option_value<>'5 ml'
   or p.bottle_size<>'5 ml' or p.size_options<>'[]'::jsonb or p.variations<>'[]'::jsonb)) then raise exception 'TESTER_SIZE_INVALID'; end if;
 if exists(select 1 from public.tester_variants t join public.product_variants v on v.id=t.variant_id
  where t.tester_product_id=parent_id and (t.manual_available is null
   or v.available is distinct from (t.manual_available and v.stock_quantity>0))) then raise exception 'TESTER_AVAILABILITY_INVALID'; end if;
 if exists(select 1 from public.tester_pack_components c join public.tester_packs d on d.product_id=c.pack_id where d.product_id=parent_id and d.mode<>'fixed')
 or exists(select 1 from public.tester_pack_allowed_variants a join public.tester_packs d on d.product_id=a.pack_id where d.product_id=parent_id and d.mode<>'configurable')
 or exists(select 1 from public.tester_packs d where d.product_id=parent_id and (
   (select count(*) from public.tester_pack_components c where c.pack_id=d.product_id)>100
   or (select count(*) from public.tester_pack_allowed_variants a where a.pack_id=d.product_id)>100)) then raise exception 'TESTER_MEMBERSHIP_INVALID'; end if;
 if exists(select 1 from public.tester_packs d join public.products p on p.id=d.product_id where d.product_id=parent_id and (
   d.definition_fingerprint is distinct from public.tester_pack_definition_hash(d.product_id)
   or (p.status='Published' and (
    (d.mode='fixed' and not exists(select 1 from public.tester_pack_components c where c.pack_id=d.product_id))
    or (d.mode='configurable' and not exists(select 1 from public.tester_pack_allowed_variants a where a.pack_id=d.product_id and a.active)))))) then raise exception 'TESTER_DEFINITION_INVALID'; end if;
 -- Recheck both the edited pack and packs affected by a tester lifecycle/variant edit.
 -- Never cascade publication changes or rewrite definitions/revisions here.
 -- The dependency lookup itself needs a fresh snapshot, even if it finds no packs.
 if exists(select 1 from public.products p where p.id=parent_id and p.commerce_kind in ('tester','tester_pack'))
  and current_setting('transaction_isolation')<>'read committed' then raise exception 'TESTER_PUBLICATION_ISOLATION_UNSUPPORTED'; end if;
 select array_agg(distinct ids.id) into affected_packs from (
  select parent_id id
  union select c.pack_id from public.tester_variants t join public.tester_pack_components c on c.tester_variant_id=t.variant_id where t.tester_product_id=parent_id
  union select a.pack_id from public.tester_variants t join public.tester_pack_allowed_variants a on a.tester_variant_id=t.variant_id where t.tester_product_id=parent_id
 ) ids;
 if exists(select 1 from public.tester_packs d join public.products p on p.id=d.product_id
  where d.product_id=any(affected_packs) and p.status='Published' and p.active) then
  -- Fresh snapshots after lock waits avoid publication/lifecycle write skew.
  if exists(select 1 from public.tester_packs d join public.products p on p.id=d.product_id
   where d.product_id=parent_id and p.status='Published' and p.active) then
   -- Publication holds shared locks through commit, variants first then tester parents.
   -- Tester edits already hold their variant/parent locks and do not lock dependent packs.
   perform v.id from public.product_variants v where v.id in (
    select c.tester_variant_id from public.tester_pack_components c where c.pack_id=parent_id
    union select a.tester_variant_id from public.tester_pack_allowed_variants a where a.pack_id=parent_id
   ) order by v.id for share;
   perform p.id from public.products p where p.id in (
    select t.tester_product_id from public.tester_variants t where t.variant_id in (
     select c.tester_variant_id from public.tester_pack_components c where c.pack_id=parent_id
     union select a.tester_variant_id from public.tester_pack_allowed_variants a where a.pack_id=parent_id
    )
   ) order by p.id for share;
  end if;
  with eligible as (
   select t.variant_id from public.tester_variants t join public.product_variants v on v.id=t.variant_id and v.product_id=t.tester_product_id
   join public.products p on p.id=t.tester_product_id
   where t.volume_ml=5.00 and p.commerce_kind='tester' and p.status='Published' and p.active
    and v.option_name='Size' and v.option_value='5 ml' and v.active
    -- Stock and manual merchandising intent affect runtime, never definition validity.
    and v.regular_price>0 and v.regular_price<>'NaN'::numeric
    and (v.sale_price is null or (v.sale_price>0 and v.sale_price<v.regular_price))
  ) select exists(select 1 from public.tester_packs d join public.products p on p.id=d.product_id
   where d.product_id=any(affected_packs) and p.status='Published' and p.active and (
    (d.mode='fixed' and (not exists(select 1 from public.tester_pack_components c where c.pack_id=d.product_id)
     or exists(select 1 from public.tester_pack_components c where c.pack_id=d.product_id and not exists(select 1 from eligible e where e.variant_id=c.tester_variant_id))))
    or (d.mode='configurable' and not exists(select 1 from public.tester_pack_allowed_variants a join eligible e on e.variant_id=a.tester_variant_id where a.pack_id=d.product_id and a.active))
   )) into publication_invalid;
  if publication_invalid then raise exception 'TESTER_PUBLICATION_INVALID'; end if;
 end if;
 return null;
end;
$fn$;
create constraint trigger products_tester_validate after insert or update or delete on public.products deferrable initially deferred for each row execute function public.validate_tester_catalog();
create constraint trigger variants_tester_validate after insert or update or delete on public.product_variants deferrable initially deferred for each row execute function public.validate_tester_catalog();
create constraint trigger registry_tester_validate after insert or update or delete on public.tester_variants deferrable initially deferred for each row execute function public.validate_tester_catalog();
create constraint trigger packs_tester_validate after insert or update or delete on public.tester_packs deferrable initially deferred for each row execute function public.validate_tester_catalog();
create constraint trigger components_tester_validate after insert or update or delete on public.tester_pack_components deferrable initially deferred for each row execute function public.validate_tester_catalog();
create constraint trigger allowed_tester_validate after insert or update or delete on public.tester_pack_allowed_variants deferrable initially deferred for each row execute function public.validate_tester_catalog();

-- Retain the reviewed 011 normal writer byte-for-byte, with private execution.
alter function public.save_catalog_product(uuid,jsonb,jsonb,text) rename to save_catalog_product_012_internal;
revoke all on function public.save_catalog_product_012_internal(uuid,jsonb,jsonb,text) from public,anon,authenticated,service_role;
create function public.save_catalog_product(p_product_id uuid,p_patch jsonb,p_variants jsonb default null,p_expected_revision text default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='Catalog saves require the backend service.'; end if;
 if exists(select 1 from public.products where id=p_product_id and commerce_kind='tester_pack') then raise exception 'TESTER_PACK_NORMAL_WRITER_DENIED'; end if;
 if exists(select 1 from public.products where id=p_product_id and commerce_kind='tester') then raise exception 'TESTER_SPECIAL_WRITER_REQUIRED'; end if;
 return public.save_catalog_product_012_internal(p_product_id,p_patch,p_variants,p_expected_revision);
end;
$fn$;

create function public.tester_product_patch(p_id uuid,p_patch jsonb,p_kind text) returns public.products
language plpgsql security definer set search_path='' as $fn$
declare names text; expressions text; assignments text; saved public.products%rowtype;
 allowed text[]:=array['name','slug','sku','short_description','description','price','sale_price','old_price','stock_quantity','stock_status',
 'category_id','category_name','collection','gender','scent_family','top_notes','middle_notes','base_notes','bottle_size','concentration',
 'longevity','sillage','occasion','inspired_by','main_image_url','gallery_urls','image_alt','badge','tags','size_options','variations',
 'is_featured','is_best_seller','is_new_arrival','is_premium','is_attar','status','seo_title','seo_description','card_image_url','card_hover_image_url','card_background_color','active','published_at'];
begin
 if p_patch is null or jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>32768
 or exists(select 1 from jsonb_object_keys(p_patch) k where not(k=any(allowed))) then raise exception 'TESTER_PATCH_INVALID'; end if;
 select string_agg(format('%I',k),',' order by k),string_agg(format('r.%I',k),',' order by k),
 string_agg(format('%I=r.%I',k,k),',' order by k) into names,expressions,assignments from jsonb_object_keys(p_patch) k;
 if p_id is null then
  if names is null then raise exception 'TESTER_PATCH_INVALID'; end if;
  execute format('insert into public.products(commerce_kind,%s) select $2,%s from jsonb_populate_record(null::public.products,$1) r returning *',names,expressions) into saved using p_patch,p_kind;
 else
  select * into saved from public.products where id=p_id;
  if not found or saved.commerce_kind<>p_kind then raise exception 'TESTER_NOT_FOUND'; end if;
  if names is not null and not(to_jsonb(saved) @> p_patch) then
   execute format('update public.products p set %s from jsonb_populate_record(null::public.products,$1) r where p.id=$2 returning p.*',assignments) into saved using p_patch,p_id;
  end if;
 end if;
 return saved;
end;
$fn$;
create function public.save_tester_product(p_product_id uuid,p_patch jsonb,p_variant jsonb,p_source_product_id uuid,p_expected_revision text,p_actor_id uuid,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare saved public.products%rowtype; reg public.tester_variants%rowtype; v public.product_variants%rowtype; result jsonb; changed boolean;
begin
 perform public.tester_catalog_assert_admin(p_actor_id,p_request_id);
 if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_variant is null or jsonb_typeof(p_variant)<>'object'
 or octet_length(jsonb_build_array(p_patch,p_variant)::text)>32768
 or p_variant->>'optionName' is distinct from 'Size' or p_variant->>'optionValue' is distinct from '5 ml'
 or exists(select 1 from jsonb_object_keys(p_variant) k where k not in ('id','optionName','optionValue','sku','regularPrice','salePrice','stockQuantity','active','available','displayOrder'))
 or jsonb_typeof(p_variant->'regularPrice') is distinct from 'number' or jsonb_typeof(p_variant->'stockQuantity') is distinct from 'number'
 or jsonb_typeof(p_variant->'active') is distinct from 'boolean' or jsonb_typeof(p_variant->'available') is distinct from 'boolean'
 or jsonb_typeof(p_variant->'displayOrder') is distinct from 'number' or jsonb_typeof(p_variant->'sku') is distinct from 'string'
 or not(p_variant ?& array['optionName','optionValue','sku','regularPrice','stockQuantity','active','available','displayOrder']) then raise exception 'TESTER_PATCH_INVALID'; end if;
 -- Stock is variant-authoritative, never compare/write the aggregate product alias as inventory.
 p_patch:=p_patch - 'stock_quantity' - 'stock_status';
 if p_product_id is not null then
  -- Match checkout and existing writer: all sibling inventory rows, then parent.
  perform id from public.product_variants where product_id=p_product_id order by id for update;
  select * into saved from public.products where id=p_product_id for update;
  if not found or saved.commerce_kind<>'tester' then raise exception 'TESTER_NOT_FOUND'; end if;
  if p_expected_revision is null or saved.catalog_revision::text<>p_expected_revision then raise exception 'CATALOG_STALE'; end if;
  select * into reg from public.tester_variants where tester_product_id=saved.id;
  select * into v from public.product_variants where id=reg.variant_id;
  if p_variant->>'id' is distinct from reg.variant_id::text then raise exception 'TESTER_IDENTITY_IMMUTABLE'; end if;
  changed:=not(to_jsonb(saved) @> p_patch) or reg.source_product_id is distinct from p_source_product_id
   or jsonb_build_object('id',v.id,'optionName',v.option_name,'optionValue',v.option_value,'sku',v.sku,'regularPrice',v.regular_price,
    'salePrice',v.sale_price,'stockQuantity',v.stock_quantity,'active',v.active,'available',reg.manual_available,'displayOrder',v.display_order)
    is distinct from (p_variant || jsonb_build_object('salePrice',p_variant->'salePrice'));
  if not changed then return jsonb_build_object('product',to_jsonb(saved),'variants',jsonb_build_array(to_jsonb(v)),'tester',to_jsonb(reg)); end if;
 else
  if p_expected_revision is not null or p_variant ? 'id' then raise exception 'TESTER_PATCH_INVALID'; end if;
 end if;
 if p_source_product_id is not null and not exists(select 1 from public.products where id=p_source_product_id and commerce_kind='standard') then raise exception 'TESTER_SOURCE_INVALID'; end if;
 saved:=public.tester_product_patch(p_product_id,p_patch || jsonb_build_object('bottle_size','5 ml'),'tester');
 -- For this tester-only writer, p_variant.available is manual Admin intent.
 -- Existing registrations are updated only after the variant-first locks above.
 if p_product_id is not null then
  update public.tester_variants set source_product_id=p_source_product_id,manual_available=(p_variant->>'available')::boolean
  where tester_product_id=saved.id and (source_product_id,manual_available) is distinct from (p_source_product_id,(p_variant->>'available')::boolean);
  -- Synchronization may advance the existing aggregate catalog revision.
  select * into saved from public.products where id=saved.id;
 end if;
 result:=public.save_catalog_product_012_internal(saved.id,'{}'::jsonb,
  jsonb_build_array(p_variant || jsonb_build_object('available',(p_variant->>'available')::boolean and (p_variant->>'stockQuantity')::integer>0)),saved.catalog_revision::text);
 if p_product_id is null then
  insert into public.tester_variants(variant_id,tester_product_id,source_product_id,manual_available)
  values((result->'variants'->0->>'id')::uuid,saved.id,p_source_product_id,(p_variant->>'available')::boolean);
 end if;
 insert into public.admin_audit_logs(admin_id,action,resource,resource_id,permission_key,request_id,metadata)
 values(p_actor_id,case when p_product_id is null then 'tester.create' else 'tester.update' end,'products',saved.id::text,'products.manage',p_request_id,'{}');
 return result || jsonb_build_object('variants',(select jsonb_agg(to_jsonb(physical) order by physical.id) from public.product_variants physical where physical.product_id=saved.id),
  'tester',(select to_jsonb(t) from public.tester_variants t where tester_product_id=saved.id));
end;
$fn$;

create function public.save_tester_pack(p_product_id uuid,p_patch jsonb,p_definition jsonb,p_expected_revision text,p_expected_definition_revision text,p_actor_id uuid,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare saved public.products%rowtype; d public.tester_packs%rowtype; old_product jsonb; old_definition jsonb;
 item jsonb; ids uuid[]; member_id uuid; hash text; changed boolean:=false; previous_members jsonb;
begin
 perform public.tester_catalog_assert_admin(p_actor_id,p_request_id);
 if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_definition is null or jsonb_typeof(p_definition)<>'object'
 or octet_length(jsonb_build_array(p_patch,p_definition)::text)>32768
 or exists(select 1 from jsonb_each(p_definition) e where (e.key in ('minimumUnits','maximumUnits','fixedRegularPrice','fixedSalePrice') and jsonb_typeof(e.value) not in ('number','null')) or (e.key='manualAvailable' and jsonb_typeof(e.value)<>'boolean'))
 or exists(select 1 from jsonb_object_keys(p_definition) k where k not in ('mode','minimumUnits','maximumUnits','fixedRegularPrice','fixedSalePrice','manualAvailable','components','allowedVariants'))
 or exists(select 1 from jsonb_object_keys(p_patch) k where k in ('price','sale_price','old_price','stock_quantity','stock_status','bottle_size','size_options','variations')) then raise exception 'TESTER_PATCH_INVALID'; end if;
 if p_product_id is not null then
  -- Catalog pack writers never mutate component inventory and acquire only their own parent first.
  select * into saved from public.products where id=p_product_id for update;
  if not found or saved.commerce_kind<>'tester_pack' then raise exception 'TESTER_NOT_FOUND'; end if;
  select * into d from public.tester_packs where product_id=saved.id for update;
  if p_expected_revision is null or p_expected_definition_revision is null
   or saved.catalog_revision::text<>p_expected_revision or d.definition_revision::text<>p_expected_definition_revision then raise exception 'CATALOG_STALE'; end if;
  if p_definition ? 'mode' and p_definition->>'mode' is distinct from d.mode then raise exception 'TESTER_MODE_IMMUTABLE'; end if;
  old_product:=to_jsonb(saved); old_definition:=to_jsonb(d);
 else
  if p_expected_revision is not null or p_expected_definition_revision is not null then raise exception 'TESTER_PATCH_INVALID'; end if;
  changed:=true;
 end if;
 saved:=public.tester_product_patch(p_product_id,case when p_product_id is null then p_patch ||
  jsonb_build_object('price',null,'sale_price',null,'old_price',null,'stock_quantity',0,'bottle_size','','size_options','[]'::jsonb,'variations','[]'::jsonb) else p_patch end,'tester_pack');
 if p_product_id is null then
  insert into public.tester_packs(product_id,mode,minimum_units,maximum_units,fixed_regular_price,fixed_sale_price,manual_available,definition_fingerprint)
  values(saved.id,p_definition->>'mode',case when p_definition->>'mode'='configurable' then coalesce((p_definition->>'minimumUnits')::integer,2) else (p_definition->>'minimumUnits')::integer end,
   (p_definition->>'maximumUnits')::integer,(p_definition->>'fixedRegularPrice')::numeric,(p_definition->>'fixedSalePrice')::numeric,
   coalesce((p_definition->>'manualAvailable')::boolean,true),repeat('0',64)) returning * into d;
 else
  update public.tester_packs set
   minimum_units=case when p_definition ? 'minimumUnits' then (p_definition->>'minimumUnits')::integer else minimum_units end,
   maximum_units=case when p_definition ? 'maximumUnits' then (p_definition->>'maximumUnits')::integer else maximum_units end,
   fixed_regular_price=case when p_definition ? 'fixedRegularPrice' then (p_definition->>'fixedRegularPrice')::numeric else fixed_regular_price end,
   fixed_sale_price=case when p_definition ? 'fixedSalePrice' then (p_definition->>'fixedSalePrice')::numeric else fixed_sale_price end,
   manual_available=case when p_definition ? 'manualAvailable' then (p_definition->>'manualAvailable')::boolean else manual_available end
  where product_id=saved.id and (minimum_units,maximum_units,fixed_regular_price,fixed_sale_price,manual_available) is distinct from (
   case when p_definition ? 'minimumUnits' then (p_definition->>'minimumUnits')::integer else minimum_units end,
   case when p_definition ? 'maximumUnits' then (p_definition->>'maximumUnits')::integer else maximum_units end,
   case when p_definition ? 'fixedRegularPrice' then (p_definition->>'fixedRegularPrice')::numeric else fixed_regular_price end,
   case when p_definition ? 'fixedSalePrice' then (p_definition->>'fixedSalePrice')::numeric else fixed_sale_price end,
   case when p_definition ? 'manualAvailable' then (p_definition->>'manualAvailable')::boolean else manual_available end);
  changed:=changed or found;
 end if;
 if p_definition ? 'components' then
  if d.mode<>'fixed' or jsonb_typeof(p_definition->'components')<>'array' or jsonb_array_length(p_definition->'components')>100 then raise exception 'TESTER_MEMBERSHIP_INVALID'; end if;
  ids:='{}';
  for item in select value from jsonb_array_elements(p_definition->'components') loop
   if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'testerVariantId') is distinct from 'string' or jsonb_typeof(item->'quantityPerPack') is distinct from 'number' or jsonb_typeof(item->'displayOrder') is distinct from 'number' or not(item ?& array['testerVariantId','quantityPerPack','displayOrder'])
    or exists(select 1 from jsonb_object_keys(item) k where k not in ('testerVariantId','quantityPerPack','displayOrder')) then raise exception 'TESTER_MEMBERSHIP_INVALID'; end if;
   member_id:=(item->>'testerVariantId')::uuid;
   if member_id is null or member_id=any(ids) then raise exception 'TESTER_MEMBERSHIP_INVALID'; end if;
   ids:=array_append(ids,member_id);
   insert into public.tester_pack_components(pack_id,tester_variant_id,quantity_per_pack,display_order)
   values(saved.id,member_id,(item->>'quantityPerPack')::integer,(item->>'displayOrder')::integer)
   on conflict(pack_id,tester_variant_id) do update set quantity_per_pack=excluded.quantity_per_pack,display_order=excluded.display_order
    where (tester_pack_components.quantity_per_pack,tester_pack_components.display_order) is distinct from (excluded.quantity_per_pack,excluded.display_order);
   changed:=changed or found;
  end loop;
  delete from public.tester_pack_components where pack_id=saved.id and not(tester_variant_id=any(ids)); changed:=changed or found;
 end if;
 if p_definition ? 'allowedVariants' then
  if d.mode<>'configurable' or jsonb_typeof(p_definition->'allowedVariants')<>'array' or jsonb_array_length(p_definition->'allowedVariants')>100 then raise exception 'TESTER_MEMBERSHIP_INVALID'; end if;
  ids:='{}';
  for item in select value from jsonb_array_elements(p_definition->'allowedVariants') loop
   if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'testerVariantId') is distinct from 'string' or jsonb_typeof(item->'active') is distinct from 'boolean' or jsonb_typeof(item->'displayOrder') is distinct from 'number' or not(item ?& array['testerVariantId','active','displayOrder'])
    or exists(select 1 from jsonb_object_keys(item) k where k not in ('testerVariantId','active','displayOrder')) then raise exception 'TESTER_MEMBERSHIP_INVALID'; end if;
   member_id:=(item->>'testerVariantId')::uuid;
   if member_id is null or member_id=any(ids) then raise exception 'TESTER_MEMBERSHIP_INVALID'; end if;
   ids:=array_append(ids,member_id);
   insert into public.tester_pack_allowed_variants(pack_id,tester_variant_id,active,display_order)
   values(saved.id,member_id,(item->>'active')::boolean,(item->>'displayOrder')::integer)
   on conflict(pack_id,tester_variant_id) do update set active=excluded.active,display_order=excluded.display_order
    where (tester_pack_allowed_variants.active,tester_pack_allowed_variants.display_order) is distinct from (excluded.active,excluded.display_order);
   changed:=changed or found;
  end loop;
  delete from public.tester_pack_allowed_variants where pack_id=saved.id and not(tester_variant_id=any(ids)); changed:=changed or found;
 end if;
 hash:=public.tester_pack_definition_hash(saved.id);
 if p_product_id is not null then
  if hash is distinct from d.definition_fingerprint then
   update public.tester_packs set definition_revision=definition_revision+1,definition_fingerprint=hash where product_id=saved.id;
  end if;
  changed:=changed or old_product is distinct from to_jsonb(saved);
  if changed and old_product=to_jsonb(saved) then update public.products set updated_at=now() where id=saved.id returning * into saved; end if;
 else update public.tester_packs set definition_fingerprint=hash where product_id=saved.id;
 end if;
 if changed then
  insert into public.admin_audit_logs(admin_id,action,resource,resource_id,permission_key,request_id,metadata)
  values(p_actor_id,case when p_product_id is null then 'tester_pack.create' else 'tester_pack.update' end,'tester_packs',saved.id::text,'products.manage',p_request_id,
   jsonb_build_object('definitionRevision',(select definition_revision from public.tester_packs where product_id=saved.id)));
 end if;
 return jsonb_build_object('product',to_jsonb(saved),'definition',(select to_jsonb(t) from public.tester_packs t where product_id=saved.id));
end;
$fn$;

create function public.save_normal_collection_products(p_collection_id uuid,p_product_ids uuid[],p_actor_id uuid,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
begin
 perform public.tester_catalog_assert_admin(p_actor_id,p_request_id);
 if p_product_ids is null or cardinality(p_product_ids)>100 or array_position(p_product_ids,null) is not null
 or cardinality(p_product_ids)<>(select count(distinct x) from unnest(p_product_ids) x)
 or exists(select 1 from unnest(p_product_ids) x where not exists(select 1 from public.products p where p.id=x and p.commerce_kind in ('standard','tester'))) then raise exception 'TESTER_PATCH_INVALID'; end if;
 perform id from public.collections where id=p_collection_id for update;
 if not found then raise exception 'TESTER_NOT_FOUND'; end if;
 delete from public.product_collections pc using public.products p where pc.collection_id=p_collection_id and p.id=pc.product_id and p.commerce_kind in ('standard','tester') and not(p.id=any(p_product_ids));
 insert into public.product_collections(collection_id,product_id,display_order)
 select p_collection_id,x,ordinality::integer from unnest(p_product_ids) with ordinality as ids(x,ordinality)
 on conflict(product_id,collection_id) do update set display_order=excluded.display_order;
 insert into public.admin_audit_logs(admin_id,action,resource,resource_id,permission_key,request_id,metadata)
 values(p_actor_id,'collection.assign_products','collections',p_collection_id::text,'collections.manage',p_request_id,jsonb_build_object('count',cardinality(p_product_ids)));
 return jsonb_build_object('success',true,'count',cardinality(p_product_ids));
end;
$fn$;

drop policy rf_products_public_read on public.products;
create policy rf_products_public_read on public.products for select to anon,authenticated
 using(status='Published' and active and commerce_kind in ('standard','tester'));
create policy rf_products_normal_catalog_boundary on public.products as restrictive for select to anon,authenticated
 using(commerce_kind in ('standard','tester'));
alter table public.tester_variants enable row level security;
alter table public.tester_packs enable row level security;
alter table public.tester_pack_components enable row level security;
alter table public.tester_pack_allowed_variants enable row level security;
revoke all on public.tester_variants,public.tester_packs,public.tester_pack_components,public.tester_pack_allowed_variants from public,anon,authenticated,service_role;
grant select on public.tester_variants,public.tester_packs,public.tester_pack_components,public.tester_pack_allowed_variants to service_role;
-- Exact per-function revokes/ownership/grants are generated in the installation envelope.

alter function public.tester_catalog_assert_admin(uuid,text) owner to postgres;
revoke all on function public.tester_catalog_assert_admin(uuid,text) from public,anon,authenticated,service_role;
alter function public.tester_pack_definition_hash(uuid) owner to postgres;
revoke all on function public.tester_pack_definition_hash(uuid) from public,anon,authenticated,service_role;
alter function public.set_tester_updated_at() owner to postgres;
revoke all on function public.set_tester_updated_at() from public,anon,authenticated,service_role;
alter function public.validate_tester_catalog() owner to postgres;
revoke all on function public.validate_tester_catalog() from public,anon,authenticated,service_role;
alter function public.derive_tester_availability() owner to postgres;
revoke all on function public.derive_tester_availability() from public,anon,authenticated,service_role;
alter function public.sync_tester_manual_availability() owner to postgres;
revoke all on function public.sync_tester_manual_availability() from public,anon,authenticated,service_role;
alter function public.save_catalog_product(uuid,jsonb,jsonb,text) owner to postgres;
revoke all on function public.save_catalog_product(uuid,jsonb,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.save_catalog_product(uuid,jsonb,jsonb,text) to service_role;
alter function public.tester_product_patch(uuid,jsonb,text) owner to postgres;
revoke all on function public.tester_product_patch(uuid,jsonb,text) from public,anon,authenticated,service_role;
alter function public.save_tester_product(uuid,jsonb,jsonb,uuid,text,uuid,text) owner to postgres;
revoke all on function public.save_tester_product(uuid,jsonb,jsonb,uuid,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.save_tester_product(uuid,jsonb,jsonb,uuid,text,uuid,text) to service_role;
alter function public.save_tester_pack(uuid,jsonb,jsonb,text,text,uuid,text) owner to postgres;
revoke all on function public.save_tester_pack(uuid,jsonb,jsonb,text,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.save_tester_pack(uuid,jsonb,jsonb,text,text,uuid,text) to service_role;
alter function public.save_normal_collection_products(uuid,uuid[],uuid,text) owner to postgres;
revoke all on function public.save_normal_collection_products(uuid,uuid[],uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.save_normal_collection_products(uuid,uuid[],uuid,text) to service_role;
$catalog_ddl$;
 end if;
 -- These signatures and ACLs are asserted, never repaired on rerun.
 select jsonb_build_object(
 'columns', (select jsonb_agg(jsonb_build_array(c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(ad.adbin,ad.adrelid),a.attidentity,a.attgenerated,case when c.relname in ('tester_variants','tester_packs','tester_pack_components','tester_pack_allowed_variants') then a.attacl is null else true end) order by c.relname,a.attnum)
  from pg_class c join pg_namespace ns on ns.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef ad on ad.adrelid=c.oid and ad.adnum=a.attnum
  where ns.nspname='public' and (c.relname in ('tester_variants','tester_packs','tester_pack_components','tester_pack_allowed_variants') or (c.relname='products' and a.attname in ('price','commerce_kind')))),
 'constraints',(select jsonb_agg(jsonb_build_array(c.relname,k.conname,pg_get_constraintdef(k.oid,false),k.convalidated) order by c.relname,k.conname) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where k.contype<>'n' and n.nspname='public' and (c.relname in ('tester_variants','tester_packs','tester_pack_components','tester_pack_allowed_variants') or k.conname in ('products_commerce_kind_valid','products_commerce_price_shape','product_variants_identity_owner_key') or (c.relname='products' and k.contype='c' and k.conkey && array(select attnum from pg_attribute where attrelid='public.products'::regclass and attname in ('price','sale_price','old_price'))))),
 'tables',(select jsonb_agg(jsonb_build_array(c.relname,r.rolname,c.relrowsecurity,c.relforcerowsecurity,(select jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),x.privilege_type,x.is_grantable) order by coalesce(g.rolname,'PUBLIC'),x.privilege_type) from aclexplode(c.relacl) x left join pg_roles g on g.oid=x.grantee where x.grantee<>c.relowner)) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_roles r on r.oid=c.relowner where n.nspname='public' and c.relname in ('tester_variants','tester_packs','tester_pack_components','tester_pack_allowed_variants')),
 'indexes',(select jsonb_agg(jsonb_build_array(c.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready) order by c.relname) from pg_index i join pg_class c on c.oid=i.indexrelid join pg_class t on t.oid=i.indrelid where t.relnamespace='public'::regnamespace and (t.relname in ('tester_variants','tester_packs','tester_pack_components','tester_pack_allowed_variants') or c.relname='product_variants_identity_owner_key')),
 'triggers',(select jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid,false),t.tgenabled) order by t.tgname) from pg_trigger t where not t.tgisinternal and (t.tgrelid in ('public.tester_variants'::regclass,'public.tester_packs'::regclass,'public.tester_pack_components'::regclass,'public.tester_pack_allowed_variants'::regclass) or t.tgname in ('products_tester_kind_guard','tester_variants_update_guard','tester_packs_update_guard','tester_components_updated','tester_allowed_updated','products_tester_validate','variants_tester_validate','registry_tester_validate','packs_tester_validate','components_tester_validate','allowed_tester_validate','variants_tester_availability','registry_tester_availability'))),
 'policies',(select jsonb_agg(jsonb_build_array(c.relname,po.polname,po.polcmd,po.polpermissive,(select jsonb_agg(coalesce(r.rolname,'PUBLIC') order by coalesce(r.rolname,'PUBLIC')) from unnest(po.polroles) ro(id) left join pg_roles r on r.oid=ro.id),pg_get_expr(po.polqual,po.polrelid),pg_get_expr(po.polwithcheck,po.polrelid)) order by c.relname,po.polname) from pg_policy po join pg_class c on c.oid=po.polrelid where c.relnamespace='public'::regnamespace and (po.polname in ('rf_products_public_read','rf_products_normal_catalog_boundary') or c.relname in ('tester_variants','tester_packs','tester_pack_components','tester_pack_allowed_variants'))),
 'functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),r.rolname,l.lanname,p.prosecdef,p.provolatile,p.proisstrict,p.proleakproof,p.proparallel,p.proconfig,(select jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),x.privilege_type,x.is_grantable) order by coalesce(g.rolname,'PUBLIC'),x.privilege_type) from aclexplode(p.proacl) x left join pg_roles g on g.oid=x.grantee where x.grantee<>p.proowner)) order by p.proname,p.oid) from pg_proc p join pg_roles r on r.oid=p.proowner join pg_language l on l.oid=p.prolang where p.pronamespace='public'::regnamespace and p.proname in ('tester_catalog_assert_admin','tester_pack_definition_hash','set_tester_updated_at','validate_tester_catalog','derive_tester_availability','sync_tester_manual_availability','save_catalog_product','tester_product_patch','save_tester_product','save_tester_pack','save_normal_collection_products','save_catalog_product_012_internal'))) into installed_shape;
 if installed_shape is distinct from $target${
  "tables": [
    [
      "tester_pack_allowed_variants",
      "postgres",
      true,
      false,
      [
        [
          "service_role",
          "SELECT",
          false
        ]
      ]
    ],
    [
      "tester_pack_components",
      "postgres",
      true,
      false,
      [
        [
          "service_role",
          "SELECT",
          false
        ]
      ]
    ],
    [
      "tester_packs",
      "postgres",
      true,
      false,
      [
        [
          "service_role",
          "SELECT",
          false
        ]
      ]
    ],
    [
      "tester_variants",
      "postgres",
      true,
      false,
      [
        [
          "service_role",
          "SELECT",
          false
        ]
      ]
    ]
  ],
  "columns": [
    [
      "products",
      "price",
      "numeric(12,2)",
      false,
      null,
      "",
      "",
      true
    ],
    [
      "products",
      "commerce_kind",
      "text",
      true,
      "'standard'::text",
      "",
      "",
      true
    ],
    [
      "tester_pack_allowed_variants",
      "pack_id",
      "uuid",
      true,
      null,
      "",
      "",
      true
    ],
    [
      "tester_pack_allowed_variants",
      "tester_variant_id",
      "uuid",
      true,
      null,
      "",
      "",
      true
    ],
    [
      "tester_pack_allowed_variants",
      "active",
      "boolean",
      true,
      "true",
      "",
      "",
      true
    ],
    [
      "tester_pack_allowed_variants",
      "display_order",
      "integer",
      true,
      "0",
      "",
      "",
      true
    ],
    [
      "tester_pack_allowed_variants",
      "created_at",
      "timestamp with time zone",
      true,
      "now()",
      "",
      "",
      true
    ],
    [
      "tester_pack_allowed_variants",
      "updated_at",
      "timestamp with time zone",
      true,
      "now()",
      "",
      "",
      true
    ],
    [
      "tester_pack_components",
      "pack_id",
      "uuid",
      true,
      null,
      "",
      "",
      true
    ],
    [
      "tester_pack_components",
      "tester_variant_id",
      "uuid",
      true,
      null,
      "",
      "",
      true
    ],
    [
      "tester_pack_components",
      "quantity_per_pack",
      "integer",
      true,
      null,
      "",
      "",
      true
    ],
    [
      "tester_pack_components",
      "display_order",
      "integer",
      true,
      "0",
      "",
      "",
      true
    ],
    [
      "tester_pack_components",
      "created_at",
      "timestamp with time zone",
      true,
      "now()",
      "",
      "",
      true
    ],
    [
      "tester_pack_components",
      "updated_at",
      "timestamp with time zone",
      true,
      "now()",
      "",
      "",
      true
    ],
    [
      "tester_packs",
      "product_id",
      "uuid",
      true,
      null,
      "",
      "",
      true
    ],
    [
      "tester_packs",
      "mode",
      "text",
      true,
      null,
      "",
      "",
      true
    ],
    [
      "tester_packs",
      "minimum_units",
      "integer",
      false,
      null,
      "",
      "",
      true
    ],
    [
      "tester_packs",
      "maximum_units",
      "integer",
      false,
      null,
      "",
      "",
      true
    ],
    [
      "tester_packs",
      "fixed_regular_price",
      "numeric(12,2)",
      false,
      null,
      "",
      "",
      true
    ],
    [
      "tester_packs",
      "fixed_sale_price",
      "numeric(12,2)",
      false,
      null,
      "",
      "",
      true
    ],
    [
      "tester_packs",
      "manual_available",
      "boolean",
      true,
      "true",
      "",
      "",
      true
    ],
    [
      "tester_packs",
      "definition_revision",
      "bigint",
      true,
      "1",
      "",
      "",
      true
    ],
    [
      "tester_packs",
      "definition_fingerprint",
      "text",
      true,
      null,
      "",
      "",
      true
    ],
    [
      "tester_packs",
      "created_at",
      "timestamp with time zone",
      true,
      "now()",
      "",
      "",
      true
    ],
    [
      "tester_packs",
      "updated_at",
      "timestamp with time zone",
      true,
      "now()",
      "",
      "",
      true
    ],
    [
      "tester_variants",
      "variant_id",
      "uuid",
      true,
      null,
      "",
      "",
      true
    ],
    [
      "tester_variants",
      "tester_product_id",
      "uuid",
      true,
      null,
      "",
      "",
      true
    ],
    [
      "tester_variants",
      "source_product_id",
      "uuid",
      false,
      null,
      "",
      "",
      true
    ],
    [
      "tester_variants",
      "volume_ml",
      "numeric(4,2)",
      true,
      "5.00",
      "",
      "",
      true
    ],
    [
      "tester_variants",
      "manual_available",
      "boolean",
      true,
      "true",
      "",
      "",
      true
    ],
    [
      "tester_variants",
      "created_at",
      "timestamp with time zone",
      true,
      "now()",
      "",
      "",
      true
    ],
    [
      "tester_variants",
      "updated_at",
      "timestamp with time zone",
      true,
      "now()",
      "",
      "",
      true
    ]
  ],
  "indexes": [
    [
      "product_variants_identity_owner_key",
      "CREATE UNIQUE INDEX product_variants_identity_owner_key ON public.product_variants USING btree (id, product_id)",
      true,
      true
    ],
    [
      "tester_allowed_display_idx",
      "CREATE INDEX tester_allowed_display_idx ON public.tester_pack_allowed_variants USING btree (pack_id, display_order, tester_variant_id) WHERE active",
      true,
      true
    ],
    [
      "tester_allowed_variant_idx",
      "CREATE INDEX tester_allowed_variant_idx ON public.tester_pack_allowed_variants USING btree (tester_variant_id, pack_id)",
      true,
      true
    ],
    [
      "tester_components_display_idx",
      "CREATE INDEX tester_components_display_idx ON public.tester_pack_components USING btree (pack_id, display_order, tester_variant_id)",
      true,
      true
    ],
    [
      "tester_components_variant_idx",
      "CREATE INDEX tester_components_variant_idx ON public.tester_pack_components USING btree (tester_variant_id, pack_id)",
      true,
      true
    ],
    [
      "tester_pack_allowed_variants_pkey",
      "CREATE UNIQUE INDEX tester_pack_allowed_variants_pkey ON public.tester_pack_allowed_variants USING btree (pack_id, tester_variant_id)",
      true,
      true
    ],
    [
      "tester_pack_components_pkey",
      "CREATE UNIQUE INDEX tester_pack_components_pkey ON public.tester_pack_components USING btree (pack_id, tester_variant_id)",
      true,
      true
    ],
    [
      "tester_packs_pkey",
      "CREATE UNIQUE INDEX tester_packs_pkey ON public.tester_packs USING btree (product_id)",
      true,
      true
    ],
    [
      "tester_variants_pkey",
      "CREATE UNIQUE INDEX tester_variants_pkey ON public.tester_variants USING btree (variant_id)",
      true,
      true
    ],
    [
      "tester_variants_source_idx",
      "CREATE INDEX tester_variants_source_idx ON public.tester_variants USING btree (source_product_id) WHERE (source_product_id IS NOT NULL)",
      true,
      true
    ],
    [
      "tester_variants_tester_product_id_key",
      "CREATE UNIQUE INDEX tester_variants_tester_product_id_key ON public.tester_variants USING btree (tester_product_id)",
      true,
      true
    ]
  ],
  "policies": [
    [
      "products",
      "rf_products_normal_catalog_boundary",
      "r",
      false,
      [
        "anon",
        "authenticated"
      ],
      "(commerce_kind = ANY (ARRAY['standard'::text, 'tester'::text]))",
      null
    ],
    [
      "products",
      "rf_products_public_read",
      "r",
      true,
      [
        "anon",
        "authenticated"
      ],
      "((status = 'Published'::publish_status) AND active AND (commerce_kind = ANY (ARRAY['standard'::text, 'tester'::text])))",
      null
    ]
  ],
  "triggers": [
    [
      "allowed_tester_validate",
      "CREATE CONSTRAINT TRIGGER allowed_tester_validate AFTER INSERT OR DELETE OR UPDATE ON public.tester_pack_allowed_variants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_tester_catalog()",
      "O"
    ],
    [
      "components_tester_validate",
      "CREATE CONSTRAINT TRIGGER components_tester_validate AFTER INSERT OR DELETE OR UPDATE ON public.tester_pack_components DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_tester_catalog()",
      "O"
    ],
    [
      "packs_tester_validate",
      "CREATE CONSTRAINT TRIGGER packs_tester_validate AFTER INSERT OR DELETE OR UPDATE ON public.tester_packs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_tester_catalog()",
      "O"
    ],
    [
      "products_tester_kind_guard",
      "CREATE TRIGGER products_tester_kind_guard BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION set_tester_updated_at()",
      "O"
    ],
    [
      "products_tester_validate",
      "CREATE CONSTRAINT TRIGGER products_tester_validate AFTER INSERT OR DELETE OR UPDATE ON public.products DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_tester_catalog()",
      "O"
    ],
    [
      "registry_tester_availability",
      "CREATE TRIGGER registry_tester_availability AFTER INSERT OR UPDATE OF manual_available ON public.tester_variants FOR EACH ROW EXECUTE FUNCTION sync_tester_manual_availability()",
      "O"
    ],
    [
      "registry_tester_validate",
      "CREATE CONSTRAINT TRIGGER registry_tester_validate AFTER INSERT OR DELETE OR UPDATE ON public.tester_variants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_tester_catalog()",
      "O"
    ],
    [
      "tester_allowed_updated",
      "CREATE TRIGGER tester_allowed_updated BEFORE UPDATE ON public.tester_pack_allowed_variants FOR EACH ROW EXECUTE FUNCTION set_tester_updated_at()",
      "O"
    ],
    [
      "tester_components_updated",
      "CREATE TRIGGER tester_components_updated BEFORE UPDATE ON public.tester_pack_components FOR EACH ROW EXECUTE FUNCTION set_tester_updated_at()",
      "O"
    ],
    [
      "tester_packs_update_guard",
      "CREATE TRIGGER tester_packs_update_guard BEFORE UPDATE ON public.tester_packs FOR EACH ROW EXECUTE FUNCTION set_tester_updated_at()",
      "O"
    ],
    [
      "tester_variants_update_guard",
      "CREATE TRIGGER tester_variants_update_guard BEFORE UPDATE ON public.tester_variants FOR EACH ROW EXECUTE FUNCTION set_tester_updated_at()",
      "O"
    ],
    [
      "variants_tester_availability",
      "CREATE TRIGGER variants_tester_availability BEFORE INSERT OR UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION derive_tester_availability()",
      "O"
    ],
    [
      "variants_tester_validate",
      "CREATE CONSTRAINT TRIGGER variants_tester_validate AFTER INSERT OR DELETE OR UPDATE ON public.product_variants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_tester_catalog()",
      "O"
    ]
  ],
  "functions": [
    [
      "derive_tester_availability",
      "",
      "",
      "trigger",
      "postgres",
      "plpgsql",
      true,
      "v",
      false,
      false,
      "u",
      [
        "search_path=\"\""
      ],
      null
    ],
    [
      "save_catalog_product",
      "p_product_id uuid, p_patch jsonb, p_variants jsonb, p_expected_revision text",
      "p_product_id uuid, p_patch jsonb, p_variants jsonb DEFAULT NULL::jsonb, p_expected_revision text DEFAULT NULL::text",
      "jsonb",
      "postgres",
      "plpgsql",
      true,
      "v",
      false,
      false,
      "u",
      [
        "search_path=\"\""
      ],
      [
        [
          "service_role",
          "EXECUTE",
          false
        ]
      ]
    ],
    [
      "save_catalog_product_012_internal",
      "p_product_id uuid, p_patch jsonb, p_variants jsonb, p_expected_revision text",
      "p_product_id uuid, p_patch jsonb, p_variants jsonb DEFAULT NULL::jsonb, p_expected_revision text DEFAULT NULL::text",
      "jsonb",
      "postgres",
      "plpgsql",
      true,
      "v",
      false,
      false,
      "u",
      [
        "search_path=\"\""
      ],
      null
    ],
    [
      "save_normal_collection_products",
      "p_collection_id uuid, p_product_ids uuid[], p_actor_id uuid, p_request_id text",
      "p_collection_id uuid, p_product_ids uuid[], p_actor_id uuid, p_request_id text",
      "jsonb",
      "postgres",
      "plpgsql",
      true,
      "v",
      false,
      false,
      "u",
      [
        "search_path=\"\""
      ],
      [
        [
          "service_role",
          "EXECUTE",
          false
        ]
      ]
    ],
    [
      "save_tester_pack",
      "p_product_id uuid, p_patch jsonb, p_definition jsonb, p_expected_revision text, p_expected_definition_revision text, p_actor_id uuid, p_request_id text",
      "p_product_id uuid, p_patch jsonb, p_definition jsonb, p_expected_revision text, p_expected_definition_revision text, p_actor_id uuid, p_request_id text",
      "jsonb",
      "postgres",
      "plpgsql",
      true,
      "v",
      false,
      false,
      "u",
      [
        "search_path=\"\""
      ],
      [
        [
          "service_role",
          "EXECUTE",
          false
        ]
      ]
    ],
    [
      "save_tester_product",
      "p_product_id uuid, p_patch jsonb, p_variant jsonb, p_source_product_id uuid, p_expected_revision text, p_actor_id uuid, p_request_id text",
      "p_product_id uuid, p_patch jsonb, p_variant jsonb, p_source_product_id uuid, p_expected_revision text, p_actor_id uuid, p_request_id text",
      "jsonb",
      "postgres",
      "plpgsql",
      true,
      "v",
      false,
      false,
      "u",
      [
        "search_path=\"\""
      ],
      [
        [
          "service_role",
          "EXECUTE",
          false
        ]
      ]
    ],
    [
      "set_tester_updated_at",
      "",
      "",
      "trigger",
      "postgres",
      "plpgsql",
      false,
      "v",
      false,
      false,
      "u",
      [
        "search_path=\"\""
      ],
      null
    ],
    [
      "sync_tester_manual_availability",
      "",
      "",
      "trigger",
      "postgres",
      "plpgsql",
      true,
      "v",
      false,
      false,
      "u",
      [
        "search_path=\"\""
      ],
      null
    ],
    [
      "tester_catalog_assert_admin",
      "p_actor_id uuid, p_request_id text",
      "p_actor_id uuid, p_request_id text",
      "void",
      "postgres",
      "plpgsql",
      true,
      "v",
      false,
      false,
      "u",
      [
        "search_path=\"\""
      ],
      null
    ],
    [
      "tester_pack_definition_hash",
      "p_id uuid",
      "p_id uuid",
      "text",
      "postgres",
      "sql",
      true,
      "s",
      false,
      false,
      "u",
      [
        "search_path=\"\""
      ],
      null
    ],
    [
      "tester_product_patch",
      "p_id uuid, p_patch jsonb, p_kind text",
      "p_id uuid, p_patch jsonb, p_kind text",
      "products",
      "postgres",
      "plpgsql",
      true,
      "v",
      false,
      false,
      "u",
      [
        "search_path=\"\""
      ],
      null
    ],
    [
      "validate_tester_catalog",
      "",
      "",
      "trigger",
      "postgres",
      "plpgsql",
      true,
      "v",
      false,
      false,
      "u",
      [
        "search_path=\"\""
      ],
      null
    ]
  ],
  "constraints": [
    [
      "product_variants",
      "product_variants_identity_owner_key",
      "UNIQUE (id, product_id)",
      true
    ],
    [
      "products",
      "products_commerce_kind_valid",
      "CHECK ((commerce_kind = ANY (ARRAY['standard'::text, 'tester'::text, 'tester_pack'::text])))",
      true
    ],
    [
      "products",
      "products_commerce_price_shape",
      "CHECK ((((commerce_kind = ANY (ARRAY['standard'::text, 'tester'::text])) AND (price IS NOT NULL) AND (price > (0)::numeric)) OR ((commerce_kind = 'tester_pack'::text) AND (price IS NULL) AND (sale_price IS NULL) AND (old_price IS NULL) AND (stock_quantity = 0) AND (bottle_size = ''::text) AND (size_options = '[]'::jsonb) AND (variations = '[]'::jsonb))))",
      true
    ],
    [
      "products",
      "products_old_price_check",
      "CHECK (((old_price IS NULL) OR (old_price >= (0)::numeric)))",
      true
    ],
    [
      "products",
      "products_price_check",
      "CHECK ((price > (0)::numeric))",
      true
    ],
    [
      "products",
      "products_sale_below_price",
      "CHECK (((sale_price IS NULL) OR (sale_price = (0)::numeric) OR (sale_price < price)))",
      true
    ],
    [
      "products",
      "products_sale_price_check",
      "CHECK (((sale_price IS NULL) OR (sale_price >= (0)::numeric)))",
      true
    ],
    [
      "tester_pack_allowed_variants",
      "allowed_tester_validate",
      "TRIGGER DEFERRABLE INITIALLY DEFERRED",
      true
    ],
    [
      "tester_pack_allowed_variants",
      "tester_pack_allowed_variants_display_order_check",
      "CHECK ((display_order >= 0))",
      true
    ],
    [
      "tester_pack_allowed_variants",
      "tester_pack_allowed_variants_pack_id_fkey",
      "FOREIGN KEY (pack_id) REFERENCES tester_packs(product_id) ON DELETE RESTRICT",
      true
    ],
    [
      "tester_pack_allowed_variants",
      "tester_pack_allowed_variants_pkey",
      "PRIMARY KEY (pack_id, tester_variant_id)",
      true
    ],
    [
      "tester_pack_allowed_variants",
      "tester_pack_allowed_variants_tester_variant_id_fkey",
      "FOREIGN KEY (tester_variant_id) REFERENCES tester_variants(variant_id) ON DELETE RESTRICT",
      true
    ],
    [
      "tester_pack_components",
      "components_tester_validate",
      "TRIGGER DEFERRABLE INITIALLY DEFERRED",
      true
    ],
    [
      "tester_pack_components",
      "tester_pack_components_display_order_check",
      "CHECK ((display_order >= 0))",
      true
    ],
    [
      "tester_pack_components",
      "tester_pack_components_pack_id_fkey",
      "FOREIGN KEY (pack_id) REFERENCES tester_packs(product_id) ON DELETE RESTRICT",
      true
    ],
    [
      "tester_pack_components",
      "tester_pack_components_pkey",
      "PRIMARY KEY (pack_id, tester_variant_id)",
      true
    ],
    [
      "tester_pack_components",
      "tester_pack_components_quantity_per_pack_check",
      "CHECK ((quantity_per_pack > 0))",
      true
    ],
    [
      "tester_pack_components",
      "tester_pack_components_tester_variant_id_fkey",
      "FOREIGN KEY (tester_variant_id) REFERENCES tester_variants(variant_id) ON DELETE RESTRICT",
      true
    ],
    [
      "tester_packs",
      "packs_tester_validate",
      "TRIGGER DEFERRABLE INITIALLY DEFERRED",
      true
    ],
    [
      "tester_packs",
      "tester_pack_mode_shape",
      "CHECK ((((mode = 'fixed'::text) AND (minimum_units IS NULL) AND (maximum_units IS NULL) AND (fixed_regular_price IS NOT NULL) AND (fixed_regular_price > (0)::numeric) AND ((fixed_sale_price IS NULL) OR ((fixed_sale_price > (0)::numeric) AND (fixed_sale_price < fixed_regular_price)))) OR ((mode = 'configurable'::text) AND (minimum_units IS NOT NULL) AND (minimum_units = 2) AND ((maximum_units IS NULL) OR (maximum_units >= 2)) AND (fixed_regular_price IS NULL) AND (fixed_sale_price IS NULL))))",
      true
    ],
    [
      "tester_packs",
      "tester_packs_definition_fingerprint_check",
      "CHECK ((definition_fingerprint ~ '^[0-9a-f]{64}$'::text))",
      true
    ],
    [
      "tester_packs",
      "tester_packs_definition_revision_check",
      "CHECK ((definition_revision > 0))",
      true
    ],
    [
      "tester_packs",
      "tester_packs_mode_check",
      "CHECK ((mode = ANY (ARRAY['fixed'::text, 'configurable'::text])))",
      true
    ],
    [
      "tester_packs",
      "tester_packs_pkey",
      "PRIMARY KEY (product_id)",
      true
    ],
    [
      "tester_packs",
      "tester_packs_product_id_fkey",
      "FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT",
      true
    ],
    [
      "tester_variants",
      "registry_tester_validate",
      "TRIGGER DEFERRABLE INITIALLY DEFERRED",
      true
    ],
    [
      "tester_variants",
      "tester_source_distinct",
      "CHECK (((source_product_id IS NULL) OR (source_product_id <> tester_product_id)))",
      true
    ],
    [
      "tester_variants",
      "tester_variant_owner_fk",
      "FOREIGN KEY (variant_id, tester_product_id) REFERENCES product_variants(id, product_id) ON DELETE RESTRICT",
      true
    ],
    [
      "tester_variants",
      "tester_variants_pkey",
      "PRIMARY KEY (variant_id)",
      true
    ],
    [
      "tester_variants",
      "tester_variants_source_product_id_fkey",
      "FOREIGN KEY (source_product_id) REFERENCES products(id) ON DELETE RESTRICT",
      true
    ],
    [
      "tester_variants",
      "tester_variants_tester_product_id_fkey",
      "FOREIGN KEY (tester_product_id) REFERENCES products(id) ON DELETE RESTRICT",
      true
    ],
    [
      "tester_variants",
      "tester_variants_tester_product_id_key",
      "UNIQUE (tester_product_id)",
      true
    ],
    [
      "tester_variants",
      "tester_variants_volume_ml_check",
      "CHECK ((volume_ml = 5.00))",
      true
    ]
  ]
}$target$::jsonb then raise exception 'RF_TESTER_012_TARGET_SHAPE'; end if;
 -- Only two exact reviewed bodies are accepted: LF and CRLF. Installed bodies are not normalized.
 for item in select * from (values
('derive_tester_availability','73c1efe36e0d60a02c7e57ccb5e1c0d0','d7a20f53465dd692c61a0ee47bcf0b7c'),
('save_catalog_product','4b13c5a0b58def4dee0c167a41e10f10','80c7460cda73600966ff4c223d2b3b92'),
('save_catalog_product_012_internal','f294a63acf84d64b9650d7389380df81','47a13aa39f3e793792250076de011cd5'),
('save_normal_collection_products','30a98350a215f9b7d13338e6416403bf','90c2bbfb578a9c2a20097c38b760621a'),
('save_tester_pack','45e9c540f639c8e4ae8a67408e65306c','1c2c43f61d4db6e83b6923d4f9c329d3'),
('save_tester_product','3940dc30a39e18ac6ae6db79601018b8','290d991cb7662d79c53552e6de18097e'),
('set_tester_updated_at','d4eb3251b2569e4593633da05a74552c','7894d54b491069bb88599b506933838e'),
('sync_tester_manual_availability','a8804e3169f38484649645b54cba57a3','d2354e7e6bfcecadd1ddb7f19bd7b5af'),
('tester_catalog_assert_admin','0e534b0c5c3e7576483709def5ce13d4','3448c84175fb05867d4dc49cfc434be2'),
('tester_pack_definition_hash','6b52db1cfcf24f5015dabe847cd5d500','23eb4ff492a4d8d87f0877e968f6e15e'),
('tester_product_patch','a8dba6ad1d840c7db21bdce7ffaf8880','5836e58208d1e688a43875ffa998e2a5'),
('validate_tester_catalog','c105c569ad9bf2c0712604ab56b140fa','03fd453af2c5084878fb0a8d3a18fcea')
) as approved(name,lf,crlf) loop
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname=item.name)<>1
   or not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname=item.name and md5(prosrc) in (item.lf,item.crlf)) then raise exception 'RF_TESTER_012_TARGET_BODY: %',item.name; end if;
 end loop;
 -- Assert effective rights as well as explicit ACLs (including inherited role authority).
 foreach table_name in array array['tester_variants','tester_packs','tester_pack_components','tester_pack_allowed_variants'] loop
  foreach role_name in array array['anon','authenticated','service_role'] loop
   foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege(role_name,'public.'||table_name,privilege_name) is distinct from (role_name='service_role' and privilege_name='SELECT') then raise exception 'RF_TESTER_012_EFFECTIVE_TABLE_ACL'; end if;
   end loop;
   if current_setting('server_version_num')::integer>=170000 then
    if has_table_privilege(role_name,'public.'||table_name,'MAINTAIN') then raise exception 'RF_TESTER_012_EFFECTIVE_TABLE_ACL'; end if;
   end if;
  end loop;
 end loop;
 for item in select p.oid,p.proname from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
  ('save_tester_product','save_tester_pack','save_normal_collection_products','save_catalog_product','save_catalog_product_012_internal','tester_catalog_assert_admin','tester_pack_definition_hash','tester_product_patch','set_tester_updated_at','validate_tester_catalog','derive_tester_availability','sync_tester_manual_availability') loop
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_function_privilege(role_name,item.oid,'EXECUTE') is distinct from (role_name='service_role' and item.proname in ('save_tester_product','save_tester_pack','save_normal_collection_products','save_catalog_product')) then raise exception 'RF_TESTER_012_EFFECTIVE_FUNCTION_ACL'; end if;
  end loop;
 end loop;
end;
$install$;
set constraints all immediate;
commit;
