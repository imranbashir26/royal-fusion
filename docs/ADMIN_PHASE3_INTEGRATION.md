# Phase 3 — Customers, Coupons and SEO

Local implementation for independent review, 2026-10-10.

## Checkpoint and evidence

Started on `phase2-canonical-variants` at `eb87d40c22bbcb57d942c35b1c7445f5da5abd07`, with an empty index and only the intentional modified checkoutIntegration test and deleted root vercel.json. The development handoff was unavailable. Existing architecture/API/auth/RBAC/data-model/checkout documentation, CONTACT_MESSAGES_PHASE2.md, committed schema and current services were inspected instead. Repository inspection establishes the approved application contract; it does not certify the current live database.

The implementation plan was to reuse cookie sessions and service clients, expose customer reads, permit only atomic single-row coupon configuration writes, and assign static-page SEO to PostgreSQL while preserving commerce and Sanity ownership. Workflows requiring an unapproved database writer or rendering architecture remain unavailable.

## Approved schema and reused architecture

- `profiles.id` references `auth.users.id`; `customer_addresses.customer_id` and `orders.customer_id` reference profiles. Email is never used to associate a customer with an order. Addresses come from the canonical address relation. Active canonical administrators are excluded from customer reads.
- Coupons retain the committed Percentage / Fixed Amount / Free Shipping enum, numeric(12,2) monetary fields, nonnegative integer usage limits, date-order and discount constraints, case-insensitive code uniqueness, restriction junctions and immutable redemption history. Zero usage limits mean unlimited. Legacy applicable-ID arrays are displayed when present and never rewritten.
- SEO settings have unique page keys/routes, title/description/canonical/robots/OG fields and active state. Public reads are governed by existing active-row RLS. Browser writes remain unavailable; administrative writes use the server service client.
- Canonical capabilities are `customers.read`, `coupons.manage`, `seo.manage`; reading customer order history additionally requires `orders.read`. Existing createAdminIdentity, AdminAuthorizationService, cookie/session restoration, Origin checks, session-bound CSRF, response envelopes and protected frontend transport are reused. No role/permission assignment changes were made.
- Capability-only tests inject already-authorized identities. The production authorization resolver still requires the existing active canonical Admin assignment and its existing `*` bundle; these tests do not introduce restricted production administrator roles.
- Audit inserts match committed `admin_audit_logs`: generated UUID id, nullable UUID admin_id FK, required text action/resource, resource_id text, metadata JSONB, generated created_at, and text permission_key/request_id additions from 002. The existing immutable audit trigger concerns UPDATE/DELETE, not INSERT. Audit failures follow the established best-effort convention and log only event/request ID; an already-persisted mutation is not falsely reported as failed.

## HTTP contracts

All paths below start with `/api/v1/admin`. All private responses, including failures, use `Cache-Control: no-store`. Existing administrator authentication and domain authorization run before data access. Writes require allowed Origin, session-bound CSRF and strict JSON up to 16 KiB. Unknown query/body fields fail. Database exceptions never become public messages. Supabase operations use bound filters and restricted columns.

| Method/path | Contract |
| --- | --- |
| GET /customers | page 1–100000, pageSize 1–50 (default 20), optional validated search up to 80 characters across name/email/phone; stable created_at DESC, id DESC |
| GET /customers/:uuid | profile summary and canonical addresses, bounded to 50 with a truncation indicator |
| GET /customers/:uuid/orders | UUID-FK order summaries only, bounded/stable pagination; also orders.read; no email lookup or search |
| GET /coupons | bounded/stable pagination and validated code search |
| GET /coupons/:uuid | configuration, preserved legacy IDs, up to 100 restrictions per type, exact redemption count and latest 20 redemption id/amount/date values; no customer email or order/customer IDs |
| POST /coupons | strict code/type/configuration; one unrestricted coupon row; database owns id, used_count and timestamps |
| PUT /coupons/:uuid | approved configuration/status and expectedUpdatedAt; conditional update matches updated_at and observed used_count |
| GET /seo | existing rows for six allowed static routes, including inactive rows for administration |
| PUT /seo/:key | home/shop/collections/attars/about/contact; approved text/canonical/OG fields and expectedUpdatedAt (null for creation) |

