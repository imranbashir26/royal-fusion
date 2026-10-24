# Pre-013 legacy table ACL hardening

Release artifact: `backend/supabase/release-migrations/004_pre013_legacy_acl_hardening.sql`.

This release-only repair belongs after the correctly installed Migration 012 and before Migration 013. It removes the exact historical grants established by the sanitized production diagnostic. It does not install 013/014, enable ordering, edit existing migrations, change function execution, or mutate business data.

## Why the hashes differed

The reviewed local reference created legacy relations before installing production default ACLs. Default privileges do not retroactively affect existing relations. Production had four additional browser-role privilege bits on 36 legacy relations. Explicit column ACLs, columns/defaults/nullability, constraints/inheritance flags, indexes, row triggers, RLS/policies, ownership and intended DML privileges otherwise matched. Functions and all seven event triggers matched.

The production default-ACL rows and local default-ACL rows already match. This artifact therefore changes existing object ACLs only. It intentionally leaves default privileges untouched; newly created objects still require their own explicit privilege boundaries, as implemented for the four 012 tester tables.

## Exact scope

Revoke only TRUNCATE, REFERENCES, TRIGGER and MAINTAIN, with no ALL or CASCADE:

| Relation | Roles |
|---|---|
| admin_audit_logs | authenticated |
| admin_memberships | anon, authenticated |
| categories | anon, authenticated |
| collections | anon, authenticated |
| contact_messages | anon, authenticated |
| coupon_categories | anon, authenticated |
| coupon_products | anon, authenticated |
| coupon_redemptions | anon, authenticated |
| coupons | anon, authenticated |
| customer_addresses | anon, authenticated |
| inventory_movements | anon, authenticated |
| newsletter_subscribers | anon, authenticated |
| order_items | anon, authenticated |
| order_notes | anon, authenticated |
| order_status_history | anon, authenticated |
| orders | anon, authenticated |
| payments | anon, authenticated |
| permissions | anon, authenticated |
| product_categories | anon, authenticated |
| product_collections | anon, authenticated |
| product_media | anon, authenticated |
| product_sales_rankings | anon, authenticated |
| product_variants | anon, authenticated |
| products | anon, authenticated |
| profiles | anon, authenticated |
| promotions | anon, authenticated |
| public_site_settings | anon, authenticated |
| refunds | anon, authenticated |
| reviews | anon, authenticated |
| role_permissions | anon, authenticated |
| roles | anon, authenticated |
| seo_settings | anon, authenticated |
| shipping_methods | anon, authenticated |
| shipping_rates | anon, authenticated |
| site_settings | authenticated |
| user_roles | anon, authenticated |

There are 280 removed nondelegable grants, all originally granted by postgres. Preserve every other grant, including SELECT/INSERT/UPDATE/DELETE, service_role grants, column ACLs and owner grants.

product_sales_rankings is an ordinary view. PostgreSQL accepts ON TABLE for its stored view ACL entries. The targeted REVOKE removes all four stored bits; it does not attempt TRUNCATE or REFERENCES operations on the view. It also removes the effective browser LOCK_ANY_MODE capability represented by the manifest's view MAINTAIN normalization. Owner/service-role view grants remain unchanged.

## Transaction and rerun contract

Run the artifact as postgres, in an otherwise idle SQL session, only after independent review and separate authorization for production execution. The file owns one BEGIN/COMMIT transaction, uses lock_timeout=5s and statement_timeout=60s, and sets transaction-local search_path=pg_catalog,public.

It checks all four roles, exact public relation names, postgres ownership and ordinary-table types (except the one ordinary view). It locks the 36 relations in stable order using SHARE ROW EXCLUSIVE; locking the view also locks its underlying relations. Execute in a controlled release window without concurrent schema/ACL changes. Lock waits are bounded; the locks temporarily block conflicting writers/DDL. No table rows are changed.

Before any REVOKE, the complete catalog manifest must be one of:

- Exact historical production post-012 state: f64ceda44b4f076680f84dc5ac4b7e1b4bf7ff58911929804d456f7d32e506b4.
- Exact already-hardened post-012 state: a2ad954731059c790d88e4cdb49682979548a83a3a3fa52379551763a06464dc. This rerun returns without an ACL write.

The original manifest expression is shared with 013, including strict NOT NULL/ACL semantics and function/event fingerprints. Partial repairs, extra grants, grant options, explicit column-grant drift, missing roles/objects, changed owners/types or other manifest drift fail closed. The release does not accept the original nonproduction disposable profile.

After revocation, all four privileges and every effective column REFERENCES check must be false for the targeted roles. The complete manifest must then equal the hardened hash. Any error aborts the whole transaction. If the SQL client leaves an aborted transaction open after an error, issue ROLLBACK; do not continue within that session until it is cleared.

The safe rerun contract is before 013 only. After 013/014 changes the schema, this pre-013 artifact deliberately refuses the new manifest. Do not rerun it as later general-purpose ACL maintenance.

## Required results

