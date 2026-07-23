# Royal Fusion Production Blueprint

Status: Phase 1B implementation specification

Audience: product owner, engineering, QA, operations, and future maintainers

## 1. Product Vision

Royal Fusion is a custom, premium fragrance commerce platform for Pakistan. It must provide a fast, accessible storefront, optional customer accounts, reliable guest checkout, and a constrained administration experience that lets non-technical staff operate the store without editing code or weakening the design.

The launch currency is PKR. Displayed prices include tax; checkout must not add tax again. Launch payments are Cash on Delivery (COD) and bank transfer. Card-payment interfaces may be prepared but must remain disabled until a provider is approved and integrated.

## 2. System Boundaries

| System | Owns | Must not own |
|---|---|---|
| React/Vite on Vercel | Presentation, cart state, public browsing, customer/admin forms | Secrets, authoritative prices, authorization decisions, stock mutation |
| Express API on Belmo | Validation, authorization, checkout orchestration, signed uploads, email dispatch, admin operations | Long-term in-memory state, browser-visible secrets |
| Supabase PostgreSQL | Commerce, customers, orders, inventory, homepage configuration, permissions, audit records | Blog article bodies, media binaries |
| Supabase Auth | Customer and administrator identity, verification, password recovery, sessions | Store permissions by role name alone |
| Cloudinary | Commerce and campaign image binaries and transformations | Product metadata, authorization policy, secrets in the browser |
| Sanity | Blogs, journals, authors, editorial categories and rich editorial content | Products, prices, stock, homepage configuration, orders, settings |
| Resend | Transactional email delivery | Order state, retry source of truth |

The active JSON repository remains a development fallback only until a separately approved migration phase. Production cannot launch with JSON persistence or browser/localStorage customer authentication.

## 3. Production Architecture

```text
Browser
  -> Vercel React application
  -> Express HTTPS API on Belmo
       -> Supabase Auth verification
       -> Supabase PostgreSQL / backend-only RPC
       -> Cloudinary signed media operations
       -> Resend email dispatch
  -> Sanity Content API for public, cacheable blog reads through a repository adapter
```

### Frontend responsibility

- Render responsive storefront, authentication, customer and admin interfaces.
- Hold non-authoritative cart selections and form drafts.
- Send variant IDs, quantities, coupon codes and idempotency keys, never trusted prices.
- Apply route-level code splitting and accessible interaction behavior.
- Display customer-safe errors; never display stack traces or provider responses.

### Backend responsibility

- Validate all request bodies, query parameters and uploaded metadata.
- Verify Supabase access tokens and resolve permission keys server-side.
- Execute privileged commerce operations and transactional checkout.
- Sign Cloudinary upload parameters and perform reference-aware deletion.
- Queue or dispatch Resend events after database commits.
- Return narrow, versioned response models and redact logs.

### Database responsibility

- Enforce keys, relationships, lifecycle constraints, RLS and uniqueness.
- Lock inventory during checkout and make order creation idempotent.
- Preserve financial and audit history.
- Separate safe public settings from protected operational settings.

### Admin responsibility

- Supply validated content within fixed templates and limits.
- Operate only within assigned permission keys.
- Archive used catalog records instead of deleting them.
- Confirm cancellation, refund, media deletion and other destructive operations.

## 4. Storefront Modules

Required before launch:

- Home: announcement bar, hero slider, featured products, best sellers, new arrivals, featured collections, promotional banners and testimonials.
- Catalog: shop, dynamic categories, collections, search, filters, sorting and paginated products.
- Product detail: fragrance details, dynamic variant combinations, stock state, gallery, related products and moderated reviews.
- Cart: line-level selection, variant snapshots, quantities and coupon preview.
- Checkout: guest-first contact/shipping, optional sign-in, COD/bank transfer, server-confirmed totals and retry-safe submission.
- Customer: branded sign-in, sign-up, verification, forgot/reset password, session-expired, profile, addresses and order history. Authentication pages use the Royal Fusion logo, approved perfume imagery and responsive mobile/desktop templates.
- Editorial: blog listing/detail, categories, search, pagination, featured and related articles through a repository interface.
- Informational: about, contact, policies, delivery and returns content.

Explicitly excluded from homepage scope: newsletter section, unrestricted page builders, custom CSS, arbitrary HTML and JavaScript.

## 5. Admin Modules

