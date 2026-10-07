-- Forward-only local 014. Production ordering remains disabled.
-- Exact catalog manifests; function CRLF normalizes to LF only.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public;
do $install014$
declare shape text;
begin
 select encode(sha256(convert_to(jsonb_build_object(
 'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,r.rolname,
  (select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),
   (select jsonb_agg(jsonb_build_array(coalesce(ar.rolname,'PUBLIC'),ax.privilege_type,ax.is_grantable) order by coalesce(ar.rolname,'PUBLIC'),ax.privilege_type) from aclexplode(a.attacl) ax left join pg_roles ar on ar.oid=ax.grantee)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  (select jsonb_agg(jsonb_build_array(x.conname,pg_get_constraintdef(x.oid,false),x.convalidated) order by x.conname) from pg_constraint x where x.conrelid=c.oid),
  (select jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid,false),t.tgenabled) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
  (select jsonb_agg(jsonb_build_array(i.relname,pg_get_indexdef(i.oid)) order by i.relname) from pg_index ix join pg_class i on i.oid=ix.indexrelid where ix.indrelid=c.oid),
  (select jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid),(select jsonb_agg(rr.rolname order by rr.rolname) from unnest(p.polroles) pr(id) join pg_roles rr on rr.oid=pr.id)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
  (select jsonb_agg(jsonb_build_array(coalesce(gr.rolname,'PUBLIC'),x.privilege_type,x.is_grantable) order by coalesce(gr.rolname,'PUBLIC'),x.privilege_type) from aclexplode(c.relacl) x left join pg_roles gr on gr.oid=x.grantee)) order by c.relname)
  from pg_class c join pg_roles r on r.oid=c.relowner where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v')
   and not exists(select 1 from pg_depend dep where dep.classid='pg_class'::regclass and dep.objid=c.oid and dep.deptype='e')),
 'functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),r.rolname,l.lanname,p.prosecdef,p.provolatile,p.proisstrict,p.proleakproof,p.proparallel,p.proconfig,
  replace(p.prosrc,E'\r\n',E'\n'),
  (select jsonb_agg(jsonb_build_array(coalesce(gr.rolname,'PUBLIC'),x.privilege_type,x.is_grantable) order by coalesce(gr.rolname,'PUBLIC'),x.privilege_type) from aclexplode(p.proacl) x left join pg_roles gr on gr.oid=x.grantee)) order by p.proname,pg_get_function_identity_arguments(p.oid))
  from pg_proc p join pg_roles r on r.oid=p.proowner join pg_language l on l.oid=p.prolang where p.pronamespace='public'::regnamespace and p.prokind='f'
   and not exists(select 1 from pg_depend dep where dep.classid='pg_proc'::regclass and dep.objid=p.oid and dep.deptype='e'))
 )::text,'UTF8')),'hex') into shape;
 if to_regprocedure('public.apply_admin_order_action_v2_014_internal(uuid,uuid,text,uuid,text,jsonb,text)') is not null then
  if shape is distinct from '62c63f9d1d70026f006b0c48f089ad4de14ec3551940e239c71112086d1f6ac3' then raise exception 'RF_FULFILLMENT_014_TARGET_DRIFT'; end if;
 else
  if shape is distinct from '33f5b5eb2034fc14cf0c4672f66e54634133e6e0d7cc59e99f20f6f4d231d6fc' then raise exception 'RF_FULFILLMENT_014_BASELINE_DRIFT'; end if;
  execute $ddl014$
