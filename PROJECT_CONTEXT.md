# Royal Fusion Project Context

## Project Purpose

Royal Fusion is a luxury perfume eCommerce website for a premium fragrance brand. The goal is to deliver a polished storefront and a secure, client-manageable admin system where non-technical staff can manage products, categories, orders, coupons, banners, blogs, testimonials, reviews, newsletter subscribers, contact messages, SEO, shipping, payments, and website settings without editing code.

The design direction is royal, opulent, and conversion-focused: ivory, champagne gold, burgundy, marble cream, elegant serif headings, refined animations, and premium fragrance boutique presentation.

## Current Status

The project is currently a strong production-oriented prototype, not yet a final production deployment.

Completed:

- Luxury React storefront with homepage, shop, product detail, collections, attars, blogs, blog detail, about, contact, cart, checkout, wishlist, and not found pages.
- Premium preloader with Royal Fusion logo, loading bar, velvet curtain reveal, and synced hero animation.
- Sticky navbar, mobile drawer, search overlay, cart drawer, wishlist, WhatsApp button, footer, and mobile bottom bar.
- Zustand cart and wishlist persistence.
- Customer account modal with sign in, sign up, logout, and profile update.
- Customer signup/login supports email or phone, requiring at least one contact method.
- Admin dashboard prototype with protected routes and role-based navigation.
- Express API prototype with admin auth, public storefront endpoints, admin resource CRUD, orders, coupons, contact, newsletter, and media uploads.
- Local JSON database prototype in `backend/server/data/db.json`.
- Seven real Royal Fusion product images optimized as WebP and added to the current catalog.
- Supabase migration and seed files prepared.
- Sanity schema starters and query notes prepared.
- Optional Supabase/Sanity frontend clients added with fallback behavior.

Current product catalog:

- SHAHEEN
- FLORAL FUSION
- VOICE OF HEART
- PITCH BLACK
- BARAAN
- CHANGE
- CRIMSON CRYSTAL

## Tech Stack

Frontend:

- Vite
- React
- TypeScript
- Tailwind CSS
- React Router DOM
- Framer Motion
- Zustand
- Lucide React

Prototype backend:

- Node.js
- Express
- JSON file persistence
- JWT admin auth
- bcrypt password hashing
- Multer local uploads
- Zod validation
- Helmet
- CORS
- express-rate-limit

Production migration target:

- Supabase for database, auth, storage, and transactional eCommerce data.
- Sanity for editorial CMS content.
- Vercel or similar static/frontend deployment.
- Optional server routes or Supabase Edge Functions for privileged backend operations.

## Important Folders

- `frontend/src/pages`: public route pages.
- `frontend/src/components`: shared UI, layout, home, product, account, and animation components.
- `frontend/src/admin`: admin dashboard UI.
- `frontend/src/services`: frontend service layer and API clients.
- `frontend/src/store`: Zustand cart, wishlist, and customer auth prototype stores.
- `frontend/src/storefront`: storefront data provider.
- `backend/server`: Express API prototype.
- `backend/server/data/db.json`: local prototype database.
- `backend/server/uploads/products`: optimized product image assets served by the prototype API.
- `backend/supabase/migrations`: production Supabase SQL schema.
- `backend/supabase/seed`: starter SQL seed from current prototype data.
- `sanity/schemas`: Sanity Studio schema starters.
- `sanity/queries.md`: GROQ query starters.

## Local Setup

Install dependencies:

```bash
npm install
```

Run frontend only:

```bash
npm run dev
```

Run API only:

```bash
npm run dev:backend
```

Run full local stack:

```bash
npm run dev:full
```

Local URLs:

- Frontend: `http://localhost:5173`
- API health: `http://127.0.0.1:4177/api/health`

Create an admin user in the prototype API:

```bash
npm run admin:create -- --email owner@example.com --password "StrongPassword123!" --name "Owner Name"
```

## Deployment Setup

Current deployment status:

- Production deployment is not complete.
- The Vite frontend can build successfully.
- The Express API is a prototype and should not be treated as final production infrastructure.
- Supabase and Sanity production integration scaffolding exists, but real credentials/projects are not connected yet.

Recommended production deployment:

- Frontend on Vercel.
- Supabase for Postgres database, Auth, Storage, and RLS-protected data access.
- Sanity hosted Studio for CMS content.
- Optional server routes or Supabase Edge Functions for privileged writes, order workflows, webhooks, and integrations.

Supabase setup artifacts:

- `backend/supabase/migrations/001_initial_schema.sql`
- `backend/supabase/seed/001_starter_catalog.sql`
- `backend/supabase/README.md`

Sanity setup artifacts:

- `sanity/schemas/*`
- `sanity/queries.md`
- `sanity/README.md`

## Environment Variables

Do not commit real secret values. The repo should only include names/placeholders.

Current/prototype variables:

