-- OPTIONAL: Royal Fusion fictional starter catalog for a new project.
-- Apply only after 001_apply_complete_schema.sql. Contains no customers,
-- orders, users, credentials, private settings, or production identifiers.

begin;

insert into public.categories (
  id, name, slug, description, image_url, cloudinary_public_id,
  display_order, show_on_homepage, status, active, seo_title, seo_description
)
values
  ('10000000-0000-4000-8000-000000000001', 'For Him', 'for-him', 'Fictional masculine fragrance category.', 'https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/category-for-him.webp', 'royal-fusion/placeholders/category-for-him', 1, true, 'Published', true, 'Perfumes for Him', 'Explore Royal Fusion fragrances for him.'),
  ('10000000-0000-4000-8000-000000000002', 'For Her', 'for-her', 'Fictional feminine fragrance category.', 'https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/category-for-her.webp', 'royal-fusion/placeholders/category-for-her', 2, true, 'Published', true, 'Perfumes for Her', 'Explore Royal Fusion fragrances for her.'),
  ('10000000-0000-4000-8000-000000000003', 'Unisex', 'unisex', 'Fictional unisex fragrance category.', 'https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/category-unisex.webp', 'royal-fusion/placeholders/category-unisex', 3, true, 'Published', true, 'Unisex Perfumes', 'Explore Royal Fusion unisex fragrances.'),
  ('10000000-0000-4000-8000-000000000004', 'Attars', 'attars', 'Fictional concentrated fragrance oils.', 'https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/category-attars.webp', 'royal-fusion/placeholders/category-attars', 4, true, 'Published', true, 'Luxury Attars', 'Explore Royal Fusion concentrated attars.'),
  ('10000000-0000-4000-8000-000000000005', 'Gift Sets', 'gift-sets', 'Fictional fragrance gift sets.', 'https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/category-gifts.webp', 'royal-fusion/placeholders/category-gifts', 5, true, 'Published', true, 'Perfume Gift Sets', 'Explore fictional Royal Fusion gift sets.'),
  ('10000000-0000-4000-8000-000000000006', 'Best Sellers', 'best-sellers', 'Automatically ranked customer favourites.', 'https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/category-best-sellers.webp', 'royal-fusion/placeholders/category-best-sellers', 6, true, 'Published', true, 'Best Selling Perfumes', 'Explore Royal Fusion best sellers.')
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  image_url = excluded.image_url,
  cloudinary_public_id = excluded.cloudinary_public_id,
  display_order = excluded.display_order,
  show_on_homepage = excluded.show_on_homepage,
  status = excluded.status,
  active = excluded.active,
  seo_title = excluded.seo_title,
  seo_description = excluded.seo_description,
  updated_at = now();

insert into public.collections (
  id, name, slug, description, active, display_order, featured,
  banner_cloudinary_public_id, banner_secure_url, banner_alt_text, seo_title, seo_description
)
values
  ('20000000-0000-4000-8000-000000000001', 'Royal Fusion Originals', 'royal-fusion-originals', 'The fictional launch collection for Royal Fusion.', true, 1, true, 'royal-fusion/placeholders/collection-originals', 'https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/collection-originals.webp', 'Royal Fusion fictional collection banner', 'Royal Fusion Originals', 'Explore the Royal Fusion launch collection.'),
  ('20000000-0000-4000-8000-000000000002', 'Crystal Edit', 'crystal-edit', 'A fictional bright and polished fragrance edit.', true, 2, true, 'royal-fusion/placeholders/collection-crystal', 'https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/collection-crystal.webp', 'Crystal Edit fictional collection banner', 'Crystal Edit', 'Explore the fictional Crystal Edit.'),
  ('20000000-0000-4000-8000-000000000003', 'Oud Heritage', 'oud-heritage', 'A fictional oud and attar collection.', true, 3, false, 'royal-fusion/placeholders/collection-oud', 'https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/collection-oud.webp', 'Oud Heritage fictional collection banner', 'Oud Heritage', 'Explore the fictional Oud Heritage collection.')
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  active = excluded.active,
  display_order = excluded.display_order,
  featured = excluded.featured,
  banner_cloudinary_public_id = excluded.banner_cloudinary_public_id,
  banner_secure_url = excluded.banner_secure_url,
  banner_alt_text = excluded.banner_alt_text,
  seo_title = excluded.seo_title,
  seo_description = excluded.seo_description,
  updated_at = now();

