# Phase 4F-1 — controlled, default-disabled blog wiring

Starting checkpoint: `phase2-canonical-variants`,
`fe4ca2750d2308e265717d53b13200b83c28a066`, empty index. Phase 4B contracts,
Studio/security documentation, Phase 4D/4E documentation and the Phase 4F read-only
audit were reviewed. No development handoff was present. Historical production
descriptions are not proof of current production state.

This phase connects the existing factories/provider to the entry points. It does
not activate production, approve an origin, change editorial authority by default,
modify dependencies, start Belmo, execute SQL or deploy anything.

## Backend boundary

`ENABLE_SANITY_BLOG_API=true` is the only activating value. Missing, `false` and
all non-exact values leave existing routing unchanged. Disabled initialization
does not import/evaluate the Sanity-dependent service chain, validate source
configuration, construct an SDK client or fetch content.

`mountSanityBlogApi()` is awaited once after existing Helmet, request context,
redacted logging, exact-origin CORS and the unchanged 400-per-15-minute global
limiter, before JSON parsing. Only `/api/v1/public/blogs` is mounted when enabled.
The existing Phase 4D factory/router, Phase 4B DTOs, validation, published-only
queries, deadlines, no-store responses and method denial are reused.

The trusted server configuration remains pinned to project `6n1y88j4`, dataset
`production`, API `2025-01-01`. `CLIENT_ORIGIN`'s first entry must be the approved
exact HTTPS storefront origin. `SANITY_BLOG_TIMEOUT_MS` defaults to 5000 and accepts
50–10000 milliseconds. No Sanity token is consumed by this public read adapter.

The enabled branch dynamically imports the existing service factory inside its
initialization guard. Import failure records only `blog.module.unavailable`;
configuration/client-construction failures retain `blog.configuration.invalid`.
These failures are caught inside the scoped
activation module. Blog reads return the existing safe 503 envelope, while sibling
routes remain available; invalid query/slug and mutation requests retain their
400/405 behavior. Upstream failures retain the existing safe 503 behavior. Logging
contains only fixed event names and status, never origins, slugs, credentials,
provider errors or stacks. Diagnostic transport failure cannot crash other APIs.
The returned `configured` status describes construction, not live upstream readiness.

The module creates no database objects or standalone server. The application entry
point is not imported by fixture tests because its normal startup has unrelated
runtime/session/server side effects. No health endpoint, global quota or proxy
configuration changes are introduced.

## Frontend boundary

Only `VITE_ENABLE_SANITY_BLOGS=true` selects the new integration. Missing, `false`
and non-exact values preserve the historical storefront and construct no blog API
client. `createBlogIntegration(import.meta.env)` runs once outside React rendering;
rerenders and Strict Mode do not reconstruct the client.

When enabled, `VITE_BLOG_CANONICAL_ORIGIN` must contain the approved exact,
credential-free HTTPS storefront origin without path, query or fragment. No
localhost, browser-origin or guessed production-domain substitute is used.
The project/dataset media namespace remains the reviewed `6n1y88j4`/`production`.
Public requests reuse `VITE_API_URL` (default `/api`), GET, credentials omitted,
no-store and the existing cancellation/deadline/projection safeguards.

Invalid enabled configuration or client construction returns an explicit enabled
but unavailable integration. Listing/detail/homepage blog views display unavailable
states, suppress historical blog loading and issue no new API requests. On blog
routes, metadata is generic/noindex, stale OG imagery is cleared and canonical tags
are removed because no trusted origin is available. It does not revert to legacy
articles or interrupt catalog/cart/authentication. Other routes retain their existing
metadata behavior. Retrying cannot repair build configuration; a corrected build is
required. Fixed diagnostics expose no configuration values or exception text.

Existing `/blogs` and `/blogs/:slug`, preview/detail/related requests and native
Publish/Unpublish authority are preserved. Homepage/banner legacy Sanity reads are
outside the blog-loader switch. No automatic realtime unpublish or caching is added.

## Local verification boundary

Tests use injected raw Sanity-shaped memory fixtures and loopback HTTP, with
outbound network guards. Browser routes fulfill catalog/auth/media responses and
cannot create real orders. They use only `https://shop.example.invalid` for the
canonical origin. No live Sanity connectivity or publishing test is permitted.
Do not edit watched source/tests while browser verification is running.

The existing source-integrity regression retains every entry and assertion; only
the two authorized nonsecret environment-example fingerprints are refreshed.
Commerce/authentication source, SQL, protected checkoutIntegration and frontend
hosting fingerprints remain unchanged. Actual `.env`/`.env.local` files are untouched.