- `PORT`
- `CLIENT_ORIGIN`
- `JWT_SECRET`
- `ADMIN_SETUP_KEY`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_NAME`

Supabase variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Sanity variables:

- `VITE_SANITY_PROJECT_ID`
- `VITE_SANITY_DATASET`
- `VITE_SANITY_API_VERSION`
- `SANITY_API_TOKEN`

Monitoring/email variables:

- `SENTRY_DSN`
- `RESEND_API_KEY`

Important rule:

- Never expose `SUPABASE_SERVICE_ROLE_KEY`, `SANITY_API_TOKEN`, or other privileged secrets in browser/Vite code.

## CMS And Admin Workflow

Current prototype admin:

- Admin login exists at `/admin/login`.
- Admin dashboard routes exist for products, categories, orders, customers, coupons, banners, blogs, testimonials, reviews, newsletter, contact messages, settings, SEO, and users.
- Admin routes are protected by JWT auth and role permissions in the Express prototype.
- Admin resource forms have frontend and backend validation for important fields.
- Media upload currently writes to local `backend/server/uploads`.

Production workflow target:

- Products, categories, prices, stock, coupons, orders, reviews, shipping, payments, customers, newsletter, contact messages, and settings should move to Supabase.
- Blogs, authors, blog categories, homepage content, banners, FAQs, policies, and fragrance guide content should move to Sanity.
- Admin dashboard should remain the management interface for eCommerce/transactional operations.
- Sanity Studio should be used for editorial content and safe text/image updates.

Current service fallback order:

1. Supabase/Sanity clients when env vars are configured.
2. Express prototype API.
3. Local TypeScript fallback data.

## Security Decisions

Already implemented in prototype:

- Admin passwords are hashed with bcrypt.
- Admin API uses JWT auth.
- Admin roles and permissions are defined.
- Protected admin routes exist.
- Express API uses Helmet.
- CORS is restricted by configured origins.
- Basic rate limiting is enabled.
- Request body sanitization exists.
- Zod validation exists for critical backend inputs.
- Product/admin forms include validation.
- Environment validation checks core runtime secrets.

Production security decisions:

- Use Supabase Auth for customer and admin identity.
- Use Supabase Row Level Security on all exposed tables.
- Keep service role credentials server-only.
- Store product/media assets in Supabase Storage with strict bucket policies.
- Use Sanity roles for content editors and blog writers.
- Add admin audit logs for all create/update/delete actions.
- Add server-side stock validation during checkout.
- Do not trust frontend validation alone.
- Do not delete orders; cancel/refund/archive instead.

Known prototype limitations:

- Customer auth is currently browser/localStorage based and must be replaced with Supabase Auth before production.
- Admin JWT is currently stored client-side and should be replaced/hardened in the production auth flow.
- Local JSON persistence is not production-safe.
- Local uploads are not production-safe.
- Real payment integration is not complete.

## Known Issues And Gaps

- Supabase project is not connected yet.
- Sanity project is not connected yet.
- Vercel/domain deployment is not configured yet.
- Product/order/admin data still persists to local JSON in the prototype API.
- Customer profile/account data still uses local browser storage.
- Checkout creates prototype orders only.
- Payment gateway integrations are not live.
- Email/WhatsApp automation is not live.
- No complete E2E test suite yet.
- No production monitoring or error tracking configured yet.
- No final client training/handover package yet.
- Worktree may contain many uncommitted/untracked files from ongoing development.

## Testing Commands

Lint:

```bash
npm run lint
```

Production build:

```bash
npm run build
```

API smoke test:

```bash
npm run api:smoke
```

Production environment readiness check:

```bash
npm run env:check:prod
```

Expected today:

- `npm run lint` should pass.
- `npm run build` should pass.
- `npm run api:smoke` should pass.
- `npm run env:check:prod` should fail until real Supabase/Sanity production env vars are supplied.

## Next Steps

Recommended order:

1. Create/connect Supabase project.
2. Apply `backend/supabase/migrations/001_initial_schema.sql`.
3. Apply `backend/supabase/seed/001_starter_catalog.sql`.
4. Create Supabase Storage buckets for product images and site assets.
5. Replace local customer auth with Supabase Auth.
6. Replace JSON product/category/order/coupon/settings persistence with Supabase.
7. Connect admin dashboard CRUD to Supabase-backed APIs or Edge Functions.
8. Create/connect Sanity project.
9. Add Sanity Studio using the schemas in `sanity/schemas`.
10. Connect blogs, homepage content, banners, FAQs, policies, and fragrance guide to Sanity.
11. Replace local uploads with Supabase Storage.
12. Finalize checkout, stock deduction, coupons, shipping, and order confirmation.
13. Add payment method flow: COD/bank transfer first, then JazzCash/Easypaisa/card if required.
14. Add email and WhatsApp notifications.
15. Add E2E tests for customer checkout and admin CRUD.
16. Configure Vercel deployment, production env vars, domain, SSL, monitoring, and backups.
17. Prepare final client documentation and admin training notes.

## Guidance For A New Codex Session

If this project is opened in another Codex account, start by reading:

1. `PROJECT_CONTEXT.md`
2. `PRODUCTION_READINESS.md`
3. `BACKEND_PLAN.md`
4. `backend/supabase/README.md`
5. `sanity/README.md`
6. `ADMIN_MANAGEMENT_DOCS.md`

Then inspect current files before making changes, because the repo is actively evolving.
