# Admin Dashboard Specification

## 1. Design Principles

- Operational, quiet and scan-friendly; no decorative charts without a decision-making purpose.
- Permission-aware navigation is a convenience only. Every API action is authorized independently.
- Forms use fixed templates, constrained fields and previews. No custom CSS, arbitrary HTML/JavaScript or unrestricted page builder.
- List pages use server pagination, URL-backed filters and debounced search.
- Destructive or financial actions require explicit confirmation and produce audit records.

## 2. Navigation

### Shared navigation

Dashboard, Products, Categories, Collections, Inventory, Homepage, Media, Blogs, Testimonials and Content SEO.

### Owner additions

Orders, Customers, Coupons, Shipping, Payments, Tax, Invoice Settings, Users and Access, Reports, Audit Logs and System Settings.

Manager must not see or retrieve Owner-only data. Blogs opens the local content workflow initially and Sanity Studio after integration.

## 3. Dashboard Overview

Controls: period selector (today, 7, 30, 90 days and custom), optional comparison period, refresh and export where permitted.

Required summaries:

- Gross revenue from non-cancelled, eligible paid/delivered orders; definition displayed in a tooltip.
- Orders by actionable state, pending cancellation requests and bank transfers awaiting verification.
- Low-stock active variants with SKU, product, attributes, balance and threshold.
- Best-selling products and variants from eligible completed order items; manually pinned products are visibly labelled.
- Recent orders with order number, customer label, total, payment, fulfilment and age.
- Quick actions permitted for the current user.

No chart loads all orders into the browser. Aggregation occurs in SQL views/functions or narrow backend queries.

## 4. Products and Variants

### Product list

Columns: thumbnail, name, status, categories, active variants, price range, stock summary, featured state and updated time. Filters: status, category, collection, availability, featured, bestseller and updated range. Search: name, slug or SKU. Default page size 20.

Bulk actions: publish eligible drafts, archive unused products, assign category/collection, set featured state and export. Bulk price or stock changes are not allowed without a dedicated reviewed workflow.

### Product editor

Sections: identity, fragrance details, categories/collections, variants, media, related products, merchandising, SEO and publishing.

Limits:

- Name 2-80 characters; slug 2-100 lowercase URL-safe characters.
- Short description 20-180; full description 20-5,000 plain/rich-safe characters.
- SEO title <= 60; SEO description 70-160.
- Fragrance note label <= 40; up to 20 notes per tier.

Draft may be saved with incomplete optional data. Publish requires at least one active in-stock-or-backorder-permitted variant, unique valid SKU, regular price, primary 4:5 product image, alt text, category and SEO fields.

### Variant editor

A row/grid editor supports unlimited variants and dynamic attribute definitions. Each row shows attribute combination, SKU, regular/sale/cost price, stock, threshold, weight, active state, media and display order.

- Cost price is masked/omitted unless `catalog.cost.read` is granted.
- Attribute combinations and SKUs are unique.
- Variants referenced by orders show Deactivate, never Delete.
- Stock is changed through an inventory adjustment dialog, not direct row editing after launch.
- Unsaved duplicate combinations and invalid sale prices are blocked inline and server-side.

## 5. Categories and Collections

Lists support search, active/status filters and drag ordering followed by an explicit Save order command.

Category form: name, slug, description, 4:5 image, alt text, status, display order and SEO.

Collection form: name, slug, description, 4:5 card image, optional desktop/mobile banner, visibility, featured state, display order, start/end schedule, product assignment and SEO. End must be later than start.

Archiving a category/collection does not archive assigned products. Deletion is blocked while referenced unless assignments are deliberately removed.

## 6. Inventory

Inventory list columns: product, variant attributes, SKU, stock, threshold, availability and last movement. Filters include low stock, out of stock, active state, product, category and movement reason.

Adjustment dialog requires variant, increase/decrease, positive quantity, reason and note. It previews resulting stock and rejects negative balances. Each adjustment is atomic and audited.

Movement history is immutable and paginated. Cancellation/refund returns link to the order and cannot be manually edited.

## 7. Orders

### Order list

Search order number, customer email/phone or tracking reference. Filter by order, payment and shipping status, method, date and amount. Columns use snapshots, not live product names/prices.

### Order detail

