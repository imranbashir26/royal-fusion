# Royal Fusion Authentication Implementation Plan

Status: Phase 2B implementation specification

## 1. Current State

Royal Fusion currently has two prototype identity systems:

- Customer accounts, customer records, deterministic password hashes, and the active profile are persisted in browser localStorage by `customerAuthStore.ts`.
- Administrator accounts and bcrypt hashes are stored in the local JSON database. Express issues an eight-hour custom JWT that the browser stores in localStorage.
- The public account modal attempts administrator login before customer login for email-shaped identifiers.
- Admin logout removes only the browser token; it does not revoke the signed JWT.
- Guest checkout is independent of both systems and must remain so.
- Supabase Auth profile, address, role, permission, and RLS foundations exist but are not connected to application authentication.

Prototype authentication may remain deliberately selectable during development. It is forbidden as an automatic or production fallback.

## 2. Target Architecture

```text
React SPA on Vercel
  -> credentials-included HTTPS requests
Express authentication gateway on Belmo
  -> Supabase Auth for identity, password, email verification, recovery, and TOTP
  -> application_sessions for timeout/revocation state
  -> relational roles/permissions for administrative authorization
  -> user-scoped Supabase client for RLS-protected customer reads
  -> backend secret client only after privileged authorization
Supabase PostgreSQL
  -> profiles, addresses, ownership, RBAC, invitations, claims, audit, and RLS
```

Owner, Manager, and customer identities use the same Supabase Auth tenant. Customers have no administrative role. An authenticated identity becomes an administrator only through an active relational role assignment.

## 3. Trust Boundaries

### Browser

- May hold non-sensitive UI state, CSRF token, profile display data, and permission snapshots for presentation.
- Must not read access tokens, refresh tokens, password hashes, backend secrets, or authoritative role assignments.
- Must not supply `customer_id`, role, permission, session lifetime, MFA bypass, or provider selection.
- Frontend guards and navigation filtering are usability controls only.

### Express

- Owns Auth exchanges, cookies, refresh, logout, session revocation, CSRF, Origin checks, rate limits, and safe error translation.
- Verifies Supabase identity and derives the user ID from verified claims.
- Resolves administrative permissions from PostgreSQL on every protected request.
- Creates user-scoped Supabase clients for RLS-protected work and uses the secret client only for authorized privileged operations.
- Never logs passwords, cookies, tokens, recovery codes, MFA secrets, provider payloads, or credentials.

### Supabase Auth

- Owns password hashing, verified email identity, password recovery, access/refresh tokens, and TOTP factors.
- Does not own Royal Fusion business permissions.
- User-editable metadata is never an authorization source.

### PostgreSQL and RLS

- Own profiles, addresses, order ownership, roles, permissions, invitations, application session state, claims, and audit records.
- RLS independently limits user-scoped reads and writes.
- Service-role bypass never substitutes for Express authorization.

## 4. Configurable Session Policy

Canonical launch defaults:

| Identity | Idle timeout | Absolute lifetime |
|---|---:|---:|
| Customer | 7 days | 30 days |
| Owner or Manager | 30 minutes | 8 hours |

Canonical link expiry:

| Link | Expiry |
|---|---:|
| Email verification | 24 hours |
| Password reset | 1 hour |
| Manager invitation | 48 hours |
| Guest-order claim | 7 days |

Values are read once from validated backend configuration and exposed only as safe behavior, not secret configuration. Shared constants are injected into session/link services; routes and components must not duplicate numeric literals. Production validation rejects non-positive values, administrator lifetime longer than customer lifetime, idle timeout longer than absolute lifetime, and link expiries outside approved operational bounds.

## 5. Cookie Policy

The authentication gateway sets four cookies scoped to the API host:

| Cookie | JavaScript access | Purpose |
|---|---|---|
| `__Host-rf-at` | HttpOnly | Short-lived Supabase access token |
| `__Host-rf-rt` | HttpOnly | Rotating Supabase refresh token |
| `__Host-rf-sid` | HttpOnly | Random application session handle |
| `__Host-rf-csrf` | Readable | Random CSRF value only; never an authentication credential |

Production attributes: `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`, and no value in URLs. Access expiry follows the Supabase JWT. Refresh/session cookies are capped by the role-specific absolute lifetime. Logout clears all four with identical attributes.

The `__Host-` names always require `Secure`, including local testing over trusted HTTPS. A loopback HTTP setup must use explicit development-only unprefixed names selected by validated server configuration; it must never emit an invalid `__Host-` cookie or reuse development names in production. Production startup fails when secure-cookie requirements, HTTPS proxy trust, or exact allowed origins are not configured.

Raw tokens are never stored in `application_sessions`. The table stores a hash of the random session handle, Supabase user/session identifiers, role class, creation/last-seen/expiry/revocation data, and safe device metadata.

