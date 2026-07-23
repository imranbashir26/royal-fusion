# Implementation Roadmap

This roadmap preserves current behavior until each replacement passes its acceptance and rollback gates. No phase rewrites existing migration history.

Reasoning level guidance: **Standard** for narrow UI/docs, **High** for cross-layer contracts, **Very High** for authentication, authorization, transactions, money, inventory and migrations.

## Phase 0 - Contract and Test Harness

Scope: approve these blueprints, define shared domain/API types, add backend/frontend test runners if absent, contract fixtures and CI checks.

- Dependencies: owner approval of open items that block implementation.
- Likely files: `docs/`, `frontend/src/types/`, `backend/server/`, root/frontend/backend package scripts, CI configuration.
- Tests: schema/contract parsers, error envelope, money/status fixtures.
- Acceptance: one canonical vocabulary; no application behavior migration.
- Security gate: secret scan and ignored environment verification.
- Performance gate: capture current bundle/API baseline.
- Rollback: revert test/config commit.
Codex reasoning: High.

## Phase 1 - Supabase Auth and Permission Foundation

Scope: replace customer localStorage auth, verify Supabase sessions in Express, connect profiles/addresses, implement permission-key authorization and admin revocation. Keep guest checkout.

- Dependencies: Phase 0; configured staging Supabase.
- Likely files: `frontend/src/store/`, `frontend/src/components/account/`, new auth pages/services, `backend/server/middleware/`, auth routes/services, additive Supabase migrations/tests.
- Tests: sign-up/sign-in/verification/reset/expiry, customer A/B isolation, inactive role, Manager denial, Owner access, token revocation.
- Acceptance: no passwords/hashes in frontend storage; branded standalone pages; API rejects missing/expired/unauthorized sessions.
- Security gate: RLS matrix and OWASP session review.
- Rollback: feature flag returns staging to prototype auth only; do not roll production identities backward after launch.
Codex reasoning: Very High.

## Phase 2 - Catalog and Dynamic Variants

Scope: additive variant-attribute schema, Supabase catalog repositories, public APIs, product/category/collection admin and frontend domain mappers.

- Dependencies: Phase 1 authorization and Phase 0 contracts.
- Likely files: `backend/supabase/migrations/`, `backend/server/routes/`, new repositories/services, `frontend/src/services/`, `types/`, product/admin components.
- Tests: unique SKU/combinations, pricing constraints, publish rules, archive protection, category Testers seed, pagination/filtering, Manager cost denial.
- Acceptance: no production product read/write uses JSON; one/many variants render without hardcoded values.
- Performance gate: narrow fields, indexed query plans and API p95 target.
- Rollback: switch reads to prior provider only before new production writes; after writes, use forward fix/data export.
Codex reasoning: Very High.

## Phase 3 - Inventory

Scope: variant balances, movement-only adjustments, low-stock views and inventory admin.

- Dependencies: Phase 2 stable variants.
- Likely files: Supabase migration/tests, backend inventory routes/services, admin inventory pages/components.
- Tests: concurrent adjustments, negative-stock rejection, immutable history, threshold alert event and permission denial.
- Acceptance: every balance change has one matching movement and actor/reason.
- Rollback: disable adjustments, reconcile from movement ledger, forward migration only.
Codex reasoning: Very High.

## Phase 4 - Cloudinary Media

Scope: signed uploads, asset registry/usages, transformations, replacement/deletion and all commerce media pickers.

- Dependencies: Phase 2 catalog IDs; approved Cloudinary account details.
- Likely files: backend media routes/services/config, Supabase media migration, frontend admin uploader/picker and responsive image component.
- Tests: signature expiry, folder tampering, MIME/dimension/size rejection, Manager scope, referenced deletion, replacement failure and responsive URLs.
- Acceptance: no new commerce upload uses local storage; no secret enters frontend/logs.
- Rollback: keep old media references readable; disable new upload endpoint; never delete originals during rollout.
Codex reasoning: Very High.

## Phase 5 - Transactional Checkout and Orders

Scope: connect Express to backend-only checkout RPC, quote/order APIs, PKR/tax-inclusive/shipping rules, COD/bank transfer, orders/customers, cancellation and refunds.