-- @014-DDL-BEGIN
create function public.fulfillment_v2_snapshot_014(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare o public.orders%rowtype; i public.order_items%rowtype; quoted record; expected jsonb; actual jsonb; identity jsonb; demand jsonb;
 physical jsonb:='[]'::jsonb;
 count_items integer; count_components integer;
begin
 select * into o from public.orders where id=p_order_id;
 if not found or o.checkout_version<>2 or o.snapshot_version<>2
 or jsonb_typeof(o.canonical_request) is distinct from 'array' or jsonb_array_length(o.canonical_request)<>9
 or o.canonical_request->0 is distinct from '2'::jsonb
 or o.request_fingerprint is distinct from public.checkout_v2_hash(o.canonical_request)
 or jsonb_typeof(o.quote_snapshot) is distinct from 'object'
 or o.quote_snapshot->'contractVersion' is distinct from '2'::jsonb
 or o.quote_fingerprint is distinct from o.quote_snapshot->>'quoteFingerprint'
 or o.quote_fingerprint !~ '^[0-9a-f]{64}$'
 or jsonb_typeof(o.quote_snapshot->'lines') is distinct from 'array'
 or jsonb_typeof(o.canonical_request->1) is distinct from 'array'
 or o.canonical_request->2 is distinct from to_jsonb(o.customer_id)
    and not(o.customer_id is null and o.canonical_request->2='null'::jsonb)
 or o.canonical_request->3 is distinct from jsonb_build_array(o.customer_name,o.customer_email,o.customer_phone)
 or o.canonical_request->4 is distinct from jsonb_build_array(o.shipping_address,o.shipping_city,o.shipping_province,o.order_notes)
 or o.canonical_request->>5 is distinct from o.payment_method
 or o.canonical_request->>6 is distinct from coalesce(o.coupon_code,'')
 or o.canonical_request->>7 is distinct from o.quote_fingerprint
 or o.canonical_request->>8 is distinct from o.customer_email
 or o.currency<>'PKR' or o.quote_snapshot->>'currency' is distinct from o.currency
 or o.subtotal<=0 or o.subtotal='NaN'::numeric or o.discount<0 or o.discount>o.subtotal
 or o.shipping_fee<0 or o.total<>o.subtotal-o.discount+o.shipping_fee
 or (o.subtotal,o.discount,o.shipping_fee,o.total) is distinct from
 ((o.quote_snapshot->>'subtotal')::numeric,(o.quote_snapshot->>'discount')::numeric,
  (o.quote_snapshot->>'shippingFee')::numeric,(o.quote_snapshot->>'total')::numeric)
 then raise exception 'ORDER_SNAPSHOT_INCONSISTENT'; end if;
 select count(*) into count_items from public.order_items where order_id=o.id;
 select count(*) into count_components from public.order_item_components where order_id=o.id;
 if count_items not between 1 and 100 or count_components>2000
 or count_items<>jsonb_array_length(o.quote_snapshot->'lines') or count_items<>jsonb_array_length(o.canonical_request->1)
 or exists(select 1 from public.order_items where order_id=o.id group by position having count(*)<>1)
 or exists(select 1 from public.order_item_components where order_id=o.id group by order_item_id,tester_variant_id having count(*)<>1)
 or exists(select 1 from public.order_item_components where order_id=o.id group by order_item_id,position having count(*)<>1)
 -- Reverse coverage: every persisted component must have a same-order V2 pack parent.
 or exists(select 1 from public.order_item_components c left join public.order_items parent on parent.id=c.order_item_id
  where c.order_id=o.id and (parent.id is null or parent.order_id is distinct from o.id
   or parent.snapshot_version is distinct from 2
   or parent.line_kind is null or parent.line_kind not in ('fixed_tester_pack','configurable_tester_pack')))
 or (select sum(line_total) from public.order_items where order_id=o.id)<>o.subtotal
 then raise exception 'ORDER_SNAPSHOT_INCONSISTENT'; end if;
 -- The JSON ordinal is independent of both quoted and persisted position metadata.
 for quoted in select value,ordinality from jsonb_array_elements(o.quote_snapshot->'lines') with ordinality loop
  expected:=quoted.value;
  select * into i from public.order_items where order_id=o.id and position=quoted.ordinality-1;
  if not found or expected->'position' is distinct from to_jsonb(quoted.ordinality-1)
  then raise exception 'ORDER_SNAPSHOT_INCONSISTENT'; end if;
  if i.snapshot_version<>2 or i.position is null or i.position<0 or i.position>=count_items
  or i.quantity<=0 or i.unit_price<=0 or i.unit_price='NaN'::numeric
  or i.line_total<>i.quantity::numeric*i.unit_price or expected is null
  or (i.canonical_line_identity,i.line_identity_hash,i.line_kind,i.product_id,i.variant_id,i.pack_id,
      i.pack_definition_revision,i.pack_definition_fingerprint,i.quantity,i.unit_price,i.line_total,i.product_name,i.sku,i.size)
   is distinct from (expected->'identity',public.checkout_v2_hash(expected->'identity'),expected->>'kind',
     (expected->>'productId')::uuid,(expected->>'variantId')::uuid,(expected->>'packId')::uuid,
     (expected->>'definitionRevision')::bigint,expected->>'definitionFingerprint',(expected->>'quantity')::integer,
     (expected->>'unitPrice')::numeric,(expected->>'lineTotal')::numeric,expected->>'name',expected->>'sku',expected->>'size')
  or i.canonical_line_identity is distinct from o.canonical_request->1->i.position->'identity'
  or to_jsonb(i.quantity) is distinct from o.canonical_request->1->i.position->'quantity'
  then raise exception 'ORDER_SNAPSHOT_INCONSISTENT'; end if;
  if jsonb_typeof(expected->'components') is distinct from 'array'
  or exists(select 1 from jsonb_array_elements(expected->'components') with ordinality component(value,ordinality)
   where component.value->'position' is distinct from to_jsonb(component.ordinality-1))
  then raise exception 'ORDER_SNAPSHOT_INCONSISTENT'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('testerVariantId',c.tester_variant_id,'testerProductId',c.tester_product_id,
   'testerName',c.tester_name,'sku',c.sku,'size',c.size,'volumeMl',c.volume_ml,'quantityPerPack',c.quantity_per_pack,
   'totalPhysicalQuantity',c.total_physical_quantity,'referenceUnitPrice',c.reference_unit_price,'position',c.position) order by c.position),'[]')
   into actual from public.order_item_components c where c.order_item_id=i.id;
  if actual is distinct from expected->'components'
  or exists(select 1 from public.order_item_components c left join public.product_variants v on v.id=c.tester_variant_id
   where c.order_item_id=i.id and (c.order_id<>o.id or c.tester_product_id is distinct from v.product_id or v.id is null
    or c.size<>'5 ml' or c.volume_ml<>5 or c.quantity_per_pack<=0 or c.total_physical_quantity<=0
    or c.reference_unit_price<=0 or c.reference_unit_price='NaN'::numeric
    or c.total_physical_quantity::bigint<>i.quantity::bigint*c.quantity_per_pack::bigint))
  then raise exception 'ORDER_SNAPSHOT_INCONSISTENT'; end if;
  if i.line_kind='normal_variant' then
   identity:=jsonb_build_array(i.line_kind,i.variant_id::text);
   if i.variant_id is null or i.pack_id is not null or jsonb_array_length(actual)<>0 or i.quantity>99
   or not exists(select 1 from public.product_variants where id=i.variant_id and product_id=i.product_id)
   then raise exception 'ORDER_SNAPSHOT_INCONSISTENT'; end if;
  elsif i.line_kind in ('fixed_tester_pack','configurable_tester_pack') then
   if i.variant_id is not null or i.pack_id is null or i.product_id is distinct from i.pack_id
   or i.pack_definition_revision is null or i.pack_definition_revision<=0
   or i.pack_definition_fingerprint is null or i.pack_definition_fingerprint !~ '^[0-9a-f]{64}$'
   or jsonb_array_length(actual) not between 1 and 100 then raise exception 'ORDER_SNAPSHOT_INCONSISTENT'; end if;
   identity:=jsonb_build_array(i.line_kind,i.pack_id::text,i.pack_definition_revision::text);
   if i.line_kind='configurable_tester_pack' then
    identity:=identity||jsonb_build_array((select jsonb_agg(jsonb_build_array(tester_variant_id::text,quantity_per_pack) order by tester_variant_id)
     from public.order_item_components where order_item_id=i.id));
   end if;
  else raise exception 'ORDER_SNAPSHOT_INCONSISTENT'; end if;
  if i.canonical_line_identity is distinct from identity then raise exception 'ORDER_SNAPSHOT_INCONSISTENT'; end if;
  -- Exact component JSON equality above proves identity, ordinal and every frozen field.
  -- Add demand only after this canonical line and all its persisted children validate.
  if i.line_kind='normal_variant' then
   physical:=physical||jsonb_build_array(jsonb_build_object('variantId',expected->'variantId',
    'productId',expected->'productId','quantity',expected->'quantity'));
  else
   physical:=physical||(select jsonb_agg(jsonb_build_object('variantId',component->'testerVariantId',
    'productId',component->'testerProductId','quantity',component->'totalPhysicalQuantity'))
    from jsonb_array_elements(expected->'components') component);
  end if;
 end loop;
 select jsonb_agg(jsonb_build_object('variantId',variant_id,'productId',product_id,'quantity',quantity) order by variant_id)
 into demand from (select variant_id,product_id,sum(quantity) quantity from (
  select (entry->>'variantId')::uuid variant_id,(entry->>'productId')::uuid product_id,
   (entry->>'quantity')::bigint quantity from jsonb_array_elements(physical) entry
 ) physical group by variant_id,product_id) totals;
 if demand is null or exists(select 1 from jsonb_array_elements(demand) d where (d->>'quantity')::bigint not between 1 and 2147483647)
 or exists(select 1 from jsonb_array_elements(demand) d group by d->>'variantId' having count(*)<>1)
 or exists(
  with physical as (select (d->>'variantId')::uuid variant_id,(d->>'quantity')::bigint q from jsonb_array_elements(demand) d),
  ledger as (select variant_id,count(*) n,sum(quantity_delta::bigint) q from public.inventory_movements
   where reference_type='order' and reference_id=o.id and reason='Order placed' group by variant_id)
  select 1 from physical full join ledger using(variant_id) where physical.q is null or ledger.q is null or ledger.n<>1 or ledger.q<>-physical.q
 ) then raise exception 'ORDER_SNAPSHOT_INCONSISTENT'; end if;
 return demand;
