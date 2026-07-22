# Royal Fusion Sanity CMS

Sanity should manage editorial and marketing content, while Supabase remains the source of truth for products, stock, prices, orders, coupons, and checkout.

## Recommended Sanity Documents

- `blogPost`
- `blogCategory`
- `author`
- `homepage`
- `banner`
- `faq`
- `policyPage`
- `fragranceGuide`

Starter schema files are in `schemas/`.

## Setup Options

Option A: Sanity Studio inside this repo

```bash
npm create sanity@latest -- --project <projectId> --dataset production --template clean
```

Then copy `backend/sanity/schemas/*` into the generated Studio schema folder.

Option B: Separate Sanity Studio repo

Use the same schema files, but keep CMS deployment separate from the storefront.

## Production Permissions

Recommended roles:

- Owner/Admin: full Sanity access
- Content Editor: publish blogs, banners, FAQs, homepage, policies
- Blog Writer: create/edit drafts only

## Frontend Integration Plan

1. Install `@sanity/client`.
2. Add `frontend/src/services/sanityClient.ts`.
3. Replace local blog/page data with Sanity GROQ queries.
4. Keep product price/stock/order data in Supabase.
5. Render portable text with safe serializers.

## Environment Variables

```env
VITE_SANITY_PROJECT_ID=
VITE_SANITY_DATASET=production
VITE_SANITY_API_VERSION=2025-01-01
SANITY_API_TOKEN=
```

Only browser-safe read configuration should use the `VITE_` prefix. Write tokens must stay server-side.
