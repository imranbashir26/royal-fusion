# Phase 4G-1 — isolated server-delivered blog HTML

Starting checkpoint: `phase2-canonical-variants`,
`f536fb1336e8f7146c977b820d73ef9961d37b76`, empty index, only the intentional
checkoutIntegration modification and root vercel.json deletion. No development
handoff was present. Phase 4B–4F contracts/documentation, the Phase 4G assessment,
actual service/query/rendering code and deployment boundaries were reviewed.
Historical phase descriptions do not establish deployed production state.

## Architecture and isolation

`createPublicBlogHtmlRouter({service, canonicalOrigin})` is an isolated factory
intended for `/blogs` and `/blogs/:slug`. It accepts the existing `BlogV1Service`;
it creates no SDK client and makes no HTTP request to the JSON API. Production
index.js, activation wiring, feature flags, real environment files and frontend
rewrites are unchanged. This router remains unmounted outside disposable fixtures.

The existing repository/source retain native Publish/Unpublish authority, explicit
published perspective, draft/release exclusion, resolved references, deterministic
ordering and duplicate-slug detection. There is no second publication status,
preview path, content fallback or persistent cache. Summary listing uses the existing
body-free query. HTML title, body and metadata come from one service response.

The renderer projects DTO fields through the existing source schemas for validation,
then renders only selected public fields. Shared `blogV1` contracts are unchanged.
Native queries, JSON API behavior, React Portable Text and cart/auth/checkout source
are unchanged. No database fixture or SQL is part of this phase.

## HTML and HTTP contracts

| Outcome | HTML response |
| --- | --- |
| Valid listing or published article | 200, complete HTML |
| Empty first listing page | 200, explicit empty journal, noindex |
| Valid slug missing/unpublished | 404 |
| Listing page beyond available pages | 404; JSON API retains its empty-200 contract |
| Invalid query/slug/URI/extra segment | 400 before source access |
| Mutation method | 405 before body parsing/source access |
| OPTIONS | 204, Allow: GET, HEAD, OPTIONS |
| Upstream, invalid content or rendering failure | 503, generic HTML and Retry-After: 60 |
| HEAD | Same actual status/headers as GET, empty body |
| Injected global limiter | Existing 429 behavior preserved |

The complete document is built before response headers are sent. No partial article
with a successful status is returned after a rendering failure. Static error pages
contain no editorial content, canonical, OG image or upstream exception details.
Diagnostics contain only `blog.html.unavailable` and status 503; a failing diagnostic
transport cannot interrupt the response. There is no readiness/connectivity claim.

Responses use text/html UTF-8, no-store and explicit byte length. `end()` avoids
automatic Express ETag/conditional-response conversion without changing global app
settings. There is no stale-if-error fallback, shared cache or intentional unpublish
delay. Already loaded pages still require navigation/refresh to observe editorial
changes; this is not a realtime unpublish guarantee.

## Rendering and security

Complete documents have DOCTYPE, language, UTF-8, viewport, skip link, semantic
navigation/main/article/listing/footer, author/category labels and UTC publication
and modification dates. Related navigation is limited to Journal/Home/Shop links;
no extra related-article query is added. No application script or hydration payload
is emitted. Editorial values never establish tags, attribute names or canonical
authority. Text and attributes escape ampersands, angle brackets and both quotes.
Unsafe schemes, credentials, protocol-relative URLs and unsafe link characters fail.

`@portabletext/to-html` handles structured nesting. Explicit components preserve
paragraphs, H2/H3, quotes, bold/emphasis, code, underline, strike-through, ordered
and unordered nested lists, safe links and image figures/captions. Source validation
and the missing-component handler fail closed on unsupported structures. Custom
attribute values are validated/escaped; renderer-produced children are the only
trusted markup passed between components. Arbitrary HTML/embeds, inline handlers
and unknown/private source fields are never serialized.

HTML-only CSP denies scripts, script attributes, forms, frames, objects, connections
and other default resources. Images are allowed only from the approved
`https://cdn.sanity.io/images/6n1y88j4/production/` path; styles are self-only.
An inherited upgrade-insecure-requests directive is retained. This changes no API
policy or global middleware. The HTTP loopback browser harness disables only that
HTTPS-upgrade directive in its own disposable Helmet configuration. Production
Helmet, CORS, proxy trust, limiter, authentication, RBAC and CSRF remain untouched.

### Rendering limits

