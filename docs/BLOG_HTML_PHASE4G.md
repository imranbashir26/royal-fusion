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

## Phase 4G-2A — local storefront integration, verification completed

Starting checkpoint: `phase2-canonical-variants`,
`e316a93f6b9282b228323bea7348ea331b1d0a02`, empty index, only the protected
checkoutIntegration modification and root vercel.json deletion. The Phase 4G-2
assessment and current Phase 4B–4G implementation were inspected; no development
handoff was present. The preceding Phase 4G-1 evidence remains historical evidence.

### Implemented local boundary

`blogDelivery.js` composes the existing JSON router and, only for an explicit injected
`documentMode: true`, the existing HTML router around one validated service. It
constructs no SDK client and adds no publication rules. The production activation
module and index.js remain byte-for-byte unchanged and never import this helper.
JSON-only composition does not evaluate the HTML/Sanity-dependent chain. No production
flag, real environment value, Vercel rewrite or application startup change is included.

`BlogNavigationLink` preserves React Router behavior by default. Under the explicitly
injected native integration's document mode, only `/blogs` and `/blogs/**` links use
document navigation; non-blog links retain SPA routing. Navbar (including portal
mobile navigation), footer, homepage previews, cards, pagination, article body/back
links and shared empty-state links use this wrapper. There is no automatic redirect
or reload effect. Production createBlogIntegration does not select document mode.

The fixed `/blogs/_assets/journal.css` route serves only the module-anchored local
stylesheet, with text/css, nosniff, no-store and HEAD parity. It exposes no directory
or user-selected filesystem path. Journal documents include this stylesheet and
semantic Home/Shop/Journal navigation. Burgundy/ivory/gold presentation, system/Georgia
fonts, responsive article cards/images, focus outlines and the skip link require no
scripts, external fonts or CSP relaxation. The React cart drawer/account modal are
not replicated in HTML; returning to the storefront restores its own providers.

The retained native React path supports `/blogs/` and single trailing article slashes.
Listing metadata follows HTML's page/pageSize canonical normalization, page titles,
description and empty-page noindex policy. Error states remove canonicals; an empty
later page has no canonical. Article query parameters remain rejected before a detail
read. Tracking keys, repeated/unknown parameters and invalid pagination remain invalid.
Only the injected synthetic HTTPS origin supplies canonical authority; no Host header,
browser origin, production redirect or sitemap implementation is added.

### Files in this local change

Created:
- `backend/server/services/blogDelivery.js`
- `backend/server/assets/blog-journal.css`
- `frontend/src/components/blog/BlogNavigationLink.tsx`
- `frontend/tests/blogHtmlIntegrationBrowser.test.mjs`
- `frontend/tests/support/blogHtmlIntegrationBrowserHarness.mjs`

Modified:
- `backend/server/routes/blogHtml.js`
- `backend/server/services/blogHtmlRenderer.js`
- `backend/server/tests/blog-activation.test.js`
- `backend/server/tests/blog-html.test.js`
- `frontend/src/blog/PublicBlogProvider.tsx`
- `frontend/src/components/blog/BlogBody.tsx`
- `frontend/src/components/blog/BlogCard.tsx`
- `frontend/src/components/common/EmptyState.tsx`
- `frontend/src/components/home/BlogsPreview.tsx`
- `frontend/src/components/layout/Footer.tsx`
- `frontend/src/components/layout/Navbar.tsx`
- `frontend/src/components/layout/SeoManager.tsx`
- `frontend/src/pages/BlogDetailsPage.tsx`
- `frontend/src/pages/BlogsPage.tsx`
- `frontend/src/services/storefrontSeo.ts`
- `frontend/tests/blogBrowser.test.mjs`
- `frontend/tests/blogHtmlBrowser.test.mjs`
- `frontend/tests/blogIntegration.test.mjs`
- `docs/BLOG_HTML_PHASE4G.md`

### Initial verification and historical stop

The new harness serves the actual React App and HTML journal on one loopback origin.
It injects the existing native-shaped GROQ fixtures and mocks catalog, customer/admin
sessions and checkout endpoints. Browser/Node guards prevent live upstream access;
no SQL, database fixture or production index import is used. Browser suites ran
sequentially and source was not edited during a running browser suite.

| Gate | Initial observed result |
| --- | --- |
| Backend blog activation/domain/adapter/HTML | 86/86 passed: 11 activation, 20 domain, 30 adapter, 25 HTML |
| Focused frontend blog contracts/SEO | 16/16 passed, included in the full frontend count |
| Full frontend default regression selection | 146/146 passed |
| SQL-free backend authentication/security | 46/46 passed |
| Protected-source bytes test | 1/1 passed; combined SQL-free backend selection 47/47 |
| Frontend TypeScript | Passed |
| Frontend lint | Passed, two existing StorefrontProvider dependency warnings |
| Targeted JS/test lint | Passed before the later test-locator corrections |
| Installed dependency tree, npm ls --all | Passed; manifests/lockfile unchanged |
| Existing HTML browser launch probe | 1/1 selected case passed |
| Initial checkout-blocked integration browser attempt | 11 passed, case 12 failed, remaining 3 not executed |
| Full existing browser regression suites | Not executed: fail-fast runner stopped in the new suite |
| Frontend production build | Not executed: critical checkout verification stop |

