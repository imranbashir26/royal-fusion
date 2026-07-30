# Authentication Contract Foundation Tests

Run from the repository root:

```bash
npm run test:auth-foundation
```

Focused commands:

```bash
npm run test:auth
npm run test:auth-sessions
npm run test:guest-checkout
npm run test:sql-auth-sessions
```

The suite uses Node's built-in test runner and requires no additional package. It does not require real environment keys. The guest-checkout regression starts the current Express API on loopback with a temporary fictional JSON database, a deliberately missing dotenv path, and `USE_SUPABASE=false`; it removes the temporary directory afterward. No external Supabase, Resend, Cloudinary, Sanity, production database, upload directory, or customer data is accessed.

The backend session suite uses an in-memory Auth gateway and session repository. It covers the new `/api/v1/auth` foundation, signed PKCE callback state, HttpOnly cookies, session-bound CSRF, exact Origin checks, refresh rotation, expiry, revocation, generic errors, and endpoint-specific rate limits without contacting Supabase. The frontend is not connected to these routes yet. Existing browser/localStorage customer Auth, JSON checkout, cart selection, catalog, and order behavior remain unchanged.

`npm run test:sql-auth-sessions` performs dependency-free static checks for migration `004`. It does not execute PostgreSQL. Run `backend/supabase/tests/006_auth_session_refresh_lease_verification.sql` only after migrations `001` through `004` in a disposable local or staging database.
