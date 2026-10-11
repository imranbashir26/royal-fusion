-- Previous vulnerable 014 validator: disposable target-drift regression only.
create or replace function public.fulfillment_v2_snapshot_014(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare o public.orders%rowtype; i public.order_items%rowtype; expected jsonb; actual jsonb; identity jsonb; demand jsonb;
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
 or (select sum(line_total) from public.order_items where order_id=o.id)<>o.subtotal
 then raise exception 'ORDER_SNAPSHOT_INCONSISTENT'; end if;
 for i in select * from public.order_items where order_id=o.id order by position,id loop
  expected:=o.quote_snapshot->'lines'->i.position;
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
 end loop;
 select jsonb_agg(jsonb_build_object('variantId',variant_id,'productId',product_id,'quantity',quantity) order by variant_id)
 into demand from (select variant_id,product_id,sum(quantity) quantity from (
  select variant_id,product_id,quantity::bigint quantity from public.order_items where order_id=o.id and line_kind='normal_variant'
  union all select tester_variant_id,tester_product_id,total_physical_quantity::bigint from public.order_item_components where order_id=o.id
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
