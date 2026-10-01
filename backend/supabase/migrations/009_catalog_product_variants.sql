-- Forward-only Phase 1. Does not backfill products or change checkout/RBAC/media.
begin;

create or replace function public.save_catalog_product(
  p_product_id uuid,
  p_patch jsonb,
  p_variants jsonb default null
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

revoke all on function public.save_catalog_product(uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.save_catalog_product(uuid,jsonb,jsonb) to service_role;
commit;
