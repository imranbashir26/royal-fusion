# Royal Fusion Authorization and RLS Plan

## 1. Core Rule

Authentication proves identity. Relational permission keys authorize administrative actions. Ownership authorizes customer actions. RLS is an independent database boundary. None replaces the others.

Frontend role/permission state controls presentation only and is never sufficient authorization.

## 2. Identity Mapping

| Identity | Auth record | Profile | Administrative roles | Data scope |
|---|---|---|---|---|
| Guest | None | None | None | Public catalog and guest checkout only |
| Customer | `auth.users` verified email | Same UUID in `profiles` | None | Own profile, addresses, orders, claims |
| Manager | `auth.users` verified email + TOTP | Same UUID | Active `manager` | Approved content/catalog operations only |
| Owner | `auth.users` verified email + TOTP | Same UUID | Active `owner` | Complete operational permissions |

Auth `user_metadata`, browser state, submitted role names, email domain, or provider claims do not assign Royal Fusion roles.

## 3. Permission Keys

### Owner bundle

The Owner role receives wildcard `*`, interpreted only by the trusted permission resolver. It includes users, roles, sessions, catalog, inventory, orders, customers, cancellations, refunds, coupons, homepage, media, payments, shipping, tax, invoices, settings, reports, SEO, and audit reads.

### Manager bundle

The approved Manager role contains exactly:

- `dashboard.read`
- `catalog.read`
- `catalog.manage`
- `categories.manage`
- `collections.manage`
- `inventory.read`
- `inventory.adjust`
- `media.commerce.manage`
- `media.delete` with backend reference/scope checks
- `homepage.manage`
- `seo.content.manage`

Testimonials, announcement, hero slides, campaigns, featured products, best sellers, and new arrivals are covered by `homepage.manage`. Blogs/journals use Sanity authorization after integration; Royal Fusion may expose a non-sensitive editorial handoff link, but Supabase commerce roles do not grant Sanity permissions automatically.

Manager explicitly lacks:

- `access.manage`, `roles.manage`, `sessions.revoke`
- `orders.read`, `orders.manage`, `customers.read`, `customers.manage`
- `cancellations.approve`, `refunds.read`, `refunds.authorize`
- `coupons.manage`, `shipping.manage`, `payments.read`, `payments.configure`, `payments.verify`
- `tax.configure`, `invoice.configure`
- `settings.private.manage`, `seo.global.manage`
- `reports.financial.read`, `audit.read`, every audit-log deletion capability, and every deployment/provider-secret capability

Provider-secret denial explicitly includes Supabase privileged keys, Cloudinary credentials, Resend credentials, Sanity tokens, and deployment credentials. Sanity editorial access, when introduced, is separately scoped and never reveals Sanity configuration secrets.

## 4. Permission Reseeding

An additive migration must not rely on `ON CONFLICT DO NOTHING` because that preserves excessive legacy grants.

The migration must:

1. Create/update canonical `owner` and `manager` role rows.
2. Create missing canonical permission rows.
3. Delete all managed `role_permissions` rows for canonical roles inside the migration transaction.
4. Insert the exact approved bundles.
5. Verify Manager has none of the forbidden keys.
6. Leave legacy roles present but inactive after explicit account transition.
7. Never automatically map real legacy administrators by email or role name.

## 5. Backend Middleware Chain

### Customer-owned route

`requestContext -> allowedOrigin -> authenticateOptional/Required -> activeSession -> csrfForMutation -> verifiedCustomer -> ownership -> handler`

### Administrative route

`requestContext -> allowedOrigin -> requireIdentity -> activeAdminSession -> csrfForMutation -> requireAAL2 -> requireRecentAuthWhenSensitive -> requirePermission(key) -> handler`

`requirePermission` queries current relational assignments. It does not read role names from JWTs, Auth metadata, request bodies, or frontend permission arrays.

The middleware stores only request-scoped identity and permission data. It never adds the backend secret key to request or response objects.

## 6. Permission Cache Rules

- Default: resolve permissions once per request through a stable database function/view.
- No cross-request cache for administrator authorization during initial launch.
- Frontend session responses may contain a `permissionVersion` and permission snapshot for UI only.
- Role/permission changes increment a version and revoke affected administrator application sessions.
- A revoked role/permission is effective on the next API request, even if the access JWT remains valid.
- If a future cache is introduced, it must be user/version keyed, short lived, invalidated transactionally, and never used for final-Owner checks.

## 7. RLS Responsibilities

### Anonymous

- Read only published/active public catalog, approved reviews, active homepage content, and allowlisted public settings.
- Cannot read profiles, addresses, roles, permissions, orders, claims, sessions, invitations, audit, private settings, payments, or refunds.
- Cannot directly create orders.

### Customer

- Read/update own allowed profile fields.
- CRUD own addresses.
- Read own linked orders, items, status history, shipments, invoices, and customer-visible notes.
- Read/consume own eligible claim only through a backend function; claim hashes are never selectable.
- Cannot read administrative role tables or other customers.

### Manager

- RLS may permit reads required by approved catalog/homepage operations, but authenticated table grants continue to block direct privileged mutations.
- Cannot read order/customer/payment/refund/private-setting/audit/session/invitation data.
- Manager mutations run through Express after permission checks, using backend privileged access.

### Owner

- RLS recognizes exact permission keys for controlled administrative reads.
- Privileged mutations still run through Express to enforce validation, MFA, recent-auth, audit, and lifecycle rules.

### Backend service

- Bypasses RLS; therefore every service-client call requires prior route authentication, session validation, CSRF/Origin where applicable, MFA, permission/ownership, and validated input.
- Service client is never returned, serialized, passed to frontend modules, or used merely for convenience on public reads.

