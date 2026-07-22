-- Royal Fusion starter seed for Supabase. Run after 001_initial_schema.sql.
-- This seed is idempotent for categories/products by slug and site_settings by id.

insert into public.site_settings (id, settings, shipping, payments, homepage, seo)
values ('site', '{"brandName":"Royal Fusion","logo":"/assets/brand/logo.png","favicon":"/favicon.svg","currency":"PKR","whatsappNumber":"+923000000000","phoneNumber":"+92 300 0000000","emailAddress":"hello@royalfusion.pk","businessAddress":"Karachi, Pakistan","instagramLink":"#","facebookLink":"#","tiktokLink":"#","youtubeLink":"#","footerDescription":"Premium fragrance impressions, attars, and gift-ready perfume experiences made for elegance, confidence, and lasting presence.","copyrightText":"Royal Fusion. Luxury perfume eCommerce prototype.","contactReceiverEmail":"hello@royalfusion.pk","announcementEnabled":true,"announcementText":"Free shipping on bulk orders. Premium gift packaging available."}'::jsonb, '{"defaultShippingFee":250,"freeShippingAbove":7000,"cityWise":[{"city":"Karachi","fee":200},{"city":"Lahore","fee":250},{"city":"Islamabad","fee":250}],"provinceWise":[{"province":"Sindh","fee":250},{"province":"Punjab","fee":300},{"province":"KPK","fee":350}],"deliveryTimeText":"2-5 working days in major cities.","courierInformation":"Courier selected according to city and order value.","shippingPolicyText":"Orders are dispatched after confirmation.","returnPolicyText":"7-day return policy on eligible unused products.","exchangePolicyText":"Exchange requests are reviewed by support."}'::jsonb, '[{"id":"pay-cod","name":"Cash on Delivery","active":true,"instructions":"Pay cash when your order arrives.","accountDetails":"","displayOrder":1},{"id":"pay-bank","name":"Bank Transfer","active":true,"instructions":"Transfer to the listed account after checkout.","accountDetails":"Royal Fusion Bank Account: 0000-000000","displayOrder":2},{"id":"pay-jazzcash","name":"JazzCash","active":false,"instructions":"JazzCash will be enabled soon.","accountDetails":"","displayOrder":3},{"id":"pay-easypaisa","name":"Easypaisa","active":false,"instructions":"Easypaisa will be enabled soon.","accountDetails":"","displayOrder":4},{"id":"pay-card","name":"Card","active":false,"instructions":"Card gateway placeholder for future integration.","accountDetails":"","displayOrder":5}]'::jsonb, '{"heroHeading":"Crafted for Kings & Queens","heroSubtitle":"Experience premium fragrance impressions made for elegance, confidence, and lasting presence.","heroImage":"/assets/brand/hero-banner.png","primaryCtaText":"Discover Collection","primaryCtaLink":"/collections","secondaryCtaText":"Shop Best Sellers","secondaryCtaLink":"/shop?best=true","featuredProductIds":["p-royal-spice","p-crimson-crystal","p-chaos"],"bestSellerProductIds":["p-royal-spice","p-crimson-crystal","p-chaos","p-oud-ul-abyaz"],"featuredCategoryIds":["cat-men","cat-women","cat-unisex","cat-oud"],"collectionTitle":"The Royal Collection","collectionText":"A palace-inspired edit for weddings, formal evenings, and unforgettable entrances.","promotionalBannerText":"Gift Royalty in Every Bottle","newsletterTitle":"Fragrance Letters"}'::jsonb, '[{"id":"seo-home","page":"Homepage","slug":"/","seoTitle":"Royal Fusion | Luxury Perfumes in Pakistan","metaDescription":"Luxury perfumes, oud fragrances, attars, and long lasting perfumes in Pakistan.","ogTitle":"Royal Fusion Luxury Perfumes","ogDescription":"Premium royal fragrance boutique.","ogImage":"/assets/brand/hero-banner.png","imageAlt":"Royal Fusion perfume bottle in palace interior"},{"id":"seo-shop","page":"Shop page","slug":"/shop","seoTitle":"Shop Luxury Perfumes in Pakistan","metaDescription":"Shop Royal Fusion long lasting perfumes, attars, oud, floral, citrus, and oriental scents.","ogTitle":"Shop Royal Fusion","ogDescription":"Luxury perfume boutique.","ogImage":"/assets/brand/hero-banner.png","imageAlt":"Royal Fusion shop banner"}]'::jsonb)
on conflict (id) do update set
  settings = excluded.settings,
  shipping = excluded.shipping,
  payments = excluded.payments,
  homepage = excluded.homepage,
  seo = excluded.seo,
  updated_at = now();

