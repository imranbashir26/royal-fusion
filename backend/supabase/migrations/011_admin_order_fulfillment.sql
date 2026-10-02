-- Local implementation artifact: apply only after explicit release approval.
begin;

alter table public.orders add column if not exists revision bigint not null default 0;
alter table public.products add column if not exists catalog_revision bigint not null default 0;
create or replace function public.advance_order_revision() returns trigger
language plpgsql set search_path = '' as $$ begin new.revision := old.revision + 1; return new; end $$;
create or replace function public.advance_catalog_revision() returns trigger
language plpgsql set search_path = '' as $$ begin new.catalog_revision := old.catalog_revision + 1; return new; end $$;
revoke all on function public.advance_order_revision(), public.advance_catalog_revision() from public, anon, authenticated;
drop trigger if exists orders_advance_revision on public.orders;
create trigger orders_advance_revision before update on public.orders for each row execute function public.advance_order_revision();
drop trigger if exists products_advance_revision on public.products;
create trigger products_advance_revision before update on public.products for each row execute function public.advance_catalog_revision();
create index if not exists orders_created_id_idx on public.orders(created_at desc,id desc);
create unique index if not exists admin_order_mutation_uidx on public.admin_audit_logs((metadata->>'mutationId'))
  where resource = 'orders' and metadata ? 'mutationId';
create unique index if not exists inventory_order_cancel_uidx on public.inventory_movements(reference_id,variant_id)
  where reference_type = 'order' and reason = 'Order cancelled';
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where r.key='order_manager' and p.key='payments.manage' on conflict do nothing;

