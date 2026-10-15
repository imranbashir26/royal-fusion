# Scheduled sale pricing: Stage 2G.3 contract

Requires the exact Release 009 database foundation. No frontend integration or
production activation is included. Missing pricing objects return 503; raw sale
amounts are never used as a fallback price resolver.

The tester API fixture now installs the real post-009 schema in owned native
PostgreSQL 17. `npm run test:tester-catalog` therefore uses the existing full
backend runner (with its PostgreSQL prerequisite checks), like the checkout
aliases. Focused native tester/V2 regressions use its existing `all` group;
scheduled API acceptance is mandatory in `acceptance`, and pure validation/mocked
batching tests belong to `unit`. No pricing RPC is emulated in the native tests.

## Administration and activation

Existing product PUT/POST accepts optional `saleStartsAt` / `saleEndsAt` on
`variants[]` and legacy `variations[]`. There are no product-level schedule
columns or aliases. Tester prices and bounds belong to their independent 5 ml
variant. Pack PATCH/POST accepts `fixedSaleStartsAt` / `fixedSaleEndsAt` in its
definition; configurable packs have no own fixed prices or schedule.

Dates require ISO 8601 with seconds, an explicit Z or ±HH:MM offset, and at most
six fractional digits. Starts are inclusive and ends exclusive. Amounts use
positive PKR values with at most two decimal places, strictly below regular
prices. No percentage sale inputs exist. Existing variant zero-to-null clearing
remains supported; fixed pack zero prices remain invalid.

**Activation gate:** every normal service write rejects non-null schedule bounds
with HTTP 409 / `SALE_SCHEDULING_DISABLED`, including direct service calls and
legacy variations. There is no environment or request override. Stage 2G.4 must
verify the frontend's active-price mapping, boundary refresh, admin omission/null
round trips, and coordinated rollout before a separately reviewed activation
change. Normal unscheduled sales, metadata editing, explicit null bounds, and
sale clearing remain available. An echoed non-null schedule is also gated; omit
unchanged schedule fields when editing an existing scheduled record's metadata.

Omitted bounds reach SQL omitted and preserve stored bounds. Explicit null
clears that bound. Clearing the sale clears both bounds atomically in Release
009. Complete structured variant rows retain the existing required price/stock
contract; they are not partial variant patches. Canonical UUIDs, optimistic
revisions, manual availability, permissions, and audit attribution are retained.
Admin variant DTOs return the **configured** `salePrice`, `saleStartsAt`, and
`saleEndsAt`. Admin pack DTOs return configured `fixedSalePrice`,
`fixedSaleStartsAt`, `fixedSaleEndsAt`, and `configuredSalePrice`.

### Authenticated product detail (Stage 2G.3.1)

`GET /api/v1/admin/products/:id` retains administrator authentication and
`products.read`. Each canonical variant additionally includes database-resolved
`effectivePrice`, `saleActive`, `pricingAt`, and `validUntil`. Its existing
`salePrice` remains the **configured** amount, even before activation or after
expiration; it is not the public active-only sale field.

Pricing uses the existing service-only `catalog_sale_prices_009` resolver and
includes draft, inactive, unavailable, and out-of-stock variants. Only variants
belonging to the authorized product are requested, in batches of at most 100.
Each batch retains its own database instant. Missing/invalid pricing, a validity
boundary crossed between batches, or a changed catalog revision fails closed
with 503 / `CATALOG_PRICING_UNAVAILABLE`; there is no raw-sale fallback.

List and mutation responses retain their existing DTOs; reload detail after a
successful edit to obtain current pricing. The four new read-only fields must
be omitted from structured variant write payloads (which remain strict).
This read does not enable scheduling writes or change public visibility.

## Public variant prices

`GET /api/v2/public/catalog/variant-prices?ids=<uuid>,<uuid>`

One to 100 unique UUIDs; no other query fields or caller clock. Returns:

```json
{
  "data": {
    "currency": "PKR",
    "items": [{
      "variantId": "uuid",
      "productId": "uuid",
      "regularPrice": 2900,
      "effectivePrice": 2450,
      "price": 2450,
      "salePrice": 2450,
      "saleActive": true,
      "pricingAt": "database ISO instant",
      "validUntil": "next database boundary or null"
    }]
  },
  "meta": { "requestId": "request identifier" }
}
```

Prices come from `storefront_variant_prices`, without backend time arithmetic.
The privileged backend also filters Published/active standard or tester parents
and active/available variants. Hidden and unknown IDs are omitted identically.
Configured future amounts and private records are not returned. `salePrice` is
null unless the database reports an active discount. `price` aliases
`effectivePrice`; `regularPrice` always retains the stored regular amount.

## Tester packs and components

Existing `/api/v2/public/tester-packs` list/detail DTOs add the same seven pricing
fields: `regularPrice`, `effectivePrice`, `price`, `salePrice`, `saleActive`,
`pricingAt`, `validUntil`. Public `fixedSalePrice` is also active-only. Fixed
charges come from the pack's own database-resolved price. Component reference
prices never override that charge. Configurable parent regular/effective/price
fields are null; chosen quantities are summed from component `effectivePrice`
values for display. Final configurable totals remain PostgreSQL checkout's
responsibility. No new pack shopping workflow is introduced.

Components and allowed variants expose the same regular/effective/active pricing
fields. Publication, membership, manual availability and stock rules still
determine which options are exposed. Source IDs, configured future sale amounts,
private definition hashes, and admin diagnostics are omitted from public DTOs.

`catalog_sale_prices_009` is called only by trusted backend code, with deduplicated
UUID batches of at most 100 variants and 100 packs. Each batch has one database
instant; if a multi-batch read crosses an earlier declared boundary, the whole
response fails closed with 503 instead of locally repricing. Requests scale by
batch count, not by product count. No new SQL grants are needed.

All public pricing responses use `Cache-Control: no-store`. Stage 2G.4 must refresh
at `validUntil`, after returning to a suspended tab, and before requesting a new
checkout quote. Prices are advisory; existing checked V1/V2 quote confirmation,
retirement, immutable committed replay, and ordering-disabled gates remain the
authority for purchases. Release 009 must be installed before deploying these
backend read paths. This document does not authorize either operation.