insert into public.products (
  id, name, slug, sku, short_description, description, price, sale_price, old_price,
  stock_quantity, stock_status, category_name, collection, gender, scent_family,
  top_notes, middle_notes, base_notes, bottle_size, concentration, longevity, sillage,
  occasion, inspired_by, main_image_url, gallery_urls, image_alt, badge, tags,
  size_options, variations, is_featured, is_best_seller, is_new_arrival, is_premium,
  is_attar, status, active, manual_best_seller_pin, manual_best_seller_rank,
  seo_title, seo_description, published_at
)
values
  ('30000000-0000-4000-8000-000000000001', 'SHAHEEN', 'shaheen', 'RF-SHAHEEN-BASE', 'Fictional starter fragrance.', 'Starter catalog copy to be replaced in the admin dashboard.', 3990, null, 4590, 75, 'In Stock', 'Unisex', 'Royal Fusion Originals', 'Unisex', 'Fresh', array['Citrus'], array['Aromatic Accord'], array['Musk'], 'Multiple', 'Eau de Parfum', '7-9 hours', 'Moderate', array['Daily Wear'], 'Fictional inspiration', 'https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/shaheen.webp', array['https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/shaheen.webp'], 'SHAHEEN fictional placeholder bottle', 'New', array['Royal Fusion'], '[]', '[]', true, false, true, true, false, 'Published', true, false, null, 'SHAHEEN | Royal Fusion', 'Fictional SHAHEEN starter product.', now()),
  ('30000000-0000-4000-8000-000000000002', 'FLORAL FUSION', 'floral-fusion', 'RF-FLORAL-FUSION-BASE', 'Fictional starter fragrance.', 'Starter catalog copy to be replaced in the admin dashboard.', 3990, null, 4590, 75, 'In Stock', 'For Her', 'Royal Fusion Originals', 'Women', 'Floral', array['Citrus'], array['Floral Accord'], array['Musk'], 'Multiple', 'Eau de Parfum', '7-9 hours', 'Moderate', array['Daily Wear'], 'Fictional inspiration', 'https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/floral-fusion.webp', array['https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/floral-fusion.webp'], 'FLORAL FUSION fictional placeholder bottle', 'Floral', array['Royal Fusion'], '[]', '[]', true, false, false, true, false, 'Published', true, false, null, 'FLORAL FUSION | Royal Fusion', 'Fictional FLORAL FUSION starter product.', now()),
  ('30000000-0000-4000-8000-000000000003', 'VOICE OF HEART', 'voice-of-heart', 'RF-VOICE-OF-HEART-BASE', 'Fictional starter fragrance.', 'Starter catalog copy to be replaced in the admin dashboard.', 3990, null, 4590, 75, 'In Stock', 'Unisex', 'Royal Fusion Originals', 'Unisex', 'Spicy', array['Citrus'], array['Amber'], array['Woods'], 'Multiple', 'Eau de Parfum', '7-9 hours', 'Moderate', array['Formal'], 'Fictional inspiration', 'https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/voice-of-heart.webp', array['https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/voice-of-heart.webp'], 'VOICE OF HEART fictional placeholder bottle', 'Signature', array['Royal Fusion'], '[]', '[]', true, false, false, true, false, 'Published', true, false, null, 'VOICE OF HEART | Royal Fusion', 'Fictional VOICE OF HEART starter product.', now()),
  ('30000000-0000-4000-8000-000000000004', 'PITCH BLACK', 'pitch-black', 'RF-PITCH-BLACK-BASE', 'Fictional starter fragrance.', 'Starter catalog copy to be replaced in the admin dashboard.', 3990, null, 4590, 75, 'In Stock', 'For Him', 'Royal Fusion Originals', 'Men', 'Woody', array['Spice'], array['Amber'], array['Woods'], 'Multiple', 'Eau de Parfum', '7-9 hours', 'Strong', array['Evening'], 'Fictional inspiration', 'https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/pitch-black.webp', array['https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/pitch-black.webp'], 'PITCH BLACK fictional placeholder bottle', 'Intense', array['Royal Fusion'], '[]', '[]', true, false, false, true, false, 'Published', true, false, null, 'PITCH BLACK | Royal Fusion', 'Fictional PITCH BLACK starter product.', now()),
  ('30000000-0000-4000-8000-000000000005', 'BARAAN', 'baraan', 'RF-BARAAN-BASE', 'Fictional starter fragrance.', 'Starter catalog copy to be replaced in the admin dashboard.', 3990, null, 4590, 75, 'In Stock', 'For Him', 'Royal Fusion Originals', 'Men', 'Fresh', array['Citrus'], array['Aromatic Accord'], array['Musk'], 'Multiple', 'Eau de Parfum', '7-9 hours', 'Moderate', array['Office'], 'Fictional inspiration', 'https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/baraan.webp', array['https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/baraan.webp'], 'BARAAN fictional placeholder bottle', 'Office', array['Royal Fusion'], '[]', '[]', true, false, false, true, false, 'Published', true, false, null, 'BARAAN | Royal Fusion', 'Fictional BARAAN starter product.', now()),
  ('30000000-0000-4000-8000-000000000006', 'CHANGE', 'change', 'RF-CHANGE-BASE', 'Fictional starter fragrance.', 'Starter catalog copy to be replaced in the admin dashboard.', 3990, null, 4590, 75, 'In Stock', 'For Him', 'Royal Fusion Originals', 'Men', 'Citrus', array['Citrus'], array['Fresh Spice'], array['Woods'], 'Multiple', 'Eau de Parfum', '7-9 hours', 'Strong', array['Daily Wear'], 'Fictional inspiration', 'https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/change.webp', array['https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/change.webp'], 'CHANGE fictional placeholder bottle', 'Bold', array['Royal Fusion'], '[]', '[]', true, false, false, true, false, 'Published', true, false, null, 'CHANGE | Royal Fusion', 'Fictional CHANGE starter product.', now()),
  ('30000000-0000-4000-8000-000000000007', 'CRIMSON CRYSTAL', 'crimson-crystal', 'RF-CRIMSON-CRYSTAL-BASE', 'Fictional starter fragrance.', 'Starter catalog copy to be replaced in the admin dashboard.', 3990, null, 4590, 75, 'In Stock', 'Unisex', 'Crystal Edit', 'Unisex', 'Oriental', array['Saffron'], array['Amber'], array['Musk'], 'Multiple', 'Eau de Parfum', '7-9 hours', 'Strong', array['Gifting'], 'Fictional inspiration', 'https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/crimson-crystal.webp', array['https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/crimson-crystal.webp'], 'CRIMSON CRYSTAL fictional placeholder bottle', 'Best Seller Pin', array['Royal Fusion'], '[]', '[]', true, false, false, true, false, 'Published', true, true, 1, 'CRIMSON CRYSTAL | Royal Fusion', 'Fictional CRIMSON CRYSTAL starter product.', now())