insert into public.categories (name, slug, description, image_url, display_order, show_on_homepage, status, seo_title, seo_description)
values ('Men’s Fragrances', 'mens-fragrances', 'Confident woods, oud, spice, and modern aromatic blends.', '', 1, true, 'Published', 'Best Perfumes for Men', 'Luxury men''s fragrances in Pakistan.')
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, image_url = excluded.image_url,
  display_order = excluded.display_order, show_on_homepage = excluded.show_on_homepage,
  status = excluded.status, seo_title = excluded.seo_title, seo_description = excluded.seo_description,
  updated_at = now();

insert into public.categories (name, slug, description, image_url, display_order, show_on_homepage, status, seo_title, seo_description)
values ('Women’s Fragrances', 'womens-fragrances', 'Soft florals, luminous musks, and graceful sweet signatures.', '', 2, true, 'Published', 'Best Perfumes for Women', 'Luxury women''s fragrances in Pakistan.')
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, image_url = excluded.image_url,
  display_order = excluded.display_order, show_on_homepage = excluded.show_on_homepage,
  status = excluded.status, seo_title = excluded.seo_title, seo_description = excluded.seo_description,
  updated_at = now();

insert into public.categories (name, slug, description, image_url, display_order, show_on_homepage, status, seo_title, seo_description)
values ('Unisex Scents', 'unisex-scents', 'Balanced luxury fragrances made for every royal mood.', '', 3, true, 'Published', 'Unisex Perfumes', 'Unisex Royal Fusion scents.')
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, image_url = excluded.image_url,
  display_order = excluded.display_order, show_on_homepage = excluded.show_on_homepage,
  status = excluded.status, seo_title = excluded.seo_title, seo_description = excluded.seo_description,
  updated_at = now();

insert into public.categories (name, slug, description, image_url, display_order, show_on_homepage, status, seo_title, seo_description)
values ('Luxury Collection', 'luxury-collection', 'Premium fragrance impressions with opulent depth.', '', 4, true, 'Published', 'Luxury Perfumes', 'Premium luxury perfumes in Pakistan.')
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, image_url = excluded.image_url,
  display_order = excluded.display_order, show_on_homepage = excluded.show_on_homepage,
  status = excluded.status, seo_title = excluded.seo_title, seo_description = excluded.seo_description,
  updated_at = now();

insert into public.categories (name, slug, description, image_url, display_order, show_on_homepage, status, seo_title, seo_description)
values ('Best Sellers', 'best-sellers', 'The most loved Royal Fusion fragrance impressions.', '', 5, true, 'Published', 'Best Selling Perfumes', 'Royal Fusion best selling perfumes.')
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, image_url = excluded.image_url,
  display_order = excluded.display_order, show_on_homepage = excluded.show_on_homepage,
  status = excluded.status, seo_title = excluded.seo_title, seo_description = excluded.seo_description,
  updated_at = now();

insert into public.categories (name, slug, description, image_url, display_order, show_on_homepage, status, seo_title, seo_description)
values ('New Arrivals', 'new-arrivals', 'Freshly launched fragrance edits.', '', 6, true, 'Published', 'New Perfume Arrivals', 'Latest Royal Fusion perfumes.')
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, image_url = excluded.image_url,
  display_order = excluded.display_order, show_on_homepage = excluded.show_on_homepage,
  status = excluded.status, seo_title = excluded.seo_title, seo_description = excluded.seo_description,
  updated_at = now();