Customers have no mutation endpoints. Coupon code/type, counters, legacy arrays, junctions and redemption history have no write inputs. Money is finite, nonnegative, at most 9999999999.99 and at most two decimals. Percentage must be positive and at most 100; fixed amount must be positive; free shipping requires zero monetary discount and no cap. Dates must be genuine ISO dates and ordered. Usage limits cannot be reduced below observed usage. Stale or concurrently changed rows produce 409 rather than overwriting them.

SEO writes reject HTML/control characters in text, unsafe URL schemes/credentials, canonical query/hash, paths for other pages and unapproved canonical origins. Canonicals must use HTTPS and the configured allowed storefront origin with the exact static path. OG image URLs require credential-free HTTPS. Robots and active state are not writable and are preserved, including intentional noindex rows. Existing page keys are preserved when locating rows by route.

## Completed admin workflows

Customers now has search, pagination, read-only details/addresses and separately authorized order links to the existing order-detail route. Coupons has search, pagination, details/restrictions/redemption summaries, validated create/edit/status forms, optimistic conflict handling and duplicate-submit prevention. New coupons default Inactive in the UI. SEO has the six static-page selectors, approved fields, loading/reload/save/success/error feedback and optimistic revisions. Expired sessions return through the established login flow; denied access hides private content. Data renders as React text. All admin traffic uses modern APIs, with independent legacy-request monitoring in browser tests.

Only functional Customers, Coupons and SEO pending states were replaced. Banners, Blogs, Testimonials and Editable Pages remain isolated and unavailable. The existing SEO/Editable Pages mode navigation remains intact.

## Coupon integrity and deferred restriction editing

The approved Supabase application client has no verified atomic writer for a coupon row plus its product/category junctions. Multiple independent PostgREST writes would risk partial restriction changes. Consequently creation is unrestricted, existing restrictions are read-only and no restriction-edit operation is exposed. Approval of an atomic database writer is required before adding that workflow; no database changes are proposed or executed here.

Checkout V1 and V2 retain their existing engines, rounding, caps, shipping, eligibility, reservation, redemption and lifecycle behavior. V2 applies discounts to monetary parent products/categories, never separately to physical pack components. Conditional admin writes preserve usage counters, historical redemptions and stock; no stacking/refund/cancellation behavior was introduced. Existing production legacy coupon and ordering fences remain intact.

New checkout-focused tests copy the exact committed read-only quote helpers/resolver and selected dependent table definitions into a fresh in-memory PostgreSQL-compatible fixture. They exercise admin-created/updated coupons against both existing V1 calculation code and actual V2 quote SQL: percentage rounding/caps, fixed amount capped at subtotal, free shipping, parent-only product/category eligibility, component rejection, deactivation/date/usage limits, unchanged stock and zero orders/redemptions. No migration file or installation guard is executed. These are calculation/integration tests, not a full migration-chain, native PostgreSQL concurrency or release-compatibility certification.

## Public SEO ownership and crawlability

Public static metadata is read through the existing publishable Supabase client with an explicit column projection, active filter, static-route allowlist and bounded range. Missing/failed public SEO reads produce safe defaults and do not reinstate prototype JSON SEO. The browser never calls the administrative SEO API for public pages.

Existing product/category/collection SEO fields remain commerce-owned. Existing Sanity blog SEO title/description projections are preserved by the mapper and used for editorial routes; no Sanity schema/GROQ or PostgreSQL editorial ownership was added. OG images use existing safe content images or static settings; adding broader Sanity SEO projections is outside this phase.

The DOM manager updates title/description/OG/robots/canonical using DOM properties, not HTML interpolation. It clears stale OG images and robots across routes and strips query/hash from fallback canonicals. Collection aliases continue to resolve. Canonical fallback assignment cannot treat a double-slash path as a different origin.

Royal Fusion remains a React/Vite SPA. The build's initial HTML retains its static metadata; route metadata is populated after JavaScript/data loading. Client-side updates do not guarantee indexing, crawlable route-specific HTML or social previews. Reliable prerendering/SSR, bot delivery, sitemaps and broader SEO deployment decisions require separate approval. No rendering/deployment architecture or ordering configuration changed.

