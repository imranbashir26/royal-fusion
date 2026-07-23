# Role and Permission Matrix

Authorization uses permission keys resolved from active database assignments. Role names provide starter bundles only; API code never authorizes with `role === 'Owner'` or `role === 'Manager'`.

Legend: **Full** = read and mutate, **Read** = safe read only, **Scoped** = explicitly limited operation, **None** = endpoint and data unavailable, **Approval** = may request but not finalize.

## 1. Matrix

| Resource/action | Permission key | Owner | Manager | Enforcement notes |
|---|---|---:|---:|---|
| Dashboard summaries | `dashboard.read` | Read | Read | Manager metrics exclude cost, margin and unnecessary customer data |
| Products | `catalog.manage` | Full | Full | Archive used products; no hard delete |
| Variant public fields | `catalog.manage` | Full | Full | Includes attributes, SKU, sale/regular price, state and ordering |
| Cost price read | `catalog.cost.read` | Read | None | Field omitted from API, export and logs for Manager |
| Cost price change | `catalog.cost.manage` | Full | None | Owner-only audited change |
| Categories | `categories.manage` | Full | Full | Dynamic management |
| Collections | `collections.manage` | Full | Full | Includes schedules and assignments |
| Inventory read | `inventory.read` | Read | Read | Variant-level |
| Inventory adjust | `inventory.adjust` | Full | Full | Reason required; no negative stock |
| Inventory movement delete/edit | none | None | None | Immutable |
| Orders read | `orders.read` | Full | None | Manager has no order/customer access by approved policy |
| Orders transition | `orders.manage` | Full | None | Valid transition and reason required |
| Cancellation request | `cancellations.request` | Full | None | Customer also has own-order scoped ability |
| Cancellation approval | `cancellations.approve` | Full | None | Transactional inventory return |
| Refund read | `refunds.read` | Read | None | Financially sensitive |
| Refund authorization | `refunds.authorize` | Full | None | Amount cap and paid balance checks |
| Customer basic data | `customers.read` | Read | None | Minimum necessary fields only |
| Customer status/notes | `customers.manage` | Full | None | No password controls |
| Coupons | `coupons.manage` | Full | None | Financial promotion authority remains Owner-only |
| Homepage sections | `homepage.manage` | Full | Full | Fixed templates only |
| Hero/campaign media | `media.commerce.manage` | Full | Full | Approved folders/types only |
| Product media | `media.commerce.manage` | Full | Full | Signed backend upload |
| Media delete | `media.delete` | Full | Scoped | Manager can delete only unreferenced assets they can manage |
| Testimonials | `homepage.manage` | Full | Full | Publication and ordering |
| Reviews moderation | `reviews.manage` | Full | Scoped | Manager may moderate/respond without customer private data |
| Blogs/journals | Sanity role | Full | Full | Sanity permissions after integration; no commerce scope |
| Content SEO | `seo.content.manage` | Full | Full | Product, collection, homepage and blog presentation fields |
| Global/public SEO | `seo.global.manage` | Full | None | Domain-wide and organization metadata |
| Shipping settings | `shipping.manage` | Full | None | Includes charges, zones and COD rules |
| Payment activation | `payments.configure` | Full | None | Credentials remain deployment secrets |
| Bank transfer verification | `payments.verify` | Full | None | Audited financial action |
| Tax configuration | `tax.configure` | Full | None | Prices remain tax-inclusive |
| Invoice legal settings | `invoice.configure` | Full | None | Protected legal fields |
| Public store settings | `settings.public.manage` | Full | Scoped | Manager may edit approved content fields only |
| Private/system settings | `settings.private.manage` | Full | None | Never includes deployment secrets in UI |
| Users/roles/permissions | `access.manage` | Full | None | Cannot remove final active Owner |
| Session revocation | `sessions.revoke` | Full | Own only | Manager can revoke own sessions through customer/session API |
| Reports/export | `reports.read` | Full | Scoped | Manager catalog/inventory only; no margin/customer exports |
| Audit logs | `audit.read` | Read | None | Immutable, retained >= 12 months |
| Audit delete | none | None | None | Retention job only after policy permits |
| Deployment/provider secrets | none | None | None | Managed in platform secret stores outside dashboard |

## 2. Sensitive Field Rules

- Cost/margin fields are removed server-side unless `catalog.cost.read` is present.
- Customer addresses, email and phone are returned only for an operational order/customer purpose and never to Manager.
- Passwords, hashes, Auth recovery data, tokens and provider credentials are never returned to either role.
- Payment responses expose method, status, amount and safe reference only; no bank proof private media outside authorized review.
- Audit exports redact tokens, credentials, full provider payloads and unnecessary customer fields.

## 3. Approval and Confirmation Rules

- Cancellation approval, refund authorization, tax changes, invoice legal changes, payment activation and role changes require Owner permission and re-authentication when the session is older than 15 minutes.
- Product/variant archive, referenced media replacement and bulk publication require a named confirmation dialog.
- No role may hard-delete orders, order items, payments, refunds, invoices, inventory movements or audit records.
- The final active Owner assignment cannot be revoked or deactivated.

## 4. Future Extensibility

Future roles are composed from permission keys, not copied conditionals. Likely bundles include Order Manager, Catalog Manager, Content Editor and Read-only Viewer. Adding a bundle must include:

1. Permission and sensitive-field review.
2. RLS/backend authorization tests.
3. Navigation visibility tests.
4. API attempts proving denied resources remain unavailable.
5. Audit records for assignment and revocation.
