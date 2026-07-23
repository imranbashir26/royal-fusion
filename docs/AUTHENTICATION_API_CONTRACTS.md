# Royal Fusion Authentication API Contracts

Proposed base path: `/api/v1`. These contracts do not change current endpoints until their implementation branch is approved.

## 1. Common Envelopes

Success:

```json
{
  "data": {},
  "meta": { "requestId": "req_example" }
}
```

Error:

```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Unable to sign in with those details.",
    "requestId": "req_example"
  }
}
```

Field validation may include safe `fields`. Responses never contain account-existence evidence, tokens, cookies, stack traces, SQL/provider messages, internal IDs unnecessary to the client, or secrets.

## 2. Cookie and Request Contract

- Authentication tokens are returned only through `Set-Cookie` for `__Host-rf-at` and `__Host-rf-rt`.
- `__Host-rf-sid` is an opaque session handle; `__Host-rf-csrf` is a non-secret readable CSRF value.
- Production cookies use `Secure`, `SameSite=Lax`, `Path=/`, and no `Domain`; token/session cookies are HttpOnly.
- Frontend requests use `credentials: "include"`.
- Every state-changing request includes `X-RF-CSRF` equal to the CSRF cookie and an allowed `Origin`.
- `Cache-Control: no-store` applies to Auth, session, profile, address, invitation, MFA, and customer-order responses.

## 3. Safe Error Codes

| Code | HTTP | Client behavior |
|---|---:|---|
| `AUTH_REQUIRED` | 401 | Route to sign-in when authentication is required |
| `INVALID_CREDENTIALS` | 401 | Generic sign-in failure |
| `EMAIL_VERIFICATION_REQUIRED` | 403 | Show resend option within limits |
| `SESSION_EXPIRED` | 401 | Clear local UI identity and show expired page |
| `SESSION_REVOKED` | 401 | Clear state and require new sign-in |
| `CSRF_INVALID` | 403 | Reload session/CSRF once; do not retry mutation blindly |
| `ORIGIN_NOT_ALLOWED` | 403 | Stop request |
| `MFA_REQUIRED` | 403 | Route administrator to enrollment/challenge |
| `MFA_CHALLENGE_FAILED` | 401 | Generic MFA failure |
| `PERMISSION_DENIED` | 403 | Hide action after refreshing permissions |
| `INVITATION_INVALID` | 400 | Generic invalid/revoked invitation |
| `INVITATION_EXPIRED` | 410 | Request Owner resend |
| `CLAIM_INVALID` | 400 | Generic claim failure |
| `CLAIM_EXPIRED` | 410 | Explain expiry without order details |
| `CLAIM_ALREADY_USED` | 409 | Stop replay |
| `RATE_LIMITED` | 429 | Honor `Retry-After` |
| `AUTH_SERVICE_UNAVAILABLE` | 503 | Retry later; never activate prototype Auth |

## 4. Customer Authentication

### `POST /api/v1/auth/signup`

Pre-auth CSRF and allowed Origin required.

```json
{
  "email": "customer@example.invalid",
  "password": "[REDACTED]",
  "fullName": "Example Customer",
  "phone": "+00 000 0000000"
}
```

Always return 202 with the same safe message for syntactically valid requests, including an already registered email. No session is created until verification policy permits it.

### `POST /api/v1/auth/signin`

```json
{ "email": "customer@example.invalid", "password": "[REDACTED]" }
```

Success sets cookies and returns safe identity/profile summary. Unknown email, wrong password, and inactive identity return `INVALID_CREDENTIALS`; unverified email returns `EMAIL_VERIFICATION_REQUIRED` only after valid credential proof.

### `POST /api/v1/auth/signout`

Requires session, Origin, and CSRF. Revokes current session, clears cookies, returns 204.

### `POST /api/v1/auth/signout-all`

Requires session, Origin, CSRF, and recent authentication. Revokes all identity sessions and returns 204.

### `GET /api/v1/auth/session`

