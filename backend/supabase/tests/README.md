# Supabase Foundation Verification

Run these scripts only against a local Supabase instance or a disposable staging project.

## Order

1. Reset an empty local database.
2. Apply `migrations/001_initial_schema.sql`.
3. Apply `migrations/002_launch_schema_foundation.sql`.
4. Apply migration `002` a second time to verify repeat safety.
5. Apply `seed/001_starter_catalog.sql` twice to verify seed idempotency.
6. Run `tests/002_foundation_verification.sql`.
7. In two separate SQL sessions, start `003_concurrent_checkout_session_a.sql`, then start `004_concurrent_checkout_session_b.sql` while session A is sleeping.

The foundation test verifies required objects, foreign keys through fixture inserts, constraints, anonymous visibility, customer isolation, administrator boundaries, stock reduction, coupon limits, checkout idempotency, and full rollback after failure.

For the concurrency test, session B must wait for session A's variant lock. With the seeded stock of 25 and both sessions requesting 20, session A commits and session B must fail for insufficient stock. Reset the disposable database immediately afterward to remove the committed test order.

Never run these tests against production. All identities and contact values are fictional `.invalid` fixtures.
