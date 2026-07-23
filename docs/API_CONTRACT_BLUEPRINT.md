# API Contract Blueprint

Base path: `/api/v1`. JSON is UTF-8. Public list endpoints are cacheable where specified; all mutations are non-cacheable.

## 1. Contract Conventions

### Success envelope

```json
{
  "data": {},
  "meta": { "requestId": "req_example" }
}
```

### Paginated success

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 0,
    "totalPages": 0,
    "requestId": "req_example"
  }
}
```

`page` starts at 1. Default `pageSize` is 20; maximum is 100. Stable sorting includes an ID tie-breaker. Invalid sort/filter values return 400 rather than being interpolated into queries.

### Error envelope

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Please check the highlighted information.",
    "fields": { "contact.email": "Enter a valid email address." },
    "requestId": "req_example"
  }
}
```

Allowed status classes: 400 validation, 401 unauthenticated, 403 unauthorized, 404 absent, 409 state conflict/idempotency conflict, 422 business-rule failure, 429 throttled and 500 generic failure. Responses never include stack traces, SQL/provider errors, configuration values or credentials.

## 2. Public Storefront Endpoints

| Method and path | Purpose | Cache |
|---|---|---|
| `GET /storefront/home` | Active homepage sections and narrow product/collection cards | Public 60 s, stale-while-revalidate 300 s |
| `GET /catalog/products` | Published products with filters and pagination | Public 60 s |
| `GET /catalog/products/:slug` | Product, active variants, media, related items and review summary | Public 60 s |
| `GET /catalog/categories` | Active categories | Public 300 s |
| `GET /catalog/collections` | Active/current collections | Public 300 s |
| `GET /catalog/collections/:slug/products` | Collection products | Public 60 s |
| `GET /reviews` | Approved reviews by product | Public 60 s |
| `GET /settings/public` | Allowlisted public settings only | Public 300 s |
| `POST /contact` | Validated contact inquiry | None |

Product filters: `category`, `collection`, `attribute`, `minPrice`, `maxPrice`, `availability`, `search`, `sort`, `page`, `pageSize`. Public product cards never include cost price, supplier data or inventory movement details.

Newsletter subscription endpoints and homepage newsletter content are excluded from the approved scope.

## 3. Authentication Endpoints

Supabase Auth owns credentials and token issuance. The application provides branded routes and uses approved Supabase SDK/server verification flows.

| Method and path | Purpose |
|---|---|
| `POST /auth/profile/bootstrap` | Create/repair application profile after verified Auth identity |
| `GET /auth/session` | Return safe current user/session summary and permissions |
| `POST /auth/logout-all` | Revoke all application sessions for current user |
| `POST /admin/sessions/:id/revoke` | Owner revokes an administrator session |

Sign-up, sign-in, verification, forgot password and reset password use Supabase Auth APIs. Passwords are never proxied into logs, stored in profiles or returned to administrators.

## 4. Customer Endpoints

All require a verified customer session except guest checkout.

- `GET/PATCH /customers/me`: minimum profile fields; marketing consent uses explicit timestamped changes.
- `GET/POST /customers/me/addresses`: list/create own addresses.
- `PATCH/DELETE /customers/me/addresses/:id`: update/delete own address, with ownership enforced server-side and by RLS.
- `GET /customers/me/orders`: paginated own orders.
- `GET /customers/me/orders/:orderNumber`: own order detail and customer-visible timeline.
- `POST /customers/me/orders/:orderNumber/cancellation-requests`: request pre-shipment cancellation.
- `POST /customers/link-guest-order`: link an eligible guest order after verified account creation using a short-lived server-issued claim flow; email equality alone is insufficient.

## 5. Checkout and Order Endpoints

### Quote

`POST /checkout/quote`

```json
{
  "items": [{ "variantId": "00000000-0000-0000-0000-000000000000", "quantity": 2 }],
  "couponCode": "OPTIONAL",
  "shipping": { "country": "PK", "city": "Lahore", "postalCode": "" },
  "paymentMethod": "cod"
}
```

Response includes authoritative line prices, subtotal, discount, tax display, shipping and total, plus an expiring quote identifier. It does not reserve inventory or guarantee price.

### Create order

`POST /orders` requires header `Idempotency-Key` containing a client-generated UUID. Body contains variant IDs/quantities, contact, shipping, payment method, optional coupon and optional authenticated address ID. Browser totals are ignored.

```json
{
  "data": {
    "orderId": "00000000-0000-0000-0000-000000000000",
    "orderNumber": "RF-2026-000001",
    "orderStatus": "Confirmed",
    "paymentStatus": "Unpaid",
    "shippingStatus": "Not Fulfilled",
    "currency": "PKR",
    "total": "5300.00"
  },
  "meta": { "requestId": "req_example" }
}
```