SQL-executing backend suites, including guest-checkout, contact database fixtures,
checkout/fulfillment migration suites and the full backend default script, are
excluded. Their later execution needs separate authorization. Browser checkout,
variants/admin/customer regressions and frontend contract tests provide SQL-free
coverage, not proof of database transaction behavior.

## Completed local verification — 2026-10-11

| Check | Result |
| --- | --- |
| New backend activation tests + existing Phase 4B/4D blog tests | 58/58 passed (8 new activation, 20 domain, 30 adapter/middleware) |
| Focused frontend blog integration/activation | 15/15 passed; included in the complete frontend result below |
| Complete frontend default regression selection | 145/145 passed |
| SQL-free backend auth/cookie/CSRF/security/source-integrity selection | 47/47 passed |
| Blog browser | 13/13 passed, including both new activation/failure-isolation cases |
| Admin Phase 1 browser | 12/12 passed |
| Admin Phase 3 browser | 10/10 passed |
| Admin orders browser | 9/9 passed |
| Customer authentication browser | 1/1 passed |
| Variant browser | 10/10 passed |
| Checkout browser | 10/10 passed |
| Public/admin Contact Messages browser | 9/9 passed |
| All eight browser suites, run sequentially | 74/74 passed |
| Frontend TypeScript/lint/build | Passed; 2632 build modules |
| Targeted backend/test lint | Passed |
| Complete installed dependency tree and workspace depth-zero validation | Both exit 0 |

No test/assertion failures, cancellations or skips occurred. No watched file was
edited during browser execution. Frontend lint retains the two existing
StorefrontProvider hook-dependency warnings; build retains the large-chunk warning.
SQL-free tests do not establish database transaction behavior or production readiness.

The backend package's existing `test` and `test:blogs` selections now include the
new activation file; dependencies and lockfile are unchanged. Use
`npm --prefix backend run test:blogs`, `npm --prefix frontend test` and
`npm --prefix frontend run test:blogs:browser` for these focused gates. The full
backend default script remains excluded here because other selected files execute SQL.

Browser TAP files, fail-fast runner, per-suite counts and nonbrowser results are
retained outside Git in
`C:/Users/DCS/.codex/outputs/royal-fusion-phase4f1-20261011/`.

### Backend startup isolation correction — 2026-10-11

Independent review identified the eager SDK load through the initial static
service import. Only the activation module, its awaited entry-point call, activation
tests and these notes changed in the correction. Global `validateRuntimeEnv()`
and authentication initialization still run first; their failures are not caught
or weakened by the blog initialization guard. Middleware positions are unchanged.

Fresh Node processes install native loader guards before importing activation.
Disabled flags produce zero Sanity-dependent service evaluations, zero client
constructions and zero route registrations. A positive control deliberately
evaluates a disposable replacement module and proves the detector responds.
A separate native SDK-import rejection verifies safe 503/400/405 responses and
continued availability of a sibling service without SDK construction.

Corrected backend verification passed 60/60 blog cases (10 activation, 20 domain,
30 adapter/middleware), plus 47/47 SQL-free authentication/security/source-integrity
cases. Targeted lint, JavaScript syntax and whitespace checks passed. No failures,
skips or cancellations occurred. Frontend files are unchanged from the completed
Phase 4F-1 tree; browser suites were not rerun. SQL and live Sanity remain excluded.
Correction evidence is separate from the original logs at
`C:/Users/DCS/.codex/outputs/royal-fusion-phase4f1-startup-isolation-20261011/`.

## Future activation and rollback gates

Production activation is not authorized. First obtain an approved canonical
origin; explicitly verify Node >=22.12 build/runtime compatibility, live published
content/asset/reference contracts, deployed routing/CORS, shared rate-limit and
upstream capacity, monitoring/readiness and the unresolved security disposition.
Current fixtures do not establish these live properties.

The root dependency-security audit still has 9 high/8 moderate findings in the
Studio/CLI ancestry; the Phase 4F audit found zero backend/frontend production
dependency findings. No upgrade or claim of advisory elimination is made here.
Server-delivered SEO HTML/statuses, pagination canonical policy, sitemaps,
prerendering, webhooks, caching and hosting rewrites remain deferred.

A separately approved release should deploy verified backend support before an
enabled frontend artifact. Backend and frontend flags are independent. Frontend
flags are build-time: activation/rollback requires rebuilding or restoring a
reviewed artifact, not changing browser storage or a URL parameter.

Rollback the frontend first, then disable/remove backend support after consumers
have rolled back. The legacy loader requires historical `status == "Published"`,
so native-published articles lacking that field may disappear from legacy views.
Approve that rollback presentation explicitly; do not add a second publication
state or automatic content fallback. Retain no-store behavior and ordering denial.

This local wiring remains uncommitted and requires independent review. It does not
authorize production services, live content operations or another phase.