insert into public.categories (name, slug, description, image_url, display_order, show_on_homepage, status, seo_title, seo_description)
values ('Oud Collection', 'oud-collection', 'Traditional oud and attar creations with depth.', '', 7, true, 'Published', 'Oud Perfumes', 'Oud perfumes and attars in Pakistan.')
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, image_url = excluded.image_url,
  display_order = excluded.display_order, show_on_homepage = excluded.show_on_homepage,
  status = excluded.status, seo_title = excluded.seo_title, seo_description = excluded.seo_description,
  updated_at = now();

insert into public.categories (name, slug, description, image_url, display_order, show_on_homepage, status, seo_title, seo_description)
values ('Fresh Scents', 'fresh-scents', 'Citrus, clean musk, and polished everyday scents.', '', 8, true, 'Published', 'Fresh Perfumes', 'Fresh citrus perfumes for daily wear.')
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, image_url = excluded.image_url,
  display_order = excluded.display_order, show_on_homepage = excluded.show_on_homepage,
  status = excluded.status, seo_title = excluded.seo_title, seo_description = excluded.seo_description,
  updated_at = now();

insert into public.categories (name, slug, description, image_url, display_order, show_on_homepage, status, seo_title, seo_description)
values ('Office Wear', 'office-wear', 'Refined projection for work and daily routines.', '', 9, true, 'Published', 'Office Wear Perfumes', 'Professional perfumes for office wear.')
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, image_url = excluded.image_url,
  display_order = excluded.display_order, show_on_homepage = excluded.show_on_homepage,
  status = excluded.status, seo_title = excluded.seo_title, seo_description = excluded.seo_description,
  updated_at = now();

insert into public.categories (name, slug, description, image_url, display_order, show_on_homepage, status, seo_title, seo_description)
values ('Gift Sets', 'gift-sets', 'Curated premium pairings wrapped for memorable occasions.', '', 10, true, 'Published', 'Perfume Gift Sets', 'Luxury perfume gift sets in Pakistan.')
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, image_url = excluded.image_url,
  display_order = excluded.display_order, show_on_homepage = excluded.show_on_homepage,
  status = excluded.status, seo_title = excluded.seo_title, seo_description = excluded.seo_description,
  updated_at = now();

insert into public.products (
  name, slug, sku, short_description, description, price, sale_price, old_price, stock_quantity, stock_status,
  category_id, category_name, collection, gender, scent_family, top_notes, middle_notes, base_notes, bottle_size,
  concentration, longevity, sillage, occasion, inspired_by, main_image_url, gallery_urls, image_alt, badge,
  tags, size_options, variations, is_featured, is_best_seller, is_new_arrival, is_premium, is_attar,
  status, seo_title, seo_description
)
select
  'SHAHEEN', 'shaheen', 'RF-SHAHEEN-50ML', 'Premium Royal Fusion fragrance with original product imagery.', 'A Royal Fusion fragrance presented with original product imagery. Full notes, pricing, and detailed story can be updated later from the admin dashboard.', 3990, 0, 4590, 25, 'In Stock',
  categories.id, 'Best Sellers', 'Royal Fusion Originals', 'Men', 'Fresh', array['Citrus','Fresh Spice']::text[], array['Floral Accord','Amber']::text[], array['Musk','Woods']::text[], '50ml',
  'Eau de Parfum', '7-9 hours', 'Moderate', array['Daily Wear','Formal','Gifting']::text[], 'Silver Mountain Water', '/uploads/products/shaheen.webp', array['/uploads/products/shaheen.webp']::text[], 'SHAHEEN Royal Fusion perfume bottle', 'New',
  array['Royal Fusion','Perfume']::text[], '[{"label":"30ml","value":"30ml","price":2490},{"label":"50ml","value":"50ml","price":3990},{"label":"100ml","value":"100ml","price":6490}]'::jsonb, '[]'::jsonb, true, true, false, true, false,
  'Published', 'SHAHEEN | Royal Fusion', 'Royal Fusion premium perfume with original product imagery.'