The same key and semantically identical request returns the original order. The same key with a different request returns 409. Business failures return stable codes such as `OUT_OF_STOCK`, `COUPON_NOT_ELIGIBLE` or `SHIPPING_UNAVAILABLE`; no fake order is returned.

`GET /orders/:orderNumber/confirmation` requires either the authenticated owner or a short-lived guest confirmation token issued only in the creation response. It returns no administrative notes.

## 6. Admin Endpoints

All endpoints require a verified administrator session and the listed permission. List endpoints support pagination, allowlisted filters and narrow selection.

| Domain | Representative paths | Permission |
|---|---|---|
| Dashboard | `GET /admin/dashboard?period=30d` | `dashboard.read` |
| Products | `GET/POST /admin/products`, `GET/PATCH /admin/products/:id`, `POST /:id/archive` | `catalog.read/manage` |
| Variants | `POST /admin/products/:id/variants`, `PATCH /admin/variants/:id`, `POST /:id/deactivate` | `catalog.manage`; cost fields need `catalog.cost.read/manage` |
| Categories | CRUD plus archive | `categories.manage` |
| Collections | CRUD, assignments and scheduling | `collections.manage` |
| Inventory | list movements, `POST /admin/inventory/adjustments` | `inventory.read/adjust` |
| Orders | list/detail, transition, notes, invoice | `orders.read/manage` |
| Cancellation | approve/reject | `cancellations.approve` |
| Refunds | create/list | `refunds.authorize/read` |
| Customers | list/detail/minimal notes/status | `customers.read/manage` |
| Coupons | CRUD/deactivate | `coupons.manage` |
| Homepage | sections, announcements, hero, assignments | `homepage.manage` |
| Reviews | moderate/respond | `reviews.manage` |
| Testimonials | CRUD/order/visibility | `homepage.manage` |
| Settings | public/shipping | `settings.public.manage` / `shipping.manage` |
| Protected settings | tax, invoice, payment activation | specific Owner-only keys |
| Access | users, roles, permissions, sessions | `access.manage` |
| Audit | paginated immutable list/export | `audit.read` |

Generic `DELETE /resources/:resource/:id` is not part of the production contract. Each resource exposes explicit archive, deactivate or safe-delete behavior.

### Status transition request

```json
{
  "toStatus": "Processing",
  "reason": "Payment instructions verified.",
  "expectedVersion": 4
}
```

The backend validates permission, transition, optimistic version and related payment/shipping state. Conflicts return 409.

## 7. Media Endpoints

- `POST /admin/media/signature`: validates intended folder, asset type, size/dimensions/format metadata and returns short-lived Cloudinary upload parameters. Never returns the API secret.
- `POST /admin/media/complete`: verifies the uploaded Cloudinary asset server-side and records metadata/usage.
- `PATCH /admin/media/:id`: updates alt text, focal point and display order.
- `POST /admin/media/:id/replace`: registers replacement, updates usage transactionally, then queues old asset cleanup.
- `DELETE /admin/media/:id`: succeeds only when no usage remains and the actor confirms the public ID suffix.

Manager access is limited to approved commerce folders. Blog assets are managed in Sanity after integration.

## 8. Blog Repository Contract

Frontend code depends on `BlogRepository`, not Sanity types:

```ts
interface BlogRepository {
  list(input: BlogListInput): Promise<Paginated<BlogCard>>
  getBySlug(slug: string): Promise<BlogDetail | null>
  listCategories(): Promise<BlogCategory[]>
  listRelated(postId: string, limit: number): Promise<BlogCard[]>
}
```

The local implementation reads tracked structured content. A later Sanity implementation maps GROQ results into the same domain models. Public page components must not import Sanity SDK types.

## 9. Rate Limits and Validation

- Authentication: 10 attempts per 15 minutes per IP/account signal, with progressive delays.
- Checkout quote: 30 per 10 minutes per IP/session.
- Order creation: 10 per hour per IP/contact signal plus idempotency.
- Coupon validation: 30 per 10 minutes.
- Contact: 5 per hour per IP/email signal.
- Admin mutation: 120 per 10 minutes per account, with lower limits for uploads/refunds.

Limits are configurable server-side and return `Retry-After`. Validation rejects unknown fields on security-sensitive requests. All IDs are parsed as UUIDs; text length, enum, money, quantity and date ranges use shared schemas.

## 10. Versioning and Deprecation

Breaking changes require a new `/api/vN` path. Additive fields are permitted when clients ignore unknown response fields. Deprecated endpoints remain documented for one release cycle and emit a non-sensitive deprecation header. Frontend and backend deploy compatibility must overlap during rolling deployment.