-- Independent of history insertion: command, effects and replay result commit together.
create or replace function public.apply_admin_order_action(
  p_order_id uuid, p_actor_id uuid, p_action text, p_mutation_id uuid,
  p_expected_revision text, p_payload jsonb, p_request_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.orders%rowtype; pay public.payments%rowtype; previous public.admin_audit_logs%rowtype;
  permission text; fingerprint text; result jsonb; target public.order_status;
  audit_details jsonb := '{}'::jsonb;
  command_payload jsonb;
  reason text; courier text; tracking text; reference text; changed boolean := false;
  item record; item_count integer;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'PERMISSION_DENIED'; end if;
  if p_order_id is null or p_actor_id is null or p_mutation_id is null
    or p_expected_revision is null or p_expected_revision !~ '^(0|[1-9][0-9]{0,18})$'
    or p_action not in ('status','fulfillment','payment','cancel','note') or p_action is null
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text)>8000
    or p_request_id is null or length(p_request_id) not between 8 and 80 then raise exception 'INVALID_ADMIN_ORDER_REQUEST'; end if;
  permission := case when p_action='payment' then 'payments.manage' else 'orders.manage' end;
  if not exists(select 1 from public.profiles pr join public.user_roles ur on ur.user_id=pr.id
    join public.roles r on r.id=ur.role_id join public.role_permissions rp on rp.role_id=r.id
    join public.permissions pe on pe.id=rp.permission_id
    where pr.id=p_actor_id and pr.status='Active' and ur.active and r.active
    and ur.revoked_at is null and (ur.expires_at is null or ur.expires_at > now())
    and r.key in ('owner','manager','order_manager','content_editor','blog_writer')
    and pe.key in ('*',permission)) then raise exception 'PERMISSION_DENIED'; end if;
  command_payload := p_payload;
  if p_action='fulfillment' then
    if p_payload ? 'reason' and jsonb_typeof(p_payload->'reason') <> 'string' then raise exception 'INVALID_ADMIN_ORDER_REQUEST'; end if;
    -- Normalize boundary whitespace once for validation, identity and audit; retain internal formatting.
    reason := regexp_replace(coalesce(p_payload->>'reason',''),'^[[:space:]]+|[[:space:]]+$','','g');
    command_payload := p_payload || jsonb_build_object('reason',reason);
  end if;
  -- JSONB canonical command fingerprint; only controlled operational fields are audited.
  fingerprint := encode(sha256(convert_to(jsonb_build_object('order',p_order_id,'actor',p_actor_id,'action',p_action,
    'revision',p_expected_revision,'payload',command_payload)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('admin-order:'||p_mutation_id::text,0));
  select * into previous from public.admin_audit_logs where resource='orders' and metadata->>'mutationId'=p_mutation_id::text;
  if found then
    if previous.metadata->>'fingerprint' <> fingerprint then raise exception 'MUTATION_CONFLICT'; end if;
    return previous.metadata->'result' || '{"replayed":true}'::jsonb;
  end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  -- A fresh duplicate cancel/payment must acknowledge without reapplying effects.
  if o.revision::text <> p_expected_revision then raise exception 'ORDER_STALE'; end if;
  if o.idempotency_key is null or o.idempotency_key !~ '^checkout:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'ORDER_LEDGER_INCONSISTENT'; end if;
  if p_payload ? 'reason' and jsonb_typeof(p_payload->'reason') <> 'string' then raise exception 'INVALID_ADMIN_ORDER_REQUEST'; end if;
  if p_action in ('status','payment','cancel') then
    select * into pay from public.payments where order_id=o.id and idempotency_key=o.idempotency_key||':payment' for update;
    if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
    if pay.provider<>o.payment_method or pay.amount<>o.total or pay.currency<>o.currency or pay.status<>o.payment_status
      or o.payment_method not in ('Cash on Delivery','Bank Transfer') then raise exception 'PAYMENT_INCONSISTENT'; end if;
  end if;
  if p_action<>'fulfillment' then reason := trim(coalesce(p_payload->>'reason','')); end if;
  if length(reason)>1000 then raise exception 'INVALID_ADMIN_ORDER_REQUEST'; end if;
  if p_action='status' then
    if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('status','courier','trackingNumber','reason'))
      or jsonb_typeof(p_payload->'status') is distinct from 'string' then raise exception 'INVALID_ADMIN_ORDER_REQUEST'; end if;
    if p_payload->>'status' not in ('Confirmed','Processing','Shipped','Delivered') then raise exception 'INVALID_ORDER_TRANSITION'; end if;
    if (p_payload ? 'courier' and jsonb_typeof(p_payload->'courier') <> 'string')
      or (p_payload ? 'trackingNumber' and jsonb_typeof(p_payload->'trackingNumber') <> 'string') then raise exception 'INVALID_ADMIN_ORDER_REQUEST'; end if;
    target := (p_payload->>'status')::public.order_status;
    if target <> o.status then
      if not ((o.status='Pending' and target='Confirmed') or (o.status='Confirmed' and target='Processing')
        or (o.status='Processing' and target='Shipped') or (o.status='Shipped' and target='Delivered')) then raise exception 'INVALID_ORDER_TRANSITION'; end if;
      if o.payment_method='Bank Transfer' and target in ('Processing','Shipped') and o.payment_status <> 'Paid' then raise exception 'PAYMENT_INCONSISTENT'; end if;
      if target='Shipped' then
        courier := trim(coalesce(p_payload->>'courier','')); tracking := trim(coalesce(p_payload->>'trackingNumber',''));
        if length(courier) not between 1 and 100 or length(tracking) not between 1 and 120 then raise exception 'FULFILLMENT_REQUIRED'; end if;
      elsif p_payload ? 'courier' or p_payload ? 'trackingNumber' then raise exception 'INVALID_ADMIN_ORDER_REQUEST'; end if;
      update public.orders set status=target,courier_name=coalesce(courier,courier_name),tracking_number=coalesce(tracking,tracking_number) where id=o.id;
      insert into public.order_status_history(order_id,from_status,to_status,note,changed_by,is_customer_visible)
        values(o.id,o.status,target,reason,p_actor_id,false);
      changed := true;
    elsif p_payload ? 'courier' or p_payload ? 'trackingNumber' then
      if p_payload->>'courier' is distinct from o.courier_name or p_payload->>'trackingNumber' is distinct from o.tracking_number then raise exception 'MUTATION_CONFLICT'; end if;
    end if;
  elsif p_action='fulfillment' then
    if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('courier','trackingNumber','reason'))
      or jsonb_typeof(p_payload->'courier') is distinct from 'string' or jsonb_typeof(p_payload->'trackingNumber') is distinct from 'string' then raise exception 'INVALID_ADMIN_ORDER_REQUEST'; end if;
    courier := trim(p_payload->>'courier'); tracking := trim(p_payload->>'trackingNumber');
    if o.status not in ('Processing','Shipped') then raise exception 'INVALID_ORDER_TRANSITION'; end if;
    if o.status='Shipped' and reason='' then raise exception 'INVALID_TRACKING'; end if;
    if length(courier) not between 1 and 100 or length(tracking) not between 1 and 120 then raise exception 'INVALID_TRACKING'; end if;
    if o.status='Shipped' then
      audit_details := jsonb_build_object('trackingCorrection',jsonb_build_object(
        'kind','tracking_correction','reason',reason,
        'previous',jsonb_build_object('courier',o.courier_name,'trackingNumber',o.tracking_number),
        'next',jsonb_build_object('courier',courier,'trackingNumber',tracking)));
    end if;
    if (courier,tracking) is distinct from (o.courier_name,o.tracking_number) then
      update public.orders set courier_name=courier,tracking_number=tracking where id=o.id; changed := true;
    end if;
  elsif p_action='payment' then
    if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('reference','reason'))
      or jsonb_typeof(p_payload->'reference') is distinct from 'string' or reason='' then raise exception 'INVALID_ADMIN_ORDER_REQUEST'; end if;
    reference := trim(p_payload->>'reference');
    if length(reference)>120 or o.status in ('Cancelled','Returned','Refunded') then raise exception 'PAYMENT_CONFIRMATION_CONFLICT'; end if;
    select * into pay from public.payments where order_id=o.id and idempotency_key=o.idempotency_key||':payment' for update;
    if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
    if pay.provider <> o.payment_method or pay.amount <> o.total or pay.currency <> o.currency
      or pay.status <> o.payment_status or o.payment_method not in ('Cash on Delivery','Bank Transfer') then raise exception 'PAYMENT_INCONSISTENT'; end if;
    if pay.status='Paid' then
      if pay.provider_reference <> reference or pay.processed_at is null then raise exception 'PAYMENT_CONFIRMATION_CONFLICT'; end if;
    else
      if (o.payment_method='Cash on Delivery' and (o.status<>'Delivered' or pay.status<>'Unpaid'))
        or (o.payment_method='Bank Transfer' and pay.status<>'Pending') or pay.processed_at is not null then raise exception 'PAYMENT_INCONSISTENT'; end if;
      update public.payments set status='Paid',processed_at=clock_timestamp(),provider_reference=reference where id=pay.id;
      update public.orders set payment_status='Paid' where id=o.id; changed := true;
    end if;
  elsif p_action='cancel' then
    if exists(select 1 from jsonb_object_keys(p_payload) k where k<>'reason') or reason='' then raise exception 'INVALID_ADMIN_ORDER_REQUEST'; end if;
    if o.status='Cancelled' then
      if not exists(select 1 from public.admin_audit_logs where resource='orders' and resource_id=o.id::text and action='order.cancel') then raise exception 'ORDER_LEDGER_INCONSISTENT'; end if;
    else
      if o.status not in ('Pending','Confirmed','Processing') then raise exception 'CANCELLATION_NOT_ALLOWED'; end if;
      -- Paid cancellation/refunds are deliberately excluded from launch.
      if o.payment_status='Paid' or exists(select 1 from public.payments where order_id=o.id and status='Paid') then raise exception 'PAID_CANCELLATION_BLOCKED'; end if;
      select count(*) into item_count from public.order_items where order_id=o.id;
      if item_count=0 or exists(select 1 from public.order_items i left join public.product_variants v on v.id=i.variant_id
        where i.order_id=o.id and (v.id is null or v.product_id is distinct from i.product_id))
        or exists(
          with items as (select variant_id,sum(quantity) q from public.order_items where order_id=o.id group by variant_id),
          ledger as (select mv.variant_id,sum(mv.quantity_delta) q,count(*) n from public.inventory_movements mv
            where mv.reference_type='order' and mv.reference_id=o.id and mv.reason='Order placed' group by mv.variant_id)
          select 1 from items full join ledger using(variant_id) where items.q is null or ledger.q is null or ledger.n<>1 or ledger.q<>-items.q)
        or exists(select 1 from public.inventory_movements mv where mv.reference_type='order' and mv.reference_id=o.id and mv.reason<>'Order placed') then raise exception 'ORDER_LEDGER_INCONSISTENT'; end if;
      -- Same inventory lock order as checkout and Phase 1; never parent-first.
      perform siblings.id from public.product_variants siblings where siblings.product_id in
        (select product_id from public.order_items where order_id=o.id) order by siblings.id for update of siblings;
      perform parents.id from public.products parents where parents.id in
        (select product_id from public.order_items where order_id=o.id) order by parents.id for update of parents;
      for item in select variant_id,sum(quantity)::integer quantity from public.order_items where order_id=o.id group by variant_id order by variant_id loop
        -- Preserve merchandising flags, including intentional availability blocks.
        update public.product_variants set stock_quantity=stock_quantity+item.quantity where id=item.variant_id;
        insert into public.inventory_movements(variant_id,quantity_delta,balance_after,reason,reference_type,reference_id,note,created_by)
          select id,item.quantity,stock_quantity,'Order cancelled','order',o.id,reason,p_actor_id from public.product_variants where id=item.variant_id;
      end loop;
      update public.orders set status='Cancelled' where id=o.id;
      insert into public.order_status_history(order_id,from_status,to_status,note,changed_by,is_customer_visible)
        values(o.id,o.status,'Cancelled',reason,p_actor_id,false); changed := true;
    end if;
  elsif p_action='note' then
    if exists(select 1 from jsonb_object_keys(p_payload) k where k<>'text') or jsonb_typeof(p_payload->'text') is distinct from 'string'
      or length(trim(p_payload->>'text')) not between 1 and 2000 then raise exception 'INVALID_ADMIN_ORDER_REQUEST'; end if;
    if o.status in ('Delivered','Cancelled','Returned','Refunded') then raise exception 'INVALID_ORDER_TRANSITION'; end if;
    insert into public.order_notes(order_id,note,is_customer_visible,created_by) values(o.id,trim(p_payload->>'text'),false,p_actor_id);
    update public.orders set updated_at=clock_timestamp() where id=o.id; changed := true;
  end if;
  select * into o from public.orders where id=o.id;
  result := jsonb_build_object('id',o.id,'revision',o.revision::text,'status',o.status,'paymentStatus',o.payment_status,'changed',changed,'replayed',false,'refundRequired',false);
  insert into public.admin_audit_logs(admin_id,action,resource,resource_id,permission_key,request_id,metadata)
    values(p_actor_id,'order.'||p_action,'orders',o.id::text,permission,p_request_id,
      jsonb_build_object('mutationId',p_mutation_id,'fingerprint',fingerprint,'result',result) || audit_details);
  return result;
