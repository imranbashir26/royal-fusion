-- Phase 4A: one transaction updates a private section and its public projection.
begin;

create or replace function public.update_site_settings_section(
  p_section text,
  p_patch jsonb,
  p_public_rows jsonb
) returns void language plpgsql security invoker set search_path = public as $$
declare
  v_key text;
  v_value jsonb;
  v_payments jsonb;
  v_result jsonb := '[]'::jsonb;
  v_item jsonb;
  v_desired jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Settings updates require the backend service.';
  end if;
  if p_section not in ('settings', 'homepage', 'shipping', 'payments')
     or jsonb_typeof(p_public_rows) <> 'object' then
    raise exception using errcode = '22023', message = 'Invalid settings section.';
  end if;

  insert into public.site_settings (id) values ('site') on conflict (id) do nothing;
  perform 1 from public.site_settings where id = 'site' for update;

  if p_section = 'settings' then
    if jsonb_typeof(p_patch) <> 'object' then raise exception 'Invalid settings patch.'; end if;
    update public.site_settings set settings = coalesce(settings, '{}'::jsonb) || p_patch,
      updated_at = now() where id = 'site';
  elsif p_section = 'homepage' then
    if jsonb_typeof(p_patch) <> 'object' then raise exception 'Invalid homepage patch.'; end if;
    update public.site_settings set homepage = coalesce(homepage, '{}'::jsonb) || p_patch,
      updated_at = now() where id = 'site';
  elsif p_section = 'shipping' then
    if jsonb_typeof(p_patch) <> 'object' then raise exception 'Invalid shipping patch.'; end if;
    update public.site_settings set shipping = coalesce(shipping, '{}'::jsonb) || p_patch,
      updated_at = now() where id = 'site';
  else
    if jsonb_typeof(p_patch) <> 'array' then raise exception 'Invalid payments patch.'; end if;
    select payments into v_payments from public.site_settings where id = 'site';
    if jsonb_typeof(v_payments) <> 'array' then v_payments := '[]'::jsonb; end if;
    for v_item in select value from jsonb_array_elements(v_payments) loop
      if v_item ->> 'name' in ('Cash on Delivery', 'Bank Transfer') then
        select value into v_desired from jsonb_array_elements(p_patch)
          where value ->> 'name' = v_item ->> 'name' limit 1;
        v_result := v_result || (v_item || jsonb_build_object('active', v_desired -> 'active'));
      else
        v_result := v_result || v_item;
      end if;
    end loop;
    for v_item in select value from jsonb_array_elements(p_patch) loop
      if not exists (select 1 from jsonb_array_elements(v_payments) existing
        where existing ->> 'name' = v_item ->> 'name') then
        v_result := v_result || v_item;
      end if;
    end loop;
    update public.site_settings set payments = v_result, updated_at = now() where id = 'site';
  end if;

  for v_key, v_value in select key, value from jsonb_each(p_public_rows) loop
    if v_key not in ('settings', 'branding', 'contact', 'commerce', 'shipping', 'payments', 'homepage') then
      raise exception using errcode = '22023', message = 'Invalid public settings key.';
    end if;
    insert into public.public_site_settings (key, value, active)
    values (v_key, v_value, true)
    on conflict (key) do update set
      value = case when v_key = 'payments' then excluded.value
        else coalesce(public.public_site_settings.value, '{}'::jsonb) || excluded.value end,
      active = true, updated_at = now();
  end loop;
end;
$$;

revoke all on function public.update_site_settings_section(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.update_site_settings_section(text, jsonb, jsonb) to service_role;

commit;
