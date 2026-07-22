# Royal Fusion Supabase Setup

This folder contains the production database direction for Royal Fusion.

## What Supabase Owns

Use Supabase for transactional eCommerce data:

- Customer profiles and addresses
- Admin roles and permissions
- Products, categories, collections, prices, stock, variants, and Cloudinary media references
- Orders and order items
- Promotions, coupons, shipping, payment status, and commerce settings
- Reviews, contact messages, newsletter subscribers
- Admin audit logs

Cloudinary owns commerce image files. Sanity owns journals and blogs only. Homepage banners,
promotions, collections, and featured-product controls remain in Supabase and are managed by
the Royal Fusion Admin Dashboard.

## Apply Schema

1. Create a Supabase project.
2. Open the SQL editor.
3. Run `migrations/001_initial_schema.sql`.
4. Run `migrations/002_launch_schema_foundation.sql`.
5. Run `seed/001_starter_catalog.sql` to load fictional relational catalog and configuration data.
6. Run the local/staging verification documented in `tests/README.md`.
7. Confirm every exposed table has RLS enabled.
8. Create the first user through Supabase Auth.
9. Assign the `owner_admin` role in `user_roles` using a backend-only administrative operation.

Example:

```sql
insert into public.user_roles (user_id, role_id)
select 'AUTH_USER_UUID_HERE', id from public.roles where key = 'owner_admin';
```

## Cloudinary Media

Supabase stores only Cloudinary identifiers and secure delivery URLs. Commerce media includes:

- Product gallery media in `product_media`
- Category media on `categories`
- Collection banners on `collections`
- Homepage banners and campaigns in `promotions`
- Open Graph media in `seo_settings`

Cloudinary upload signatures and API secrets must remain in Express. Never send them to Vite.

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
- Relational categories, collections, products, and product variants
- Fictional Cloudinary-ready media placeholders
- Public settings, shipping configuration, one homepage promotion, and SEO settings

The seed contains no customers, credentials, payment account details, or production identifiers.
It is idempotent by stable keys such as slug, SKU, code, and setting key.

## Checkout Boundary

`create_order_transaction` is callable only by `service_role`. It accepts variant IDs and
quantities, locks inventory, reloads prices, applies coupon and shipping rules, creates all
order records, and rolls back on failure. Do not call it from the browser. Express must verify
the customer/admin request before invoking it with server-only credentials.

## Verification And Rollback

- Local/staging checks: `tests/README.md`
- Migration rollback: `rollback/002_launch_schema_foundation_rollback.sql`

Prefer restoring a pre-migration backup over destructive rollback when real data exists.

## First Production Build Order

1. Validate migrations, RLS, checkout, rollback, and seed data locally.
2. Generate typed Supabase database definitions.
3. Implement backend Supabase repositories without switching application traffic.
4. Replace customer and administrator identity with Supabase Auth.
5. Replace local media upload with backend-signed Cloudinary upload.
6. Connect admin operations to permission-checked Express endpoints.
7. Connect storefront reads only after RLS and mapping tests pass.
