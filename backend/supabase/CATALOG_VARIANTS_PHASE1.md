# Phase 1 catalog persistence

Scope: the protected admin product API persists products and relational inventory
variants together. Storefront loading, product details, cart, checkout, shipping,
payments and `create_order_transaction` are unchanged. No production action is
performed by adding this migration or running these tests.

## Transaction and access

`public.save_catalog_product(p_product_id uuid, p_patch jsonb, p_variants jsonb
default null)` is called only by the backend's service-role Supabase client after
the existing admin identity, `products.manage`, origin and CSRF checks. It runs as
SECURITY DEFINER with an empty search path, a fixed product-column allowlist and
bound JSON values. PUBLIC, anon and authenticated execution is revoked; service_role
is granted execution. The function also requires `auth.role() = 'service_role'`.

One invocation contains the parent write, variant upserts and stock aggregation.
An error rolls back the whole invocation. Updates lock existing variant rows in
UUID order, then the product, following checkout's variant-first locking order.
The existing variant stock trigger stays installed. Product stock is the sum of
active relational variant stock; availability does not change this aggregate.
The final aggregate also handles products with no variants. No second stock store
or variant deletion is introduced. Existing audit logging remains best-effort
after persistence, and existing media claiming remains outside this transaction.

## Input and lifecycle

The simple admin form requires no JSON: absent/empty variations and absent explicit
variants select the single-size path. `bottleSize`, `sku`, `price`, `salePrice` and
`stockQuantity` map to a Size variant. `50ml`, `50 ML` and extra whitespace normalize
to `50 ml`; a zero sale price becomes SQL NULL in the variant. New default variants
are active, and available when stock is greater than zero. Product sale_price may
remain zero for compatibility.

New products with a size create one default variant. Draft/non-sellable products
without a size may have zero stock and zero variants. Stock without a size requires
explicit variants. Active Published products require at least one active variant;
an active zero-stock variant represents a sold-out product. Archival retains all
variant UUIDs; product status/active continue to control publication.

An existing single variant is updated in place. Only supplied scalar fields change
its size, SKU, price, sale price or stock. Stock changes derive availability;
metadata-only edits preserve stock, active and availability. A missing default
variant is created from the locked current product, including its existing stock.
Repeated saves reuse the UUID rather than duplicating stock.

The explicit `variants` contract is an array of 1-50 objects:

```json
{
  "variants": [{
    "id": "existing-variant-uuid-on-edit",
    "optionName": "Size",
    "optionValue": "50 ml",
    "sku": "UNIQUE-SIZE-SKU",
    "regularPrice": 2900,
    "salePrice": null,
    "stockQuantity": 12,
    "active": true,
    "available": true,
    "displayOrder": 0
  }]
}
```

Omit `id` on creation. Option name defaults to Size, active to true, display order
to zero, and omitted availability derives from stock. Omitted/zero sale price
becomes NULL. Each supplied object is a complete variant description, rather than
a field-level patch. An update containing only `variants` is supported.

IDs must belong to the parent product. Without an ID, an unambiguous existing
normalized option or same-product SKU identifies the row; a genuinely new identity
inserts a row. When changing both option and SKU, supply the UUID. Conflicting
identities roll back. SKU and option duplicate checks are case-insensitive.
Omitted rows are retained; explicitly set active=false to retire a row. Existing
nonempty `variations` objects are adapted to this contract; `sizeOptions` remains
descriptive because it does not provide complete inventory/SKU information.

For products already containing multiple rows, changed scalar inventory/price/SKU/
size fields require explicit variants. Metadata edits and unchanged full-form
scalar values are allowed. Phase 1 adds no dedicated multi-size editor. Legacy
variation JSON remains descriptive and is not a synchronized read model; future
editors must use the canonical `variants` returned by admin get/create/update.

## Local verification

```powershell
node --test --test-concurrency=1 backend/server/tests/admin-products-v1.test.js backend/server/tests/catalog-variants.test.js
npm test --workspace backend
node --check backend/server/schemas/catalogVariants.js
node --check backend/server/schemas/productAdmin.js
node --check backend/server/services/productAdminService.js
git diff --check
```

The new tests use disposable in-memory PostgreSQL through PGlite and execute the
actual migrations 001, 002, 005 and 009. Auth helpers/roles are stubbed locally;
pgcrypto installation is skipped because UUID generation is built in. There is
no production connection or environment loading. Tests cover rollback on a later
variant failure, ID retention, normalization, conflicts, aggregates, legacy repair,
drafts, publication, service-only permissions and migration replay. Existing HTTP
tests exercise the actual catalog RPC under the existing API guards. PGlite is
single-connection: hosted PostgREST and concurrent checkout/admin saves still need
staging verification. Absolute stock edits do not detect stale browser values;
Phase 1 adds no inventory adjustment ledger entries or optimistic revisions.

## Deployment plan (not executed)

1. Review migration 009 and confirm the target already has the current products,
   product_variants, stock trigger, product card columns and Supabase auth helpers.
   Do not replay historical migrations/RBAC policies on the audited production DB.
2. Apply only `009_catalog_product_variants.sql` in staging. Check owner, signature,
   SECURITY DEFINER, empty search path and service-only execution. Confirm backend
   calls carry service-role credentials and browser execution is denied.
3. Deploy the backend in staging, exercise simple creation/update, drafts, duplicate
   rollback, structured variants, media, auth and concurrent inventory operations.
4. After review, pause admin writes during rollout; install 009 in production before
   deploying this backend. The migration performs no backfill. Resume admin writes
   after protected API smoke checks. No storefront deployment is required here.
5. Reconcile Baraan separately after approval of its live values. Review other legacy
   products in a later reconciliation task; this migration repairs none automatically.

## Reviewed Baraan reconciliation plan (not executed)

Before any future write, read the live product with UUID
`45852db8-8b83-425e-8d1f-4112958ed505` and all its variants. Confirm the audited
values still hold: RF-BAR-001, 50 ml, price 2900, sale price 0, stock 12, Published,
active, and zero variants. Check no other variant already owns RF-BAR-001. If the
values differ, review them before proceeding; do not copy a stale snapshot.

After migration/backend rollout, use an authorized admin session, permitted Origin
and valid CSRF token to send the existing protected endpoint this minimal request:

```http
PUT /api/v1/admin/products/45852db8-8b83-425e-8d1f-4112958ed505
Content-Type: application/json

{"bottleSize":"50 ml"}
```

The generic RPC creates the missing default variant using price/SKU/sale/stock read
under the product lock. Do not submit stockQuantity=12 from the old audit. If the
live product is unchanged, the resulting row is Size / 50 ml / RF-BAR-001, regular
price 2900, sale price NULL, stock 12, active=true, available=true. The parent stock
stays 12. Verify exactly one row, record its UUID, and verify parent/media values.
Repeating the request preserves that UUID and current stock. SKU/option/constraint
errors roll back the operation; investigate rather than bypassing constraints.

This is an operator plan, not a backfill embedded in application code, and it does
not make the current storefront/cart use variant UUIDs; those remain later phases.
