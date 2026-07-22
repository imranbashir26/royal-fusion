# Royal Fusion Supabase Setup

This folder contains the production database direction for Royal Fusion.

## What Supabase Owns

Use Supabase for transactional eCommerce data:

- Customer profiles and addresses
- Admin memberships and roles
- Products, categories, prices, stock, variants, images
- Orders and order items
- Coupons and shipping/payment settings
- Reviews, contact messages, newsletter subscribers
- Admin audit logs

Sanity should own editorial content such as blogs, policy pages, homepage copy, and fragrance guides.

## Apply Schema

1. Create a Supabase project.
2. Open the SQL editor.
3. Run `migrations/001_initial_schema.sql`.
4. Run `seed/001_starter_catalog.sql` to load the current Royal Fusion categories, product catalog, and settings.
5. Confirm every public table has RLS enabled.
6. Create the first user through Supabase Auth.
7. Insert that user's UUID into `admin_memberships` with role `Owner/Admin`.

Example:

```sql
insert into public.admin_memberships (user_id, role, status)
values ('AUTH_USER_UUID_HERE', 'Owner/Admin', 'Active');
```

## Storage Buckets

Create these Supabase Storage buckets:

- `product-images`: public read, admin-only write
- `site-assets`: public read, admin/content-editor write
- `cms-exports`: private, owner/admin only if needed

Recommended file limits:

- Product/site images: `image/jpeg`, `image/png`, `image/webp`
- Max size: 3 MB per file before optimization
- Convert public storefront assets to WebP during upload when possible

## Required Environment Variables

Frontend:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_SANITY_PROJECT_ID=
VITE_SANITY_DATASET=production
VITE_SANITY_API_VERSION=2025-01-01
```

Backend/server-only:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SANITY_API_TOKEN=
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` in Vite/browser code.

## Migration Notes From Current Prototype

The current project still uses:

- `backend/server/data/db.json`
- local JSON update helpers
- browser-local customer auth prototype
- local `backend/server/uploads`

These must be replaced before production launch. The service layer should stay, but the implementation should call Supabase and Sanity instead of local JSON.

## Starter Seed

`seed/001_starter_catalog.sql` is generated from the current prototype data and includes:

- The 7 current Royal Fusion products
- Current category list
- Site settings, shipping settings, payment settings, homepage JSON, and SEO JSON

The seed is idempotent by product/category slug and site setting id.

## First Production Build Order

1. Add Supabase client packages.
2. Add typed Supabase service modules.
3. Migrate `products`, `categories`, `orders`, `coupons`, `reviews`, settings, and users.
4. Replace customer auth store with Supabase Auth.
5. Replace local media upload with Supabase Storage.
6. Keep admin UI, but connect its API calls to Supabase-backed endpoints.
7. Add audit logging for admin mutations.
