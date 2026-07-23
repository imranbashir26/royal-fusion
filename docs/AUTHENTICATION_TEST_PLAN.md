# Royal Fusion Authentication Test Plan

## 1. Test Principles

- Tests use fictional `.invalid` emails, disposable local/staging databases, and mocked provider responses.
- No test contacts production Auth, database, email, or customer records.
- Security-sensitive tests assert both response behavior and absence of leaked details.
- Every implementation branch adds its tests before enabling its feature flag.
- Guest checkout regression runs on every Auth branch.
- Unit tests cover configuration, cookie, CSRF, Origin, permission, timeout, token-hash, and safe-error helpers.
- Backend API integration tests exercise the documented routes through Express with mocked Auth and disposable data adapters.
- Frontend component and route-guard tests verify branded Auth states without treating UI guards as authorization.
- SQL/RLS tests use disposable databases; E2E and production smoke tests use approved isolated identities and non-destructive flows.

## 2. Test Groups

| Group | Preconditions | Action | Expected result | Security property | Branch |
|---|---|---|---|---|---|
| Contract/tooling | Existing repo, no Auth behavior change | Start test runner with mock Auth gateway | Deterministic isolated suite runs locally/CI | Tests cannot reach production | `test/auth-contract-foundation` |
| Cookie options | Mock successful sign-in | Inspect `Set-Cookie` metadata | Token cookies HttpOnly; production Secure/Lax/Path=/; no Domain | Tokens unavailable to JS | `test/auth-contract-foundation`, backend branch |
| Verification callback | Issued PKCE/state fixture | Complete, mismatch, expire, replay, and supply an external `next` target | Only the first matching callback succeeds; callback cookies clear; external redirect is rejected | Callback CSRF, replay, and open-redirect defense | Backend/customer pages branches |
| CSRF contract | Pre-auth/auth session fixture | Mutate with missing/wrong/correct token | Wrong requests 403; correct proceeds | Cookie request forgery blocked | Contract/backend branch |
| CORS/Origin | Exact allowlist fixture | Send allowed, absent, foreign, and localhost production origins | Only intended cases pass | No wildcard/localhost production trust | Backend branch |
| Signup | Mock eligible/existing emails | Submit valid signup | Same 202 shape in both cases | Account enumeration resistance | Customer pages/backend branch |
| Sign-in | Verified/unverified/wrong credentials | Attempt login | Safe success or stable generic errors | Credential/account state not leaked | Backend/customer pages |
| Verification | Valid, expired, replayed provider codes | Open callback/resend | One valid completion; failures safe; resend limited | Link replay/redirect abuse blocked | Customer pages/backend branch |
| Password recovery | Existing/missing email and recovery sessions | Request/reset/replay | Generic 202; valid reset revokes sessions; replay fails | Enumeration and recovery replay blocked | Customer pages/backend branch |
| Session restoration | Valid customer/admin cookies | Reload SPA and call session API | Correct safe identity; no raw token response | Secure restoration | Backend/customer/admin branches |
| Idle expiry | Controlled clock | Exceed 7-day customer or 30-minute admin idle timeout | `SESSION_EXPIRED`, cookies cleared | Configured inactivity enforcement | Backend branch |
| Absolute expiry | Controlled clock | Exceed 30-day customer or 8-hour admin lifetime | Refresh denied, session revoked | Sessions cannot live forever | Backend branch |
| Refresh rotation | Near-expiry and concurrent requests | Refresh once/twice concurrently | One safe rotation, no token replay/loop | Single-use refresh handling | Backend branch |
| Current logout | Active session | Sign out | Provider/session revoked; cookies cleared | Stolen refresh reuse limited | Backend branch |
| Global logout | Multiple sessions | Sign out all | Every session revoked | Account-wide incident response | Backend branch |
| Admin revocation | Owner and Manager sessions | Owner revokes Manager session | Next Manager request denied immediately | Administrative revocation | Admin RBAC branch |
| Permission resolver | Canonical role fixtures | Request each permission | Exact Owner/Manager matrix | Least privilege | Schema/admin branches |
| Stale permission | Manager UI snapshot then role revocation | Call protected API | Denied despite stale frontend state | Backend is authoritative | Admin RBAC branch |
| Customer ownership | Customer A/B fixtures | B reads/updates A resources | No rows/403/404 safe response | Tenant isolation | Schema/profile branch |
| Direct browser mutation | Authenticated customer/Manager DB role | Insert order or mutate admin tables | Database denies | Grants and RLS defense | Schema branch |
| Profile hardening | Customer profile fixture | Alter ID/status/email/protected fields | Database/backend rejects or preserves | Privilege/identity integrity | Schema/profile branch |
| Default address | Customer with existing default | Set second default concurrently | Exactly one default remains | Relational invariant | Profile branch |
| Owner bootstrap | Zero/one Owner fixtures | Run release command twice | First succeeds/audits; second permanently fails | No public/repeated bootstrap | Admin RBAC branch |
| Final Owner | One/two Owner fixtures | Revoke/deactivate assignments | Last Owner protected; non-final permitted/audited | Administrative continuity | Schema/admin branch |
| Manager invite | Pending/expired/revoked/mismatched identities | Accept/resend/revoke | Only verified matching active invite assigns Manager | No invitation privilege escalation | Admin RBAC branch |
| Manager denial | Active Manager AAL2 | Call orders/customers/refund/tax/payment/shipping/access/protected-settings/audit-delete APIs | `PERMISSION_DENIED`, no data | Approved Manager boundary | Admin RBAC branch |
| MFA enrollment | New Owner/Manager AAL1 | Access dashboard/enroll TOTP | Dashboard blocked until verified factor | Mandatory administrator MFA | MFA branch |
| MFA challenge | Valid/invalid/replayed/limited code | Verify challenge | Valid reaches AAL2 once; failures limited | Brute force/replay resistance | MFA branch |
| MFA bypass | Client flag or modified response | Call admin API at AAL1 | `MFA_REQUIRED` | Frontend cannot bypass MFA | MFA branch |
| MFA recovery | Lost Manager/Sole Owner fixture | Attempt public/self recovery | Denied; controlled audited process required | No public factor reset | MFA branch |
| Guest checkout no session | Existing JSON checkout fixtures | Place guest order without cookies | Existing contract/cart behavior remains | Auth remains optional | Every branch |
| Guest checkout malformed auth | Invalid cookie/header fixture | Place otherwise valid order | Auth error, not silent guest downgrade | Identity confusion blocked | Backend branch |
| Guest checkout valid auth | Verified customer session | Place order during Auth foundation | Current order behavior unchanged; ID derived only when explicitly connected later | Browser cannot choose customer | Backend/profile branch |
| Claim success | Verified matching customer + valid claim | Submit claim once | Ownership/history/audit update atomically | Proof-based linking | Guest-link branch |
| Claim expiry/replay | Expired/used/random tokens | Submit claim | Stable safe error, no order details/change | Token replay/enumeration blocked | Guest-link branch |
| Claim concurrency | Two transactions same claim | Submit simultaneously | Exactly one commit | Single-use ownership | Guest-link branch |
| Support recovery | Customer requests manual transfer | Attempt automatic transfer | No automatic link; Owner-reviewed path only | Social-engineering resistance | Guest-link branch |
| Provider outage | Mock timeout/error | Sign in/refresh/admin request | 503 safe code, no fallback/provider dump | Fail-closed Auth | Backend/cutover branches |
| Database outage | Session store unavailable | Access protected route | Denied safely | Revocation cannot be bypassed | Backend branch |
| Rate limits | Controlled IP/account keys | Exceed each endpoint threshold | Endpoint-specific 429 + `Retry-After` | Brute force/abuse control | Relevant branch |
| Log redaction | Trigger every Auth failure | Inspect captured logs | No passwords/tokens/cookies/MFA secrets | Sensitive logging prevented | Backend/cutover branches |
| Browser storage | Production frontend fixture | Sign in and inspect storage | No password/hash/access/refresh/admin JWT | XSS token exposure reduced | Customer/admin/cutover branches |
| Route guards | Customer, Manager, Owner, expired states | Navigate directly | Correct page/redirect; APIs still enforce | UI consistency, not sole auth | Customer/admin branches |
| Production config | Invalid provider/MFA/cookie/CORS values | Start readiness validation | Production fails before traffic | No insecure production mode | Cutover branch |
| E2E customer | Disposable Auth/email fixture | Signup -> verify -> profile -> address -> signout/in | Complete branded journey | End-to-end identity correctness | Customer/profile branches |
| E2E administrator | Provisioned Owner and invited Manager | MFA -> dashboard -> allowed/denied actions | Owner full; Manager limited | End-to-end RBAC/MFA | Admin/MFA branches |
| Production smoke | Approved production test identities only | Session, MFA, permission, guest checkout smoke | Safe checks pass without real orders/data mutation where avoidable | Deployment readiness | Cutover branch |