from public.categories where slug = 'best-sellers'
on conflict (slug) do update set
  name = excluded.name, sku = excluded.sku, short_description = excluded.short_description, description = excluded.description,
  price = excluded.price, sale_price = excluded.sale_price, old_price = excluded.old_price, stock_quantity = excluded.stock_quantity,
  stock_status = excluded.stock_status, category_id = excluded.category_id, category_name = excluded.category_name,
  collection = excluded.collection, gender = excluded.gender, scent_family = excluded.scent_family,
  top_notes = excluded.top_notes, middle_notes = excluded.middle_notes, base_notes = excluded.base_notes,
  bottle_size = excluded.bottle_size, concentration = excluded.concentration, longevity = excluded.longevity,
  sillage = excluded.sillage, occasion = excluded.occasion, inspired_by = excluded.inspired_by,
  main_image_url = excluded.main_image_url, gallery_urls = excluded.gallery_urls, image_alt = excluded.image_alt,
  badge = excluded.badge, tags = excluded.tags, size_options = excluded.size_options, variations = excluded.variations,
  is_featured = excluded.is_featured, is_best_seller = excluded.is_best_seller, is_new_arrival = excluded.is_new_arrival,
  is_premium = excluded.is_premium, is_attar = excluded.is_attar, status = excluded.status,
  seo_title = excluded.seo_title, seo_description = excluded.seo_description, updated_at = now();

insert into public.products (
  name, slug, sku, short_description, description, price, sale_price, old_price, stock_quantity, stock_status,
  category_id, category_name, collection, gender, scent_family, top_notes, middle_notes, base_notes, bottle_size,
  concentration, longevity, sillage, occasion, inspired_by, main_image_url, gallery_urls, image_alt, badge,
  tags, size_options, variations, is_featured, is_best_seller, is_new_arrival, is_premium, is_attar,
  status, seo_title, seo_description
)
select
  'FLORAL FUSION', 'floral-fusion', 'RF-FLORAL-FUSION-50ML', 'Premium Royal Fusion fragrance with original product imagery.', 'A Royal Fusion fragrance presented with original product imagery. Full notes, pricing, and detailed story can be updated later from the admin dashboard.', 3990, 0, 4590, 25, 'In Stock',
  categories.id, 'For Her', 'Royal Fusion Originals', 'Women', 'Floral', array['Citrus','Fresh Spice']::text[], array['Floral Accord','Amber']::text[], array['Musk','Woods']::text[], '50ml',
  'Eau de Parfum', '7-9 hours', 'Moderate', array['Daily Wear','Formal','Gifting']::text[], 'Gucci Flora', '/uploads/products/floral-fusion.webp', array['/uploads/products/floral-fusion.webp']::text[], 'FLORAL FUSION Royal Fusion perfume bottle', 'Floral',
  array['Royal Fusion','Perfume']::text[], '[{"label":"30ml","value":"30ml","price":2490},{"label":"50ml","value":"50ml","price":3990},{"label":"100ml","value":"100ml","price":6490}]'::jsonb, '[]'::jsonb, true, true, false, true, false,
  'Published', 'FLORAL FUSION | Royal Fusion', 'Royal Fusion premium perfume with original product imagery.'
from public.categories where slug = 'best-sellers'
on conflict (slug) do update set
  name = excluded.name, sku = excluded.sku, short_description = excluded.short_description, description = excluded.description,
  price = excluded.price, sale_price = excluded.sale_price, old_price = excluded.old_price, stock_quantity = excluded.stock_quantity,
  stock_status = excluded.stock_status, category_id = excluded.category_id, category_name = excluded.category_name,
  collection = excluded.collection, gender = excluded.gender, scent_family = excluded.scent_family,
  top_notes = excluded.top_notes, middle_notes = excluded.middle_notes, base_notes = excluded.base_notes,
  bottle_size = excluded.bottle_size, concentration = excluded.concentration, longevity = excluded.longevity,
  sillage = excluded.sillage, occasion = excluded.occasion, inspired_by = excluded.inspired_by,
  main_image_url = excluded.main_image_url, gallery_urls = excluded.gallery_urls, image_alt = excluded.image_alt,
  badge = excluded.badge, tags = excluded.tags, size_options = excluded.size_options, variations = excluded.variations,
  is_featured = excluded.is_featured, is_best_seller = excluded.is_best_seller, is_new_arrival = excluded.is_new_arrival,
  is_premium = excluded.is_premium, is_attar = excluded.is_attar, status = excluded.status,
  seo_title = excluded.seo_title, seo_description = excluded.seo_description, updated_at = now();

