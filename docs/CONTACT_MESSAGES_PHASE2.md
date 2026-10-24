# Phase 2 contact messages

Local implementation awaiting independent review. This document does not authorize deployment or database work.

## Existing schema and access

`001_initial_schema.sql` defines `public.contact_messages`: UUID `id` primary key with generated default; required name, email, phone (default empty), subject, message, status (default Unread), and created_at (default now). There is no updated_at or durable idempotency column. No schema changes are required or included.

`002_launch_schema_foundation.sql` removes the old public insert policy, enables permission-based authenticated administrative access (`contact_messages.manage`), revokes browser INSERT/UPDATE/DELETE, and grants service_role table access. The API uses the existing server auth runtime's service client. It never exposes that credential to the browser. Later migrations are left untouched. Repository schema inspection does not certify live production state.

## HTTP contract

- `POST /api/v1/public/contact`: strict name (2–80), email (up to 254), optional phone (up to 32, digits/phone punctuation), message (10–4000). Unknown fields, HTML and control characters are rejected. The server sets subject Website inquiry and status Unread. Maximum JSON request is 16 KiB, measured by the body parser before shared sanitization. Accepted requests return 201 with only a confirmation message and request ID.
- `GET /api/v1/admin/contact-messages`: page starts at 1 (maximum 100000), pageSize 1–50 (default 20), optional Read/Unread status. Stable ordering by created_at DESC, id DESC. Summaries omit message bodies.
- `GET /api/v1/admin/contact-messages/:id`: approved message fields only.
- `PATCH /api/v1/admin/contact-messages/:id/status`: strict Read/Unread status only, maximum 1 KiB JSON. Same-status retries do not create another audit entry. No editing content, deletion, export or bulk endpoint.

Contact routers mount before the shared parser/sanitizer. Public mutations require an allowed Origin and are limited to five attempts/hour/IP, plus five validated submissions/hour/normalized email signal. Email limiter keys are SHA-256 digests; neither raw input nor database exception text is logged. CORS uses the existing application allowlist. The limiter uses the existing in-process store: multiple instances/restarts require a reviewed shared rate-limit store for a globally coordinated limit.

Administrative requests restore existing HttpOnly-cookie sessions and verify administrator class and contact_messages.manage (or canonical *). Status changes additionally require allowed Origin and session-bound CSRF. Private responses, including auth failures, use no-store. Audit metadata contains only status; audit failures follow the existing best-effort pattern and log only event/request ID. Contact details render as React text, never HTML.

The production legacy `/api/public/contact` endpoint returns 410 before JSON storage access. Existing legacy checkout/coupon production denials are preserved. Prototype behavior remains isolated to non-production.

## Frontend and retry limits

The public form retains its design and required fields, applies matching length limits, announces success/error, disables inputs while sending, and guards duplicate submit events. Failure retains the form. It makes one request and performs no automatic retry. The inbox replaces only Contact Messages' pending module and offers pagination, status filter, details and Read/Unread changes. Permission errors hide private content; expired sessions refresh identity and return to the existing login flow.

Durable deduplication after an ambiguous lost response is unsupported by the existing schema. A manual retry after an accepted response was lost may create a second inquiry. No deduplication table, ID convention or schema mutation is introduced. Operator reconciliation remains manual; message deletion is outside scope.

## Local verification

`npm --prefix backend run test:contact` uses disposable in-memory PostgreSQL (PGlite) with contact and audit table DDL copied from the committed schema, including audit defaults, required fields, primary key and actor foreign key. Only the audit column additions from 002 are copied; no migration is applied. A minimal local auth.users fixture supplies the referenced actor. It connects to no external database. The adapter exercises actual SQL inserts, bounded selects and status updates; session/authorization boundaries are injected test doubles. Existing cookie-session and authorization suites cover the shared auth implementation.

`npm --prefix frontend run test:contact` verifies both clients. `npm --prefix frontend run test:contact:browser` uses the existing Vite/Playwright harness, intercepts every external request, and independently detects legacy contact/admin calls. Run Phase 1 browser regressions, the frontend regression suite, lint and build as well.

Production SQL, migration application, ordering enablement and deployment are outside this phase. Belmo remains stopped. Protected checkoutIntegration and root vercel.json state and frontend rewrites must remain exact.

## Verification result (2026-10-10)

Checkpoint: phase2-canonical-variants, baa5673bef984932bcdf3d038ec4e5ab81fd3644. Development handoff file was not found; existing API/auth documentation and committed schema were inspected instead.

| Check | Final result |
| --- | --- |
| Contact PostgreSQL/API tests | 12 passed, 0 failed |
| Shared backend security/API regressions | 116 passed, 0 failed |
| Frontend regression suite, including contact clients | 122 passed, 0 failed |
| Combined Phase 1 and contact browsers | 22 passed (15 Phase 1, 7 contact), 0 failed |
| Frontend lint | Passed, no warnings |
| Frontend production build | Passed; chunk-size advisory remains |
| Git diff whitespace check | Passed |

Backend regressions covered auth contracts, cookie sessions, guest checkout, categories, collections, media, reviews, newsletter, settings and orders V1. Migration suites were not executed.