end $$;
revoke all on function public.apply_admin_order_action(uuid,uuid,text,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.apply_admin_order_action(uuid,uuid,text,uuid,text,jsonb,text) to service_role;

-- Catalog revision guard follows below; original Phase 1 persistence body retained.

drop function public.save_catalog_product(uuid,jsonb,jsonb);
create or replace function public.save_catalog_product(
  p_product_id uuid,
  p_patch jsonb,
  p_variants jsonb default null,
  p_expected_revision text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous public.products%rowtype;
  saved public.products%rowtype;
  variant public.product_variants%rowtype;
  patch jsonb := p_patch - 'stock_quantity' - 'stock_status';
  item jsonb;
  allowed text[] := array[
    'name','slug','sku','short_description','description','price','sale_price','old_price',
    'stock_quantity','category_id','category_name','collection','gender','scent_family',
    'top_notes','middle_notes','base_notes','bottle_size','concentration','longevity',
    'sillage','occasion','inspired_by','main_image_url','gallery_urls','image_alt','badge',
    'tags','size_options','variations','is_featured','is_best_seller','is_new_arrival',
    'is_premium','is_attar','status','seo_title','seo_description','card_image_url',
    'card_hover_image_url','card_background_color','active','published_at'
  ];
  names text;
  expressions text;
  assignments text;
  size_value text;
  variant_count integer;
  wanted_stock integer;
  seen_ids uuid[] := '{}';
  total_stock integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Catalog saves require the backend service.';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or (p_patch = '{}'::jsonb and (p_product_id is null or p_variants is null))
     or exists (select 1 from jsonb_object_keys(p_patch) k where not (k = any(allowed))) then
    raise exception using errcode = '22023', message = 'Invalid catalog patch.';
  end if;
  if p_variants is not null and (jsonb_typeof(p_variants) <> 'array'
      or jsonb_array_length(p_variants) not between 1 and 50) then
    raise exception using errcode = '22023', message = 'Invalid variants.';
  end if;

  if p_product_id is not null then
    -- Same variant-first order as checkout; never delete or recreate inventory rows.
    perform id from public.product_variants where product_id = p_product_id order by id for update;
    select * into previous from public.products where id = p_product_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Product not found.';
    end if;
  end if;

  if p_product_id is not null then
    if (p_variants is not null or p_patch ? 'stock_quantity') and p_expected_revision is null then
      raise exception using errcode = 'P0001', message = 'CATALOG_STALE';
    end if;
    if p_expected_revision is not null and previous.catalog_revision::text <> p_expected_revision then
      raise exception using errcode = 'P0001', message = 'CATALOG_STALE';
    end if;
  end if;

  if patch ? 'bottle_size' then
    size_value := regexp_replace(trim(patch->>'bottle_size'), '\s+', ' ', 'g');
    size_value := regexp_replace(size_value, '^(\d+(?:\.\d+)?)\s*ml$', '\1 ml', 'i');
    patch := jsonb_set(patch, '{bottle_size}', to_jsonb(size_value));
  end if;
  -- Identifiers originate only in the allowlist above; values remain bound parameters.
  select string_agg(format('%I', k), ',' order by k),
         string_agg(format('r.%I', k), ',' order by k),
         string_agg(format('%I = r.%I', k, k), ',' order by k)
    into names, expressions, assignments
  from jsonb_object_keys(patch) k;

  if p_product_id is null then
    if names is null then
      raise exception using errcode = '22023', message = 'Product fields are required.';
    end if;
    execute format('insert into public.products (%s) select %s from jsonb_populate_record(null::public.products, $1) r returning *', names, expressions)
      into saved using patch;
  else
    if names is not null then
      execute format('update public.products p set %s from jsonb_populate_record(null::public.products, $1) r where p.id = $2 returning p.*', assignments)
        into saved using patch, p_product_id;
    else
      saved := previous;
    end if;
  end if;

  if p_variants is not null then
    for item in select value from jsonb_array_elements(p_variants) loop
      if jsonb_typeof(item) <> 'object' or not (item ?& array['optionName','optionValue','sku','regularPrice','stockQuantity','active','displayOrder']) then
        raise exception using errcode = '22023', message = 'Invalid variant contract.';
      end if;
      size_value := regexp_replace(trim(item->>'optionValue'), '\s+', ' ', 'g');
      size_value := regexp_replace(size_value, '^(\d+(?:\.\d+)?)\s*ml$', '\1 ml', 'i');
      variant := null;
      if item->>'id' is not null then
        select * into variant from public.product_variants
          where id = (item->>'id')::uuid and product_id = saved.id;
        if not found then
          raise exception using errcode = '22023', message = 'Variant does not belong to this product.';
        end if;
      else
        select count(*) into variant_count from public.product_variants
          where product_id = saved.id and (
            (lower(option_name) = lower(trim(item->>'optionName'))
             and lower(regexp_replace(regexp_replace(trim(option_value), '\s+', ' ', 'g'), '^(\d+(?:\.\d+)?)\s*ml$', '\1 ml', 'i')) = lower(size_value))
            or lower(sku) = lower(trim(item->>'sku'))
          );
        if variant_count > 1 then
          raise exception using errcode = '23505', message = 'Ambiguous variant identity; supply the existing UUID.';
        end if;
        select * into variant from public.product_variants
          where product_id = saved.id and (
            (lower(option_name) = lower(trim(item->>'optionName'))
             and lower(regexp_replace(regexp_replace(trim(option_value), '\s+', ' ', 'g'), '^(\d+(?:\.\d+)?)\s*ml$', '\1 ml', 'i')) = lower(size_value))
            or lower(sku) = lower(trim(item->>'sku'))
          );
      end if;
      if variant.id is null then
        insert into public.product_variants(product_id, option_name, option_value, sku,
          regular_price, sale_price, stock_quantity, active, available, display_order)
        values (saved.id, trim(item->>'optionName'), size_value, trim(item->>'sku'),
          (item->>'regularPrice')::numeric, nullif((item->>'salePrice')::numeric, 0),
          (item->>'stockQuantity')::integer, (item->>'active')::boolean,
          coalesce((item->>'available')::boolean, (item->>'stockQuantity')::integer > 0),
          (item->>'displayOrder')::integer) returning * into variant;
      else
        if variant.id = any(seen_ids) then
          raise exception using errcode = '23505', message = 'Duplicate variant option.';
        end if;
        update public.product_variants set option_name = trim(item->>'optionName'), option_value = size_value,
          sku = trim(item->>'sku'), regular_price = (item->>'regularPrice')::numeric,
          sale_price = nullif((item->>'salePrice')::numeric, 0), stock_quantity = (item->>'stockQuantity')::integer,
          active = (item->>'active')::boolean,
          available = coalesce((item->>'available')::boolean, (item->>'stockQuantity')::integer > 0),
          display_order = (item->>'displayOrder')::integer where id = variant.id returning * into variant;
      end if;
      seen_ids := array_append(seen_ids, variant.id);
    end loop;
    -- Omitted variants are retained, not implicitly deleted or deactivated.
  else
    select count(*) into variant_count from public.product_variants where product_id = saved.id;
    if variant_count > 1 then
      if (p_patch ? 'stock_quantity' and (p_patch->>'stock_quantity')::integer is distinct from previous.stock_quantity)
        or (p_patch ? 'price' and saved.price is distinct from previous.price)
        or (p_patch ? 'sale_price' and saved.sale_price is distinct from previous.sale_price)
        or (p_patch ? 'sku' and saved.sku is distinct from previous.sku)
        or (p_patch ? 'bottle_size' and saved.bottle_size is distinct from previous.bottle_size) then
        raise exception using errcode = '22023', message = 'Multi-variant inventory requires explicit variants.';
      end if;
    elsif variant_count = 1 then
      select * into variant from public.product_variants where product_id = saved.id;
      update public.product_variants set
        option_value = case when patch ? 'bottle_size' then saved.bottle_size else option_value end,
        sku = case when patch ? 'sku' then saved.sku else sku end,
        regular_price = case when patch ? 'price' then saved.price else regular_price end,
        sale_price = case when patch ? 'sale_price' then nullif(saved.sale_price, 0) else sale_price end,
        stock_quantity = case when p_patch ? 'stock_quantity' then (p_patch->>'stock_quantity')::integer else stock_quantity end,
        available = case when p_patch ? 'stock_quantity' then (p_patch->>'stock_quantity')::integer > 0 else available end
      where id = variant.id;
    elsif trim(saved.bottle_size) <> '' and saved.status <> 'Archived' then
      wanted_stock := coalesce((p_patch->>'stock_quantity')::integer, previous.stock_quantity, 0);
      size_value := regexp_replace(regexp_replace(trim(saved.bottle_size), '\s+', ' ', 'g'), '^(\d+(?:\.\d+)?)\s*ml$', '\1 ml', 'i');
      insert into public.product_variants(product_id, option_name, option_value, sku,
        regular_price, sale_price, stock_quantity, active, available)
      values(saved.id, 'Size', size_value, saved.sku, saved.price,
        nullif(saved.sale_price, 0), wanted_stock, true, wanted_stock > 0);
      update public.products set bottle_size = size_value where id = saved.id;
    elsif saved.status = 'Published' and saved.active then
      raise exception using errcode = '22023', message = 'Published products require a size or explicit variants.';
    elsif coalesce((p_patch->>'stock_quantity')::integer, previous.stock_quantity, 0) <> 0 then
      raise exception using errcode = '22023', message = 'Stock requires a size or explicit variants.';
    end if;
  end if;

  if saved.status = 'Published' and saved.active and not exists (
    select 1 from public.product_variants where product_id = saved.id and active
  ) then
    raise exception using errcode = '22023', message = 'Published products require an active variant.';
  end if;
  select coalesce(sum(stock_quantity), 0)::integer into total_stock
    from public.product_variants where product_id = saved.id and active;
  update public.products set stock_quantity = total_stock,
    stock_status = case when total_stock = 0 then 'Out of Stock' when total_stock <= 5 then 'Low Stock' else 'In Stock' end
    where id = saved.id returning * into saved;
  return jsonb_build_object('product', to_jsonb(saved), 'variants', coalesce((
    select jsonb_agg(to_jsonb(v) order by display_order, id) from public.product_variants v where product_id = saved.id
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.save_catalog_product(uuid,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.save_catalog_product(uuid,jsonb,jsonb,text) to service_role;

commit;