## 3. Mock Auth Gateway

The first branch provides an interface-compatible fake that can emit:

- Verified/unverified users.
- Valid/expired access sessions.
- Refresh success, reuse, and outage.
- Invitation acceptance/mismatch.
- AAL1/AAL2 and TOTP challenge results.
- Provider-safe error categories.

Production code receives the gateway through dependency injection. Tests must fail if the fake is accidentally selected under production configuration.

## 4. Test Data and Isolation

- Use deterministic UUIDs and fictional `.invalid` domains.
- Hash sample claim/session values; never store real tokens in fixtures.
- SQL tests run inside rollback transactions where possible.
- Concurrency tests use disposable local/staging sessions and clean up afterward.
- Timeouts use an injected clock.
- Rate limits use an isolated in-memory/test adapter, never production counters.
- Browser tests clear only Royal Fusion test storage and preserve unrelated browser state.

## 5. Required Assertions Beyond Status Codes

- Response schema and safe error code.
- No `Set-Cookie` on failed authentication unless clearing/rotating pre-auth CSRF safely.
- Cookie flags and expiry.
- Database row count/state and audit event.
- No unintended inventory/order/cart mutation.
- No forbidden field in JSON.
- No sensitive content in captured logs.
- No browser-readable access/refresh token or password hash.
- RLS result under real `anon`/`authenticated` claims.

## 6. CI and Release Gates

Every Auth branch must pass affected unit/API/frontend tests, guest checkout regression, SQL static checks where relevant, lint, typecheck, production build, secret scan, and `git diff --check`.

Schema and cutover branches additionally require disposable-project migration rehearsal, RLS matrix, rollback/forward-repair review, and read-only deployment verification. MFA/admin branches require manual two-device/session verification before production approval.
