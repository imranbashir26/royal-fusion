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

## Single Admin Release Plan (authoritative for the verified legacy production schema)

Royal Fusion has two application user types: a verified Customer with no RBAC
assignment, and an explicitly assigned active `admin` with `*`. Endpoint permission
checks remain in place. Sessions, MFA and CSRF are separate from role authority.

**Ordering remains disabled. These files are drafts for implementation review, not
approval to run them. Do not replay historical 003/004 on the legacy production
database or rely on numeric ordering.** Historical 003's owner/manager transition
does not preserve the verified legacy assignment. The release expansion includes
the required 003/004 session, refresh, audit and ownership foundation with the
single Admin model; it does not create the obsolete invitation workflow.

The three manual release files are:

- `release-migrations/001_single_admin_expansion.sql`: atomic overlap, active-only
  assignments, secure sessions, guarded permission resolver and last-Admin guards.
  The resolver requires Active profile, active assignment/role and wildcard. During
  overlap only, it also recognizes the exact legacy owner_admin UUID pinned by
  immutable first_admin bootstrap evidence. Runtime settings cannot select it.
  The compatibility check accepts only the read-only verified production SQL body
  or the exact expanded body, with matching signature/security/owner/EXECUTE ACLs.
  Each body has explicit LF and CRLF representations. Only outer whitespace is
  trimmed from installed source; characters inside quoted values are never normalized.
- `release-migrations/002_single_admin_fulfillment.sql`: immediately after ordinary
  011; changes only its actor authorization, removes the obsolete order-manager
  payment grant, and preserves the reviewed transactional body.
- `release-migrations/003_single_admin_retirement.sql`: separate, deliberate cutover
  after successful deployment and canonical authentication verification. It guards
  the installed resolver and atomically removes the approved legacy fallback;
  final has_permission recognizes canonical admin only. Unknown definitions abort
  the entire retirement; reruns accept only the exact final definition.

Release sequence, subject to separate migration/deployment approval:

1. Read-only production preconditions: approve the exact Auth UUID/profile, sole
   active legacy `owner_admin` assignment and its `*` grant; inspect existing
   session/security objects, grants, migration history and a recoverable backup.
2. On the dedicated release connection, supply `royal_fusion.approved_admin_uuid`
   as the approved UUID. This is operator input, never a browser/bootstrap endpoint.
   Run the expansion alone. No UUID, email, password or service key is embedded.
3. Verify the same UUID has **two distinct assignments**, legacy `owner_admin` and
   canonical `admin`, each active with wildcard. Verify session functions/grants.
   Expansion aborts on unexpected assignments, bootstrap evidence, incompatible
   schema/security functions or security hooks; investigate rather than bypass it.
4. Apply reviewed ordinary migration `010_checkout_product_locking.sql`.
5. Apply ordinary `011_admin_order_fulfillment.sql`, then the release fulfillment
   correction on the same controlled release occasion **before application traffic**.
   Verify service-only ACLs and canonical actor checks. Do not deploy into the gap.
6. Deploy the reviewed backend/frontend with ordering still disabled. Keep the
   legacy assignment active so the previous deployment retains its authority.
7. Verify canonical Admin password/MFA login, cookie restoration, refresh,
   permissions and implemented APIs. Validate inactive profile/assignment denial.
8. Verify Customer registration/verification/login, restore/signout, own-profile
   editing, ownership enforcement and denial of Admin APIs. Address-book management
   is not part of the new account modal; checkout still accepts shipping information.
9. Only after explicit cutover approval, supply the same approved UUID plus
   `royal_fusion.canonical_login_verified_for` (that UUID) and
   `royal_fusion.canonical_verification_reference` (8–160 character non-secret
   approval/test reference). Run retirement separately. These inputs attest to
   reviewed evidence; SQL cannot independently prove a browser login occurred.
10. Verify Admin still works, obsolete assignments/roles are inactive, legacy
    permission links are removed and immutable transition evidence exists.
11. Configure and verify shipping methods/rates and payment enablement separately.
12. After real PostgreSQL multi-connection concurrency verification and live
    RPC/permissions/RLS/configuration checks, approve a controlled test order.
13. Verify relational fulfillment and inventory/payment/audit outcomes.
14. Approve controlled launch and the explicit ordering-gate change separately.

The expansion is safely repeatable while overlap remains valid; retirement is
repeatable with its approval evidence. Expansion is intentionally refused after
retirement. Compatible existing session structures and optional assignment lifecycle
columns are preserved. No production migration or configuration has been applied
by this implementation.

Old prototype `/admin/users` management is not supported or navigable. New Admin
provisioning and authority changes require reviewed server operations. The old
`create-admin` CLI provisions prototype JSON users and must not be used for this
release. Wildcard application authority does not grant deployment, provider secrets
or direct browser execution of service-only operational RPCs.

Local SQL validation uses disposable PGlite PostgreSQL fixtures. This establishes
transaction/authorization behavior but does not replace real multi-connection
locking tests. The local-only concurrency runner now uses expansion → 010 → 011 →
correction. It refuses nonempty/nonlocal targets and requires a local `psql`.

## Historical Schema Instructions (not the current production release sequence)

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
- prototype JSON features that have not yet received production adapters
- local `backend/server/uploads`

The supported customer account flow now uses backend/Supabase cookie sessions with
memory-only frontend presentation state. It removes the old localStorage account
record on restoration; browser-stored passwords and local customer IDs confer no
authority. Remaining prototype modules need production adapters before launch.

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
