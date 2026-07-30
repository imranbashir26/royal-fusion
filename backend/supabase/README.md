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
5. Run `migrations/003_auth_schema_hardening.sql`.
6. Run `migrations/004_auth_session_refresh_lease.sql`.
7. Run `seed/001_starter_catalog.sql` to load fictional relational catalog and configuration data.
8. Run the local/staging verification documented in `tests/README.md`.
9. Confirm every exposed table has RLS enabled.

Migration `003` creates canonical `owner` and `manager` roles, backend-only invitation,
session, bootstrap, and guest-order-claim records, final-Owner protection, and narrower
customer ownership policies. It does not create users, provision an Owner, activate
Supabase Auth in Express, or change the current frontend/JSON authentication behavior.

The first Owner must later be assigned by the reviewed release-only backend command.
Do not assign it through a browser or expose a bootstrap endpoint. Legacy `owner_admin`
and `shop_manager` roles remain present but inactive; legacy Shop Manager assignments
are not converted automatically.

Migration `004` adds an atomic refresh lease, recovery-session context, and focused
session audit events for the Express cookie-session gateway. It stores no access token,
refresh token, or cookie value. Its backend-only functions are executable only by
`service_role`.

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
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_SANITY_PROJECT_ID=
VITE_SANITY_DATASET=production
VITE_SANITY_API_VERSION=2025-01-01
```

Backend/server-only:

```env
SUPABASE_URL=
SUPABASE_SECRET_KEY=
USE_SUPABASE=
SANITY_API_TOKEN=
```

Never expose `SUPABASE_SECRET_KEY` in Vite/browser code.

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
- Migration 002 rollback: `rollback/002_launch_schema_foundation_rollback.sql`
- Authentication hardening rollback: `rollback/003_auth_schema_hardening_rollback.sql`
- Cookie-session rollback: `rollback/004_auth_session_refresh_lease_rollback.sql`

The migration 003 rollback refuses to run after invitations, sessions, claims, canonical
role assignments, bootstrap state, or related audit evidence exists. Use a forward-fix
migration once any authentication workflow has used the schema.

Migration `004` rollback refuses to run after any application session exists because
discarding recovery context or refresh state would be unsafe. Use a forward-fix migration.

Prefer restoring a pre-migration backup over destructive rollback when real data exists.

## First Production Build Order

1. Validate migrations, RLS, checkout, rollback, and seed data locally.
2. Generate typed Supabase database definitions.
3. Implement backend Supabase repositories without switching application traffic.
4. Replace customer and administrator identity with Supabase Auth.
5. Replace local media upload with backend-signed Cloudinary upload.
6. Connect admin operations to permission-checked Express endpoints.
7. Connect storefront reads only after RLS and mapping tests pass.