Initial contact tests passed 10/10 before two additional abuse/audit tests were added. Initial browser run passed 4/7: three new retention checks timed out on an exact textarea label locator. The expected failure feedback and retained name had already passed. Diagnostic DOM output proved the label text became `MessagePlease help me choose a fragrance.` after React retained the textarea value. The test now targets the form textarea and retains the exact value assertion. A parallel rerun then reported seven hook failures because Chromium/Chrome could not launch; no test assertions ran. The isolated rerun passed 7/7, and final combined browser verification passed 22/22. Initial client tests passed 2/2 with a Vite dependency-scan shutdown warning; disabling automatic discovery in the test server removed that warning. Initial lint reported one unused fixture destructuring variable, corrected before the clean final run.

No critical security checks failed. Protected checkoutIntegration SHA-256 remains 87dc83af5c5d5d182870a7bea0a7f45b86282c75c2555687d69c6286e18882ac; frontend/vercel.json remains 59f90930c70f98d5925bbecd8aa6847c4a6fc45d241a0d048121b7765d82d4de; root vercel.json remains absent. No Supabase migration or release migration changed. Index empty; no stage, commit, push, deployment, production access or ordering enablement occurred.

Phase 2 is ready for independent review. Deployment and any production verification require a separate authorized step.

## Independent-review corrections

The canonical permission is `contact_messages.manage`, seeded by committed Migration 002 and used by its contact policy. Both Contact Messages entries in adminConfig now use it directly, matching the inbox and backend router. AdminAuthProvider's existing `contactMessages:manage` alias already resolved UI checks to the canonical key; it remains for compatibility. No permission assignments, wildcard grants, resolver rules or other modules changed.

Focused browser coverage supplies an already-authorized administrator session with only `contact_messages.manage`, verifies that Contact Messages is the sole sidebar navigation entry, follows the link and reads the inbox/detail. A session with unrelated permission cannot see the link or issue contact requests from the direct route. Backend route tests accept the canonical key and reject the legacy spelling as an actual grant.

These are capability-boundary tests with injected authorized identities. The approved production AdminAuthorizationService still requires the existing active canonical admin assignment and its existing `*` bundle. It does not issue restricted administrator sessions containing only this permission. This work does not introduce restricted roles or broaden the approved authentication model.

### Audit insert compatibility evidence

Committed `001_initial_schema.sql` defines the audit table; committed `002_launch_schema_foundation.sql` adds permission_key and request_id. Inspection of later migrations/release migrations found no conflicting audit column alteration. Migration 003's immutable trigger, retained by Release 001, fires only before UPDATE/DELETE and does not block INSERT.

| Column | Committed type/constraint/default | Contact status insert |
| --- | --- | --- |
| id | UUID primary key, generated default | Omitted; database generates it |
| admin_id | Nullable UUID FK to auth.users(id), ON DELETE SET NULL | Existing authenticated actor UUID |
| action | TEXT NOT NULL | contact.status |
| resource | TEXT NOT NULL | contact_messages |
| resource_id | TEXT NOT NULL, default empty | Contact UUID represented as text |
| metadata | JSONB NOT NULL, default empty object | Object containing only Read/Unread status |
| created_at | TIMESTAMPTZ NOT NULL, default now() | Omitted; database generates it |
| permission_key | TEXT NOT NULL, default empty | contact_messages.manage |
| request_id | TEXT NOT NULL, default empty | Request-context ID |

The application insert is compatible; ContactV1Service is unchanged. The stronger fixture now copies the actual DDL and column additions rather than a permissive audit stub. Tests require persisted audit rows, generated values and no fallback warning for valid transitions. They also prove rejection of duplicate primary keys, missing actors and NULL required fields. No SQL file or database access policy changed. The existing best-effort audit operational behavior remains unchanged; these schema tests do not claim atomic status/audit writes.

### Correction-pass verification

All checks passed on their first run in this correction pass: contact PostgreSQL/API 14/14; contact client/config contracts 3/3; shared auth contracts/cookie sessions 41/41; full frontend regressions 123/123 (including those three contact contracts); combined browsers 24/24 (15 Phase 1, 9 contact). No failed, skipped or cancelled tests. Lint clean; production build passed with the existing chunk-size advisory; git diff --check clean.

Only six files changed in this correction pass: frontend/src/admin/adminConfig.ts; frontend/tests/contactBrowser.test.mjs; frontend/tests/contactIntegration.test.mjs; backend/server/tests/contact-v1.test.js; backend/server/tests/support/contactDatabase.js; this document. Existing Phase 2 changes remain present. AdminAuthProvider, AdminContactMessagesPage, ContactV1Service, the contact router and all SQL files were inspected and retained.

HEAD remains baa5673bef984932bcdf3d038ec4e5ab81fd3644 on phase2-canonical-variants; index empty. Both protected file hashes match the values recorded above; root vercel.json remains deleted. No production connection, migrations, staging, commit, push, deployment, Belmo startup, ordering enablement or Phase 3 work occurred. Stop here for independent review.
