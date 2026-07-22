# Royal Fusion Production Backend Plan

Royal Fusion should move from the current JSON-backed prototype to a Supabase + Sanity production architecture.

## Recommended Stack

- Frontend: Vite, React, TypeScript, Tailwind CSS
- Database/Auth/Storage: Supabase
- CMS: Sanity
- API layer: thin server routes or Supabase Edge Functions for privileged workflows
- Payments: COD/manual bank first, gateway integration later
- Email: Resend or Brevo
- Monitoring: Sentry
- Deployment: Vercel + Supabase + Sanity

## Supabase Responsibilities

Supabase should own transactional and security-sensitive eCommerce data:

- Customer accounts and profiles
- Admin memberships and roles
- Products, categories, variants, prices, stock, images
- Orders and order items
- Coupons and shipping/payment settings
- Reviews and testimonials
- Contact messages
- Newsletter subscribers
- Admin audit logs

The initial SQL schema is in:

```txt
backend/supabase/migrations/001_initial_schema.sql
```

## Sanity Responsibilities

Sanity should own editorial and marketing content:

- Blogs
- Blog authors/categories
- Homepage content blocks
- Banners/campaign copy
- About page
- FAQs
- Policy pages
- Fragrance guide content

Do not use Sanity as the source of truth for stock, prices, orders, coupons, or checkout.

## Migration Path

1. Keep the current frontend/admin UI.
2. Replace `backend/server/data/db.json` with Supabase tables.
3. Replace local customer auth with Supabase Auth.
4. Replace local uploads with Supabase Storage.
5. Replace local blog/page data with Sanity queries.
6. Keep the service layer names, but change implementations to real APIs.
7. Add admin audit logging for every create/update/delete action.
8. Add production tests and deployment checks.

## Production Security Requirements

- Enable RLS on every Supabase table exposed to the browser.
- Never expose service-role credentials to frontend code.
- Restrict admin writes by role.
- Validate all inputs with schemas on server-side privileged paths.
- Sanitize rich text before rendering.
- Restrict uploads by MIME type, extension, size, and bucket policy.
- Add rate limiting to login, contact, newsletter, coupon, and checkout flows.
- Add strong environment variable validation.
- Add backups, monitoring, and admin activity logs.

## Production Delivery Gates

The project is not deliverable until:

- Supabase schema is applied.
- Auth works for customers and admins.
- Admin dashboard reads/writes real database data.
- Sanity Studio is configured for content editing.
- Checkout creates real orders and validates stock/coupons.
- Media uploads use cloud storage.
- Tests pass for storefront, checkout, admin CRUD, and auth.
- Production deployment has HTTPS, correct env vars, backups, and monitoring.