Sections: summary, customer/shipping snapshot, item/variant snapshots, totals, payment, shipment, timeline, internal notes, customer-visible notes, cancellation/refunds, invoice and audit entries.

Actions are offered only for valid transitions. Each transition requests a reason and uses optimistic concurrency. Refund and cancellation approvals require Owner permission and a confirmation summarizing financial and inventory effects.

Invoices are generated from immutable order and legal-setting snapshots. Orders, items, payments, refunds, invoices and history cannot be hard-deleted.

## 8. Customers

Owner-only at launch unless a later permission grants carefully scoped access. Display only what operations require: contact, account state, addresses, consent, order count/spend and history. Mask private fields in list views.

Administrators never view, set or reset customer passwords. Account suspension requires a reason and must not erase order history. Internal notes are audited and never customer-visible.

## 9. Coupons and Promotions

Coupon editor: code, type, amount/percentage, maximum discount, minimum subtotal, product/category scope, total/per-customer limits, start/end and active state. It previews example calculations using fictional amounts only.

Promotions support product, collection or site placements, schedule, priority and linked media. Conflicting schedules at the same placement/priority produce a warning and must be resolved before publication.

## 10. Homepage Management

The homepage screen contains fixed sections only:

1. Announcement bar
2. Hero slider
3. Featured products
4. Best sellers
5. New arrivals
6. Featured collections
7. Promotional banners
8. Testimonials

Each section has visibility, display order and optional schedule. Preview modes are desktop (1440 px), tablet (768 px) and mobile (390 px) within fixed templates.

### Hero slide editor

- Desktop and mobile image, title (max 60), description (max 160), CTA (max 24), internal destination or validated HTTPS URL, alignment, order, active state, dates and autoplay interval.
- Desktop and mobile safe-area overlays appear in preview.
- Each slide autoplay interval is 4-10 seconds, default 6.
- Publishing is blocked without required images and alt text.

Storefront slider provides autoplay, previous/next, pagination dots and swipe. It pauses on hover and keyboard focus, disables autoplay with one active slide, and respects `prefers-reduced-motion`.

## 11. Media Management

The media picker shows thumbnail, dimensions, format, folder, usages and updated date. Uploads are signed by the backend. Users can set alt text/focal point, reorder applicable galleries and replace an asset.

Deletion opens a usage report. Referenced assets cannot be deleted. Replacement first verifies the new asset and updates all selected usages transactionally; old Cloudinary deletion is queued only after references move successfully.

## 12. Reviews and Testimonials

Reviews filter by Pending/Approved/Rejected, rating, product and verified purchase. Moderators may approve, reject and add a public response. Verified purchase is computed from an eligible order item and cannot be manually enabled.

Testimonials are curated separately with visibility, ordering and optional approved image. Publishing requires permission to use the attribution/media.

## 13. Settings

- Public store settings: identity, public support contact, currency display and delivery estimate.
- Shipping: default PKR 300, zone overrides, COD availability and free-shipping threshold.
- Payment activation: COD and bank transfer. Card remains disabled until integration approval.
- Tax/invoice: Owner-only tax-inclusive display configuration and protected legal fields.
- Credentials are deployment secrets and never dashboard fields.

## 14. Common Interaction States

- Loading: table skeleton preserving final column widths; action buttons disabled only when dependent data is pending.
- Empty: name the missing resource and show one permitted primary action.
- Failure: customer-safe message, request ID and retry; preserve form draft.
- Success: concise toast and updated data; financial transitions also show a durable timeline entry.
- Offline/network loss: preserve unsaved non-sensitive drafts locally for the current tab only; never cache passwords, tokens, cost exports or customer records.
- Session expiry: stop mutations, retain safe form draft in memory and route to the branded session-expired page.

## 15. Responsive and Accessibility Rules

- Mobile tables become labelled rows or horizontal data grids with a clear scroll affordance; critical identity/action columns remain visible.
- Filters use a mobile sheet and desktop toolbar. Active filters are removable chips with accessible names.
- Forms use one column on mobile, two only when field relationships remain clear.
- Focus is moved into dialogs and restored to the trigger. Escape closes non-destructive dialogs.
- Confirmation dialogs name the resource and irreversible effect; typing confirmation is reserved for high-impact operations.
- Touch targets are at least 44 by 44 px, focus indicators are visible, errors are associated with fields and color is never the sole status signal.
