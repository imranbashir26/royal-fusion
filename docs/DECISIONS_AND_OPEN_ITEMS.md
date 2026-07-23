# Decisions and Open Items

## 1. Approved Decisions

### Platform and ownership

- Frontend: React/Vite on Vercel.
- Privileged API: Express on Belmo.
- Transactional database and Auth: Supabase.
- Commerce media: Cloudinary through backend-authorized flows.
- Blogs/journals: local repository initially, Sanity later without public-page redesign.
- Email: Resend through a database outbox/async dispatcher.
- Homepage, products, orders and commerce settings remain outside Sanity.

### Payments, currency and tax

- Launch payments: COD and bank transfer.
- Card architecture may be prepared but remains disabled until provider approval.
- Currency: PKR.
- Displayed prices include tax; checkout does not add tax again.
- Tax configuration and invoice tax breakdown are Owner-only and configurable.

### Shipping

- Pakistan-wide delivery.
- Default charge: PKR 300.
- Optional city/zone overrides, configurable free-shipping threshold and delivery estimate.
- COD availability may vary by zone.

### Orders and finance

- Order statuses: Pending, Confirmed, Processing, Shipped, Delivered, Cancelled, Refunded.
- Payment statuses: Unpaid, Pending Verification, Paid, Failed, Refunded, Partially Refunded.
- Shipping statuses: Not Fulfilled, Preparing, Dispatched, In Transit, Delivered, Returned.
- Customers request cancellation before shipment; Owner approval is required.
- Shipped orders cannot be directly cancelled.
- Cancellation returns eligible quantities transactionally.
- Refunds require Owner authorization and audit records.
- Orders and financial records are never hard-deleted.
- Invoice format: `RF-YYYY-000001`.

### Catalog

- Products support unlimited dynamic variants.
- Initial attribute definitions are Size or volume, Type and Packaging, managed as data rather than hardcoded storefront values.
- Each variant has stable ID, attributes, unique SKU, regular/sale/cost prices, stock, threshold, weight, state, order, optional media and timestamps.
- Ordered variants/products are archived or deactivated instead of deleted.
- Initial dynamic categories: Men, Women, Unisex, Attars, Gift Sets and Testers.
- Best sellers derive from eligible completed order items with optional manual pin/rank.

### Roles

- Owner has full operational access, including finance, access control, protected settings, reports and audit logs.
- Manager handles catalog, inventory, commerce media, homepage, testimonials, blogs/journals and content SEO.
- Manager cannot access users/roles, refunds, tax, payment credentials, sensitive settings, unnecessary customer data, audit deletion or deployment/provider secrets.
- Authorization uses permission keys, not role-name checks.

### Homepage and design safety

- Managed sections: announcement, hero slider, featured products, best sellers, new arrivals, featured collections, promotions and testimonials.
- Newsletter functionality is explicitly excluded from the approved homepage and production scope.
- No unrestricted page builder, custom CSS or arbitrary HTML/JavaScript fields.
- Each hero slide supports desktop/mobile images, content, CTA, alignment, order, schedule and a 4-10 second autoplay setting.
- Slider supports controls, dots, swipe, focus/hover pause, one-slide autoplay disable and reduced motion.
- Fixed responsive templates, character limits, aspect ratios, focal points and previews protect the design.

### Media

- Cloudinary folder root and child folders follow `royal-fusion/{products,variants,categories,collections,homepage,campaigns,reviews,blogs}`.
- Main product media: 1600x2000 (4:5).
- Desktop hero: 2400x1200 (2:1).
- Mobile hero: 1080x1350 (4:5).
- Blog cover: 1600x900 (16:9).
- Open Graph: 1200x630.
- Category/collection cards: 1200x1500 (4:5).
- Deletion is reference-aware; replacement verifies new assets before removing old ones.

### Authentication, retention and recovery

- Guest checkout remains available and account creation is optional.
- Supabase Auth replaces browser/localStorage authentication.
- Required branded pages: sign in, sign up, forgot/reset password, verification and session expired. Pages use the Royal Fusion logo, approved perfume imagery and responsive mobile/desktop templates.
- Admin sessions support revocation and future MFA.
- Database backups are daily. The backup provider creates backups, operations monitors completion, engineering maintains and executes the restore runbook, and the Owner authorizes a production restore. Final provider configuration and named operators remain open.
- Cloudinary retains media independently.
- Audit logs are retained at least 12 months.

## 2. Resolved Architecture Clarifications

- Stock is deducted transactionally when launch order creation succeeds; there is no separate reservation at launch.
- Successful launch checkout returns a persisted Confirmed order.
- COD begins Unpaid; bank transfer begins Pending Verification.
- Email delivery happens after commit through an outbox and cannot roll back order creation.
- Public settings and protected settings are stored/read separately.
- The current JSON repository is a temporary fallback, not a production provider.
- The existing Supabase schema is extended through additive migrations only.

## 3. Genuinely Open Items

| Item | Required by | Owner | Blocking effect |
|---|---|---|---|
| Final card-payment provider | Before card phase | Business owner + engineering | Card remains disabled; does not block COD/bank launch |
| Legal invoice values | Before production invoice release | Business owner/legal adviser | Placeholder fields may be built; final invoice launch blocked |
| Zone-specific shipping prices and city mapping | Before shipping-rule production test | Business owner | PKR 300 default can be implemented; overrides blocked |
| Free-shipping threshold | Before checkout production configuration | Business owner | Feature can be built disabled/null |
| Cloudinary account/cloud/folder policy details | Before media integration | Business owner + engineering | Upload integration blocked |
| Resend verified sender domain and addresses | Before production email delivery | Business owner + engineering | Templates/outbox can be built; sending blocked |
| Backup provider/schedule configuration and restore operator | Before launch | Business owner + operations | Production launch blocked |

## 4. Release Review Checklist

The Phase 1B release review confirms these approved decisions; this list does not introduce additional open items:

1. The permission matrix matches real staff responsibilities.
2. Confirmed is the successful initial launch order status.
3. Stock deduction at successful order creation is preferred over temporary reservation.
4. Manager does not manage coupons, shipping or customer/order data.
5. Blog administration moves to Sanity after integration.
6. The seven open items above have named owners and target dates.