## Initial Phase 3 verification (before independent-review corrections)

| Check | Final result |
| --- | --- |
| npm --prefix backend run test:phase3 | 14 passed, 0 failed, 0 skipped/cancelled |
| Existing backend auth-contract, cookie-session, contact-v1, orders-v1 and protected checkout file suites | 71 passed, 0 failed, 0 skipped/cancelled |
| npm --prefix frontend run test:phase3 | 5 passed, 0 failed; these are also included in the full frontend result below |
| npm --prefix frontend test | 128 passed, 0 failed, 0 skipped/cancelled |
| npm --prefix frontend run test:phase3:browser | 7 passed, 0 failed, 0 skipped/cancelled |
| Existing Phase 1, contact, customer auth, variants and checkout browsers | 42 passed, 0 failed, 0 skipped/cancelled (12 + 9 + 1 + 10 + 10) |
| npm --prefix frontend run lint | Passed, no warnings |
| npm --prefix frontend run build | Passed; Vite's >500 KiB chunk advisory remains |
| git diff --check | Passed |

Backend regressions were invoked with `node --test --test-concurrency=1` on auth-contract-foundation.test.js, auth-backend-cookie-sessions.test.js, contact-v1.test.js, orders-v1.test.js and checkout-v2-protected.test.js. Existing browser regressions were invoked with the same concurrency setting on adminPhase1Browser.test.mjs, contactBrowser.test.mjs, customerAuthBrowser.test.mjs, variantBrowser.test.mjs and checkoutBrowser.test.mjs. Browser harnesses intercept every external request; local isolated API servers are fixtures, not Belmo.

Full backend migration-chain/customer-account SQL suites were not invoked because they execute migrations and this phase prohibits that. Existing shared auth tests, new FK-based customer isolation tests, frontend customer contracts and the customer-auth browser cover the relevant application boundaries. No critical security, checkout or integrity assertion failed.

All initial failures are retained here:

1. First backend Phase 3 run: 10/11 passed. The disposable adapter's identifier regex rejected digits in address_line_1; it was corrected without changing the actual schema/API.
2. First Phase 3 browser run: 0/7 passed due to browser-launch hook failures; no assertions ran. A direct installed Chrome launch succeeded, followed by a successful retry of browser setup.
3. Initial lint/build: missing closing option tag in the new SEO JSX. Fixed. Lint then reported four access-object effect dependency warnings, removed by stable destructuring. The next build found optional collections access in the SEO resolver; optional chaining corrected it. Final lint/build are clean except the stated chunk advisory.
4. Browser retry: 5/7 passed; exact labels for Coupon type and Storefront page included option text. Explicit accessible names corrected the controls. The test's Editable Pages expected notice was also aligned to the existing exact notice. Final run: 7/7.
5. First checkout-focused run: 2/3 passed. The test inserted a nonexistent third timestamp column into a two-column coupon junction. Explicit approved columns corrected fixture setup. Rerun: 3/3; final combined Phase 3 suite: 14/14.
6. Full frontend tests initially emitted a Vite HMR port-in-use advisory while all 128 tests passed. The new middleware-only contract fixture now disables unused HMR. This did not affect application assertions.

## Exact Phase 3 file inventory

Created:

- backend/server/routes/adminPhase3V1.js
- backend/server/schemas/adminPhase3.js
- backend/server/services/adminPhase3Service.js
- backend/server/tests/admin-phase3.test.js
- backend/server/tests/admin-phase3-checkout.test.js
- backend/server/tests/support/phase3Database.js
- backend/server/tests/support/phase3CheckoutDatabase.js
- frontend/src/admin/AdminPhase3Pages.tsx
- frontend/src/services/adminPhase3Api.ts
- frontend/src/services/storefrontSeo.ts
- frontend/tests/adminPhase3Integration.test.mjs
- frontend/tests/adminPhase3Browser.test.mjs
- docs/ADMIN_PHASE3_INTEGRATION.md

Modified:

