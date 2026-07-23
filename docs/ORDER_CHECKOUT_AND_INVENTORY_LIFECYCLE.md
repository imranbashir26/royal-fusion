# Order, Checkout and Inventory Lifecycle

## 1. Launch Rules

- Currency is PKR.
- Catalog prices are tax-inclusive. Tax may be displayed on invoices from a configurable calculation/snapshot, but checkout never adds tax a second time.
- Default Pakistan shipping is PKR 300 unless a valid city/zone override or free-shipping rule applies.
- Launch payments are COD and bank transfer. Card remains disabled.
- Guest checkout is available. Account creation is optional before or after purchase.
- The backend is authoritative for variants, prices, stock, coupons, shipping, tax display and totals.

## 2. Checkout Sequence

1. Frontend collects selected cart lines as variant IDs and quantities, contact/shipping details, payment method and optional coupon.
2. Frontend requests an optional quote for display. A quote does not reserve stock.
3. On submit, frontend generates and persists an idempotency UUID for that attempt until success or a deliberate cart change.
4. Backend validates request shape, rate limit, enabled payment method, Pakistan shipping coverage and customer scope.
5. One database transaction:
   - claims/checks the idempotency key;
   - locks requested active variant rows in deterministic ID order;
   - reloads product publication, authoritative prices and stock;
   - validates coupon scope, dates, subtotal and redemption limits;
   - resolves zone/default shipping and free-shipping eligibility;
   - calculates tax-inclusive subtotal, discount, PKR 300 default/override shipping and final total;
   - creates the order, immutable item snapshots and initial histories;
   - deducts variant stock and writes inventory movements;
   - records coupon redemption and initial payment record;
   - inserts required email-outbox events;
   - commits atomically.
6. Successful launch orders return `Confirmed`, `Unpaid` for COD or `Pending Verification` for bank transfer, and `Not Fulfilled`.
7. Frontend treats success only as a successful HTTP response matching the contract with persisted order ID/number. It removes only ordered cart lines.
8. Resend dispatch occurs after commit. Delivery failure is retried and never converts a valid order into failure or rolls back it.

At launch there is no separate stock reservation. Stock is deducted during successful order creation. This keeps available stock authoritative and prevents overselling.

## 3. Guest and Registered Checkout

Guest orders store immutable contact/shipping snapshots and no customer ID. The creation response contains a short-lived confirmation token; it is not reusable for administrative actions.

Registered orders link the verified Supabase Auth profile and may reference an owned address, while still storing snapshots. RLS and backend checks restrict reads to that customer.

After guest purchase, account creation does not automatically expose every order sharing an email. Linking requires verified identity plus a short-lived claim initiated from the order confirmation/email.

## 4. Price and Coupon Calculations

For each line:

```text
unit_price = active sale price when valid, otherwise regular price
line_subtotal = unit_price * quantity
subtotal = sum(line_subtotal)
discount = coupon calculation capped by eligible subtotal and optional max discount
shipping = zone override or PKR 300 default, then free-shipping rule/coupon
final_total = subtotal - discount + shipping
```

Tax is included within the displayed product prices. A configurable invoice tax component may be derived from tax-inclusive totals and stored as a display snapshot; it is not added to `final_total`.

Coupon rules:

- Codes are case-insensitive and normalized server-side.
- Percentage is bounded 0-100 and applies only to eligible lines.
- Fixed cart cannot exceed subtotal.
- Fixed product applies only to eligible product/category lines and cannot make a line negative.
- Free shipping changes shipping only.
- Total and per-customer/guest limits are checked and recorded in the same transaction.

## 5. Idempotency and Concurrency

- `Idempotency-Key` is required for order creation and unique.
- Store a canonical request hash with the key. Same key/same hash returns the original result; same key/different hash returns 409.
- Variant rows are locked in stable order to reduce deadlocks.
- Stock update includes a nonnegative guard. Any failed line rolls back the entire order.
- Coupon usage and yearly invoice/order sequence allocation occur transactionally.
- Client retry after timeout uses the same key. It must not generate a new key until the client knows the prior request did not persist or the cart changed intentionally.

## 6. Order Status Transitions

| From | Allowed next | Conditions |
|---|---|---|
| Pending | Confirmed, Cancelled | Internal recovery/import state; confirmation validates stock if not already deducted |
| Confirmed | Processing, Cancelled | Cancellation only before shipment handoff |
| Processing | Shipped, Cancelled | Shipped requires shipment at Dispatched/In Transit; cancellation requires pre-handoff state |
| Shipped | Delivered | Direct cancellation prohibited |
| Delivered | Refunded | Only after a successful full refund record |
| Cancelled | Refunded | Only when paid funds require a completed full refund |
| Refunded | none | Terminal financial state |