That initial integration attempt passed direct/refresh HTML and CSS/CSP checks, actual
desktop/mobile/storefront/footer/preview navigation, keyboard/new-tab/history,
pagination and trailing slash, disabled native/legacy modes, canonical cart UUIDs,
quantities/selections/consumption metadata preservation, customer cookie/session/CSRF
continuity, and administrator restoration. Mobile and desktop synthetic-image
screenshots were inspected. This does not establish hosting-proxy or live-content
compatibility or a complete accessibility audit. Checkout recovery was not established
at this historical stop.

**Critical stop:** `lost checkout response remains frozen through HTML navigation and
retries one idempotent order` failed at the initial submission check (test line 201).
Expected one mock order-endpoint request; observed seven. This occurred before any
HTML navigation. The original fixture simulated response loss by destroying the server
response; the existing checkout browser harness instead aborts its intercepted request. Current
CheckoutClient source issues one POST in its request function and has no retry loop.
At that stop, the evidence could not establish whether the repeats originated in browser
transport, fixture behavior or application behavior. That observation alone did not
justify changing checkout logic or accepting duplicate orders. Distinct logical-order count,
frozen recovery and duplicate-submission assertions were not reached in this case.

The initial runner stopped immediately. No remaining browser or build gate continued
in that attempt; failure documentation and Git integrity inspection followed. No
application checkout/authentication/cart source was changed. The subsequent authorized
fixture-only investigation and correction below resolved this verification blocker.

Earlier failures are retained as historical results:
- Initial backend run: 82/83 passed; its unchanged Phase 4G-1 boundary check rejected
  HTML references in the production activation module. The injected helper was moved
  to the separate, unimported blogDelivery module; production activation bytes were
  restored exactly. Final backend result is 86/86 with all prior assertions retained.
- First selected browser attempt: eight hook failures, zero cases reaching assertions,
  after Chrome's existing 15-second launch timeout. The next full-suite launch attempt
  also timed out before assertions. No launch/assertion timeout was increased.
- A successful launch then failed the first case's cleanup assertion because the
  fixture seeding script accessed sessionStorage in an inaccessible document. Seeding
  now runs only in a JavaScript-enabled document at the loopback origin; page-error
  assertions remain unchanged. No application storage behavior was altered.
- Following attempt: first four passed, then the mobile locator failed. The correct
  Open menu button and portal Mobile menu dialog were selected.
- Following attempt: first six passed, then the article locator assumed the link was
  inside its H3. The existing card wraps the H3 in its link; the selector was corrected.
- Following attempt: first six passed, then that article was incorrectly expected on
  page two. The test now navigates back to its actual first-page fixture before the
  exact single-link assertion. No ordering or pagination contract changed.
- Following attempt: first ten passed, then an administrator locator counted both
  sidebar and dashboard links. It was scoped to the dashboard's main control.
- Initial checkout-blocked attempt: first eleven passed, then the seven-versus-one
  checkout assertion failed. The runner stopped before the subsequent authorized
  investigation, correction and regression/build verification.

Cart assertions retain raw durable journals and use the existing snapshot-plus-delta
projection for consumed quantities. A raw snapshot is not substituted for projected
cart state; no checkout business logic or assertions were weakened.

All logs, stopped attempts, browser runner and images are outside Git at
`C:/Users/DCS/.codex/outputs/royal-fusion-phase4g2a-20261011/`.

### Confirmed checkout investigation and controlled response loss

The subsequent investigation recorded one trusted user click, one trusted form submit
and one application fetch through `handleSubmit`, `submitFrozen` and
`CheckoutClient.request`. Chrome 154.0.8037.99 nevertheless sent seven distinct HTTP
POSTs after the mock called `res.destroy()` before response headers: the first six
arrivals used previously established connections and the last used a fresh connection. These
were actual server arrivals, not OPTIONS, redirects or repeated route-handler counting.
Every arrival carried the identical idempotency identity and request body; the mock
created one receipt. Disabled blog integration and React-free controls reproduced the
transport behavior. The evidence identified Chrome transport retransmissions after
destroyed mock responses, without demonstrating additional application submissions or
a checkout application regression.

The corrected fixture uses Playwright interception for controlled response loss.
`route.fetch({maxRetries: 0, maxRedirects: 0})` must obtain a complete HTTP 200 mock
receipt with the matching idempotency key before the response is disposed and
browser-facing delivery is aborted with `route.abort()`. This completes one upstream
operation and loses only its delivery; it introduces no automatic retry or redirect.
Physical `res.destroy()` remains a separate diagnostic, which recorded one trusted
submit, one application fetch, seven server POSTs, one distinct key and one receipt.
The original exactly-one initial request and receipt assertions were retained.

