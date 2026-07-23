# Royal Fusion Authentication Branch Roadmap

## 1. Release Gate

This Phase 2B documentation branch must be reviewed, approved, committed, pushed, and merged into `main` before `test/auth-contract-foundation` is created. Every implementation branch starts from an updated clean `main`, is reviewed independently, and merges before the next dependent branch begins.

The branches must not migrate catalog, inventory, commerce media, checkout persistence, checkout calculations, or order-dashboard workflows.

## 2. Shared Commit and Review Rules

- Keep schema, backend, frontend, MFA, linking, and cutover concerns in their assigned branch.
- Use additive migrations only; never rewrite migrations 001/002.
- Keep `USE_SUPABASE` connectivity-only.
- Never commit environment files, provider responses, tokens, cookies, credentials, real identities, or live data.
- Run affected tests, lint, typecheck, build, secret scan, and `git diff --check` before each commit.
- Commit tests with the behavior they verify; avoid one large final test commit.
- Stop on unrelated changes, migration drift, security regression, or conflict.

## 3. Branch 1 - `test/auth-contract-foundation`

**Objective:** Establish contracts and non-destructive test infrastructure before Auth behavior changes.

- **Exact scope:** Assess current npm workspaces; add compatible unit/API/component tooling, shared Auth contract fixtures, injected clock, mock Supabase Auth gateway, cookie/CSRF helpers under test, and guest-checkout regression coverage.
- **Likely files:** Root/frontend/backend package manifests and lockfile; new backend/frontend test configuration; `backend/server/tests/`; `frontend/src/**/*.test.*`; shared test fixtures.
- **Prohibited:** Runtime Auth routes, current login behavior, Supabase migrations, JSON/live data, checkout calculations and production flags.
- **Schema changes:** None.
- **API changes:** None; tests describe proposed `/api/v1` contracts without routing production traffic.
- **Frontend changes:** Test harness only.
- **Tests:** Mock gateway success/failure, cookie flags, CSRF contract, generic errors, current guest checkout success/failure preservation.
- **Acceptance:** Tests are isolated, cannot contact production, and current application behavior is unchanged.
- **Manual verification:** Run all test commands with network disabled; verify existing dev flows still start.
- **Rollback point:** Revert tooling/config/test commit.
- **Security gate:** Fake provider cannot activate when `NODE_ENV=production`; fixtures contain no credential-shaped values.
- **Commit boundaries:** Tooling/config; mock gateway/fixtures; contract tests; guest regression tests.
- **Codex reasoning:** High.

## 4. Branch 2 - `feature/auth-schema-hardening`

**Objective:** Add the database/RLS foundation required by secure Auth and exact RBAC.

- **Exact scope:** New numbered additive migration, rollback/forward-repair procedure, dashboard deployment script update where required, SQL verification, and disposable RLS/concurrency tests.
- **Likely files:** `backend/supabase/migrations/`, `tests/`, `rollback/`, `dashboard/`, and Supabase README.
- **Prohibited:** Frontend/backend Auth behavior, remote schema commands, account import, catalog/order schema redesign.
- **Schema changes:** Canonical Owner/Manager reseeding; delete/reinsert managed grants; invitation, application-session, guest-claim objects; final-Owner and role-assignment guards; profile hardening; audit events; customer-visible history policy; indexes/constraints/RLS/grants.
- **API changes:** None.
- **Frontend changes:** None.
- **Tests:** Clean/repeated migration, exact permission matrix, Customer A/B, Manager denial, final Owner, invite transitions, session/claim privacy, claim replay/concurrency, legacy policy retirement.
- **Acceptance:** Manager has no forbidden permission; no browser role sees raw sessions/claims or performs privileged writes; existing checkout function remains backend-only.
- **Manual verification:** Apply only to local/disposable staging; run consolidated read-only verification; do not claim production execution.
- **Rollback point:** Rollback new objects only before dependent records; otherwise use documented forward repair.
- **Security gate:** `SECURITY DEFINER` functions have empty search paths, explicit grants, fixed authorization inputs, and no public role assignment.
- **Commit boundaries:** Migration; SQL tests; rollback/verification/docs.
- **Codex reasoning:** Extra High.

## 5. Branch 3 - `feature/auth-backend-cookie-sessions`