## 8. Customer Profile Protection

- `profiles.id`, account status, identity email, created timestamp, and administrative fields are immutable to ordinary users.
- Email changes use Supabase Auth verification and a backend reconciliation step.
- Phone is a contact field at launch and may be edited with validation; it is not proof of identity.
- Legacy profile address columns become read-only/deprecated; canonical addresses use `customer_addresses`.
- Profile creation remains trigger-driven after Auth user creation.

## 9. Customer Ownership

- Express derives `customer_id` from verified `sub`; body/query values are rejected.
- Customer order APIs filter by both order identifier and verified customer ID.
- RLS repeats the same ownership condition.
- Guest orders have null `customer_id` and are not visible through account APIs.
- Guest-order claim transaction is the only automatic path from null ownership to a verified customer.

## 10. Protected Settings

- Public settings live in an allowlisted public table/view.
- Tax, payment, invoice, private/system, and provider configuration are separate.
- Provider credentials stay in deployment secret stores, not dashboard/database fields.
- Manager has no protected-setting permission or RLS visibility.
- Owner receives only safe configuration metadata; secret values are never returned through admin APIs.

## 11. Final-Owner Protection

Database/backend transaction rules:

- Lock canonical Owner role and active Owner assignments before change.
- Reject revocation, deactivation, or deletion that would leave zero active Owners.
- Prevent self-demotion when it would remove the final Owner.
- Require AAL2, recent authentication, `access.manage`, reason, and audit record.
- Bootstrap assignment succeeds only when active Owner count is zero and a permanent bootstrap-closed marker is absent; success writes the marker and immutable audit event.
- Rollback cannot reopen bootstrap through a public/API path.

## 12. Invitation Protection

Invitation rows contain normalized email, role ID fixed to Manager, inviter, provider user ID when known, status, expiry, accepted identity, and timestamps.

- Only Owner creates/resends/revokes.
- The recipient cannot change intended role.
- Acceptance requires verified email and matching Auth identity.
- Row is locked during acceptance.
- Pending -> Accepted, Revoked, or Expired only; terminal rows cannot reactivate.
- Invitation IDs/tokens do not grant permissions by themselves.
- Invitation tables and provider identifiers are not browser-selectable.

## 13. Application Sessions

`application_sessions` contains:

- UUID ID and hashed opaque handle
- Auth user ID and safe provider session identifier
- identity class (`customer` or `administrator`)
- created, last-seen, idle-expiry, absolute-expiry, revoked timestamps
- revocation reason/actor
- MFA assurance and recent-auth timestamps
- safe user-agent/device label and optional IP hash
- created/updated timestamps and version

No access token, refresh token, password, TOTP secret, recovery code, CSRF plaintext, or cookie value is stored. CSRF is stored as a hash.

RLS grants no browser access. Express exposes a safe projection through session APIs.

## 14. Audit Requirements

Immutable audit events are required for:

- First-Owner bootstrap
- Role assignment/revocation and failed final-Owner attempt
- Manager invite/create/resend/revoke/accept
- Administrator session revoke and global signout
- MFA enroll/verify/factor recovery/reset
- Protected setting/financial reauthentication outcomes
- Guest-order claim success/failure category and support-assisted transfer

Audit payloads exclude passwords, tokens, cookie values, TOTP secrets, full recovery data, provider payloads, and unnecessary customer information.

## 15. Legacy Authority Retirement

- `admin_memberships` and `is_admin()` remain temporarily for rollback visibility but cease to authorize new routes/policies.
- Additive migration replaces affected policies with `has_permission()` conditions.
- Explicit verification proves no active policy calls `is_admin()` before a later cleanup migration drops legacy objects.
- JSON administrator login remains development-only until cutover, then is disabled in production.
- Legacy Shop Manager assignments are not auto-converted. Each intended Manager is invited and assigned through Supabase Auth.

## 16. Proposed RLS Verification Matrix

| Operation | Guest | Customer A | Customer B | Manager | Owner | Service after backend auth |
|---|---:|---:|---:|---:|---:|---:|
| Read Customer A profile | Deny | Allow | Deny | Deny | Allow | Scoped allow |
| Update Customer A safe profile | Deny | Allow | Deny | Deny | Allow | Scoped allow |
| Read Customer A addresses/orders | Deny | Allow | Deny | Deny | Allow | Scoped allow |
| Insert order directly | Deny | Deny | Deny | Deny | Deny | Checkout function only |
| Read catalog drafts | Deny | Deny | Deny | Allow | Allow | Allow |
| Mutate catalog directly from browser | Deny | Deny | Deny | Deny | Deny | Authorized API only |
| Adjust inventory | Deny | Deny | Deny | Backend API | Backend API | Authorized API only |
| Read orders/customers/payments | Deny | Own only | Own only | Deny | Allow | Authorized API only |
| Read private settings | Deny | Deny | Deny | Deny | Allow safe projection | Authorized API only |
| Assign roles/invitations | Deny | Deny | Deny | Deny | Backend API | Authorized API only |
| Read audit logs | Deny | Deny | Deny | Deny | Allow | Authorized API only |
| Read raw sessions/claim hashes | Deny | Deny | Deny | Deny | Deny | Backend only |

Tests must include inactive role, expired session, AAL1 administrator, revoked invitation, stale permission snapshot, and service operation attempted without prior backend authorization.

## 17. Additive Migration and Rollback Expectations

The future schema branch creates one numbered additive migration plus:

- Read-only deployment verification SQL.
- Local/disposable RLS tests.
- Documented rollback SQL that removes only newly added policies/functions/tables when no dependent records exist.
- Forward-repair procedure after invitations, sessions, claims, or audit events exist.
- No rewrite of migrations 001/002 and no automatic production account migration.