insert into public.products (
  name, slug, sku, short_description, description, price, sale_price, old_price, stock_quantity, stock_status,
  category_id, category_name, collection, gender, scent_family, top_notes, middle_notes, base_notes, bottle_size,
  concentration, longevity, sillage, occasion, inspired_by, main_image_url, gallery_urls, image_alt, badge,
  tags, size_options, variations, is_featured, is_best_seller, is_new_arrival, is_premium, is_attar,
  status, seo_title, seo_description
)
select
  'VOICE OF HEART', 'voice-of-heart', 'RF-VOICE-OF-HEART-50ML', 'Premium Royal Fusion fragrance with original product imagery.', 'A Royal Fusion fragrance presented with original product imagery. Full notes, pricing, and detailed story can be updated later from the admin dashboard.', 3990, 0, 4590, 25, 'In Stock',
  categories.id, 'Best Sellers', 'Royal Fusion Originals', 'Unisex', 'Spicy', array['Citrus','Fresh Spice']::text[], array['Floral Accord','Amber']::text[], array['Musk','Woods']::text[], '50ml',
  'Eau de Parfum', '7-9 hours', 'Moderate', array['Daily Wear','Formal','Gifting']::text[], 'Terre D''Hermes', '/uploads/products/voice-of-heart.webp', array['/uploads/products/voice-of-heart.webp']::text[], 'VOICE OF HEART Royal Fusion perfume bottle', 'Signature',
  array['Royal Fusion','Perfume']::text[], '[{"label":"30ml","value":"30ml","price":2490},{"label":"50ml","value":"50ml","price":3990},{"label":"100ml","value":"100ml","price":6490}]'::jsonb, '[]'::jsonb, true, true, false, true, false,
  'Published', 'VOICE OF HEART | Royal Fusion', 'Royal Fusion premium perfume with original product imagery.'
from public.categories where slug = 'best-sellers'
on conflict (slug) do update set
  name = excluded.name, sku = excluded.sku, short_description = excluded.short_description, description = excluded.description,
  price = excluded.price, sale_price = excluded.sale_price, old_price = excluded.old_price, stock_quantity = excluded.stock_quantity,
  stock_status = excluded.stock_status, category_id = excluded.category_id, category_name = excluded.category_name,
  collection = excluded.collection, gender = excluded.gender, scent_family = excluded.scent_family,
  top_notes = excluded.top_notes, middle_notes = excluded.middle_notes, base_notes = excluded.base_notes,
  bottle_size = excluded.bottle_size, concentration = excluded.concentration, longevity = excluded.longevity,
  sillage = excluded.sillage, occasion = excluded.occasion, inspired_by = excluded.inspired_by,
  main_image_url = excluded.main_image_url, gallery_urls = excluded.gallery_urls, image_alt = excluded.image_alt,
  badge = excluded.badge, tags = excluded.tags, size_options = excluded.size_options, variations = excluded.variations,
  is_featured = excluded.is_featured, is_best_seller = excluded.is_best_seller, is_new_arrival = excluded.is_new_arrival,
  is_premium = excluded.is_premium, is_attar = excluded.is_attar, status = excluded.status,
  seo_title = excluded.seo_title, seo_description = excluded.seo_description, updated_at = now();