| Limit | Maximum |
| --- | --- |
| Successful HTML UTF-8 output | 2 MiB |
| Aggregate counted editorial text UTF-8 | 1 MiB |
| Article spans | 10,000 |
| Rendering work units (fields/nodes/marks) | 100,000 |
| Body blocks, per-block children/marks/definitions | Existing approved schema limits |
| Generated image width/height parameter | 1–2400 |
| Derived image display height | 1–100,000 |

Injected limits can only lower these maxima. Work/text checks precede schema/body
serialization; final UTF-8 output size is checked before response emission. Exceeding
a limit returns 503, never truncated 200 content. Small fixed error documents are
independent of an intentionally lowered successful-document budget. Actual content
compatibility with these limits requires later separately authorized live review.

## Editorial images

`blogHtmlMedia.js` follows frontend blogImages.ts namespace/geometry rules and is
checked against that unchanged frontend helper. Asset reference, exact CDN path,
project/dataset, dimensions, alt/caption, crop and hotspot are validated/projected.
URL-builder dimensions are bounded; generated URLs retain the validated origin/path
and only controlled query parameters. Original crop/hotspot metadata is respected.
No token, signed credential, asset download or browser SDK client is needed.
Featured images load eagerly, body/listing images lazily; captions remain plain text.

## SEO and pagination

An injected exact credential-free HTTPS origin is required, without path/query/hash.
Tests use only `https://shop.example.invalid`. Host/forwarded headers, browser location
and historical domains never supply authority. Article overrides must match that
origin and exact `/blogs/:slug`, without query/hash. Missing upstream overrides use
the repository's existing fallback. Invalid stored overrides fail closed.

Initial HTML contains title/description fallbacks, one canonical, robots, OG
title/description/url/type, validated OG-image fallback/alt/dimensions and UTC
publication/modification metadata. Editorial noindex is preserved in metadata and
X-Robots-Tag. Empty first pages and fixed error documents are noindex,follow.

Pagination reuses page 1–1000 and pageSize 1–50, default 20. Page one/default size
canonicalizes to `/blogs`; later default-size pages use `?page=n`. Nondefault size
is retained, with parameters ordered page then pageSize. Real Previous/Next anchors
use the same normalization and never enumerate/request page 1001. There is no redirect
or unbounded crawl. The React listing resolver currently lacks this pagination
canonical policy and must be aligned separately before activation.

Sitemap implementation is deferred. Future bounded enumeration must retain native
publication/security rules, approved article canonicals and last-modification dates,
exclude noindex/invalid articles, detect duplicates and fail on upstream errors.
The current pagination ceiling must not silently truncate a future sitemap.

## Dependencies and verification

Backend explicitly declares already installed/locked `@portabletext/to-html` 6.0.0
and `@sanity/image-url` 2.1.1. Only backend dependency metadata is added to the root
lockfile; unrelated package nodes/versions/integrities are preserved. There is no
force fix, override, installation lifecycle execution or runtime upgrade. A focused
SQL-free script is `npm --prefix backend run test:blog-html`.

Fixtures use the real existing GROQ through groq-js over disposable native-shaped documents,
loopback HTTP and synthetic images. Node/browser guards reject unexpected external
traffic. Browser HTML tests run with JavaScript disabled and compare server/frontend
image validation and URLs. Existing browser suites run sequentially without edits.
Full backend/SQL/migration suites are excluded; frontend checkout contracts and browser
tests do not establish database transaction behavior.

### Completed local verification — 2026-10-11

| Gate | Final result |
| --- | --- |
| New renderer/router/content/security HTTP tests | 23/23 passed, including first run and final CSP verification |
| Existing Phase 4B/4D/4F-1 blog tests | 60/60 passed (10 activation, 20 domain, 30 adapter/middleware) |
| SQL-free backend auth/security/source-integrity selection | 47/47 passed |
| Complete existing frontend default suite | 145/145 passed |
| New JavaScript-disabled HTML browser | 8/8 passed |
| Existing blog browser | 13/13 passed |
| Checkout browser | 10/10 passed |
| Variant browser | 10/10 passed |
| Admin Phase 1 browser | 12/12 passed |
| Admin Phase 3 browser | 10/10 passed |
| Admin orders browser | 9/9 passed |
| Customer authentication browser | 1/1 passed |
| Public/admin Contact Messages browser | 9/9 passed |
| All nine browser suites, sequential | 82/82 passed |
| Strict frontend TypeScript and strict renderer/media JavaScript checking | Passed |
| Router JavaScript checking at existing dynamic Express boundary | Passed with noImplicitAny=false; full strict Express typing is not claimed |
| Targeted code/test lint and frontend lint | Passed; two existing StorefrontProvider dependency warnings |
| Frontend production build | Passed; existing large-chunk warning |
| Complete installed dependency tree | Passed |
| Root audit | 17 entries: 0 critical, 9 high, 8 moderate; expected nonzero exit remains |
| Backend/frontend production workspace audits | Both zero |

