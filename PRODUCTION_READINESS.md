# Royal Fusion Production Readiness Guide

This guide tracks what remains before Royal Fusion can be delivered as a secure, client-manageable eCommerce website.

## Current Production Gap

The current app is a strong prototype with a luxury storefront, admin UI, Express API, local JSON persistence, and local uploads.

Before launch, replace prototype systems:

- `backend/server/data/db.json` -> Supabase Postgres
- local customer auth store -> Supabase Auth
- local admin JWT/localStorage flow -> Supabase-backed admin session/role checks
- `backend/server/uploads` -> Supabase Storage
- local blog/page data -> Sanity CMS

## Current Service Fallback Order

The frontend service layer now supports production clients without breaking local development:

1. Supabase for products, categories, reviews, settings, orders, and transactional data.
2. Sanity for blogs, banners, homepage content, and editable content.
3. Existing Express API prototype when production credentials are missing.
4. Local TypeScript fallback data if the API is not running.

This keeps the storefront usable today while giving the production migration a clean switch-over point.

## Required Access From Client

### Supabase

- Project URL
- Anon key
- Service role key for backend-only operations
- Database password if direct CLI migrations are used
- Confirmation of project region

### Sanity

- Project ID
- Dataset name, usually `production`
- API token
- Decision: Sanity Studio inside this repo or separate repo

### Deployment

- Vercel team/project access
- Production domain
- DNS provider access or instructions
- Business email for transactional messages

### Business Setup

- WhatsApp number
- Business phone
- Business email
- Business address
- Social links
- Shipping fee rules
- Return/exchange/privacy/terms text
- Payment method priority: COD, bank transfer, JazzCash, Easypaisa, card

## Recommended Delivery Phases

### Phase 1: Infrastructure

- Create Supabase project.
- Apply `backend/supabase/migrations/001_initial_schema.sql`.
- Apply `backend/supabase/seed/001_starter_catalog.sql`.
- Create storage buckets.
- Configure env vars.
- Create first owner/admin.

### Phase 2: Supabase Integration

- Install Supabase client.
- Add typed Supabase service modules.
- Replace JSON storefront reads with Supabase queries.
- Replace admin create/update/delete with Supabase-backed API routes or Edge Functions.
- Replace local customer auth with Supabase Auth.
- Add profile and admin membership handling.

### Phase 3: Sanity CMS

- Add Sanity schemas for blogs, authors, categories, homepage sections, FAQs, policies, and fragrance guide.
- Add Sanity query service.
- Connect public blogs/pages to Sanity.
- Give client/editor roles only the needed permissions.

### Phase 4: Checkout and Orders

- Validate stock at checkout.
- Validate coupons server-side.
- Create order and order items transactionally.
- Deduct stock safely.
- Add COD/bank transfer flow.
- Add order confirmation email and WhatsApp link.
- Add payment gateway later if needed.

### Phase 5: Admin Hardening

- Add audit logs for every admin mutation.
- Add safer delete flows and archive where appropriate.
- Add order invoice/export.
- Add low-stock alerts.
- Add import/export for products and orders.

### Phase 6: Security Hardening

- Enforce RLS on all Supabase tables.
- Keep service role key server-only.
- Add rate limits for login, contact, newsletter, coupon, and checkout.
- Add CAPTCHA only if spam becomes a real issue.
- Sanitize rich text.
- Validate uploads by MIME type, extension, and size.
- Add Sentry error monitoring.
- Add backup and restore process.

### Phase 7: Testing

- Unit tests: calculations, validators, formatters.
- API tests: auth, coupons, orders, product admin.
- Component tests: cart, checkout, account, product forms.
- E2E tests: customer journey and admin CRUD.
- Lighthouse/performance pass.
- Mobile responsive visual checks.

### Phase 8: Deployment

- Configure Vercel project.
- Set production env vars.
- Deploy frontend.
- Configure API/Edge functions if used.
- Connect domain and SSL.
- Run production smoke tests.
- Handover client docs and admin training.

## Minimum Launch Acceptance Checklist

- Customer can register/login/reset password.
- Admin can login and role restrictions work.
- Client can add/edit/archive products without code.
- Product images upload to cloud storage.
- Products, prices, stock, categories are database-driven.
- Cart and checkout create real orders.
- Admin can update order statuses and tracking.
- Coupons and shipping calculate correctly.
- Blogs/content are editable in Sanity.
- Contact/newsletter submissions persist.
- SEO titles/meta render correctly.
- All production secrets are in env vars only.
- RLS policies are enabled and tested.
- `npm run lint`, `npm run build`, API tests, and E2E smoke tests pass.
- `npm run env:check:prod` passes with production values.
- Backups and monitoring are enabled.

## Non-Negotiable Safety Rules

- Never commit `.env` or production keys.
- Never expose Supabase service role key to the browser.
- Never allow admin writes directly from unauthenticated browser code.
- Never trust frontend validation alone.
- Never delete orders; archive/cancel/refund instead.
- Never let product stock update only on the client.
- Never render CMS rich text without safe serializers/sanitization.