on conflict (slug) do update set
  name = excluded.name,
  sku = excluded.sku,
  short_description = excluded.short_description,
  description = excluded.description,
  price = excluded.price,
  sale_price = excluded.sale_price,
  old_price = excluded.old_price,
  category_name = excluded.category_name,
  collection = excluded.collection,
  gender = excluded.gender,
  scent_family = excluded.scent_family,
  main_image_url = excluded.main_image_url,
  gallery_urls = excluded.gallery_urls,
  image_alt = excluded.image_alt,
  status = excluded.status,
  active = excluded.active,
  manual_best_seller_pin = excluded.manual_best_seller_pin,
  manual_best_seller_rank = excluded.manual_best_seller_rank,
  seo_title = excluded.seo_title,
  seo_description = excluded.seo_description,
  published_at = excluded.published_at,
  updated_at = now();

-- Three independently priced and stocked variants per product.
with variant_seed(product_slug, option_value, sku, regular_price, sale_price, stock_quantity, display_order) as (
  values
    ('shaheen','30ml','RF-SHAHEEN-30ML',2490::numeric,null::numeric,25,1), ('shaheen','50ml','RF-SHAHEEN-50ML',3990,null,25,2), ('shaheen','100ml','RF-SHAHEEN-100ML',6490,null,25,3),
    ('floral-fusion','30ml','RF-FLORAL-FUSION-30ML',2490,null,25,1), ('floral-fusion','50ml','RF-FLORAL-FUSION-50ML',3990,null,25,2), ('floral-fusion','100ml','RF-FLORAL-FUSION-100ML',6490,null,25,3),
    ('voice-of-heart','30ml','RF-VOICE-OF-HEART-30ML',2490,null,25,1), ('voice-of-heart','50ml','RF-VOICE-OF-HEART-50ML',3990,null,25,2), ('voice-of-heart','100ml','RF-VOICE-OF-HEART-100ML',6490,null,25,3),
    ('pitch-black','30ml','RF-PITCH-BLACK-30ML',2490,null,25,1), ('pitch-black','50ml','RF-PITCH-BLACK-50ML',3990,null,25,2), ('pitch-black','100ml','RF-PITCH-BLACK-100ML',6490,null,25,3),
    ('baraan','30ml','RF-BARAAN-30ML',2490,null,25,1), ('baraan','50ml','RF-BARAAN-50ML',3990,null,25,2), ('baraan','100ml','RF-BARAAN-100ML',6490,null,25,3),
    ('change','30ml','RF-CHANGE-30ML',2490,null,25,1), ('change','50ml','RF-CHANGE-50ML',3990,null,25,2), ('change','100ml','RF-CHANGE-100ML',6490,null,25,3),
    ('crimson-crystal','30ml','RF-CRIMSON-CRYSTAL-30ML',2490,null,25,1), ('crimson-crystal','50ml','RF-CRIMSON-CRYSTAL-50ML',3990,null,25,2), ('crimson-crystal','100ml','RF-CRIMSON-CRYSTAL-100ML',6490,null,25,3)
)
insert into public.product_variants (
  product_id, option_name, option_value, sku, regular_price, sale_price,
  stock_quantity, available, active, display_order
)
select products.id, 'Size', variant_seed.option_value, variant_seed.sku,
  variant_seed.regular_price, variant_seed.sale_price, variant_seed.stock_quantity,
  true, true, variant_seed.display_order