An outside-repository controlled-loss experiment passed 1/1 before adoption. The
corrected focused checkout scenario then passed 1/1: the frozen attempt and cart
survived HTML Journal navigation and the storefront return; checkout reload restored
the same attempt without another POST. An explicit recovery double-click produced one
additional POST with the same body/key, two total HTTP requests and one total receipt.
The cart was consumed once; a later HTML round trip and success reload produced no
additional request or consumption. This verifies disposable mock recovery and navigation,
not database-level idempotency or production readiness.

Investigation evidence is retained at
`C:/Users/DCS/.codex/outputs/royal-fusion-checkout-investigation-20261011/`.
The controlled-loss experiment, diagnostic, final report and test logs are retained at
`C:/Users/DCS/.codex/outputs/royal-fusion-phase4g2a-checkout-correction-20261011/`.

### Approved test corrections and retained subsequent failures

The subsequent fixture correction changed the integration test and its harness, with
three separately approved assertion/locator corrections in existing browser tests:

- `blogHtmlBrowser.test.mjs`: scope the Shop link to `Main navigation` because both
  header and footer contain valid Shop links; retain the href/navigation assertions.
- `blogBrowser.test.mjs`: expect the documented page-two canonical
  `https://shop.example.invalid/blogs?page=2&pageSize=2`, replacing the historical
  root `/blogs` expectation.
- `blogBrowser.test.mjs`: expect zero canonical links for invalid `/blogs/Upper`,
  retaining its noindex, content, request and security assertions.

No application SEO or checkout logic changed in those corrections. No assertion was
removed, timeout increased or arbitrary sleep introduced. Subsequent failed attempts
also remain recorded in the correction report:

- Two focused attempts passed the one-request/receipt checks but failed a newly added
  seed-versus-persisted cart byte comparison solely because of JSON property ordering.
  The complete parsed cart structure is now compared at that boundary; journal bytes
  and original navigation snapshots remain exact. Final focused result: 1/1.
- A broad attempt had 17 Chrome-launch hook failures at the unchanged 15-second
  timeout, before application assertions. The unchanged subsequent launch succeeded.
- The existing HTML browser run passed two cases before the ambiguous Shop locator
  failed; the approved scope correction yielded 8/8.
- The React blog run passed three cases before the page-two canonical failure; after
  its approved correction, six passed before the invalid-route canonical wait failed.
  The second approved correction yielded 13/13.

### Final Codex-reported verification — 2026-10-11

The following results are recorded from the completed correction's
`VERIFICATION_REPORT.md` and `verification-summary.json`. This documentation-only
update did not independently execute tests or repeat the verification.

| Final regression gate | Passed |
| --- | --- |
| New HTML integration browser | 17/17 |
| Existing HTML browser | 8/8 |
| Existing React blog browser | 13/13 |
| Checkout browser | 10/10 |
| Variant browser | 10/10 |
| Customer authentication browser | 1/1 |
| Admin Phase 1 browser | 12/12 |
| Admin Phase 3 browser | 10/10 |
| Admin orders browser | 9/9 |
| Contact browser | 9/9 |
| Backend blog activation/domain/adapter/HTML | 86/86 |
| SQL-free backend security and protected-source checks | 47/47 |
| Complete frontend default regression selection | 146/146 |
| Total | **378/378** |

The final runs reported **zero failures, skips or cancellations**. The browser
subtotal is 99/99; backend blog counts are 11 activation, 20 domain, 30 adapter and
25 HTML. The 47 SQL-free checks comprise 46 security checks and one protected-source
check. Focused reruns and the outside experiment are not counted again in the total.
Browser suites ran sequentially; source edits occurred after the relevant runner
stopped. External-network guards passed; no SQL or database fixtures were executed.

Reported TypeScript, installed dependency-tree validation, targeted lint, frontend
lint, production frontend build and Git whitespace checks passed. Frontend lint retained
two existing StorefrontProvider dependency warnings; the build retained the 681.56 kB
main-chunk size warning. No fresh dependency audit or advisory resolution is claimed.

### Outstanding production gates and rollback

This fixture-only implementation remains uncommitted. Implementation verification
completed with the reported results above; independent review awaits final documentation
confirmation. Successful mock checkout recovery does not establish production readiness
or authorize activation. Database-level same-key and concurrent-delivery idempotency
remain a separate release gate: source design was reviewed, but no SQL was executed
and persistent duplicate prevention was not experimentally verified in this phase.
Business origin, live native-published content/assets, actual hosting status/header/query
and cookie forwarding, compatible Node/workspace installation, capacity/monitoring,
tracking-query policy, sitemap policy and the previously recorded unresolved Studio/CLI
advisories still require separate review. No new dependency audit was run here and no
advisory is claimed resolved.

Future Vercel/Belmo routing and feature activation remain deferred. Existing JSON
activation defaults and production HTTP ordering denial are unchanged. Roll back
frontend document navigation/routing/artifacts before removing any later HTML support;
coordinate those changes so consumers never point at an unmounted route. Native-content
versus historical-publication rollback differences remain the earlier documented gate.
No production connections, live Sanity operations, SQL, environment edits, ordering
enablement, staging, commit, push, deployment or Belmo startup occurred in this phase.
This final documentation correction changes only this file, preserves the protected
working-tree exclusions, and executes no tests, SQL, services or activation operations.