The final selection contains 357 distinct test cases (130 backend, 145 frontend,
82 browser), without double-counting repeated renderer/browser attempts. Final runs
have zero failures, skips or cancellations. No critical security or checkout
assertion failed. No source was edited while browser suites ran.

#### First-run failures and corrections

- The first targeted lint command used a nonexistent frontend-local executable path.
  The existing root oxlint executable was used; lint passed. No package was installed.
- An additional strict backend all-module type probe returned 74 diagnostics from
  new annotation gaps and the repository's absent Express declarations. Exported
  contracts/helper annotations were added. A follow-up strict helper probe found five
  budget-field typing diagnostics, and a separate non-strict router probe found one
  caption-narrowing diagnostic. Those were corrected; final strict helper and frontend
  checks passed. The router retains the existing dynamic Express typing boundary,
  checked explicitly with noImplicitAny=false; no Express declaration dependency was
  added and no claim of full strict Express validation is made.
- The first new HTML browser attempt reported 0/8 passed because its setup hook could
  not find bundled Chromium. No assertions ran. The new harness now follows the existing
  Royal Fusion convention: try Chromium, then installed headless Google Chrome. No browser
  download or environment change occurred.
- The next attempt passed two cases, then stopped on an ambiguous navigation locator:
  four fixture articles deliberately share the same title. The test now asserts exactly
  one heading link with the intended article href before clicking. No assertion or
  coverage was removed. Remaining cases were not run in that stopped attempt.
- The final new browser run passed 8/8 and all eight existing browser suites passed on
  their first run in this phase. The fail-fast runner stopped each failed attempt and
  retained both earlier browser logs. No timeout increase or arbitrary sleep was used.

Logs, first-attempt failures, audits, sequential runner and integrity evidence are
outside Git at `C:/Users/DCS/.codex/outputs/royal-fusion-phase4g1-20261011/`.
The root audit's remaining Studio/CLI findings are unresolved, not suppressed. The
lockfile changes only the backend workspace entry; all third-party package records,
resolutions and integrity values match committed HEAD.

Protected checkoutIntegration SHA-256 remains
`87dc83af5c5d5d182870a7bea0a7f45b86282c75c2555687d69c6286e18882ac`.
Frontend vercel.json remains
`59f90930c70f98d5925bbecd8aa6847c4a6fc45d241a0d048121b7765d82d4de`;
root vercel.json remains absent. No production entry point, activation, frontend
application source, real environment, SQL/migration, ordering or hosting setting changed.

## UX, deployment and rollback gates

The initial document is accessible semantic HTML, with no React storefront shell,
Tailwind presentation, interactive cart/account controls or hydration. Home/Shop links
return to the existing storefront. The navigation fixture proves anchor behavior,
not complete production cart/SSR integration. Existing React routes remain unchanged.

Future HTML mounting requires a separately approved gate; enabling the JSON blog flag
must not implicitly activate HTML. Preserve global security middleware order, body
parsers and all sibling routes. Later Vercel `/blogs` and `/blogs/**` external rewrites
would precede the SPA catch-all and preserve `/api/**`; status, query, headers and
cache behavior need actual deployment verification. No rewrite has changed here.

Approve the business origin, compatible hosting runtimes/install scopes, actual live
published content/assets, capacity/monitoring, frontend metadata and navigation,
presentation, sitemap policy and independent review before any activation. Node 22.12
meets the scoped backend/frontend graph; the complete Studio/workspace graph needs
22.20 on Node 22.x. Local verification uses Node 24.19.0. Existing Studio/CLI advisories
are not automatically resolved by this work and need an explicit release disposition.

Rollback would restore the reviewed frontend routing/artifact first, then remove HTML
mounting after consumers are restored, while keeping API and commerce policies intact.
The legacy loader's custom historical Published filter may omit native-published
articles; approve that consequence rather than adding a second publication state or
fallback. This foundation does not claim deployed HTML, production readiness or
authorization for live content, service startup or another phase.
