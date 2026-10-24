# Phase 013: local tester checkout and order snapshots

Migration `013_tester_checkout_order_snapshots.sql` follows the complete 012
foundation and corrected single-admin release chain. It is a local implementation,
not approval to apply a production migration or enable ordering.

## Contracts and authority

`POST /api/v2/public/checkout/quote` accepts strict version-2 logical lines and
returns authoritative SQL prices, component previews and a quote fingerprint.
`POST /api/v2/public/orders` validates its version-2 contract but is always
unavailable before 014. The service never calls the order RPC. Quotes always
return `orderingEnabled: false`. Existing v1 production gates remain unchanged.

Only disposable tests invoke `create_order_transaction_v2` as postgres with the
synthetic service claim. PUBLIC/anon/authenticated/service_role lack EXECUTE.
No deployment flag or caller-controlled GUC enables this function.

`checkout_v2_canonical` owns full request canonicalization. UUIDs are lowercase,
revisions are bounded canonical decimal strings, configurable duplicate selections
aggregate, and logical lines group by the complete identity, not its SHA-256 hash.
`checkout_v2_compact` recursively serializes arrays; object nodes use deterministic
PostgreSQL jsonb text. Identity tuples contain only arrays and ASCII UUID/revision
strings/integer quantities, so their representation is compact. Full request hashes
are server-owned; clients must not recreate them independently.

Both SQL writers derive `checkout:<UUID>` through `checkout_v2_key`, using
PostgreSQL UUID parsing and lowercase UUID output before advisory locking,
lookup or new-write delegation. The existing global text uniqueness index stays
unchanged. New RPC writes share the canonical advisory key and store canonical
order/payment keys.

Historical keys were unconstrained text in the preserved SQL writer, although
the current HTTP schema already lowercases UUIDs. Production rows were not
inspected. `checkout_v2_stored_uuid` recognizes parseable namespaced historical
UUID representations (including uppercase, braces and PostgreSQL-supported
unhyphenated forms). A nonunique expression index supports equivalent-key lookup
without rewriting any row or payment key. `checkout_v2_existing` reads at most
two equivalents in one statement snapshot: one row is replayed or version-fenced;
multiple rows raise `V2_IDEMPOTENCY_AMBIGUOUS`. It never chooses a canonical row
over another equivalent row. Invalid incoming identities fail closed.

The forward v1 SQL wrapper compares frozen variant quantities and normalized
contact/shipping/customer/payment/coupon intent before returning a committed
receipt. Historical alias replay never delegates to the internal writer and never
checks current stock, publication, pricing, shipping, payment or coupon eligibility.
V2 retains full canonical-request and fingerprint comparison before resolution.
The v1 service validates request shape, then calls this authoritative transaction
boundary directly. It does not perform textual order lookups, JavaScript replay
comparison, or current-commerce preflight. Both new and replayed RPC responses
contain the complete existing v1 receipt; SQL returns the parsed canonical UUID
without rewriting historical order/payment keys. Responses are allowlisted and
malformed RPC envelopes fail closed. Transport failures retain the same token for
retry. Post-rejection variant reads provide safe error diagnostics only.

The preserved v1 transaction already owns catalog, stock, price calculation,
coupon and shipping validation. Its 013 forward augmentation adds the former
service's positive regular/sale-price checks and configured-payment enforcement
after existing variant/product/coupon locks, before the first order write. Payment
configuration rows are share-locked and retain private/public/commerce precedence,
including explicit false. Default shipping ties use UUID as the final ordering
key, matching the former service selection. The exact baseline manifest and unique
insertion anchors fail closed if the expected transaction body changes. These
checks never run on committed replay. No new externally callable RPC or helper
grant is introduced. This service contract requires migration 013; it is not a
compatibility deployment against the older incomplete RPC receipt.

The shared SQL resolver handles variant/fixed/configurable pricing, primary and
relational tester/pack categories, parent-only coupons, UTC coupon dates, existing
shipping priority/threshold/free-shipping rules, and payment configuration precedence.
Quote fingerprints include frozen display/reference values, grouping, quantities,
definition identity and resolved commerce outcomes. Adequate remaining-stock changes
do not change the fingerprint. A quote reserves no inventory.

## Snapshots and safety