- Dependencies: Phases 1-4; zone/free-shipping decisions.
- Likely files: existing checkout function plus additive migrations, backend checkout/order/payment services/routes, frontend checkout/order/customer pages, admin order screens.
- Tests: authoritative prices, concurrency, idempotency, coupon limits, PKR 300 default, no double tax, guest/account orders, all valid/invalid transitions, cancellation restoration, refund caps and rollback.
- Acceptance: no production order write uses JSON; failed checkout preserves cart; financial history is immutable.
- Security gate: service credential backend-only, RLS isolation and abuse limits.
- Rollback: stop new checkout and display maintenance; never revert persisted orders to JSON.
Codex reasoning: Very High.

## Phase 6 - Homepage, Promotions and Settings

Scope: fixed homepage sections, hero behavior, campaigns, testimonials, coupons, shipping/public/private settings and responsive previews.

- Dependencies: catalog/media; Owner permissions.
- Likely files: additive Supabase migrations, backend homepage/settings routes, frontend home components and admin editors.
- Tests: schedules/time zones, content limits, one-slide behavior, reduced motion, mobile/desktop assets, Manager restrictions, private-setting non-disclosure.
- Acceptance: homepage is fully manageable without code and cannot accept arbitrary markup/styles.
- Performance gate: cached narrow home payload and responsive imagery.
- Rollback: retain last published configuration/version and one-click Owner restore.
Codex reasoning: High.

## Phase 7 - Resend, Invoices and Operational Workflows

Scope: email outbox/dispatcher, required notifications, invoice snapshots/PDF, contact alerts, audit integration and reconciliation jobs.

- Dependencies: Phase 5 events; approved Resend domain and legal values for final production.
- Likely files: additive migrations, backend email/invoice/worker services, templates, admin delivery/invoice views.
- Tests: outbox commit boundary, retry/dead-letter, no duplicate sends, PDF snapshots, redaction and provider outage.
- Acceptance: email failure never corrupts orders; invoice numbering is unique and legal values configurable.
- Rollback: disable dispatcher while retaining outbox; switch template version without changing orders.
Codex reasoning: Very High.

## Phase 8 - Blogs and Sanity Adapter

Scope: complete blog list/detail/search/pagination/related UI using local repository, then optional Sanity repository and Studio workflow.

- Dependencies: stable `BlogRepository`; approved Sanity project when integration begins.
- Likely files: `frontend/src/pages/BlogsPage.tsx`, `BlogDetailsPage.tsx`, blog components/types/repositories, `sanity/`.
- Tests: local/Sanity contract parity, portable-content safety, previews, SEO, pagination and missing article.
- Acceptance: repository swap causes no page redesign; Sanity owns blogs only.
- Rollback: select local repository and retain last known published content cache.
Codex reasoning: High.

## Phase 9 - Performance, Accessibility and Deployment Hardening

Scope: split storefront/admin providers, bundle analysis, server pagination/debounced search, caching, image tuning, monitoring, backup/restore, CI/CD and release runbooks.

- Dependencies: all launch workflows stable.
- Likely files: `frontend/src/App.tsx`, providers/services/Vite config, backend caching/logging/config, deployment and CI files, operational docs.
- Tests: Lighthouse/real-device, keyboard/screen reader, visual regression, load/concurrency, security headers/CORS/rates, backup restore and production smoke.
- Acceptance: Core Web Vitals/API/bundle targets in production blueprint; no unexplained >500 kB chunk; restore rehearsal passes.
- Rollback: platform deployment rollback plus backward-compatible API/database changes.
Codex reasoning: High to Very High.

## Phase 10 - Launch and Stabilization

Scope: final data migration, freeze window, reconciliation, smoke tests, client training, monitoring and rollback decision window.

- Dependencies: all launch gates and production credentials in secret managers.
- Tests: catalog counts/checksums, order sequence, permissions, checkout canary, email/media/domain, analytics and backups.
- Acceptance: signed launch checklist and owner handover.
- Rollback: frontend/backend deployment rollback; database uses forward repair unless the rehearsed migration rollback proves no post-cutover writes occurred.
Codex reasoning: Very High.

## Cross-Phase Release Gates

- No critical/high unresolved security finding.
- Unit, API, RLS, integration and affected E2E tests pass.
- `git diff --check`, lint, typecheck, production build and secret scan pass.
- Additive migration has rollback procedure, staging rehearsal and read-only verification.
- Logs contain request IDs but no credentials, tokens or unnecessary personal data.
- Performance regression is measured against the Phase 0 baseline.
- Documentation and environment examples remain placeholder-only.