insert into public.products (
  name, slug, sku, short_description, description, price, sale_price, old_price, stock_quantity, stock_status,
  category_id, category_name, collection, gender, scent_family, top_notes, middle_notes, base_notes, bottle_size,
  concentration, longevity, sillage, occasion, inspired_by, main_image_url, gallery_urls, image_alt, badge,
  tags, size_options, variations, is_featured, is_best_seller, is_new_arrival, is_premium, is_attar,
  status, seo_title, seo_description
)
select
  'PITCH BLACK', 'pitch-black', 'RF-PITCH-BLACK-50ML', 'Premium Royal Fusion fragrance with original product imagery.', 'A Royal Fusion fragrance presented with original product imagery. Full notes, pricing, and detailed story can be updated later from the admin dashboard.', 3990, 0, 4590, 25, 'In Stock',
  categories.id, 'For Him', 'Royal Fusion Originals', 'Men', 'Woody', array['Citrus','Fresh Spice']::text[], array['Floral Accord','Amber']::text[], array['Musk','Woods']::text[], '50ml',
  'Eau de Parfum', '7-9 hours', 'Moderate', array['Daily Wear','Formal','Gifting']::text[], 'Tom Ford Black Orchid', '/uploads/products/pitch-black.webp', array['/uploads/products/pitch-black.webp']::text[], 'PITCH BLACK Royal Fusion perfume bottle', 'Intense',
  array['Royal Fusion','Perfume']::text[], '[{"label":"30ml","value":"30ml","price":2490},{"label":"50ml","value":"50ml","price":3990},{"label":"100ml","value":"100ml","price":6490}]'::jsonb, '[]'::jsonb, true, true, false, true, false,
  'Published', 'PITCH BLACK | Royal Fusion', 'Royal Fusion premium perfume with original product imagery.'
from public.categories where slug = 'best-sellers'
on conflict (slug) do update set
  name = excluded.name, sku = excluded.sku, short_description = excluded.short_description, description = excluded.description,
  price = excluded.price, sale_price = excluded.sale_price, old_price = excluded.old_price, stock_quantity = excluded.stock_quantity,
  stock_status = excluded.stock_status, category_id = excluded.category_id, category_name = excluded.category_name,
  collection = excluded.collection, gender = excluded.gender, scent_family = excluded.scent_family,
  top_notes = excluded.top_notes, middle_notes = excluded.middle_notes, base_notes = excluded.base_notes,
  bottle_size = excluded.bottle_size, concentration = excluded.concentration, longevity = excluded.longevity,
  sillage = excluded.sillage, occasion = excluded.occasion, inspired_by = excluded.inspired_by,
  main_image_url = excluded.main_image_url, gallery_urls = excluded.gallery_urls, image_alt = excluded.image_alt,
  badge = excluded.badge, tags = excluded.tags, size_options = excluded.size_options, variations = excluded.variations,
  is_featured = excluded.is_featured, is_best_seller = excluded.is_best_seller, is_new_arrival = excluded.is_new_arrival,
  is_premium = excluded.is_premium, is_attar = excluded.is_attar, status = excluded.status,
  seo_title = excluded.seo_title, seo_description = excluded.seo_description, updated_at = now();

insert into public.products (
  name, slug, sku, short_description, description, price, sale_price, old_price, stock_quantity, stock_status,
  category_id, category_name, collection, gender, scent_family, top_notes, middle_notes, base_notes, bottle_size,
  concentration, longevity, sillage, occasion, inspired_by, main_image_url, gallery_urls, image_alt, badge,
  tags, size_options, variations, is_featured, is_best_seller, is_new_arrival, is_premium, is_attar,
  status, seo_title, seo_description
)
select
  'BARAAN', 'baraan', 'RF-BARAAN-50ML', 'Premium Royal Fusion fragrance with original product imagery.', 'A Royal Fusion fragrance presented with original product imagery. Full notes, pricing, and detailed story can be updated later from the admin dashboard.', 3990, 0, 4590, 25, 'In Stock',
  categories.id, 'For Him', 'Royal Fusion Originals', 'Men', 'Fresh', array['Citrus','Fresh Spice']::text[], array['Floral Accord','Amber']::text[], array['Musk','Woods']::text[], '50ml',
  'Eau de Parfum', '7-9 hours', 'Moderate', array['Daily Wear','Formal','Gifting']::text[], 'Office for Men', '/uploads/products/baraan.webp', array['/uploads/products/baraan.webp']::text[], 'BARAAN Royal Fusion perfume bottle', 'Office',
  array['Royal Fusion','Perfume']::text[], '[{"label":"30ml","value":"30ml","price":2490},{"label":"50ml","value":"50ml","price":3990},{"label":"100ml","value":"100ml","price":6490}]'::jsonb, '[]'::jsonb, true, true, false, true, false,
  'Published', 'BARAAN | Royal Fusion', 'Royal Fusion premium perfume with original product imagery.'