## 6. CSRF Architecture

- All state-changing cookie-authenticated requests require an allowed `Origin` and `X-RF-CSRF` header.
- The header value must equal the readable CSRF cookie and match the server-side session-bound hash using constant-time comparison.
- Login, signup, recovery initiation, invitation acceptance, MFA challenge, and refresh receive endpoint-specific anti-abuse handling. Login/signup may bootstrap a pre-auth CSRF cookie but still require an allowed Origin.
- Safe GET/HEAD/OPTIONS routes do not mutate state.
- Missing/mismatched CSRF returns `CSRF_INVALID` without disclosing session details.
- Webhooks use provider signatures, not browser CSRF.

## 7. CORS Architecture

- `Access-Control-Allow-Origin` echoes only an exact configured frontend origin.
- `Access-Control-Allow-Credentials: true` is enabled for approved origins.
- Wildcard origins are forbidden with credentials.
- Production does not automatically allow localhost.
- Allowed methods and headers are explicit; `X-RF-CSRF` is allowed.
- Preflight does not authenticate or disclose account state.
- Origin verification is repeated by mutation middleware because CORS alone is not authorization.

## 8. Identity Verification

For each authenticated request:

1. Read the HTTP-only cookies.
2. Find the hashed application session and reject revoked/expired sessions.
3. Verify JWT signature, issuer, audience, expiry, subject, and required claims using current Supabase verification behavior.
4. Use an Auth-server user lookup when current email verification, factor, or account state is security-sensitive.
5. Confirm `sub` matches the application session user.
6. Apply idle/absolute timeout and MFA assurance requirements.
7. Resolve relational permissions or customer ownership.

`getSession()` output, frontend profile state, Auth user metadata, and JWT role-like custom fields are not authorization evidence.

## 9. Refresh and Rotation

- Refresh is initiated explicitly by `POST /auth/refresh` or internally before a protected response when the access token is near expiry.
- Express locks the application session row during rotation to avoid simultaneous one-time refresh token use.
- The backend exchanges the HTTP-only refresh token with Supabase Auth and replaces both token cookies atomically in one response.
- Session ID and CSRF values rotate after sign-in, privilege elevation, password reset, and MFA completion.
- Failed refresh revokes the application session, clears cookies, and returns `SESSION_EXPIRED` or `SESSION_REVOKED`.
- The frontend performs one refresh attempt for eligible requests and never loops.

## 10. Logout and Revocation

- `signout` revokes the current Supabase refresh session, marks the application session revoked, and clears cookies.
- `signout-all` revokes every refresh session and application session for the identity.
- Owner may revoke a selected administrator session through an Owner-only endpoint.
- Administrator middleware checks the application session on every request, so database revocation is immediate even while a short-lived access JWT remains cryptographically valid.
- Permission removal is effective on the next request because permissions are not trusted from the token.

## 11. Customer Lifecycle

1. Customer signs up with email and password.
2. Backend returns an enumeration-safe response and Supabase sends verification.
3. Verification callback validates the provider code and creates the secure session.
4. Auth trigger creates a profile; customer completes profile and addresses later.
5. Customer signs in, restores session, updates profile/addresses, and reads owned orders.
6. Recovery uses a one-hour link and limited recovery context.
7. Password reset revokes prior sessions and requires a new sign-in.
8. Account suspension blocks new sessions without deleting order history.

Phone remains a profile/contact field. Phone OTP is post-launch.

## 12. Owner Lifecycle

- No public Owner signup, public setup key, hardcoded password, or role assignment from metadata.
- A release-only backend command accepts an existing verified Supabase user ID, never a password.
- A transaction locks the Owner role, proves that no active Owner exists, assigns the role, and writes an immutable bootstrap audit event.
- Bootstrap permanently refuses once an active Owner exists.
- Role mutation logic prevents removal or deactivation of the final active Owner.
- Owner must complete TOTP enrollment and reach AAL2 before accessing administration.

## 13. Manager Invitation Lifecycle

1. Owner submits a normalized email through an Owner-only action.
2. Backend creates a 48-hour pending invitation and invokes the server-side Supabase invitation operation.
3. Invitation stores intended Manager role, inviter, expiry, status, accepted user ID, and timestamps.
4. Recipient accepts through the Auth flow and verifies email.
5. Backend locks the invitation, confirms email and identity match, and assigns Manager transactionally.
6. Manager enrolls TOTP before dashboard access.
7. Invite, resend, revoke, acceptance, role assignment, and MFA completion are audited.

Expired or revoked invitations never assign permissions. Resend rotates invitation state rather than extending an old token silently.

## 14. Administrator MFA