from variant_seed
join public.products products on products.slug = variant_seed.product_slug
on conflict (sku) do update set
  product_id = excluded.product_id,
  option_name = excluded.option_name,
  option_value = excluded.option_value,
  regular_price = excluded.regular_price,
  sale_price = excluded.sale_price,
  stock_quantity = excluded.stock_quantity,
  available = excluded.available,
  active = excluded.active,
  display_order = excluded.display_order,
  updated_at = now();

insert into public.product_categories (product_id, category_id, is_primary)
select products.id, categories.id, true
from public.products products
join public.categories categories on categories.slug = case products.slug
  when 'floral-fusion' then 'for-her'
  when 'pitch-black' then 'for-him'
  when 'baraan' then 'for-him'
  when 'change' then 'for-him'
  else 'unisex'
end
where products.slug in ('shaheen','floral-fusion','voice-of-heart','pitch-black','baraan','change','crimson-crystal')
on conflict (product_id, category_id) do update set is_primary = excluded.is_primary;

insert into public.product_categories (product_id, category_id, is_primary)
select products.id, categories.id, false
from public.products products
cross join public.categories categories
where products.slug in ('shaheen','floral-fusion','voice-of-heart','pitch-black','baraan','change','crimson-crystal')
  and categories.slug = 'best-sellers'
on conflict (product_id, category_id) do update set is_primary = excluded.is_primary;

insert into public.product_collections (product_id, collection_id, display_order)
select products.id, collections.id, row_number() over (order by products.name)::integer
from public.products products
join public.collections collections on collections.slug = case
  when products.slug = 'crimson-crystal' then 'crystal-edit'
  else 'royal-fusion-originals'
end
where products.slug in ('shaheen','floral-fusion','voice-of-heart','pitch-black','baraan','change','crimson-crystal')
on conflict (product_id, collection_id) do update set display_order = excluded.display_order;

