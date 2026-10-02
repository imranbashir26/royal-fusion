-- Phase 3: function-only locking, fail-closed shipping and explicit UTC coupon dates.
-- No tables, columns, RLS policies or catalog writer changes.

create or replace function public.create_order_transaction(
  p_idempotency_key text,
  p_items jsonb,
  p_contact jsonb,
  p_shipping jsonb,
  p_payment_method text,
  p_coupon_code text default null,
  p_shipping_method_id uuid default null,
  p_customer_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_idempotency_key text := trim(coalesce(p_idempotency_key, ''));
  v_order public.orders%rowtype;
  v_coupon public.coupons%rowtype;
  v_shipping_method public.shipping_methods%rowtype;
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric(12,2);
  v_discount_base numeric(12,2);
  v_discount numeric(12,2) := 0;
  v_shipping_fee numeric(12,2) := 0;
  v_total numeric(12,2);
  v_requested_count integer;
  v_matched_count integer;
  v_customer_email text := lower(trim(coalesce(p_contact ->> 'email', '')));
  v_coupon_usage integer;
  v_shipping_rate_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Checkout is restricted to the backend service.';
  end if;

  if length(v_idempotency_key) < 8 or length(v_idempotency_key) > 160 then
    raise exception using errcode = '22023', message = 'A valid idempotency key is required.';
  end if;
  if length(trim(coalesce(p_payment_method, ''))) < 2 then
    raise exception using errcode = '22023', message = 'A valid payment method is required.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'At least one order item is required.';
  end if;
  if length(trim(coalesce(p_contact ->> 'name', ''))) < 2
     or (v_customer_email = '' and length(trim(coalesce(p_contact ->> 'phone', ''))) < 7) then
    raise exception using errcode = '22023', message = 'Valid customer contact information is required.';
  end if;
  if length(trim(coalesce(p_shipping ->> 'address', ''))) < 4
     or length(trim(coalesce(p_shipping ->> 'city', ''))) < 2 then
    raise exception using errcode = '22023', message = 'A valid shipping address is required.';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.profiles where id = p_customer_id and status = 'Active'
  ) then
    raise exception using errcode = '23503', message = 'Customer account is unavailable.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_idempotency_key, 0));

  select * into v_order
  from public.orders
  where idempotency_key = v_idempotency_key;
  if found then
    return jsonb_build_object(
      'id', v_order.id,
      'orderNumber', v_order.order_number,
      'status', v_order.status,
      'subtotal', v_order.subtotal,
      'discount', v_order.discount,
      'shippingFee', v_order.shipping_fee,
      'total', v_order.total,
      'idempotent', true
    );
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where not (item ? 'variantId')
       or not (item ? 'quantity')
       or (item ->> 'quantity') !~ '^[1-9][0-9]*$'
       or (item ->> 'quantity')::integer > 99
  ) then
    raise exception using errcode = '22023', message = 'Every item requires a variant ID and quantity from 1 to 99.';
  end if;

  with requested as (
    select (item ->> 'variantId')::uuid as variant_id, sum((item ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) item
    group by (item ->> 'variantId')::uuid
  )
  select count(*) into v_requested_count from requested;

  -- Match Phase 1 save_catalog_product: variants first, then parent products.
  -- Lock every sibling so the aggregate-stock trigger sees serialized decrements.
  perform siblings.id
  from public.product_variants siblings
  where siblings.product_id in (
    select requested.product_id
    from public.product_variants requested
    where requested.id in (
      select (item ->> 'variantId')::uuid from jsonb_array_elements(p_items) item
    )
  )
  order by siblings.id
  for update of siblings;

  perform products.id
  from public.products products
  where products.id in (
    select requested.product_id
    from public.product_variants requested
    where requested.id in (
      select (item ->> 'variantId')::uuid from jsonb_array_elements(p_items) item
    )
  )
  order by products.id
  for update of products;

  with requested as (
    select (item ->> 'variantId')::uuid as variant_id, sum((item ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) item
    group by (item ->> 'variantId')::uuid
  )
  select count(*) into v_matched_count
  from requested
  join public.product_variants variants on variants.id = requested.variant_id
  join public.products products on products.id = variants.product_id
  where variants.active and variants.available and products.active and products.status = 'Published';

  if v_matched_count <> v_requested_count then
    raise exception using errcode = 'P0001', message = 'One or more product variants are unavailable.';
  end if;

  if exists (
    with requested as (
      select (item ->> 'variantId')::uuid as variant_id, sum((item ->> 'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) item
      group by (item ->> 'variantId')::uuid
    )
    select 1
    from requested
    join public.product_variants variants on variants.id = requested.variant_id
    where variants.stock_quantity < requested.quantity
  ) then
    raise exception using errcode = 'P0001', message = 'One or more product variants do not have enough stock.';
  end if;

  with requested as (
    select (item ->> 'variantId')::uuid as variant_id, sum((item ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) item
    group by (item ->> 'variantId')::uuid
  )
  select sum((case when variants.sale_price is not null then variants.sale_price else variants.regular_price end) * requested.quantity)
  into v_subtotal
  from requested
  join public.product_variants variants on variants.id = requested.variant_id;

  if p_coupon_code is not null and trim(p_coupon_code) <> '' then
    select * into v_coupon
    from public.coupons
    where lower(code) = lower(trim(p_coupon_code))
    for update;

    if not found or v_coupon.status <> 'Active' then
      raise exception using errcode = 'P0001', message = 'Coupon is unavailable.';
    end if;
    if v_coupon.start_date is not null and (statement_timestamp() at time zone 'UTC')::date < v_coupon.start_date then
      raise exception using errcode = 'P0001', message = 'Coupon has not started.';
    end if;
    if v_coupon.end_date is not null and (statement_timestamp() at time zone 'UTC')::date > v_coupon.end_date then
      raise exception using errcode = 'P0001', message = 'Coupon has expired.';
    end if;
    if v_subtotal < v_coupon.minimum_order_amount then
      raise exception using errcode = 'P0001', message = 'Order does not meet the coupon minimum.';
    end if;
    if v_coupon.usage_limit > 0 and v_coupon.used_count >= v_coupon.usage_limit then
      raise exception using errcode = 'P0001', message = 'Coupon usage limit has been reached.';
    end if;

    if v_coupon.per_customer_usage_limit > 0 then
      select count(*) into v_coupon_usage
      from public.coupon_redemptions redemptions
      where redemptions.coupon_id = v_coupon.id
        and (
          (p_customer_id is not null and redemptions.customer_id = p_customer_id)
          or (v_customer_email <> '' and lower(redemptions.customer_email) = v_customer_email)
        );
      if v_coupon_usage >= v_coupon.per_customer_usage_limit then
        raise exception using errcode = 'P0001', message = 'Customer coupon usage limit has been reached.';
      end if;
    end if;

    with requested as (
      select (item ->> 'variantId')::uuid as variant_id, sum((item ->> 'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) item
      group by (item ->> 'variantId')::uuid
    )
    select coalesce(sum(
      (case when variants.sale_price is not null then variants.sale_price else variants.regular_price end) * requested.quantity
    ), 0)
    into v_discount_base
    from requested
    join public.product_variants variants on variants.id = requested.variant_id
    where (
      not exists (select 1 from public.coupon_products where coupon_id = v_coupon.id)
      or exists (
        select 1 from public.coupon_products
        where coupon_id = v_coupon.id and product_id = variants.product_id
      )
    )
    and (
      not exists (select 1 from public.coupon_categories where coupon_id = v_coupon.id)
      or exists (
        select 1
        from public.coupon_categories coupon_categories
        join public.product_categories product_categories
          on product_categories.category_id = coupon_categories.category_id
        where coupon_categories.coupon_id = v_coupon.id
          and product_categories.product_id = variants.product_id
      )
    );

    if v_discount_base <= 0 then
      raise exception using errcode = 'P0001', message = 'Coupon does not apply to the selected products.';
    end if;

    if v_coupon.type = 'Percentage' then
      v_discount := round(v_discount_base * v_coupon.discount_value / 100, 2);
    elsif v_coupon.type = 'Fixed Amount' then
      v_discount := least(v_discount_base, v_coupon.discount_value);
    end if;
    if v_coupon.max_discount_amount is not null then
      v_discount := least(v_discount, v_coupon.max_discount_amount);
    end if;
  end if;

  if p_shipping_method_id is not null then
    select * into v_shipping_method
    from public.shipping_methods
    where id = p_shipping_method_id and active;
  else
    select * into v_shipping_method
    from public.shipping_methods
    where active
    order by display_order, created_at
    limit 1;
  end if;
  if not found then
    raise exception using errcode = 'P0001', message = 'No shipping method is available.';
  end if;

  -- Reject every tie at the winning priority/threshold, even when fees agree.
  select count(*), min(ranked.fee) into v_shipping_rate_count, v_shipping_fee
  from (
    select rates.fee, dense_rank() over (
      order by case rates.scope_type when 'city' then 1 when 'province' then 2 else 3 end,
        rates.minimum_subtotal desc
    ) as selection_rank
    from public.shipping_rates rates
    where rates.shipping_method_id = v_shipping_method.id
      and rates.active
      and rates.minimum_subtotal <= (v_subtotal - v_discount)
      and (
        rates.scope_type = 'default'
        or (rates.scope_type = 'city' and lower(rates.scope_value) = lower(coalesce(p_shipping ->> 'city', '')))
        or (rates.scope_type = 'province' and lower(rates.scope_value) = lower(coalesce(p_shipping ->> 'province', '')))
      )
  ) ranked
  where ranked.selection_rank = 1;
  if v_shipping_rate_count > 1 then
    raise exception using errcode = 'P0001', message = 'Shipping rate configuration is ambiguous.';
  end if;
  v_shipping_fee := coalesce(v_shipping_fee, v_shipping_method.base_fee);

  if (v_shipping_method.free_shipping_threshold is not null
      and (v_subtotal - v_discount) >= v_shipping_method.free_shipping_threshold)
     or (v_coupon.id is not null and v_coupon.type = 'Free Shipping') then
    v_shipping_fee := 0;
  end if;

  v_total := greatest(0, v_subtotal - v_discount + v_shipping_fee);
  v_order_id := gen_random_uuid();
  v_order_number := 'RF-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-' ||
    upper(substr(replace(v_order_id::text, '-', ''), 1, 8));

  insert into public.orders (
    id, order_number, customer_id, customer_name, customer_email, customer_phone,
    shipping_address, shipping_city, shipping_province, order_notes,
    status, payment_method, payment_status, subtotal, discount, shipping_fee, total,
    coupon_code, coupon_id, shipping_method_id, currency, idempotency_key
  ) values (
    v_order_id, v_order_number, p_customer_id,
    trim(coalesce(p_contact ->> 'name', '')),
    nullif(v_customer_email, ''),
    nullif(trim(coalesce(p_contact ->> 'phone', '')), ''),
    trim(coalesce(p_shipping ->> 'address', '')),
    trim(coalesce(p_shipping ->> 'city', '')),
    trim(coalesce(p_shipping ->> 'province', '')),
    trim(coalesce(p_shipping ->> 'notes', '')),
    'Pending', p_payment_method,
    case when lower(p_payment_method) = 'cash on delivery' then 'Unpaid'::public.payment_status else 'Pending'::public.payment_status end,
    v_subtotal, v_discount, v_shipping_fee, v_total,
    coalesce(v_coupon.code, ''), v_coupon.id, v_shipping_method.id, 'PKR', v_idempotency_key
  );

  with requested as (
    select (item ->> 'variantId')::uuid as variant_id, sum((item ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) item
    group by (item ->> 'variantId')::uuid
  )
  insert into public.order_items (
    order_id, product_id, variant_id, product_name, size, sku, quantity, unit_price
  )
  select
    v_order_id,
    variants.product_id,
    variants.id,
    products.name,
    variants.option_value,
    variants.sku,
    requested.quantity,
    case when variants.sale_price is not null then variants.sale_price else variants.regular_price end
  from requested
  join public.product_variants variants on variants.id = requested.variant_id
  join public.products products on products.id = variants.product_id;

  with requested as (
    select (item ->> 'variantId')::uuid as variant_id, sum((item ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) item
    group by (item ->> 'variantId')::uuid
  ), updated as (
    update public.product_variants variants
    set stock_quantity = variants.stock_quantity - requested.quantity,
        available = (variants.stock_quantity - requested.quantity) > 0,
        updated_at = now()
    from requested
    where variants.id = requested.variant_id
    returning variants.id, variants.stock_quantity, requested.quantity
  )
  insert into public.inventory_movements (
    variant_id, quantity_delta, balance_after, reason, reference_type, reference_id
  )
  select id, -quantity, stock_quantity, 'Order placed', 'order', v_order_id
  from updated;

  insert into public.order_status_history (order_id, from_status, to_status, note)
  values (v_order_id, null, 'Pending', 'Order created by transactional checkout.');

  insert into public.payments (order_id, provider, amount, currency, status, idempotency_key)
  values (
    v_order_id,
    p_payment_method,
    v_total,
    'PKR',
    case when lower(p_payment_method) = 'cash on delivery' then 'Unpaid'::public.payment_status else 'Pending'::public.payment_status end,
    v_idempotency_key || ':payment'
  );

  if v_coupon.id is not null then
    insert into public.coupon_redemptions (
      coupon_id, order_id, customer_id, customer_email, discount_amount
    ) values (
      v_coupon.id, v_order_id, p_customer_id, v_customer_email, v_discount
    );
    update public.coupons
    set used_count = used_count + 1, updated_at = now()
    where id = v_coupon.id;
  end if;

  return jsonb_build_object(
    'id', v_order_id,
    'orderNumber', v_order_number,
    'status', 'Pending',
    'subtotal', v_subtotal,
    'discount', v_discount,
    'shippingFee', v_shipping_fee,
    'total', v_total,
    'idempotent', false
  );
end;
$$;

revoke all on function public.create_order_transaction(text, jsonb, jsonb, jsonb, text, text, uuid, uuid) from public;
revoke all on function public.create_order_transaction(text, jsonb, jsonb, jsonb, text, text, uuid, uuid) from anon;
revoke all on function public.create_order_transaction(text, jsonb, jsonb, jsonb, text, text, uuid, uuid) from authenticated;
grant execute on function public.create_order_transaction(text, jsonb, jsonb, jsonb, text, text, uuid, uuid) to service_role;