- backend/package.json (test registration)
- backend/server/index.js (authenticated router registration)
- frontend/package.json (test registration)
- frontend/src/admin/AdminRoutes.tsx
- frontend/src/admin/AdminSeoPage.tsx
- frontend/src/admin/adminConfig.ts
- frontend/src/components/layout/SeoManager.tsx
- frontend/src/services/productionMappers.ts
- frontend/src/services/storefrontService.ts
- frontend/src/services/supabaseStorefrontService.ts
- frontend/src/types/index.ts
- frontend/tests/adminPhase1Browser.test.mjs (modern SEO fixture/pending scope; independent legacy detector retained)

## Protected integrity and stop point

CheckoutIntegration bytes remain SHA-256 `87dc83af5c5d5d182870a7bea0a7f45b86282c75c2555687d69c6286e18882ac`. Frontend rewrite configuration remains `59f90930c70f98d5925bbecd8aa6847c4a6fc45d241a0d048121b7765d82d4de`. Root vercel.json remains absent. No migrations, release migrations, auth services, cart/checkout persistence, checkout engines, environment or deployment settings changed. No migration application, production access, staging, commits, pushes, merge, deployment, Belmo startup or ordering enablement occurred. The branch/HEAD remain the starting checkpoint and the index is empty.

Coupon restriction mutation and reliable server-rendered SEO remain explicit deferred workflows. Current live database state has not been verified. Stop here for independent review; Phase 4 is not started.

## Independent-review corrections — 2026-10-10

This targeted pass started from the same branch/HEAD and preserved all existing uncommitted Phase 3 work. The index was empty. A byte-hash snapshot of all 426 tracked/nonignored source files established the starting state; before this documentation update, only the six intended code/test files changed and the other 420 entries matched exactly.

### Canonical origin validation

The previous resolver accepted an HTTPS stored canonical with the right path even when its origin was foreign. It now compares the parsed canonical origin to the caller-supplied storefront origin before accepting the URL. SeoManager already supplies `window.location.origin`; it is unchanged. Approved same-origin HTTPS URLs remain valid. Foreign/historical hosts or ports, malformed values, unsafe schemes, credentials, mismatched paths and query/hash values fall back to the storefront URL with the current route and no query/hash. Stored data cannot establish another trusted origin. Collection aliases and domain-owned metadata precedence remain intact.

The current public frontend has no separate canonical-host environment setting. ENVIRONMENT_SETUP.md documents `CLIENT_ORIGIN` as the server's exact storefront allowlist, with the canonical origin first for Auth callbacks; this server configuration is not exposed to the browser. The resolver retains its existing caller-origin contract instead of adding a host, exposing server configuration or inferring approval from stored metadata. No production URL is hardcoded and no environment/deployment configuration changed.

### Coupon restriction display

Previously, empty modern junction arrays produced “All monetary parent products” / “All categories” even when historical arrays contained IDs. The display now classifies each product/category restriction set independently as Unrestricted, Modern restrictions, Historical restrictions or Mixed sources, and renders modern and historical IDs separately. It displays the preserved metadata sources; it does not calculate eligibility or combine those sources into new checkout rules. Checkout remains authoritative and restriction editing remains unavailable.

Committed Migration 001 lines 124–125 define both historical applicable-ID arrays as UUID[] NOT NULL with empty defaults. The backend already selects/preserves those values and was retained. The display helper also tolerates null/missing arrays defensively without mutating or sorting IDs. The actual-schema backend regression verifies legacy-only and mixed DTOs and verifies that configuration updates preserve both sources. Existing redemption/inventory/coupon calculation regressions remain in place.

### Read-only public SEO permission evidence

Only committed repository SQL was inspected; no database query, migration, RLS or grant modification occurred.