exception when others then raise exception 'ORDER_SNAPSHOT_INCONSISTENT';
end; $fn$;

create function public.apply_admin_order_action_v2_014_internal(p_order_id uuid,p_actor_id uuid,p_action text,p_mutation_id uuid,
 p_expected_revision text,p_payload jsonb,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare o public.orders%rowtype; pay public.payments%rowtype; previous public.admin_audit_logs%rowtype;
 fingerprint text; command_payload jsonb:=p_payload; reason text; demand jsonb; item jsonb; result jsonb; balance integer; changing boolean;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'PERMISSION_DENIED'; end if;
 if p_order_id is null or p_actor_id is null or p_mutation_id is null or p_action is null
 or p_action not in ('status','fulfillment','payment','cancel','note') or p_expected_revision is null
 or p_expected_revision !~ '^(0|[1-9][0-9]{0,18})$' or p_request_id is null or length(p_request_id) not between 8 and 80
 or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>8000
 then raise exception 'INVALID_ADMIN_ORDER_REQUEST'; end if;
 if not exists(select 1 from public.profiles pr join public.user_roles ur on ur.user_id=pr.id join public.roles r on r.id=ur.role_id
  join public.role_permissions rp on rp.role_id=r.id join public.permissions pe on pe.id=rp.permission_id
  where pr.id=p_actor_id and pr.status='Active' and ur.active and r.active and r.key='admin' and pe.key='*') then raise exception 'PERMISSION_DENIED'; end if;
 if exists(select 1 from jsonb_each(p_payload) e where jsonb_typeof(e.value)<>'string')
 or exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(case p_action
  when 'status' then array['status','courier','trackingNumber','reason'] when 'fulfillment' then array['courier','trackingNumber','reason']
  when 'payment' then array['reference','reason'] when 'cancel' then array['reason'] else array['text'] end)))
 then raise exception 'INVALID_ADMIN_ORDER_REQUEST'; end if;
 reason:=case when p_action='fulfillment' then regexp_replace(coalesce(p_payload->>'reason',''),'^[[:space:]]+|[[:space:]]+$','','g') else btrim(coalesce(p_payload->>'reason','')) end;
 if length(reason)>1000 or (p_action in ('cancel','payment') and reason='')
 or (p_action='note' and length(btrim(coalesce(p_payload->>'text',''))) not between 1 and 2000)
 or (p_action='status' and coalesce(p_payload->>'status','') not in ('Confirmed','Processing','Shipped','Delivered'))
 or (p_action='payment' and (not(p_payload ? 'reference') or length(p_payload->>'reference')>120))
 or (p_action='fulfillment' and (length(btrim(coalesce(p_payload->>'courier',''))) not between 1 and 100
  or length(btrim(coalesce(p_payload->>'trackingNumber',''))) not between 1 and 120))
 then raise exception 'INVALID_ADMIN_ORDER_REQUEST'; end if;
 if p_action='fulfillment' then command_payload:=p_payload||jsonb_build_object('reason',reason); end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('order',p_order_id,'actor',p_actor_id,'action',p_action,
  'revision',p_expected_revision,'payload',command_payload)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('admin-order:'||p_mutation_id::text,0));
 select * into previous from public.admin_audit_logs where resource='orders' and metadata->>'mutationId'=p_mutation_id::text;
 if found then
  if previous.metadata->>'fingerprint' is distinct from fingerprint then raise exception 'MUTATION_CONFLICT'; end if;
  if jsonb_typeof(previous.metadata->'result') is distinct from 'object' or previous.metadata->'result'->>'id' is distinct from p_order_id::text
  then raise exception 'ORDER_LEDGER_INCONSISTENT'; end if;
  return previous.metadata->'result'||'{"replayed":true}'::jsonb;
 end if;
 select * into o from public.orders where id=p_order_id for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if o.checkout_version<>2 then raise exception 'ORDER_VERSION_UNSUPPORTED'; end if;
 if o.revision::text<>p_expected_revision then raise exception 'ORDER_STALE'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'ORDER_ISOLATION_UNSUPPORTED'; end if;
 select * into pay from public.payments where order_id=o.id and idempotency_key=o.idempotency_key||':payment' for update;
 if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
 if pay.provider<>o.payment_method or pay.amount<>o.total or pay.currency<>o.currency or pay.status<>o.payment_status
 or o.payment_method not in ('Cash on Delivery','Bank Transfer') then raise exception 'PAYMENT_INCONSISTENT'; end if;
 perform id from public.order_items where order_id=o.id order by position,id for share;
 perform id from public.order_item_components where order_id=o.id order by order_item_id,position,id for share;
 demand:=public.fulfillment_v2_snapshot_014(o.id);
 changing:=case p_action when 'cancel' then o.status<>'Cancelled' when 'note' then true when 'payment' then pay.status<>'Paid'
  when 'status' then p_payload->>'status'<>o.status::text
  else (btrim(p_payload->>'courier'),btrim(p_payload->>'trackingNumber')) is distinct from (o.courier_name,o.tracking_number) end;
 if changing and o.revision=9223372036854775807 then raise exception 'ORDER_REVISION_OVERFLOW'; end if;
 if p_action<>'cancel' then
  -- Reentrant mutation/order/payment locks; the corrected V1 operational semantics are unchanged.
  return public.apply_admin_order_action_v1_013_internal(p_order_id,p_actor_id,p_action,p_mutation_id,p_expected_revision,p_payload,p_request_id);
 end if;
 if exists(select 1 from public.inventory_movements where reference_type='order' and reference_id=o.id and inventory_movements.reason not in ('Order placed','Order cancelled'))
 then raise exception 'ORDER_LEDGER_INCONSISTENT'; end if;
 if o.status='Cancelled' then
  if not exists(select 1 from public.admin_audit_logs where resource='orders' and resource_id=o.id::text and action='order.cancel'
   and metadata->'result'->'changed'='true'::jsonb and metadata->'result'->>'status'='Cancelled')
  or (select count(*) from public.order_status_history where order_id=o.id and to_status='Cancelled')<>1
  or exists(with physical as (select (d->>'variantId')::uuid variant_id,(d->>'quantity')::bigint q from jsonb_array_elements(demand) d),
   ledger as (select variant_id,count(*) n,sum(quantity_delta::bigint) q from public.inventory_movements
    where reference_type='order' and reference_id=o.id and inventory_movements.reason='Order cancelled' group by variant_id)
   select 1 from physical full join ledger using(variant_id) where physical.q is null or ledger.q is null or ledger.n<>1 or ledger.q<>physical.q)
  then raise exception 'ORDER_LEDGER_INCONSISTENT'; end if;
 else
  if o.status not in ('Pending','Confirmed','Processing') then raise exception 'CANCELLATION_NOT_ALLOWED'; end if;
  if o.payment_status='Paid' or exists(select 1 from public.payments where order_id=o.id and status='Paid') then raise exception 'PAID_CANCELLATION_BLOCKED'; end if;
  if exists(select 1 from public.inventory_movements where reference_type='order' and reference_id=o.id and inventory_movements.reason='Order cancelled') then raise exception 'ORDER_LEDGER_INCONSISTENT'; end if;
  perform v.id from public.product_variants v where v.product_id in(select (d->>'productId')::uuid from jsonb_array_elements(demand) d)
   or v.id in(select (d->>'variantId')::uuid from jsonb_array_elements(demand) d) order by v.id for update;
  if exists(select 1 from jsonb_array_elements(demand) d left join public.product_variants v on v.id=(d->>'variantId')::uuid
   where v.id is null or v.product_id is distinct from (d->>'productId')::uuid) then raise exception 'ORDER_SNAPSHOT_INCONSISTENT'; end if;
  perform id from public.products where id in(select (d->>'productId')::uuid from jsonb_array_elements(demand) d) order by id for update;
  -- The frozen demand and original ledger are revalidated after inventory lock waits.
  demand:=public.fulfillment_v2_snapshot_014(o.id);
  if exists(select 1 from jsonb_array_elements(demand) d join public.product_variants v on v.id=(d->>'variantId')::uuid
   where v.stock_quantity::bigint+(d->>'quantity')::bigint>2147483647)
  or exists(select 1 from public.product_variants v left join jsonb_array_elements(demand) d on v.id=(d->>'variantId')::uuid
   where v.product_id in(select (x->>'productId')::uuid from jsonb_array_elements(demand) x) and v.active
   group by v.product_id having sum(v.stock_quantity::bigint+coalesce((d->>'quantity')::bigint,0))>2147483647)
  then raise exception 'INVENTORY_RESTORATION_OVERFLOW'; end if;
  for item in select value from jsonb_array_elements(demand) loop
   update public.product_variants set stock_quantity=(stock_quantity::bigint+(item->>'quantity')::bigint)::integer
    where id=(item->>'variantId')::uuid returning stock_quantity into balance;
   insert into public.inventory_movements(variant_id,quantity_delta,balance_after,reason,reference_type,reference_id,note,created_by)
    values((item->>'variantId')::uuid,(item->>'quantity')::integer,balance,'Order cancelled','order',o.id,reason,p_actor_id);
  end loop;
  update public.orders set status='Cancelled' where id=o.id;
  insert into public.order_status_history(order_id,from_status,to_status,note,changed_by,is_customer_visible)
   values(o.id,o.status,'Cancelled',reason,p_actor_id,false);
 end if;
 select * into o from public.orders where id=p_order_id;
 result:=jsonb_build_object('id',o.id,'revision',o.revision::text,'status',o.status,'paymentStatus',o.payment_status,
  'changed',changing,'replayed',false,'refundRequired',false);
 insert into public.admin_audit_logs(admin_id,action,resource,resource_id,permission_key,request_id,metadata)
  values(p_actor_id,'order.cancel','orders',o.id::text,'orders.manage',p_request_id,
   jsonb_build_object('mutationId',p_mutation_id,'fingerprint',fingerprint,'result',result));
 return result;