Invalid examples: Confirmed directly to Delivered, Shipped to Cancelled, Cancelled back to Processing, or Refunded to any active state. Corrections require a documented compensating action, not history deletion.

## 7. Payment Status Transitions

| From | Allowed next | Conditions |
|---|---|---|
| Unpaid | Pending Verification, Paid, Failed | COD may become Paid on confirmed collection; bank proof moves to verification |
| Pending Verification | Paid, Failed | Authorized verification or future provider result |
| Failed | Pending Verification, Paid | New bank proof or verified later payment attempt |
| Paid | Partially Refunded, Refunded | Authorized refund record |
| Partially Refunded | Partially Refunded, Refunded | Cumulative refunds <= paid amount |
| Refunded | none | Terminal |

Bank-transfer orders cannot ship until Paid. COD may ship while Unpaid; delivery confirmation should atomically mark payment Paid or create an explicit reconciliation exception visible to Owner.

## 8. Shipping Status Transitions

| From | Allowed next | Conditions |
|---|---|---|
| Not Fulfilled | Preparing | Order Confirmed/Processing |
| Preparing | Not Fulfilled, Dispatched | Reversal only before courier handoff and with reason |
| Dispatched | In Transit, Returned | Tracking/courier reference required |
| In Transit | Delivered, Returned | Provider/admin event |
| Delivered | Returned | Formal return workflow only |
| Returned | none | Terminal shipment state |

Order status Shipped requires Dispatched or In Transit. Order Delivered requires shipping Delivered. A returned shipment does not automatically imply refund; payment/refund follows its own authorized workflow.

## 9. Cancellation

1. Customer may request cancellation while order is Confirmed or Processing and shipment is Not Fulfilled/Preparing.
2. Request records reason and timestamp; it does not change stock.
3. Owner reviews and approves/rejects. Shipped/Dispatched/In Transit orders cannot be approved for direct cancellation.
4. Approval transaction locks the order/items/variants, verifies state, changes order to Cancelled, restores each quantity, writes inventory movements/status history/audit record and creates email-outbox event.
5. If paid, the order remains Cancelled while refund processing occurs; after full refund it may transition to Refunded.

Repeated approval is idempotent and cannot restore stock twice.

## 10. Refunds and Returns

- Only Owner with `refunds.authorize` can create a refund.
- Refund request specifies payment, amount, reason and affected quantities where stock is returned.
- Backend verifies refundable balance and locks payment/refund rows.
- Successful refund writes refund, payment status, optional inventory returns, order history, audit and email event transactionally.
- Partial refund keeps the operational order state unless business rules require a separate return status. Full refund transitions Delivered/Cancelled to Refunded.
- Inventory is restored only for confirmed returned/cancelled quantities in saleable condition. Damaged returns use a movement reason that does not increase sellable stock.

## 11. Email Event Boundaries

| Event | Customer | Admin |
|---|---|---|
| Account created | Verification | None |
| Password recovery | Reset link | None |
| Order committed | Confirmation | New order |
| Order status changed | Relevant status update | None |
| Shipment dispatched | Shipping confirmation | None |
| Cancellation requested | Acknowledgement | Cancellation request |
| Cancellation approved | Cancellation confirmation | None |
| Refund completed | Refund confirmation | None |
| Stock reaches threshold | None | Low-stock alert |
| Contact inquiry committed | Acknowledgement if approved | Contact inquiry |

Outbox insert belongs to the business transaction. Resend delivery is asynchronous with capped exponential retries and a dead-letter/admin-visible failure state. Email payloads contain only required data and no credentials.

## 12. Failure and Recovery Scenarios

- Validation/stock/coupon failure: transaction rolls back; frontend keeps cart, selections, coupon and form values and shows a retryable customer-safe message.
- Database timeout before response: frontend retries same idempotency key; backend returns existing result or completes once.
- Email failure: order remains valid; outbox retries.
- Cloudinary unavailable: checkout is unaffected because order snapshots use already-approved media references.
- Courier update conflict: reject stale version, reload timeline and require operator review.
- Cancellation stock restoration failure: entire cancellation transaction rolls back; order remains unchanged.
- Refund provider succeeds but local confirmation fails: reconciliation job uses provider idempotency/reference and alerts Owner; never issue a second refund blindly.
- Resend/provider/webhook payload errors: log request ID and redacted reason, return generic errors and retain a retryable operational record.

## 13. Invoice Rules

- Number: `RF-YYYY-000001`, allocated transactionally and unique per year.
- Snapshot fields: legal business name/address, support phone/email, prefix, tax information and footer.
- Totals show PKR subtotal, discount, shipping, tax-inclusive notice/configured breakdown and final total.
- Invoice regeneration uses stored snapshots and order data, not current product/settings values.
- Final legal values remain placeholders until Owner provides them.
