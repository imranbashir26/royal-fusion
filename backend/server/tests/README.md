# Authentication Contract Foundation Tests

Run from the repository root:

```bash
npm run test:auth-foundation
```

Focused commands:

```bash
npm run test:auth
npm run test:guest-checkout
```

The suite uses Node's built-in test runner and requires no additional package. It does not require real environment keys. The guest-checkout regression starts the current Express API on loopback with a temporary fictional JSON database, a deliberately missing dotenv path, and `USE_SUPABASE=false`; it removes the temporary directory afterward. No external Supabase, Resend, Cloudinary, Sanity, production database, upload directory, or customer data is accessed.

These tests define future authentication contracts only. They do not activate cookie authentication, CSRF middleware, Supabase Auth, permission middleware, MFA, invitations, or guest-order linking. Those behaviors remain assigned to the later branches listed in `docs/AUTHENTICATION_BRANCH_ROADMAP.md`. Current production authentication and checkout routes are unchanged.