end; $fn$;

create or replace function public.apply_admin_order_action(p_order_id uuid,p_actor_id uuid,p_action text,p_mutation_id uuid,
 p_expected_revision text,p_payload jsonb,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare version smallint;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'PERMISSION_DENIED'; end if;
 -- No order lock here: each handler acquires mutation identity before order state.
 select checkout_version into version from public.orders where id=p_order_id;
 if version=2 then return public.apply_admin_order_action_v2_014_internal(p_order_id,p_actor_id,p_action,p_mutation_id,p_expected_revision,p_payload,p_request_id);
 elsif version=1 or version is null then return public.apply_admin_order_action_v1_013_internal(p_order_id,p_actor_id,p_action,p_mutation_id,p_expected_revision,p_payload,p_request_id);
 else raise exception 'ORDER_VERSION_UNSUPPORTED'; end if;
end; $fn$;
do $acl014$
declare fn regprocedure; grantee text;
begin
 foreach fn in array array['public.fulfillment_v2_snapshot_014(uuid)'::regprocedure,
  'public.apply_admin_order_action_v2_014_internal(uuid,uuid,text,uuid,text,jsonb,text)'::regprocedure,
  'public.apply_admin_order_action(uuid,uuid,text,uuid,text,jsonb,text)'::regprocedure,
  'public.create_order_transaction_v2(jsonb,uuid)'::regprocedure] loop
  execute format('alter function %s owner to postgres',fn);
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
  -- Explicitly remove grants inherited from arbitrary configured default ACLs.
  for grantee in select distinct r.rolname from pg_proc p cross join lateral aclexplode(p.proacl) a join pg_roles r on r.oid=a.grantee
   where p.oid=fn::oid and r.rolname<>'postgres' loop
   execute format('revoke all on function %s from %I',fn,grantee);
  end loop;
 end loop;
end; $acl014$;
grant execute on function public.apply_admin_order_action(uuid,uuid,text,uuid,text,jsonb,text) to service_role;
grant execute on function public.create_order_transaction_v2(jsonb,uuid) to service_role;
-- Existing quote service grant and 013 direct-write guards remain unchanged.
-- @014-DDL-END
$ddl014$;
  select encode(sha256(convert_to(jsonb_build_object(
 'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,r.rolname,
  (select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),
   (select jsonb_agg(jsonb_build_array(coalesce(ar.rolname,'PUBLIC'),ax.privilege_type,ax.is_grantable) order by coalesce(ar.rolname,'PUBLIC'),ax.privilege_type) from aclexplode(a.attacl) ax left join pg_roles ar on ar.oid=ax.grantee)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  (select jsonb_agg(jsonb_build_array(x.conname,pg_get_constraintdef(x.oid,false),x.convalidated) order by x.conname) from pg_constraint x where x.conrelid=c.oid),
  (select jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid,false),t.tgenabled) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
  (select jsonb_agg(jsonb_build_array(i.relname,pg_get_indexdef(i.oid)) order by i.relname) from pg_index ix join pg_class i on i.oid=ix.indexrelid where ix.indrelid=c.oid),
  (select jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid),(select jsonb_agg(rr.rolname order by rr.rolname) from unnest(p.polroles) pr(id) join pg_roles rr on rr.oid=pr.id)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
  (select jsonb_agg(jsonb_build_array(coalesce(gr.rolname,'PUBLIC'),x.privilege_type,x.is_grantable) order by coalesce(gr.rolname,'PUBLIC'),x.privilege_type) from aclexplode(c.relacl) x left join pg_roles gr on gr.oid=x.grantee)) order by c.relname)
  from pg_class c join pg_roles r on r.oid=c.relowner where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v')
   and not exists(select 1 from pg_depend dep where dep.classid='pg_class'::regclass and dep.objid=c.oid and dep.deptype='e')),
 'functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),r.rolname,l.lanname,p.prosecdef,p.provolatile,p.proisstrict,p.proleakproof,p.proparallel,p.proconfig,
  replace(p.prosrc,E'\r\n',E'\n'),
  (select jsonb_agg(jsonb_build_array(coalesce(gr.rolname,'PUBLIC'),x.privilege_type,x.is_grantable) order by coalesce(gr.rolname,'PUBLIC'),x.privilege_type) from aclexplode(p.proacl) x left join pg_roles gr on gr.oid=x.grantee)) order by p.proname,pg_get_function_identity_arguments(p.oid))
  from pg_proc p join pg_roles r on r.oid=p.proowner join pg_language l on l.oid=p.prolang where p.pronamespace='public'::regnamespace and p.prokind='f'
   and not exists(select 1 from pg_depend dep where dep.classid='pg_proc'::regclass and dep.objid=p.oid and dep.deptype='e'))
 )::text,'UTF8')),'hex') into shape;
  if shape is distinct from '62c63f9d1d70026f006b0c48f089ad4de14ec3551940e239c71112086d1f6ac3' then raise exception 'RF_FULFILLMENT_014_INSTALL_DRIFT'; end if;
 end if;
end; $install014$;
commit;
