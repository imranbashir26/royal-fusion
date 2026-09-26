-- Phase 2C operator-reviewed normalization. Never run automatically or as a migration.
-- Targets only the seven exact (slug, SKU) rows from 001_starter_catalog.sql.
-- It creates no products and changes no prices, stock, descriptions, flags, or media.
-- Review the current rows and the Phase 2C audit before applying to any database.
begin;

create temporary table phase2c_known_products (
  slug text primary key,
  sku text not null,
  gender text not null,
  scent_family text not null,
  collection_slug text not null
) on commit drop;

insert into phase2c_known_products values
  ('shaheen', 'RF-SHAHEEN-BASE', 'Unisex', 'Fresh', 'royal-fusion-originals'),
  ('floral-fusion', 'RF-FLORAL-FUSION-BASE', 'Women', 'Floral', 'royal-fusion-originals'),
  ('voice-of-heart', 'RF-VOICE-OF-HEART-BASE', 'Unisex', 'Spicy', 'royal-fusion-originals'),
  ('pitch-black', 'RF-PITCH-BLACK-BASE', 'Men', 'Woody', 'royal-fusion-originals'),
  ('baraan', 'RF-BARAAN-BASE', 'Men', 'Fresh', 'royal-fusion-originals'),
  ('change', 'RF-CHANGE-BASE', 'Men', 'Citrus', 'royal-fusion-originals'),
  ('crimson-crystal', 'RF-CRIMSON-CRYSTAL-BASE', 'Unisex', 'Oriental', 'crystal-edit');

do $$
begin
  if exists (
    select 1 from public.products p join phase2c_known_products k using (slug)
    where p.sku <> k.sku or p.concentration <> 'Eau de Parfum'
      or p.gender::text <> k.gender or p.scent_family <> k.scent_family
      or (p.status = 'Published' and not p.active)
      or (p.status = 'Archived' and p.active)
  ) then
    raise exception 'Phase 2C catalog identity/classification conflict; review products manually';
  end if;
  if exists (
    select 1 from (values ('attars','attar'), ('gift-sets','gift-set')) as pair(old_slug,new_slug)
    join public.categories old_category on old_category.slug = pair.old_slug
    join public.categories new_category on new_category.slug = pair.new_slug
  ) then
    raise exception 'Both plural and singular category records exist; reconcile IDs manually';
  end if;
  if exists (
    select 1 from public.products p join phase2c_known_products k on k.slug = p.slug and k.sku = p.sku
    where not exists (select 1 from public.collections c where c.slug = k.collection_slug)
  ) then
    raise exception 'An approved collection is missing; apply/review Phase 2B collections first';
  end if;
end $$;

-- Preserve IDs, media, and descriptions on existing plural category records.
update public.categories set name = 'Attar', slug = 'attar', updated_at = now() where slug = 'attars';
update public.categories set name = 'Gift Set', slug = 'gift-set', updated_at = now() where slug = 'gift-sets';

insert into public.categories (name, slug, description, status, active, show_on_homepage)
values
  ('Eau de Parfum', 'eau-de-parfum', '', 'Published', true, false),
  ('Extrait de Parfum', 'extrait-de-parfum', '', 'Published', true, false),
  ('Attar', 'attar', '', 'Published', true, false),
  ('Gift Set', 'gift-set', '', 'Published', true, false)
on conflict (slug) do update set name = excluded.name
where public.categories.name is distinct from excluded.name;

do $$
begin
  if exists (
    select 1 from public.categories
    where slug in ('eau-de-parfum','extrait-de-parfum','attar','gift-set') and not active
  ) then
    raise exception 'A canonical product type is inactive; review before assigning products';
  end if;
  if exists (
    select 1 from public.products p join phase2c_known_products k on k.slug = p.slug and k.sku = p.sku
    join public.product_categories pc on pc.product_id = p.id
    join public.categories c on c.id = pc.category_id
    where c.slug not in ('eau-de-parfum','for-him','for-her','unisex','best-sellers','new-arrivals')
  ) then
    raise exception 'A known starter product has an unexpected category relationship';
  end if;
end $$;

-- Product type is derived from the recorded Eau de Parfum concentration, never gender or flags.
update public.products p
set category_id = c.id, category_name = c.name, is_attar = false, updated_at = now()
from phase2c_known_products k, public.categories c
where p.slug = k.slug and p.sku = k.sku and c.slug = 'eau-de-parfum'
  and (p.category_id is distinct from c.id or p.category_name is distinct from c.name or p.is_attar);

delete from public.product_categories pc
using public.products p, phase2c_known_products k, public.categories c
where pc.product_id = p.id and p.slug = k.slug and p.sku = k.sku
  and pc.category_id = c.id
  and c.slug in ('for-him','for-her','unisex','best-sellers','new-arrivals');

insert into public.product_categories (product_id, category_id, is_primary)
select p.id, c.id, true
from public.products p join phase2c_known_products k on k.slug = p.slug and k.sku = p.sku
cross join public.categories c where c.slug = 'eau-de-parfum'
on conflict (product_id, category_id) do update set is_primary = true;

-- Canonical Attar/Gift Set records determine the denormalized category and Attar flag.
update public.products p set category_name = c.name, is_attar = (c.slug = 'attar'), updated_at = now()
from public.categories c
where p.category_id = c.id and c.slug in ('eau-de-parfum','extrait-de-parfum','attar','gift-set')
  and (p.category_name is distinct from c.name or p.is_attar is distinct from (c.slug = 'attar'));

-- Memberships are evidenced by the previous explicit relational starter seed, not products.collection.
insert into public.product_collections (product_id, collection_id, display_order)
select p.id, c.id, 0
from public.products p join phase2c_known_products k on k.slug = p.slug and k.sku = p.sku
join public.collections c on c.slug = k.collection_slug
on conflict (product_id, collection_id) do nothing;

-- Retire legacy facet records only when nothing else still depends on them.
do $$
begin
  if exists (
    select 1 from public.categories c
    where c.slug in ('for-him','for-her','unisex','best-sellers','new-arrivals')
      and (exists (select 1 from public.products p where p.category_id = c.id)
        or exists (select 1 from public.product_categories pc where pc.category_id = c.id))
  ) then
    raise exception 'Legacy categories still have other product references; review manually';
  end if;
  if exists (
    select 1 from public.products p
    where lower(trim(p.category_name)) in
      ('for him','for her','unisex','best sellers','new arrivals','attars','gift sets')
  ) then
    raise exception 'Products still have legacy category names; review their type evidence manually';
  end if;
end $$;

update public.categories
set active = false, status = 'Unpublished', show_on_homepage = false, updated_at = now()
where slug in ('for-him','for-her','unisex','best-sellers','new-arrivals')
  and (active or status <> 'Unpublished' or show_on_homepage);

commit;