**Objective:** Implement the Express Auth gateway without switching current frontend flows.

- **Exact scope:** Auth provider abstraction, Supabase server Auth client, secure cookie utilities, session registry, verified claims/user checks, CSRF, Origin/CORS, refresh rotation, logout/revocation, endpoint-specific rate limits, feature flags, safe errors, health/readiness, and redacted logging.
- **Likely files:** `backend/server/index.js`, `routes/auth.js` or new v1 routes, `middleware/auth.js`, new session/CSRF/origin/rate services, `services/supabaseClient.js`, schemas, env validation/example, backend tests.
- **Prohibited:** Frontend Auth switch, JSON admin removal, customer UI changes, catalog/order workflow migration, live service calls in tests.
- **Schema changes:** Consume Branch 2 only; no additional migration unless a reviewed defect requires a separate additive migration.
- **API changes:** Implement signup/signin/signout/session/refresh/recovery/verification primitives behind server-controlled provider selection.
- **Frontend changes:** None beyond optional test client fixtures.
- **Tests:** Cookie attributes, CSRF, exact CORS, claims, idle/absolute expiry, refresh concurrency, local/global logout, revocation, rate limits, outage/fail-closed behavior, log redaction, guest checkout with absent/malformed credentials.
- **Acceptance:** No token in JSON; production readiness rejects insecure providers/cookies/origins; existing frontend remains on explicitly configured prototype mode during development.
- **Manual verification:** Inspect browser cookies through devtools without displaying values; test two sessions and revocation in disposable environment.
- **Rollback point:** Keep provider flags on prototype outside production; revert backend before frontend switch.
- **Security gate:** No wildcard credentialed CORS, raw refresh database storage, provider dump, silent guest downgrade, or production fallback.
- **Commit boundaries:** Provider/config; cookies/session; CSRF/CORS; routes/rates/errors; tests/readiness.
- **Codex reasoning:** Extra High.

## 6. Branch 4 - `feature/customer-auth-pages`

**Objective:** Replace browser customer authentication with branded Supabase-backed flows.

- **Exact scope:** Standalone sign-in, signup, forgot/reset, verification, and session-expired pages; customer Auth context; API adapter; responsive branding; storage cleanup for customer Auth key after successful provider cutover.
- **Likely files:** `frontend/src/App.tsx`, `store/customerAuthStore.ts`, `components/account/AccountModal.tsx`, new Auth pages/components/services/types, assets already approved, frontend tests.
- **Prohibited:** Admin Auth switch, profile/address/order APIs, database migrations, checkout behavior changes, new production imagery without approval.
- **Schema changes:** None.
- **API changes:** Consume Branch 3 customer Auth endpoints.
- **Frontend changes:** Remove local password hashing/customer arrays; use `credentials: include`, CSRF, session restoration, safe errors, preserved in-memory drafts, Royal Fusion logo/perfume templates for mobile/tablet/desktop.
- **Tests:** Route guards, forms, enumeration-safe messages, verification/reset/expiry, no password/token storage, CSRF retry behavior, accessibility and responsive snapshots.
- **Acceptance:** No browser password/hash/access/refresh storage; customer can complete all approved Auth flows; guest storefront remains unaffected.
- **Manual verification:** New customer journey in disposable Auth; keyboard/mobile/desktop review; inspect storage names only.
- **Rollback point:** Non-production provider flag may return to prototype before production cutover; production never falls back automatically.
- **Security gate:** Admin login is no longer attempted from customer UI; redirects are relative/allowlisted; errors reveal no account existence.
- **Commit boundaries:** Context/API; page shell; signup/signin; recovery/verification/expiry; tests/accessibility.
- **Codex reasoning:** High.

## 7. Branch 5 - `feature/customer-profile-addresses`

**Objective:** Connect verified customer profiles, multiple addresses, and owned order history while preserving optional Auth at checkout.