```json
{
  "data": {
    "authenticated": true,
    "identity": {
      "id": "00000000-0000-0000-0000-000000000000",
      "email": "customer@example.invalid",
      "emailVerified": true
    },
    "profile": { "fullName": "Example Customer", "phone": "+00 000 0000000" },
    "administrator": null,
    "expiresAt": "2030-01-01T00:00:00Z",
    "csrfToken": "csrf_example"
  },
  "meta": { "requestId": "req_example" }
}
```

Unauthenticated requests return `{ "authenticated": false }` with a fresh pre-auth CSRF token, not 401.

### `POST /api/v1/auth/refresh`

Requires session cookies, Origin, and CSRF. Body is empty. Rotates tokens when valid. Returns safe session summary. Invalid rotation clears cookies and returns `SESSION_EXPIRED`/`SESSION_REVOKED`.

### `POST /api/v1/auth/forgot-password`

```json
{ "email": "customer@example.invalid" }
```

Always returns 202 for valid syntax: "If an eligible account exists, recovery instructions will be sent."

### `POST /api/v1/auth/reset-password`

Requires a valid one-hour recovery session, Origin, and CSRF.

```json
{ "newPassword": "[REDACTED]" }
```

Success revokes all sessions, clears recovery/auth cookies, returns 204, and requires fresh sign-in.

### Verification callback

`GET /api/v1/auth/verify/callback?code=[REDACTED]&next=/account` accepts only provider-issued, single-use codes and allowlisted relative `next` paths. Express requires the matching short-lived HttpOnly PKCE/state cookie, compares state in constant time where the provider flow supplies it, consumes the verifier once, exchanges the code server-side, rotates the session, clears callback cookies, and redirects without retaining the code. Missing, expired, mismatched, or replayed callback state fails generically. A POST callback may be used if the selected provider flow requires it.

### Verification resend

`POST /api/v1/auth/verification/resend` accepts an email, returns the same 202 response regardless of existence, and applies its own rate limit.

## 5. Customer Profile and Addresses

- `GET /api/v1/customer/profile`: verified customer; returns own profile only.
- `PATCH /api/v1/customer/profile`: Origin/CSRF; accepts allowlisted profile fields only. Email changes use a separate verified Auth flow.
- `GET /api/v1/customer/addresses`: own paginated addresses.
- `POST /api/v1/customer/addresses`: create own address.
- `PATCH /api/v1/customer/addresses/:id`: update owned address.
- `DELETE /api/v1/customer/addresses/:id`: delete owned address when not protected by workflow.
- `POST /api/v1/customer/addresses/:id/default`: transactionally replace default address.

The browser never sends `customer_id`; Express uses verified `sub`. Ownership is enforced by Express and RLS.

Address mutation example:

```json
{
  "label": "Home",
  "recipientName": "Example Customer",
  "phone": "+00 000 0000000",
  "addressLine1": "Example address",
  "addressLine2": "",
  "city": "Example City",
  "province": "Example Province",
  "postalCode": ""
}
```

## 6. Customer Order History

- `GET /api/v1/customer/orders?page=1&pageSize=20`: own orders only.
- `GET /api/v1/customer/orders/:orderNumber`: own order snapshots and customer-visible timeline only.
- `POST /api/v1/customer/orders/:orderNumber/cancellation-requests`: separate future workflow; ownership required.

The API derives customer identity and never accepts an ownership ID. An existing guest order is invisible until securely claimed.

## 7. Administrator Session

### `GET /api/v1/admin/session`

Requires authenticated identity. Returns:

```json
{
  "data": {
    "authenticated": true,
    "mfaRequired": false,
    "assuranceLevel": "aal2",
    "administrator": {
      "id": "00000000-0000-0000-0000-000000000000",
      "displayName": "Example Administrator",
      "roleKeys": ["manager"],
      "permissions": ["catalog.manage", "homepage.manage"],
      "permissionVersion": "version_example"
    },
    "expiresAt": "2030-01-01T00:00:00Z",
    "csrfToken": "csrf_example"
  },
  "meta": { "requestId": "req_example" }
}
```

The permission list is presentation data only. Every protected API request resolves authoritative permissions again.

## 8. Manager Invitations