One order item owns the money for each logical line. Pack components freeze names,
SKU, 5 ml identity, per-pack and total quantities, and reference prices. Components
carry no monetary subtotal. `orders.quote_snapshot` additionally freezes the resolver
output so deferred completeness checks never consult a later catalog definition.

Existing rows receive only new-column historical defaults; existing purchase values
are not updated or inferred. New v1 rows default to snapshot 1, while the v2 writer
explicitly creates version/snapshot 2. New historical exemptions and version changes
are forbidden. V2 purchase snapshots are immutable.

Invoker write guards distinguish real direct service DML from approved owner-run
functions. They protect v2 orders, items and associated effects without a spoofable
session authorization flag. New components have RLS and only service SELECT; no
browser privileges/policies. Restrictive browser-read policies on orders/items also
hide v2 rows, including frozen quote JSON, without changing v1 ownership/Admin read
requirements. Existing owner-only RPC implementations are retained
behind v1/v2 checkout and fulfillment fences and lose direct external EXECUTE.
Admin list summaries mark v2 unsupported; v1 detail refuses v2 until 014.

## Inventory and locks

Physical demand is aggregated over the entire order:
`standalone quantity + sum(pack quantity * component quantity per pack)`.
Each physical variant is decremented once with one inventory movement. Pack parents
have no physical movement. 012 derives effective tester availability from stock and
manual merchandising intent; 013 never changes that manual flag or pack definitions.

Order transaction protocol:
1. Canonicalize, lock the shared `checkout:<UUID>` advisory key, replay/conflict first.
2. Lock all pack parents, then definitions, sorted by UUID.
3. Resolve physical identities; lock all inventory siblings globally by UUID.
4. Lock physical product parents by UUID; reject changed physical identities.
5. Re-read eligibility/prices/demand, lock coupon/configuration rows consistently.
6. Resolve the quote again, check its fingerprint, then write all effects atomically.

READ COMMITTED is mandatory. Quotes do not take reservation locks. New configuration
inserts and publication/edit races require the real-PostgreSQL follow-up below; the
shipping winner and ambiguity check use one statement snapshot.

## Limits and migration recognition

SQL enforces 32768 canonical UTF-8 bytes, 100 raw/canonical logical lines, 100
raw/canonical configurable selections per line, and 2000 resolved component rows.
Counts are physical snapshot rows, not physical units. Widened arithmetic rejects
quantity, demand and monetary overflow. The backend separately bounds transport and
strict request shape; fixed expansion is necessarily resolved in SQL.

The migration compares exact catalog manifests before installation and after it.
Unknown baselines and target drift fail closed. Manifests cover public tables,
columns/column ACLs, constraints, indexes, triggers, policies, table ACLs, function
attributes/bodies/ACLs; no data, generated UUIDs or sequence counters are hashed.
Extension-owned objects are excluded; their installed schemas vary between PostgreSQL
distributions. Application objects and column-level privileges remain exact.
Function body CRLF normalizes to LF, with no other body relaxation. Reruns preserve
data. Later migrations legitimately change this target: do not rerun 013 to repair
a database after 014 or an unknown alteration.

`node server/scripts/refresh-checkout-v2-manifest.mjs` regenerates manifests using
only a fresh disposable PGlite fixture. It reads no env/connection strings and
changes only 013. Manifest regeneration requires review; it is not a way to bless
unknown production state.

## Validation and later work

Focused commands from backend:
`npm run test:checkout-v2:sql`, `npm run test:checkout-v2:api`,
`npm run test:checkout-v2`. The full backend test command includes these tests.
Frontend `npm run test:checkout-v2` verifies the non-operative type contract.

014 owns version-aware fulfillment/cancellation, ledger restoration and eventual
service execution approval. No customer pack cart, builder, persistence or purchasing
UI is introduced here.

Real PostgreSQL, disposable databases only:
- pack checkout versus tester stock/manual/lifecycle saves;
- checkout versus pack definition save;
- mixed-line ordering and shared testers across several packs;
- identical/conflicting v2 submissions and v1/v2 same-token submissions;
- READ COMMITTED refresh after lock waits;
- quote/order races with coupon/payment/shipping changes, including inserted scopes.

Production RPC/permissions/configuration verification, migration approval, 014
acceptance and controlled deployment/release validation remain launch gates.