| Manifest | Before | After |
|---|---|---|
| tables | 6a73c5384546ae9cad62f758aad9834ad35a9c50be186862e67ff8c867d14a37 | 3ac4ae8fc1e111a7d68bb2853c7f7d2f6df1c492104cf8f714b0630791005184 |
| complete | f64ceda44b4f076680f84dc5ac4b7e1b4bf7ff58911929804d456f7d32e506b4 | a2ad954731059c790d88e4cdb49682979548a83a3a3fa52379551763a06464dc |

The hardened complete hash is already accepted by the unchanged Migration 013 guard. No broader production hash is added to 013.

Use the reviewed SELECT-only section diagnostic before/after production execution. Preserve the original complete export and the post-hardening export. Confirm exact fingerprints, Baraan stocks 12/12, unchanged business-row counts, function bytes/ACLs/settings, event attachments/callback metadata, table/column/schema privileges and defaults. Diagnostic SELECTs do not execute 013/014.

## Local validation

Run the dedicated suite from the repository root:

```powershell
node --test --test-concurrency=1 backend/server/tests/pre013-acl-hardening.test.js
```

It builds disposable production-like catalogs, applies 012 once per new fixture, reproduces the exact historical ACL hash, applies this artifact with all four LF/CRLF install/rerun combinations, and checks exact hashes, all table/column denials, intended grants and row/function/event/default preservation. It also rejects unrelated/partial drift, injects a late failure to verify rollback, and exercises public catalog reads, customer profile access, admin authorization, tester creation and V1 checkout. Migration 013 is exercised only in disposable databases; its V2 quote structure remains valid. No Migration 014 is executed by this suite.

Native PostgreSQL 17 validation must independently reproduce both hashes, preserve raw ACLs outside the revoke scope and raw column/schema ACLs, preserve Baraan stocks and all rows/functions/events/defaults, test reruns and bounded lock failure, then confirm local 013 installation. Keep native validation logs and database identity (loopback/data-directory/version) with review evidence.

For broader backend regression without running 014, omit orders-v2.test.js, fulfillment-v2-sql.test.js and admin-orders-v2.test.js; skip the checkout-v2-sql tests named verified production catalog / defaults / enabled event trigger chain and verified production metadata drift rejects atomically at 014. Run the remaining configured backend tests and the frontend suite. Report these exclusions explicitly; do not describe that run as the unfiltered full backend suite.

## Rollback strategy

An error before COMMIT rolls back all revokes. This is the normal failure rollback and needs no compensating grants.

After COMMIT, returning to the broader historical privileges is a security regression and blocks 013 again. Do not perform an automatic rollback. Prefer repairing a verified application issue while keeping the hardened grants.

If an ACL restoration is absolutely required before 013, obtain separate approval after reviewing the exact captured pre-hardening ACL tuples. Verify all 280 tuples have grantor postgres and grant_option=false, and that the current catalog is exactly the hardened post-012 state. Restore only these reviewed tuples as postgres; do not use GRANT ALL, PUBLIC, service_role, default privileges or grant options. The following is the exact scope to review, not an automatically executed rollback:

```sql
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public;
-- First verify the exact hardened manifest in this transaction.
grant truncate,references,trigger,maintain on table
 public.admin_audit_logs,
 public.site_settings
to authenticated;
grant truncate,references,trigger,maintain on table
 public.admin_memberships,
 public.categories,
 public.collections,
 public.contact_messages,
 public.coupon_categories,
 public.coupon_products,
 public.coupon_redemptions,
 public.coupons,
 public.customer_addresses,
 public.inventory_movements,
 public.newsletter_subscribers,
 public.order_items,
 public.order_notes,
 public.order_status_history,
 public.orders,
 public.payments,
 public.permissions,
 public.product_categories,
 public.product_collections,
 public.product_media,
 public.product_sales_rankings,
 public.product_variants,
 public.products,
 public.profiles,
 public.promotions,
 public.public_site_settings,
 public.refunds,
 public.reviews,
 public.role_permissions,
 public.roles,
 public.seo_settings,
 public.shipping_methods,
 public.shipping_rates,
 public.user_roles
to anon,authenticated;
-- Verify the original historical full hash and raw captured grants before COMMIT.
-- This outline defaults to a rehearsal: no grants are committed.
-- Replace ROLLBACK with COMMIT only after separate approval and both exact checks.
rollback;
```

This outline requires the manifest checks described above and defaults to ROLLBACK; it is not a separate guarded rollback artifact. After 013 has installed, neither this outline nor this pre-013 release is an approved rollback path: the new schema and any later privilege changes require a fresh scoped review. Restoring ACLs never rolls back business data or migrations.

## Security rationale

TRUNCATE and REFERENCES bypass RLS enforcement. TRIGGER permits trigger creation and MAINTAIN permits additional maintenance/locking operations. These browser grants are not security-neutral catalog formatting and must not be normalized away. Function EXECUTE cleanup, set_updated_at(), public.rls_auto_enable(), ensure_rls and all platform event callbacks remain unchanged for later separately reviewed work.

References: [PostgreSQL RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), [privilege meanings](https://www.postgresql.org/docs/17/ddl-priv.html), [default privileges](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).