from public.categories where slug = 'best-sellers'
on conflict (slug) do update set
  name = excluded.name, sku = excluded.sku, short_description = excluded.short_description, description = excluded.description,
  price = excluded.price, sale_price = excluded.sale_price, old_price = excluded.old_price, stock_quantity = excluded.stock_quantity,
  stock_status = excluded.stock_status, category_id = excluded.category_id, category_name = excluded.category_name,
  collection = excluded.collection, gender = excluded.gender, scent_family = excluded.scent_family,
  top_notes = excluded.top_notes, middle_notes = excluded.middle_notes, base_notes = excluded.base_notes,
  bottle_size = excluded.bottle_size, concentration = excluded.concentration, longevity = excluded.longevity,
  sillage = excluded.sillage, occasion = excluded.occasion, inspired_by = excluded.inspired_by,
  main_image_url = excluded.main_image_url, gallery_urls = excluded.gallery_urls, image_alt = excluded.image_alt,
  badge = excluded.badge, tags = excluded.tags, size_options = excluded.size_options, variations = excluded.variations,
  is_featured = excluded.is_featured, is_best_seller = excluded.is_best_seller, is_new_arrival = excluded.is_new_arrival,
  is_premium = excluded.is_premium, is_attar = excluded.is_attar, status = excluded.status,
  seo_title = excluded.seo_title, seo_description = excluded.seo_description, updated_at = now();

insert into public.products (
  name, slug, sku, short_description, description, price, sale_price, old_price, stock_quantity, stock_status,
  category_id, category_name, collection, gender, scent_family, top_notes, middle_notes, base_notes, bottle_size,
  concentration, longevity, sillage, occasion, inspired_by, main_image_url, gallery_urls, image_alt, badge,
  tags, size_options, variations, is_featured, is_best_seller, is_new_arrival, is_premium, is_attar,
  status, seo_title, seo_description
)
select
  'CHANGE', 'change', 'RF-CHANGE-50ML', 'Premium Royal Fusion fragrance with original product imagery.', 'A Royal Fusion fragrance presented with original product imagery. Full notes, pricing, and detailed story can be updated later from the admin dashboard.', 3990, 0, 4590, 25, 'In Stock',
  categories.id, 'For Him', 'Royal Fusion Originals', 'Men', 'Citrus', array['Citrus','Fresh Spice']::text[], array['Floral Accord','Amber']::text[], array['Musk','Woods']::text[], '50ml',
  'Eau de Parfum', '7-9 hours', 'Moderate', array['Daily Wear','Formal','Gifting']::text[], 'Sauvage by Dior', '/uploads/products/change.webp', array['/uploads/products/change.webp']::text[], 'CHANGE Royal Fusion perfume bottle', 'Bold',
  array['Royal Fusion','Perfume']::text[], '[{"label":"30ml","value":"30ml","price":2490},{"label":"50ml","value":"50ml","price":3990},{"label":"100ml","value":"100ml","price":6490}]'::jsonb, '[]'::jsonb, true, true, false, true, false,
  'Published', 'CHANGE | Royal Fusion', 'Royal Fusion premium perfume with original product imagery.'
