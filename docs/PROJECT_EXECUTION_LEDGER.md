# Royal Fusion Project Execution Ledger

This ledger records reviewed implementation branches and release evidence. A merged
database migration is not considered deployed until its separate manual migration gate
has been completed against the intended environment.

## Phase 2, Branch 2: Authentication Schema And RLS Hardening

| Field | Record |
|---|---|
| Branch | `feature/auth-schema-hardening` |
| Objective | Add the database foundation for Supabase identities, canonical RBAC, backend-managed sessions, invitations, guest-order claims, customer ownership RLS, and final-Owner protection without changing application authentication. |
| Starting commit | `7410beab031c4ef803c0f3257d1c21949baf5c24` |
| Migration | `backend/supabase/migrations/003_auth_schema_hardening.sql` |
| Rollback | `backend/supabase/rollback/003_auth_schema_hardening_rollback.sql` |
| Runtime verification | `backend/supabase/tests/005_auth_schema_hardening_verification.sql` |
| Static verification | `backend/server/scripts/check-auth-schema-sql.mjs` |
| Feature commit | `1efd7892cbbf88dc1002aca21dfbe87f9732c204` |
| Merge commit | `18d9defc232d581f2f2983cabfc80e3a9a4572eb` |
| Completion status | Merged to `main`; application behavior unchanged |
| Next branch | `feature/auth-backend-cookie-sessions` |

### Validation Performed

- Authentication contract and guest-checkout regression tests: 15 passed.
- Backend syntax validation: passed.
- Isolated fictional JSON smoke test: passed.
- Authentication schema static checks: passed.
- Frontend lint, TypeScript validation, and production build: passed.
- Secret, runtime network-boundary, real-data-path, changed-scope, and whitespace scans: passed.
- Post-merge authentication, checkout, and SQL-static tests: passed.
- Runtime PostgreSQL verification: **NOT RUN** because Docker, PostgreSQL, and Supabase CLI
  were not installed locally.
- No remote database was contacted and no migration was applied remotely.

### Manual Migration Gate

Before enabling Supabase authentication in any deployed environment:

1. Use a disposable local Supabase instance or explicitly approved staging project.
2. Apply migrations `001`, `002`, and `003` in order.
3. Reapply migration `003` to verify deterministic reseeding.
4. Apply the fictional starter seed.
5. Run `002_foundation_verification.sql` and
   `005_auth_schema_hardening_verification.sql`.
6. Run the two checkout concurrency verification sessions.
7. Review every failure before applying migration `003` to production.
8. Never run the guarded rollback after lifecycle or audit data exists; use a forward-fix
   migration instead.

### Warnings

- `npm audit --omit=dev` reports three pre-existing high-severity findings in PostCSS
  and React Router dependencies. This branch changed no dependency version or lockfile.
- The frontend build retains the pre-existing approximately 625 kB Vite chunk warning.
- Failed protected database operations and explicit global-logout summary events require
  backend audit handling in later authentication branches.

## Phase 2, Branch 3: Backend Authentication Cookie Sessions

| Field | Record |
|---|---|
| Branch | `feature/auth-backend-cookie-sessions` |
| Objective | Add the backend Supabase Auth gateway, server-controlled provider configuration, secure cookie sessions, PKCE callbacks, CSRF/Origin protection, refresh rotation, revocation, and rate limits without switching the frontend or JSON commerce workflows. |
| Starting commit | `39b779d949f8ba9b94281767e3a48cd6d6544de6` |
| Migration | `backend/supabase/migrations/004_auth_session_refresh_lease.sql` |
| Rollback | `backend/supabase/rollback/004_auth_session_refresh_lease_rollback.sql` |
| Runtime verification | `backend/supabase/tests/006_auth_session_refresh_lease_verification.sql` |
| Static verification | `backend/server/scripts/check-auth-session-sql.mjs` |
| Feature commit | `4589d09dc48546cfe5df8ec294946e646353774e` |
| Merge commit | `089b4db9930464ddeae921bc350a9623b9e199c9` |
| Completion status | Merged to `main`; frontend Auth and JSON commerce workflows unchanged |
| Next branch | `feature/customer-auth-pages` |

### Validation Performed

- Combined backend authentication and guest-checkout regression suite: 39 passed.
- Cookie, PKCE callback, CSRF, exact Origin/CORS, refresh, timeout, revocation,
  recent-auth, provider-failure, rate-limit, and redaction tests: passed.
- Authentication schema and session SQL static checks: passed.
- Backend syntax and fabricated production-configuration validation: passed.
- Frontend lint, standalone TypeScript validation, and production build: passed.
- Secret-signature, environment, response-exposure, external-network, real-data-path,
  changed-scope, lockfile, and whitespace scans: passed.
- Post-merge backend, checkout, schema-static, and session-static tests: passed.
- Runtime PostgreSQL verification: **NOT RUN** because Docker, PostgreSQL, and Supabase CLI
  were not installed locally.
- No remote database, Supabase Auth tenant, email provider, media provider, or real data was contacted.

### Manual Migration Gate

Before enabling the Supabase authentication providers in an approved environment:

1. Complete the Branch 2 migration gate and confirm migration `003` is present.
2. Apply `004_auth_session_refresh_lease.sql` in a disposable local Supabase instance or
   explicitly approved staging project.
3. Reapply migration `004` to verify repeat safety.
4. Run `005_auth_schema_hardening_verification.sql` and
   `006_auth_session_refresh_lease_verification.sql`.
5. Verify one concurrent refresh lease succeeds while a second is denied, browser roles
   cannot execute lease functions, and heartbeat updates do not create audit noise.
6. Configure protected backend Auth values in the deployment secret manager; never put
   the Supabase secret key, PKCE verifier, refresh token, or CSRF signing secret in Vite.
7. Do not run rollback `004` after any application session exists; use a forward-fix migration.

### Warnings

- `npm audit --omit=dev` still reports three pre-existing high-severity findings in PostCSS
  and React Router dependencies. This branch changed no dependency version or lockfile.
- The frontend build retains the pre-existing approximately 625 kB Vite chunk warning.
- Frontend customer pages still use the prototype store until
  `feature/customer-auth-pages`; no production Auth cutover has occurred.
- Administrator Supabase Auth, RBAC cutover, MFA, Manager invitations, and first-Owner
  provisioning remain assigned to later approved branches.
