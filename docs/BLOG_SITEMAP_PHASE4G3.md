# Phase 4G-3 — isolated blog XML sitemap

Starting checkpoint: `phase2-canonical-variants`,
`44f1acf8276c9ccf77f26e26ef785a793d30fa9a`, empty index. The only existing
exclusions were the modified checkoutIntegration test and deleted root vercel.json.
No development handoff was present. Phase 4B–4G contracts, implementation and
documentation were inspected; historical reviews do not establish production state.

This foundation is locally verified and remains uncommitted. It is **unmounted in
production**, does not activate HTML or JSON blog features, and is not a production
readiness claim.

## Architecture and complete enumeration

`createPublicBlogSitemapRouter({service, canonicalOrigin})` is an isolated Express
factory, proposed for `/blog-sitemap.xml` at the public site's root. It injects the
same `BlogV1Service` used by JSON/HTML delivery. No second Sanity client, API crawler,
SDK credentials, environment switch or production mounting is introduced.

The existing source gains the optional `snapshotPublished()` read, exposed through
repository/service `snapshotArticles()`. Existing sources remain compatible for
listing/detail; sources without the new read fail sitemap generation with 503.
The centralized GROQ reuses existing published filters and summary/body projections.
Native Publish/Unpublish remains authoritative; draft/release documents and private
references are excluded independently of the client's perspective.

Public listing pages are bounded to 50 records and 1000 pages. They are unsuitable
for proving a complete collection by stitching mutable responses. The sitemap
instead evaluates the total and complete bounded collection in **one query**, ordered
by publication date descending and document ID ascending. The published count must
equal the returned length, with unique IDs/slugs and the expected order. No repeated
offset reads, detail fan-out, retry or unbounded loop occurs.

The initial supported population is **50 published articles**, including noIndex
articles before filtering. At 51, the query returns the count without retrieving
full articles and generation fails; it never returns a truncated successful sitemap.
Duplicate identities or slug collisions fail the entire generation, including a
collision with a noIndex article. Silently choosing one duplicate could hide an
incomplete or ambiguous publication state.

## Validation, XML and resource limits

The repository applies existing source schemas and safe DTO projection. Every article
then passes the unchanged HTML renderer's canonical, body, image, date and work checks
before inclusion. Malformed content, invalid slugs/dates, foreign canonicals or
unservable articles fail the entire sitemap; noIndex does not bypass validation.

Only validated indexable article canonicals are emitted. The origin is explicitly
injected; tests use `https://shop.example.invalid`. Host/forwarded headers, browser
location and editorial content cannot establish authority. Each location is the exact
approved HTTPS `/blogs/:slug` canonical, without credentials, query or hash.