- **Exact scope:** Express customer routes, user-scoped Supabase queries, profile/address/order-history UI, default-address transaction, optional checkout prefill.
- **Likely files:** New backend customer routes/services/middleware/tests; frontend customer pages/services/types; `CheckoutPage.tsx` only for optional prefill; affected RLS tests.
- **Prohibited:** Checkout database migration, order creation calculation changes, admin customer screens, guest-order linking, catalog changes.
- **Schema changes:** Use Branch 2. A defect requires a separately reviewed additive migration, never an ad hoc edit.
- **API changes:** Profile, addresses, own order list/detail.
- **Frontend changes:** Account pages, address selection/default UI, order history, opt-in checkout prefill that never overwrites entered data.
- **Tests:** Customer A/B ownership, protected profile fields, default address concurrency, order snapshots, pagination, authenticated/guest checkout regression and privacy fields.
- **Acceptance:** Customer sees only owned data; browser never supplies customer ID; guest checkout remains fully usable.
- **Manual verification:** Two fictional accounts and one guest flow; direct URL/API ownership attempts.
- **Rollback point:** Disable account data routes/UI while keeping Auth sessions valid; remove optional prefill without changing checkout.
- **Security gate:** RLS plus Express ownership, no admin/private/customer-B data, no profile email change outside Auth.
- **Commit boundaries:** Backend ownership APIs; frontend profile; addresses; order history/prefill; tests.
- **Codex reasoning:** High.

## 8. Branch 6 - `feature/admin-supabase-auth-rbac`

**Objective:** Replace JSON administrator authentication with Supabase identity and relational permission-key authorization.

- **Exact scope:** Release-only first-Owner command, Manager invitation lifecycle, administrator session endpoint, permission middleware, route enforcement, frontend admin Auth state, permission-aware navigation, audit writes, production fail-closed behavior.
- **Likely files:** Backend Auth/admin routes, middleware, role config removal/replacement, provisioning script, startup code, admin API/provider/login/users UI/types, tests, safe env examples/docs.
- **Prohibited:** Catalog/order handler migration, MFA implementation beyond `MFA_REQUIRED` gate hooks, real account import, public provisioning, direct frontend role mutation.
- **Schema changes:** Consume Branch 2 only.
- **API changes:** Admin session, invitations, session list/revoke; existing protected routes switch to exact permission keys.
- **Frontend changes:** Remove localStorage JWT and raw token types; use cookie session; Manager/Owner UI derives safe permission snapshot.
- **Tests:** Bootstrap once, final Owner, invitation match/expiry/revoke, exact role matrix, stale permission, session revocation, every admin route denial/allowance, audit events.
- **Acceptance:** No JSON admin login in production; no role-name-only authorization; Manager cannot access forbidden resources; no catalog/order business behavior changed.
- **Manual verification:** Provision disposable Owner, invite Manager, exercise allowed/denied routes in separate sessions.
- **Rollback point:** Before production cutover, non-production may explicitly use JSON provider; after cutover keep Supabase identities and roll application release only.
- **Security gate:** No setup key/public Owner assignment, no final-Owner removal, no browser bearer token, no role from user metadata.
- **Commit boundaries:** Permission middleware; provisioning; invitations; frontend session switch; route conversion; tests/audit/readiness.
- **Codex reasoning:** Extra High.

## 9. Branch 7 - `feature/admin-mfa`

**Objective:** Require TOTP MFA for every Owner and Manager before dashboard access.

- **Exact scope:** Enrollment, challenge, verification, AAL2 middleware, recent-auth checks, controlled factor recovery, session rotation, UI, and production enforcement.
- **Likely files:** Backend MFA routes/services/middleware/tests; admin Auth provider/pages/components; readiness validation/docs.
- **Prohibited:** Customer MFA requirement, public bypass/recovery, role changes, unrelated admin features.
- **Schema changes:** Use application-session/audit fields from Branch 2; any missing object requires reviewed additive migration.
- **API changes:** MFA status/enroll/challenge/verify and controlled recovery administration.
- **Frontend changes:** Mandatory enrollment/challenge screens, TOTP entry, safe factor status, session-expired/recovery instructions.
- **Tests:** AAL1 denial, enrollment, valid/invalid/replayed challenges, rate limits, AAL2 session rotation, recent-auth sensitive actions, Manager/Owner enforcement, client bypass attempt, recovery controls.
- **Acceptance:** No administrator reaches business admin APIs below AAL2; production readiness rejects disabled MFA.
- **Manual verification:** Two Auth factors in disposable environment; lost-device Manager and sole-Owner recovery tabletop.
- **Rollback point:** Feature may remain unenforced only in non-production; production rollback cannot disable MFA to restore access.
- **Security gate:** No TOTP secret/recovery material in logs/database/client persistence; no public factor reset.
- **Commit boundaries:** Backend assurance; enrollment/challenge; frontend flows; recovery/recent-auth; tests/readiness.
- **Codex reasoning:** Extra High.