from public.categories where slug = 'best-sellers'
on conflict (slug) do update set
  name = excluded.name, sku = excluded.sku, short_description = excluded.short_description, description = excluded.description,
  price = excluded.price, sale_price = excluded.sale_price, old_price = excluded.old_price, stock_quantity = excluded.stock_quantity,
  stock_status = excluded.stock_status, category_id = excluded.category_id, category_name = excluded.category_name,
  collection = excluded.collection, gender = excluded.gender, scent_family = excluded.scent_family,
  top_notes = excluded.top_notes, middle_notes = excluded.middle_notes, base_notes = excluded.base_notes,
  bottle_size = excluded.bottle_size, concentration = excluded.concentration, longevity = excluded.longevity,
  sillage = excluded.sillage, occasion = excluded.occasion, inspired_by = excluded.inspired_by,
  main_image_url = excluded.main_image_url, gallery_urls = excluded.gallery_urls, image_alt = excluded.image_alt,
  badge = excluded.badge, tags = excluded.tags, size_options = excluded.size_options, variations = excluded.variations,
  is_featured = excluded.is_featured, is_best_seller = excluded.is_best_seller, is_new_arrival = excluded.is_new_arrival,
  is_premium = excluded.is_premium, is_attar = excluded.is_attar, status = excluded.status,
  seo_title = excluded.seo_title, seo_description = excluded.seo_description, updated_at = now();

insert into public.products (
  name, slug, sku, short_description, description, price, sale_price, old_price, stock_quantity, stock_status,
  category_id, category_name, collection, gender, scent_family, top_notes, middle_notes, base_notes, bottle_size,
  concentration, longevity, sillage, occasion, inspired_by, main_image_url, gallery_urls, image_alt, badge,
  tags, size_options, variations, is_featured, is_best_seller, is_new_arrival, is_premium, is_attar,
  status, seo_title, seo_description
)
select
  'CRIMSON CRYSTAL', 'crimson-crystal', 'RF-CRIMSON-CRYSTAL-50ML', 'Premium Royal Fusion fragrance with original product imagery.', 'A Royal Fusion fragrance presented with original product imagery. Full notes, pricing, and detailed story can be updated later from the admin dashboard.', 3990, 0, 4590, 25, 'In Stock',
  categories.id, 'Best Sellers', 'Royal Fusion Originals', 'Unisex', 'Oriental', array['Citrus','Fresh Spice']::text[], array['Floral Accord','Amber']::text[], array['Musk','Woods']::text[], '50ml',
  'Eau de Parfum', '7-9 hours', 'Moderate', array['Daily Wear','Formal','Gifting']::text[], 'Baccarat Rouge 540', '/uploads/products/crimson-crystal.webp', array['/uploads/products/crimson-crystal.webp']::text[], 'CRIMSON CRYSTAL Royal Fusion perfume bottle', 'Best Seller',
  array['Royal Fusion','Perfume']::text[], '[{"label":"30ml","value":"30ml","price":2490},{"label":"50ml","value":"50ml","price":3990},{"label":"100ml","value":"100ml","price":6490}]'::jsonb, '[]'::jsonb, true, true, false, true, false,
  'Published', 'CRIMSON CRYSTAL | Royal Fusion', 'Royal Fusion premium perfume with original product imagery.'
from public.categories where slug = 'best-sellers'
on conflict (slug) do update set
  name = excluded.name, sku = excluded.sku, short_description = excluded.short_description, description = excluded.description,
  price = excluded.price, sale_price = excluded.sale_price, old_price = excluded.old_price, stock_quantity = excluded.stock_quantity,
  stock_status = excluded.stock_status, category_id = excluded.category_id, category_name = excluded.category_name,
  collection = excluded.collection, gender = excluded.gender, scent_family = excluded.scent_family,
  top_notes = excluded.top_notes, middle_notes = excluded.middle_notes, base_notes = excluded.base_notes,
  bottle_size = excluded.bottle_size, concentration = excluded.concentration, longevity = excluded.longevity,
  sillage = excluded.sillage, occasion = excluded.occasion, inspired_by = excluded.inspired_by,
  main_image_url = excluded.main_image_url, gallery_urls = excluded.gallery_urls, image_alt = excluded.image_alt,
  badge = excluded.badge, tags = excluded.tags, size_options = excluded.size_options, variations = excluded.variations,
  is_featured = excluded.is_featured, is_best_seller = excluded.is_best_seller, is_new_arrival = excluded.is_new_arrival,
  is_premium = excluded.is_premium, is_attar = excluded.is_attar, status = excluded.status,
  seo_title = excluded.seo_title, seo_description = excluded.seo_description, updated_at = now();