- TOTP is mandatory for Owner and Manager before production launch.
- AAL1 administrator sessions may access only enrollment, challenge, verification, signout, and safe session identity endpoints.
- Enrollment returns a provider QR/secret only on the protected enrollment screen and never logs or persists it in application tables.
- After TOTP verification, Express rotates session and CSRF identifiers and requires AAL2 on every admin endpoint.
- Sensitive actions also require recent authentication within 15 minutes.
- Client flags cannot bypass assurance checks.
- Manager factor recovery requires Owner approval and controlled factor reset. Sole-Owner recovery uses a documented release-operator procedure with identity verification and immutable audit evidence; there is no public recovery endpoint.

## 15. Guest Checkout Preservation

- Missing authentication is valid for order creation.
- A valid customer session allows Express to derive `customer_id`.
- Browser requests never contain `customer_id`.
- Malformed, expired, revoked, or inconsistent credentials are rejected rather than downgraded to guest.
- Initial Auth branches do not alter cart selection, products, prices, shipping, coupons, JSON persistence, or current checkout calculations.
- Customer Auth outages do not disable unauthenticated guest checkout.

## 16. Guest-Order Linking

- Generate a cryptographically random one-time token at eligible guest order creation.
- Store only a strong token hash with order, contact binding, seven-day expiry, and use state.
- Deliver the token after the order transaction through the confirmation boundary.
- Linking requires a verified authenticated customer, valid unused token, contact proof, and unowned order.
- Lock order and claim rows; assign ownership, consume claim, and append order/audit history atomically.
- Order number, localStorage, email equality, or device identity alone never proves ownership.
- Support-assisted recovery requires manual Owner review and a separately audited operation; it never auto-transfers ownership.

## 17. Failure Behavior

- Supabase Auth unavailable: return `AUTH_SERVICE_UNAVAILABLE`; do not expose provider errors.
- Customer Auth unavailable: guest checkout stays available; account features show a retryable service message.
- Admin Auth unavailable: admin remains unavailable; storefront and guest checkout continue.
- Session database unavailable: fail authenticated requests closed.
- Email delivery failure: retain safe pending state and expose resend only within configured limits.
- MFA service/factor failure: deny administrator access without bypass.
- Invalid feature configuration in production: process readiness fails and deployment must not receive traffic.

## 18. Rollback Behavior

- Development may intentionally select `prototype` providers.
- Production validation requires both providers to equal `supabase` and MFA to be enabled.
- There is no runtime fallback after an Auth error.
- Before cutover, a branch may be rolled back while prototype mode remains explicitly configured in non-production.
- After production cutover, rollback restores the previous compatible release while retaining Supabase identities, sessions, roles, and audit data. It never restores localStorage passwords or JSON administrator login.
- Schema changes are additive and include tested rollback SQL only while no post-migration records depend on them; otherwise use forward repair.

## 19. Feature Flags

Server-controlled configuration:

- `CUSTOMER_AUTH_PROVIDER=prototype|supabase`
- `ADMIN_AUTH_PROVIDER=prototype|supabase`
- `ENABLE_GUEST_ORDER_LINKING=false|true`
- `ENABLE_ADMIN_MFA=false|true`

`USE_SUPABASE` remains connectivity-only. Frontend learns safe capabilities from a backend session/config response; it cannot choose providers or MFA enforcement.

Production validation rejects prototype providers, disabled administrator MFA, insecure cookies, wildcard/missing origins, and absent required Supabase server configuration.

## 20. Cutover Process

1. Pass schema/RLS, backend, frontend, MFA, guest checkout, and security gates in staging.
2. Provision Owner and invite Managers through approved workflows.
3. Confirm all administrators have TOTP and tested recovery responsibilities.
4. Set production providers to Supabase and MFA enabled.
5. Deploy backend before frontend with backward-compatible endpoints.
6. Deploy frontend and verify secure cookies/session restoration.
7. Remove `royal-fusion-customer-auth` and `royal-fusion-admin-token` from browser storage through a one-time versioned cleanup that preserves cart, wishlist, and visual preferences.
8. Disable JSON admin routes, startup provisioning, and customer prototype Auth in production.
9. Run production smoke tests and monitor Auth, CSRF, rate-limit, and invitation failures without logging credentials.

Prototype browser or JSON accounts are not imported automatically.

## 21. Production Readiness Rules

Production is not ready unless:

- Both Auth providers are Supabase and administrator MFA is enabled.
- Access/refresh tokens are absent from browser-readable storage.
- Exact CORS, Origin, CSRF, secure-cookie, proxy trust, and HTTPS checks pass.
- Owner/Manager permission and RLS matrices pass.
- First-Owner bootstrap is closed after provisioning and final-Owner protection passes.
- Guest checkout succeeds without cookies and rejects malformed supplied authentication.
- Session expiry/revocation, invitation expiry, MFA, and order-claim replay tests pass.
- No secrets or provider error payloads appear in responses, logs, bundles, or tracked files.