| Evidence | Required access/boundary |
| --- | --- |
| 002_launch_schema_foundation.sql:515–531 | seo_settings contains public metadata fields; no provider credentials or customer data |
| 002_launch_schema_foundation.sql:1111 | RLS enabled on seo_settings |
| 002_launch_schema_foundation.sql:1325–1326 | rf_seo_public_read permits SELECT to anon/authenticated using active |
| 002_launch_schema_foundation.sql:1327–1328 | rf_seo_admin is separately permission-gated by seo.manage |
| 002_launch_schema_foundation.sql:1338 | USAGE on public schema to anon/authenticated |
| 002_launch_schema_foundation.sql:1339–1342 | Explicit table SELECT includes seo_settings for both browser roles; it covers every projected public column |
| 002_launch_schema_foundation.sql:1358–1366 | Browser INSERT/UPDATE/DELETE revoked, including seo_settings; admin RLS alone does not grant write privileges |
| 003_auth_schema_hardening.sql:848–860 | Later auth/RBAC revokes do not remove the SEO public read grant/policy |
| Release 003:52–89 | has_permission retains authenticated/service EXECUTE and canonical Admin resolution; anonymous active-row policy does not invoke it |
| Release 004:100–136 | Existing-table hardening removes only TRUNCATE/REFERENCES/TRIGGER/MAINTAIN and preserves SEO SELECT |
| Release 005:368–369 | Changes future schema-specific table defaults only; existing SEO grants/RLS remain intact |

The publishable client therefore has a committed safe read path for active metadata. The static-route and explicit-column restrictions are additionally applied by the existing `getSeo()` query; the database's public policy is active-row-based, not a static-route allowlist. Authorized admin reads may include inactive rows under the separate administrative policy. This repository conclusion does not certify live production deployment or catalog state. There is no repository permission blocker and no database fix was introduced.

### Exact correction-pass files

- frontend/src/services/storefrontSeo.ts — canonical origin comparison.
- frontend/src/services/adminPhase3Api.ts — pure, null-safe restriction-provenance display helper; API transport/type contracts retained.
- frontend/src/admin/AdminPhase3Pages.tsx — accurate source-specific coupon display; no write or eligibility changes.
- frontend/tests/adminPhase3Integration.test.mjs — approved/foreign/malformed/historical/fallback canonicals and all restriction source combinations.
- frontend/tests/adminPhase3Browser.test.mjs — legacy-only/mixed/null-array rendering, foreign canonical fallback and updated exact display expectations; all prior assertions/legacy monitoring retained.
- backend/server/tests/admin-phase3.test.js — actual-schema historical/mixed restriction preservation regression.
- docs/ADMIN_PHASE3_INTEGRATION.md — this correction/permission/verification record.

SeoManager, backend Phase 3 services, schema files, migrations, release migrations, checkout/redemption engines, protected exclusions and rewrite/environment/ordering settings remain byte-identical to this pass's starting snapshot. No files were created in this correction pass.

### Correction-pass verification results

| Executed check | Pass | Fail | Skip/cancel |
| --- | ---: | ---: | ---: |
| npm --prefix backend run test:phase3 (12 API + 3 checkout calculation/integrity cases) | 15 | 0 | 0 |
| Backend contact-v1, orders-v1 and checkout-v2-protected | 30 | 0 | 0 |
| npm --prefix frontend run test:phase3 | 7 | 0 | 0 |
| npm --prefix frontend test (includes the 7 Phase 3 integration cases) | 130 | 0 | 0 |
| npm --prefix frontend run test:phase3:browser | 10 | 0 | 0 |
| Existing adminPhase1Browser, contactBrowser and checkoutBrowser (12 + 9 + 10) | 31 | 0 | 0 |
| npm --prefix frontend run lint | Passed | — | — |
| npm --prefix frontend run build | Passed | — | — |
| git diff --check | Passed | — | — |

Existing backend/browser groups used `node --test --test-concurrency=1` with the named files. All commands passed on their first correction-pass run; no security, checkout or other assertion failed. The full frontend run emitted an asynchronous Vite dependency-scan warning (“server is being restarted or closed”, 35 scanner errors) from an existing middleware fixture: adminMediaContract.test.mjs:15 does not disable dependency discovery. All 130 tests and the production build passed. That unrelated fixture was retained. The build also retains its existing >500 KiB chunk-size advisory. These diagnostics were not represented as test failures or silently omitted.

Protected SHA-256 values, absent root vercel.json, branch/HEAD and empty index were rechecked. No production access/SQL, migrations, grants/RLS changes, checkout/redemption changes, staging/commits/pushes, deployments, Belmo startup, ordering enablement or Phase 4 work occurred. Existing atomic restriction-writer and crawlable-rendering limitations remain deferred; these corrections add no blocker. Stop for independent review.

READY FOR INDEPENDENT REVIEW