## 10. Branch 8 - `feature/guest-order-linking`

**Objective:** Allow a verified account to claim an eligible guest order with one-time proof.

- **Exact scope:** Claim-token generation boundary, strong hash storage, confirmation delivery event, claim API/UI, expiry/replay/concurrency, ownership/history/audit transaction, manual Owner-reviewed recovery procedure.
- **Likely files:** Backend order-claim service/route/tests; order confirmation event/template boundary; customer claim page/service; SQL tests. Existing order creation is touched only at the claim-token/outbox boundary.
- **Prohibited:** Checkout price/stock/shipping/coupon logic, order dashboard migration, email provider redesign, auto-link by email.
- **Schema changes:** Consume Branch 2 claim objects.
- **API changes:** Customer claim endpoint and safe support request path.
- **Frontend changes:** Claim landing/form and account order refresh.
- **Tests:** Seven-day expiry, hash-only storage, contact mismatch, unverified account, replay, simultaneous claims, already-owned order, audit/history rollback and email failure boundary.
- **Acceptance:** Exactly one verified claim can link; no order data leaks on failure; checkout success is independent of claim delivery.
- **Manual verification:** Fictional guest order/verified account in disposable staging; replay and support-review walkthrough.
- **Rollback point:** Disable `ENABLE_GUEST_ORDER_LINKING`; existing orders/claims remain safe and guest checkout continues.
- **Security gate:** No plaintext claim database/log, URL analytics leakage, email-only link, or automatic support transfer.
- **Commit boundaries:** Token/service; API transaction; delivery boundary; UI; tests/support docs.
- **Codex reasoning:** Extra High.

## 11. Branch 9 - `chore/auth-cutover-hardening`

**Objective:** Remove prototype Auth paths and enforce production configuration.

- **Exact scope:** Versioned browser Auth-storage cleanup, delete obsolete customer hash/store code, remove admin bearer storage, disable JSON Auth/startup provisioning in production, exact CORS/cookies/proxy readiness, secret/log scans, release/rollback runbook and final regressions.
- **Likely files:** Frontend Auth/admin services/stores/types, backend prototype Auth routes/config/startup scripts, env validation/examples, deployment/CI docs/tests.
- **Prohibited:** Importing prototype accounts, deleting live JSON data, catalog/order migration, weakening MFA/RLS/session checks.
- **Schema changes:** None unless a reviewed forward-only cleanup migration later retires legacy authority after verification.
- **API changes:** Prototype endpoints become unavailable in production; v1 Supabase contracts remain.
- **Frontend changes:** Remove obsolete storage keys only; preserve cart, wishlist, and non-auth preferences.
- **Tests:** Production config matrix, no fallback under outage, no browser Auth secrets, exact CORS, secure cookies, MFA mandatory, guest checkout, Owner/Manager matrix, recovery/rollback, dependency/secret scans.
- **Acceptance:** Production cannot start with prototype providers, disabled MFA, insecure cookies, or wildcard origins; no obsolete Auth storage remains.
- **Manual verification:** Staging cutover rehearsal, two-browser session/revocation, production-like domain cookies, guest checkout, rollback tabletop.
- **Rollback point:** Roll application deployment while preserving Supabase identities/data; never restore insecure production Auth.
- **Security gate:** Full security review with no unresolved Critical/High findings and signed release checklist.
- **Commit boundaries:** Frontend cleanup; backend prototype shutdown; readiness/deployment; final tests/runbook.
- **Codex reasoning:** Extra High.

## 12. Required Merge Order

```text
Phase 2B docs merged to main
  -> test/auth-contract-foundation
  -> feature/auth-schema-hardening
  -> feature/auth-backend-cookie-sessions
  -> feature/customer-auth-pages
  -> feature/customer-profile-addresses
  -> feature/admin-supabase-auth-rbac
  -> feature/admin-mfa
  -> feature/guest-order-linking
  -> chore/auth-cutover-hardening
```

Do not create the next branch until the previous branch is validated, reviewed, pushed, and merged into `main`.