- `POST /api/v1/admin/invitations`: Owner + `access.manage`, AAL2, recent auth. Body contains email only; role is fixed to Manager server-side.
- `GET /api/v1/admin/invitations`: Owner-only paginated list with masked email where appropriate.
- `POST /api/v1/admin/invitations/:id/resend`: Owner-only; rotates pending invite and expiry.
- `POST /api/v1/admin/invitations/:id/revoke`: Owner-only; revokes pending invitation.
- `POST /api/v1/admin/invitations/accept`: verified invited session; body contains invitation acceptance context supplied by the provider flow, not a requested role.

Creation response:

```json
{
  "data": {
    "id": "00000000-0000-0000-0000-000000000000",
    "status": "Pending",
    "expiresAt": "2030-01-03T00:00:00Z"
  },
  "meta": { "requestId": "req_example" }
}
```

## 9. Session Listing and Revocation

- `GET /api/v1/auth/sessions`: current identity's safe sessions.
- `DELETE /api/v1/auth/sessions/:id`: revoke owned session; current session requires confirmation.
- `GET /api/v1/admin/users/:userId/sessions`: Owner-only administrator sessions.
- `DELETE /api/v1/admin/users/:userId/sessions/:id`: Owner-only revocation with reason and audit.

Responses expose device label, created/last-seen/expiry, current flag, and revoked state. They never return session handles or tokens.

## 10. MFA Contracts

- `POST /api/v1/admin/mfa/enroll`: starts TOTP enrollment for authenticated administrator; returns provider QR representation and factor ID once, `no-store`.
- `POST /api/v1/admin/mfa/challenge`: creates a challenge for an owned verified factor.
- `POST /api/v1/admin/mfa/verify`: accepts factor/challenge IDs and a short TOTP code; success rotates session/CSRF and establishes AAL2.
- `GET /api/v1/admin/mfa/status`: safe factor/enrollment/assurance summary.
- `DELETE /api/v1/admin/mfa/factors/:id`: prohibited for self-service administrator recovery at launch; controlled recovery only.

No endpoint accepts `mfaRequired`, desired assurance level, role, or bypass flags from the browser.

## 11. Guest-Order Claim

- `POST /api/v1/customer/order-claims`: verified customer, Origin, CSRF.

```json
{ "claimToken": "[REDACTED]" }
```

Success returns the newly accessible order summary. Errors use `CLAIM_INVALID`, `CLAIM_EXPIRED`, or `CLAIM_ALREADY_USED` without exposing unowned order data. No endpoint links by email/order number alone.

## 12. Rate Limits

Provider-level limits remain in force. Express applies independent limits using IP plus normalized non-secret/account/session signals:

| Operation | Limit |
|---|---|
| Sign in | 10 / 15 min per IP+identifier; 30 / 15 min per IP |
| Sign up | 5 / hour per IP; 3 / day per normalized email |
| Forgot password | 5 / hour per IP+email; always generic 202 |
| Reset password | 5 / hour per recovery session/IP |
| Verification resend | 3 / hour per email/IP |
| Invitation creation | 20 / day per Owner; 5 / day per target email |
| Invitation resend | 5 / day per invitation/Owner |
| MFA challenge | 10 / 15 min per session |
| MFA verification | 5 / 10 min per challenge; invalidate after limit |
| Guest-order claim | 10 / hour per account/IP; 5 / day per claim/order signal |
| Profile/address mutation | 60 / hour per customer; 120 / hour per IP |

429 responses use `RATE_LIMITED`, include `Retry-After`, and do not reveal whether an account/invite/claim exists.

## 13. Middleware Contract

Protected mutation order:

1. Request ID and redacted logging context.
2. Exact CORS/Origin validation.
3. Endpoint-specific IP/signal rate limiting.
4. Bounded body parsing and schema validation.
5. Authentication cookie and verified claims.
6. Application session timeout/revocation.
7. CSRF verification.
8. MFA assurance/recent-auth requirement.
9. Permission or customer ownership requirement.
10. Handler and database/RLS operation.
11. Safe error mapping and audit outcome.

Authentication failures never silently continue as anonymous except when the endpoint explicitly declares authentication optional and no credentials were supplied.