- Overview: period-based revenue, order counts, pending work, low stock, top products/variants, recent orders and quick actions.
- Catalog: products, dynamic variants, categories, collections, related products and SEO.
- Inventory: balances, low-stock thresholds, manual adjustments and movement history.
- Orders: search, filters, detail, timeline, status workflow, notes, cancellation, refunds and invoice generation.
- Customers: minimum necessary profile, addresses, order history, consent and account state; passwords are never visible or editable.
- Promotions: coupons, scheduled promotions and product/category eligibility.
- Homepage: announcement bar, hero slides, section visibility/order, campaigns, featured assignments and testimonials.
- Media: Cloudinary upload, preview, crop/focal point, replacement, ordering and reference-aware deletion.
- Content: links into Sanity for blogs after integration; no commerce records in Sanity.
- Configuration: shipping, payment activation, public SEO and protected Owner-only tax/invoice settings.
- Access: users, permissions, active sessions and audit logs.

## 6. Data Ownership

| Domain | Source of truth | Read path | Write path |
|---|---|---|---|
| Products, variants, categories, collections | Supabase | Express public catalog API | Express admin API |
| Stock and movements | Supabase | Express scoped APIs | Transaction/RPC through Express |
| Orders, payments, refunds | Supabase | Express customer/admin APIs | Express transactional services |
| Customers and addresses | Supabase Auth + Supabase | Express customer/admin APIs | Customer-scoped or privileged Express APIs |
| Homepage and campaigns | Supabase | Express public homepage API | Express admin API |
| Reviews and testimonials | Supabase | Express public API | Express moderation API |
| Blogs and journals | Local repository initially, Sanity later | Blog repository | Local release process, later Sanity Studio |
| Commerce images | Cloudinary with Supabase metadata | Responsive Cloudinary URLs | Signed backend flow |
| Emails | Supabase outbox/event record + Resend | Administrative delivery status | Backend worker/dispatcher |

## 7. Integration Ownership

- Supabase secret access is backend-only. Browser Supabase access is limited to Auth and explicitly RLS-safe customer operations where approved.
- Cloudinary signatures, API secrets, deletion and replacement are backend-only.
- Resend credentials and dispatch are backend-only. Email failure never rolls back an already committed order.
- Sanity public reads use project/dataset identifiers only. Write tokens remain outside Vite and the Royal Fusion frontend.

## 8. Launch Scope

### Required before launch

- Supabase-backed catalog, variants, inventory, checkout, orders, customers and admin operations.
- Supabase Auth customer/admin sessions and permission enforcement.
- COD and bank-transfer workflows; card disabled.
- Cloudinary commerce media, Resend notifications, invoice generation and audit logs.
- Homepage management described in this blueprint.
- Blog listing/detail using the repository abstraction and local structured content.
- Responsive, accessibility, security, backup and monitoring gates in the roadmap.

### Recommended before launch

- Cancellation request self-service, customer-visible order timeline, admin report export and visual regression coverage.
- Sanity blog integration if content operations require independent publishing at launch.

### Safe for later

- Card provider integration, MFA enforcement, advanced reporting, customer segmentation and multi-language content.

### Not recommended

- Direct browser privileged writes, editable financial totals, hard deletion of financial history, unrestricted page building, custom CSS/HTML/JavaScript fields, or duplicate commerce ownership in Sanity.

## 9. Non-Functional Targets

- Mobile p75 LCP <= 2.5 s, INP <= 200 ms and CLS <= 0.1 on representative production traffic.
- Initial route JavaScript target <= 250 kB compressed; no unexplained output chunk above 500 kB uncompressed.
- Public catalog API p95 <= 500 ms excluding network transit; checkout API p95 <= 1.5 s excluding asynchronous email.
- WCAG 2.2 AA for launch-critical routes.
- API list endpoints use server pagination and narrow fields; default 20 and maximum 100 rows.
- Daily database backup with a documented restoration test at least quarterly.
- 99.9% monthly target availability for the storefront/API, excluding provider-wide incidents.

## 10. Backup and Restoration Responsibility

- The configured database backup provider creates and retains daily backups according to the approved retention policy.
- Operations monitors daily completion, records failures and confirms Cloudinary retention remains independent from database backups.
- Engineering owns the versioned restore runbook, performs quarterly restoration tests in an isolated environment and executes an approved production restore.
- The Owner authorizes the production recovery point and restoration window after engineering explains expected data loss and service impact.
- Final provider configuration and named operators remain open until recorded in `DECISIONS_AND_OPEN_ITEMS.md`.