XML is UTF-8 with a declaration and the sitemap namespace. Values escape all five
XML entities and reject characters forbidden by XML 1.0, including lone surrogates.
No editorial XML, DTD, entities, title, body or private metadata is emitted. `lastmod`
uses the validated article `_updatedAt` converted to UTC, matching existing HTML
metadata; generation time and invented dates are never substituted. The format
follows the [Sitemap protocol](https://www.sitemaps.org/protocol.html).

Limits are deliberately below protocol maximums:

- 50 published articles and one source operation per generation.
- Existing source deadline: 5000 ms by default, with AbortController and an independent
  deadline even for injected clients that ignore cancellation; no SDK retries.
- 8 MiB source/DTO serialization guard before article processing. This guard applies
  after SDK deserialization; it is not a streaming network-response limit.
- Query-side body bounds: 1000 blocks, 10,000 children, 10,000 mark definitions and
  100,000 marks; overflow produces an invalid sentinel, never truncated valid content.
- Existing per-article HTML limits: 1 MiB text, 10,000 spans, 100,000 work units and
  2 MiB HTML output. Output is validated and discarded after each article.
- 128 KiB final XML. All work completes before response headers/body are emitted.

Larger collections require a separately reviewed expansion or sitemap-index/partition
strategy with coherent enumeration. Raising limits blindly or aggregating existing
offset pages is not an approved solution. Sanity query behavior and pagination guidance
are documented in the [Query API](https://www.sanity.io/docs/http-reference/query) and
[pagination guide](https://www.sanity.io/docs/developer-guides/paginating-with-groq).

## HTTP and SEO consistency

GET succeeds with 200, `application/xml; charset=utf-8`, exact byte length, nosniff and
no-store. HEAD performs the same validation and returns the same status/headers without
a body. Conditional headers do not convert responses to 304; no ETag/cache is added.
OPTIONS returns 204; other methods return 405 before JSON parsing or source access.
Queries and extra paths return 400. Upstream/validation/limit failures return a fixed
plain-text 503 with Retry-After 60; no empty or partial successful XML is returned.
Diagnostics contain only `blog.sitemap.unavailable` and status 503. Logger failure
cannot interrupt the response. Injected Helmet, request context, CORS and the global
rate limiter retain authority, and sibling routes remain available.

The existing HTML/React SEO policies were reviewed; no frontend SEO correction was
necessary. Tests verify each emitted URL against served HTML canonical/robots/date.
HTML listing canonicals retain page/pageSize normalization; empty first pages use
noindex and later empty pages return 404. Indexable articles return 200/index;
noIndex articles return 200/noindex and are omitted from XML. Missing/unpublished
articles return 404, invalid URLs return 400 and upstream failures return 503, with
no article canonical on error documents. These HTTP statements concern the isolated
HTML router; deployed SPA/proxy behavior still requires separate hosting verification.
Only article URLs are listed; listing pages are not invented as dated entries.

## Exact files

Created:

- `backend/server/services/blogSitemap.js`: validated generation and XML escaping.
- `backend/server/routes/blogSitemap.js`: isolated HTTP factory.
- `backend/server/tests/blog-sitemap.test.js`: 28 fixture/HTTP/security regressions.
- `docs/BLOG_SITEMAP_PHASE4G3.md`: this focused implementation record.

Modified:

- `shared/contracts/blogV1.ts`: optional complete-read source/repository contracts.
- `backend/server/schemas/blogV1.js`: complete-envelope and resource bounds.
- `backend/server/services/sanityBlogQueries.js`: reused body projection and bounded query.
- `backend/server/services/sanityBlogSource.js`: existing-client snapshot read/deadline.
- `backend/server/services/blogRepository.js`: complete validation and reused article mapping.
- `backend/server/services/blogV1Service.js`: sanitized optional-read delegation.
- `backend/server/tests/sanity-blog-v1.test.js`: exact read-method contract and privacy
  assertion extended to snapshot DTOs; original listing/detail assertions retained.
- `backend/package.json`: focused `test:blog-sitemap` script only; no dependency change.

## Actual local verification — 2026-10-11

| Final gate | Result |
| --- | --- |
| Backend blog selection | 114/114: 11 activation, 20 domain, 30 adapter, 25 HTML, 28 sitemap |
| SQL-free backend auth/security/protected source | 47/47 |
| Complete frontend default selection | 146/146 |
| HTML storefront integration browser | 17/17 |
| Existing HTML browser | 8/8 |
| React blog browser | 13/13 |
| Checkout browser | 10/10 |
| Variant browser | 10/10 |
| Customer authentication browser | 1/1 |
| Final selected total | **366/366; zero failures, skips or cancellations** |
| Strict helper/source JavaScript type checking | Passed |
| Router checking at existing dynamic Express boundary | Passed with noImplicitAny=false |
| Frontend TypeScript and production build | Passed |
| Targeted backend/test lint | Passed without warnings |
| Frontend lint | Passed with two existing StorefrontProvider dependency warnings |
| Independent .NET XML parser | Passed: declaration, namespace/root and four fixture URLs |
| Git whitespace and protected-file checks | Passed; empty index |

Browser suites ran sequentially; no source/test file was edited during execution.
The frontend build retains its existing 681.56 kB main-chunk warning. SQL-backed
suites and the full backend default script were excluded. Repeated focused runs are
not double-counted. Fixture guards blocked external traffic; no live Sanity was used.

First-run results remain recorded:

- Initial sitemap run: 27/28; Express omitted the explicit UTF-8 charset from XML MIME.
  The response header was corrected without changing the assertion; subsequent 28/28
  and final combined 114/114 passed.
- Initial combined blog run: 113/114; the exact source-method list expected only the
  two old reads. Private-data assertions passed. The list was extended to the approved
  third read and privacy coverage expanded to its DTOs; final 114/114 passed.
- Initial targeted lint reported an unused test import and an intentional control-
  character regex warning. The import was removed and XML character validation uses
  explicit Unicode code-point checks; final targeted lint is clean.

Logs and independently parsed fixture XML are outside Git at
`C:/Users/DCS/.codex/outputs/royal-fusion-phase4g3-20261011/`.
Run the focused suite with `npm --prefix backend run test:blog-sitemap`.

## Deferred activation and rollback

Independent review and the final canonical business domain remain required. Separately
verify actual native-published content/assets, SDK/query compatibility, hosting runtime,
resource capacity, same-origin sitemap/HTML routing, status/header forwarding,
monitoring and security-advisory disposition. Historical Studio/CLI findings are not
claimed resolved; no new audit was performed. Database idempotency and ordering gates
remain outside this SQL-free phase.

Future robots.txt discovery, production sitemap files, rewrites and sitemap indexes
require separate approval; none was changed. No production feature flag or entry point
imports or mounts this factory. Rollback requires no production action now. If activated
later, restore/remove discovery and routing coherently before removing sitemap support,
preserving JSON/HTML services and commerce policies.

Protected checkoutIntegration bytes, the absent root vercel.json and frontend/vercel.json
are preserved. No production connection, SQL, migration, live Sanity read/write, environment
edit, Belmo startup, ordering enablement, staging, commit, push or deployment occurred.
