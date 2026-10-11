# Phase 014: frozen tester-pack fulfillment

Local implementation and disposable acceptance tests only. This is not production migration or launch approval. Apply the exact approved 013 baseline and 014 target in a separately approved release before deploying backend code that advertises V2 fulfillment. Migrations 001–013 and release migrations are unchanged.

## Database entrypoints

`apply_admin_order_action(uuid,uuid,text,uuid,text,jsonb,text)` retains its signature. V1 delegates to the unchanged `apply_admin_order_action_v1_013_internal`; V2 delegates to `apply_admin_order_action_v2_014_internal`; unknown versions fail closed. All private functions are postgres owned, SECURITY DEFINER, with empty search paths and schema-qualified relations. Only service_role executes the public dispatcher and V2 order/quote entrypoints. PUBLIC, anon, authenticated and arbitrary inherited/default grants cannot execute private handlers. Phase 013 RLS, immutable snapshots and direct-write guards remain authoritative; no table write grants are added.

Active canonical `admin` assignment plus wildcard permission and Active profile are required. Trusted route authentication supplies the actor. Existing administrator session, MFA, Origin and CSRF controls remain unchanged. No owner/manager compatibility or authorization expansion is introduced.

## Frozen cancellation authority

For each physical variant, restoration is the sum of normal-line quantities and component `total_physical_quantity` across the whole order. The same tester in standalone, fixed and configurable lines yields one restoration and one `Order cancelled` movement. Pack parents receive neither stock nor movements.

Private snapshot validation checks order/item versions, immutable request/quote correspondence, identities/hashes, deterministic positions, required pack/normal fields, frozen component ownership, 5 ml identity, positive quantities/reference prices, widened multiplication, and exactly one matching original placement movement per physical variant. Missing, extra or mismatched snapshots/placement ledger fail with `ORDER_SNAPSHOT_INCONSISTENT`. No current recipe, membership, price, availability, publication or pack revision resolves restoration. Current variant ownership is checked only to ensure physical stock still belongs to its frozen product.

Quoted lines and nested components use independent JSON array ordinality: quoted and persisted positions must both equal the zero-based ordinal, including contiguous component positions within each pack. Reverse coverage rejects every order component without a same-order V2 pack parent; exact per-parent frozen component equality proves full correspondence and excludes extra, missing, duplicate and cross-parent entries. Demand is accumulated only from validated canonical quote entries, then independently compared with the original placement ledger. An orphan plus a matching inflated placement ledger therefore cannot authorize restoration.

Restoration uses bigint arithmetic and checks both variant stock and the active-sibling product aggregate against 2147483647 before writes. Movements carry positive aggregated quantity, actual stock balance, order reference, validated reason and trusted actor. Phase 012 stock triggers derive tester availability; `manual_available` is never changed. Standard merchandising flags are preserved.

## Mutation and lifecycle

Validation and canonical Admin authority precede `admin-order:<mutationId>` advisory locking and committed audit lookup. Matching fingerprint replays saved results before revision/snapshot work; different intent conflicts. New mutations lock order, compare revision, lock canonical payment, items by position/id and components by parent/position/id. Cancellation then locks all affected sibling variants globally by UUID and physical product parents by UUID, revalidates frozen ledger, checks bounds, and writes stock/ledger/order/history/audit atomically. READ COMMITTED is required for new V2 actions. No pack definition, membership or tester registry lock is requested to derive demand. Phase 012 availability triggers can read tester registry under MVCC without a reverse row-lock edge.

Fresh duplicate cancellation verifies previous successful cancellation audit, single Cancelled history and exactly one positive movement per physical variant; it records a normal no-op mutation audit without additional inventory, history or order revision. Revision overflow is rejected before effects. Late history/audit failures roll back all effects, including catalog revisions caused by stock triggers.

V1 non-cancellation rules remain authoritative: forward status progression, Bank Transfer paid before Processing/Shipped, required shipping tracking, correction reason, separate COD collection, no-op revisions and protected terminal states. Cancellation validates canonical payment/provider/amount/currency and blocks any associated Paid payment. It changes no payment status, coupons, redemptions or refunds. No partial/component cancellation, substitution or Returned/Refunded workflow is added.

## Backend and Admin UI

Lists use explicit projections and small version metadata queries rather than loading private snapshots. Detail allowlists frozen V2 items/components, physical quantity and permitted actions; private request, quote, fingerprints and raw audit metadata are never returned. Components show per-pack/total physical quantity and reference-only price. UI distinguishes fixed/configurable packs, retains exact saved mutation retries, intersects backend action support with local permissions and never labels pack parents as historical variants. V1 display/actions remain compatible. Customer cart, builder and checkout persistence are unchanged.

`checkoutExecutionPolicy` defaults false, permits only an explicitly injected boolean capability in test/development, and absolutely denies production/unknown environments. No environment flag or request field enables ordering. Quote `orderingEnabled` and order service use the same policy. Runtime application construction provides no capability, so production and default HTTP ordering remain disabled even after SQL execute permission is granted. Controlled tests invoke real service-role RPCs, validate/allowlist full receipts, return 201 creation/200 replay, and retry lost responses with the exact existing idempotency key. A later separately reviewed release phase must authorize production HTTP execution.

## Migration manifests

One transaction, 5-second lock timeout and 60-second statement timeout. Exact catalog manifests recognize only the 013 baseline or exact 014 target; owners, function bodies/attributes/ACLs, columns, constraints, indexes, triggers and policies participate. Only CRLF-to-LF function-body normalization is permitted. Populated rerun performs no DDL/data repair. Drift fails closed; no seeds are present.

`node backend/server/scripts/refresh-fulfillment-v2-manifest.mjs` computes baseline/target in disposable PGlite and writes only migration 014. Never run it concurrently with tests. It is an authoring tool, not production drift repair.

Focused scripts: `npm run test:fulfillment-v2:sql --workspace backend`, `npm run test:fulfillment-v2:api --workspace backend`. Both are included in the full backend suite. Regression validation also covers checkout-v2, V1 checkout/fulfillment, tester catalog, auth contracts/sessions/transition, Admin UI unit/browser tests, full frontend, build, lint and diff checks.

## Required later real PostgreSQL validation

PGlite establishes sequential transaction/rollback, security and manifest behavior, not independent-session concurrency. Before launch, use disposable real PostgreSQL with independent connections to verify:

- simultaneous same-mutation cancellation and lost-response exact retry;
- two distinct cancellation requests, verifying one restoration/history;
- cancellation versus tester Admin stock save and checkout;
- status progression versus cancellation;
- mixed/shared-tester sibling/parent UUID lock ordering and deadlock freedom;
- immediate Admin actions after V2 creation.

Also verify production RPC/role/permissions/configuration, approve exact migration application separately, and perform controlled deployment/release validation. No production operations are authorized by this document or local tests.