insert into public.product_media (
  product_id, cloudinary_public_id, secure_url, alt_text, media_type, display_order, is_primary
)
select
  products.id,
  'royal-fusion/placeholders/' || products.slug,
  'https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/' || products.slug || '.webp',
  products.name || ' fictional placeholder bottle',
  'image', 1, true
from public.products products
where products.slug in ('shaheen','floral-fusion','voice-of-heart','pitch-black','baraan','change','crimson-crystal')
on conflict (cloudinary_public_id) do update set
  product_id = excluded.product_id,
  secure_url = excluded.secure_url,
  alt_text = excluded.alt_text,
  media_type = excluded.media_type,
  display_order = excluded.display_order,
  is_primary = excluded.is_primary,
  updated_at = now();

insert into public.promotions (
  id, name, slug, promotion_type, title, subtitle, body, cta_text, cta_url,
  placement, cloudinary_public_id, secure_image_url, image_alt_text, active, display_order
)
values (
  '50000000-0000-4000-8000-000000000001', 'Launch Hero', 'launch-hero', 'banner',
  'Royal Fusion', 'Fictional launch promotion', 'Replace this copy through the Royal Fusion Admin Dashboard.',
  'Shop Now', '/shop', 'homepage_hero', 'royal-fusion/placeholders/homepage-hero',
  'https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/homepage-hero.webp',
  'Royal Fusion fictional homepage promotion', true, 1
)
on conflict (slug) do update set
  name = excluded.name, promotion_type = excluded.promotion_type, title = excluded.title,
  subtitle = excluded.subtitle, body = excluded.body, cta_text = excluded.cta_text,
  cta_url = excluded.cta_url, placement = excluded.placement,
  cloudinary_public_id = excluded.cloudinary_public_id, secure_image_url = excluded.secure_image_url,
  image_alt_text = excluded.image_alt_text, active = excluded.active,
  display_order = excluded.display_order, updated_at = now();

insert into public.shipping_methods (
  id, code, name, description, base_fee, free_shipping_threshold,
  estimated_days_min, estimated_days_max, active, display_order
)
values (
  '60000000-0000-4000-8000-000000000001', 'standard', 'Standard Delivery',
  'Fictional Pakistan-wide starter delivery method.', 250, 7000, 2, 5, true, 1
)
on conflict (code) do update set
  name = excluded.name, description = excluded.description, base_fee = excluded.base_fee,
  free_shipping_threshold = excluded.free_shipping_threshold,
  estimated_days_min = excluded.estimated_days_min, estimated_days_max = excluded.estimated_days_max,
  active = excluded.active, display_order = excluded.display_order, updated_at = now();

insert into public.shipping_rates (shipping_method_id, scope_type, scope_value, fee, minimum_subtotal, active)
select methods.id, rates.scope_type, rates.scope_value, rates.fee, 0, true
from public.shipping_methods methods
cross join (values
  ('default', '', 250::numeric),
  ('city', 'Karachi', 200::numeric),
  ('city', 'Lahore', 250::numeric),
  ('city', 'Islamabad', 250::numeric),
  ('province', 'Sindh', 250::numeric),
  ('province', 'Punjab', 300::numeric),
  ('province', 'KPK', 350::numeric)
) as rates(scope_type, scope_value, fee)
where methods.code = 'standard'
on conflict (shipping_method_id, scope_type, (lower(scope_value))) do update set
  fee = excluded.fee, minimum_subtotal = excluded.minimum_subtotal,
  active = excluded.active, updated_at = now();

insert into public.public_site_settings (key, value, active)
values
  ('branding', '{"brandName":"Royal Fusion","currency":"PKR","logoUrl":"https://res.cloudinary.com/replace-cloud-name/image/upload/v1/royal-fusion/placeholders/logo.webp"}'::jsonb, true),
  ('contact', '{"email":"support@example.invalid","phone":"+92 300 0000000","businessAddress":"Fictional address, Pakistan"}'::jsonb, true),
  ('commerce', '{"announcementEnabled":false,"announcementText":""}'::jsonb, true)
on conflict (key) do update set value = excluded.value, active = excluded.active, updated_at = now();

commit;
