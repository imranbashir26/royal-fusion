# Supabase Foundation Verification

Run these scripts only against a local Supabase instance or a disposable staging project.

## Order

1. Reset an empty local database.
2. Apply `migrations/001_initial_schema.sql`.
3. Apply `migrations/002_launch_schema_foundation.sql`.
4. Apply `migrations/003_auth_schema_hardening.sql`.
5. Apply migration `003` a second time to verify deterministic role reseeding and repeat safety.
6. Apply `migrations/004_auth_session_refresh_lease.sql`.
7. Apply migration `004` a second time to verify repeat safety.
8. Apply `seed/001_starter_catalog.sql` twice to verify seed idempotency.
9. Run `tests/002_foundation_verification.sql`.
10. Run `tests/005_auth_schema_hardening_verification.sql`.
11. Run `tests/006_auth_session_refresh_lease_verification.sql`.
12. In two separate SQL sessions, start `003_concurrent_checkout_session_a.sql`, then start `004_concurrent_checkout_session_b.sql` while session A is sleeping.

The foundation test verifies required objects, foreign keys through fixture inserts, constraints, anonymous visibility, customer isolation, administrator boundaries, stock reduction, coupon limits, checkout idempotency, and full rollback after failure.

For the concurrency test, session B must wait for session A's variant lock. With the seeded stock of 25 and both sessions requesting 20, session A commits and session B must fail for insufficient stock. Reset the disposable database immediately afterward to remove the committed test order.

Never run these tests against production. All identities and contact values are fictional `.invalid` fixtures.

## Phase 3 checkout

`npm run test:checkout --workspace backend` executes the actual migration 010 and checkout
RPC in disposable, in-memory PGlite. It checks snapshots, stock, payment, inventory,
rollback, permissions and quote parity. **It does not prove concurrency.**

For real multi-connection verification, create a new empty local PostgreSQL database
whose name ends in `_phase3_disposable`, then run from the repository root:

```sh
node backend/server/scripts/check-checkout-concurrency.mjs --database royal_fusion_phase3_disposable --port 5432 --user postgres
```

The runner requires an installed `psql`, forces `127.0.0.1`, ignores dotenv/PG environment
configuration, refuses a nonempty database, applies fixture schema/migrations, and
asserts competing sessions wait. It covers same-variant overselling, distinct sibling
aggregate stock, checkout/catalog locking compatibility, and rollback. It leaves only
fictional data in the disposable database for inspection. Remove that database afterward.
Never point this runner or these fixtures at production. Production purchasing remains
blocked in the HTTP route until relational fulfillment and release verification exist.

### Phase 3 acceptance policies

Coupon dates use the UTC calendar date explicitly: quotes use the server's UTC instant,
and the RPC uses `(statement_timestamp() at time zone 'UTC')::date`. Session/environment
timezones do not change the rule. A later request can legitimately cross a UTC boundary.

Shipping rejects **all** ties at the winning scope priority and highest qualifying
minimum subtotal, including equal-fee duplicates. Quote and RPC both fail closed before
order writes. Default-rate ties are schema-valid; the city-tie defensive SQL fixtures
remove the uniqueness index only inside a disposable transaction and roll back afterward.

Success pages display historical receipts and never consume a cart. A live validated
receipt includes its idempotency UUID; completion checks that UUID against the frozen
request and exact purchased-line snapshot. Cart entries have durable instance UUIDs,
so removing/re-adding the same variant cannot revive an old snapshot. Per-attempt cart
claims/completions are separate immutable storage records without eviction. Web Locks
serialize completion across tabs. Completion writes durable quantities against entry
UUIDs, never a full cart snapshot; hydration projects unapplied quantities onto only
those original entries. The cart snapshot records the quantities already projected.
Ordinary cart operations read the latest shared state,
and storage events synchronize other tabs. Session intents remain per-tab. Browsers
without Web Locks fail closed on cleanup. If a crash/write failure interrupts a claimed
cleanup, the attempt remains in explicit recovery and is never automatically consumed
again. This favors keeping cart items over subtracting from a later cart. Clearing site
storage removes local recovery context; it does not cancel any server order.

Completed attempts are historical only, so later checkout can freeze a new UUID without
using Continue shopping. Unreadable/older/corrupt potentially submitted attempts block
fresh checkout until explicit recovery/reset; they never mint a replacement UUID silently.

`005_auth_schema_hardening_verification.sql` checks customer isolation, direct browser
denials, canonical Owner/Manager permission boundaries, invitation lifecycle protection,
session and claim hash-only storage, claim replay prevention, final-Owner protection,
audit immutability, SECURITY DEFINER search paths, and grant boundaries. It rolls back all
fixtures. Run `npm run test:sql-auth-schema` from the repository root for dependency-free
static checks when PostgreSQL/Supabase CLI is unavailable; static checks do not replace
executing the SQL verification against a disposable local database.

`006_auth_session_refresh_lease_verification.sql` verifies that only one refresh lease
can be held, the wrong lease owner cannot release it, browser roles cannot execute lease
functions, recovery context exists, and heartbeat updates do not create noisy audit rows.
It uses fictional fixtures and rolls back. `npm run test:sql-auth-sessions` performs only
static checks when PostgreSQL/Supabase CLI is unavailable.
