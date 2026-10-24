# Phase 4E fixture-only storefront blog integration

This local implementation starts from branch `phase2-canonical-variants`, HEAD
`3344d33a4fe09d8b01a234872bb62facf530531b`, with an empty index and only the
pre-existing checkoutIntegration modification and root vercel.json deletion.
It builds on [Phase 4B contracts](BLOG_DOMAIN_PHASE4B.md) and the
[Phase 4D isolated API](BLOG_SANITY_PHASE4D.md).

**The fixture-only implementation has passed the reported regression gates.**
The subsequently confirmed terminal results are recorded below. Implementation
remains uncommitted, with independent final Git review pending. This does not
establish production readiness or authorize activation.

## Activation boundary

`App` accepts an optional `blogIntegration` containing `{ enabled: true, client }`.
The unchanged production entry point renders `<App />`; the new integration is
therefore disabled by default. There is no environment variable, local-storage or
URL activation switch. The client and its approved configuration are injected
explicitly by the disposable browser harness and stay fixed for that mount.
Changing integration mode requires a fresh application mount.

The existing blog pages, cards, homepage preview and storefront blog loader remain
the default. An enabled integration suppresses only the historical blog loader;
catalog loading, refresh reconciliation and cart persistence retain their existing
logic. Enabled pages consume the versioned API only, with no historical JSON,
browser Sanity query or unavailable-content fallback. The backend production entry
point remains unchanged and the Phase 4D routes remain unmounted.

## Client, routes and state

`publicBlogsApi.ts` uses the existing shared `blogV1` types and API base convention.
It supports bounded page/pageSize inputs (1–1000 / 1–50), defaulting to 1 / 20,
rejects duplicate and unknown query keys, and validates lowercase slugs up to 96
characters before making a request. Article detail is fetched independently.
Nested responses are validated and projected, including pagination counts,
ordering, identities, author/category references, dates, Portable Text, image
geometry and SEO. Private/unknown fields are omitted. Invalid or unsafe content
fails closed as unavailable.

Public requests are GET with `credentials: omit`, no authorization/CSRF/Sanity
token, and `cache: no-store`. HTTP 400, 404, 429, 503, malformed responses and
network errors receive fixed safe messages. An independent 12-second default
deadline and AbortController bound requests even if an injected fetch ignores
cancellation. No raw upstream messages are exposed.

`PublicBlogProvider` owns route-specific state and explicit revalidation. Requests
are aborted on cleanup and guarded by sequence, route, load function and revision.
Old article data is cleared during navigation/revalidation; React Strict Mode
cleanup and clients ignoring cancellation are covered by browser tests. There is
no persistent article cache or automatic realtime-unpublish promise. A removed
article disappears after a fresh request or the Refresh article action.

Existing `/blogs` and `/blogs/:slug` routes, layout and responsive conventions are
preserved. The enabled experience adds API pagination, summary cards, a three-item
homepage preview, independently loaded details and bounded related summaries.
Loading, empty, invalid, not-found, rate-limit and unavailable states are explicit.
No reading time or unsupported editorial fields are invented.

## Portable Text, editorial media and SEO

Structured bodies render through `@portabletext/react` 8.0.1: paragraphs, H2/H3,
strong/emphasis, quotes, ordered/bullet/nested lists, links and image objects.
Text is escaped by React; raw HTML and arbitrary media components are not enabled.
Links accept safe root-relative paths or credential-free HTTPS URLs; external links
receive `noopener noreferrer`. Unknown blocks/marks fail closed.

`@sanity/image-url` 2.1.1 builds URLs only from validated assets in the configured
`6n1y88j4` / `production` image namespace. Asset reference, dimensions, alt text,
caption, crop and hotspot are validated and preserved. The builder performs no
SDK request. Browser tests fulfill these image requests with synthetic media;
no live asset is downloaded.

The existing SeoManager remains the sole metadata writer. The enabled blog branch
uses an explicitly injected validated HTTPS canonical origin and matching article
path, title/description fallbacks, robots and Open Graph metadata. Tests use only
`https://shop.example.invalid`, not localhost, window.location or an assumed live
domain. Loading, invalid, missing and unavailable states clear stale image metadata
and use noindex. Navigation resets article metadata and returns other routes to the
existing resolver. Editorial noindex and approved canonical paths are retained.

Client-side metadata does **not** establish dependable search-engine crawlability
or social previews. The SPA HTML shell has no server-rendered article content or
article-specific HTTP status. SSR/prerendering, sitemaps and server-visible status
codes are deferred.

Primary library guidance:
[@portabletext/react](https://github.com/portabletext/react-portabletext),
[@sanity/image-url](https://github.com/sanity-io/image-url).

## Disposable fixture integration

The browser harness starts Vite and Express on loopback, imports only the isolated
Phase 4D router/service and injects in-memory Sanity documents. It does not import
the production backend entry point or read real environment files. Synthetic
catalog/auth/media responses preserve the real application components without
external connections. Node and browser network guards reject unexpected external
traffic. Enabled fixture pages assert zero historical blog reads, credentials,
unexpected requests, browser errors and ordering writes.

Four added backend tests cover composed helmet/request-context headers,
exact-origin CORS, rate limiting, method denial before JSON parsing, HEAD/OPTIONS,
and preservation of sibling/historical routes. Production middleware and routing
are unchanged.

## Dependencies and remaining findings

The frontend directly declares the already installed reviewed versions
`@portabletext/react` 8.0.1 and `@sanity/image-url` 2.1.1. React/React DOM remain
19.2.8. The lockfile adds only these two frontend workspace declarations; no package
resolution, integrity value, dependency node, override or third-party version changes.
Installed package/peer requirements and the full dependency tree are checked.
The renderer requires Node.js 22.12 or later and React 19; local validation uses
Node.js 24.19.0. Confirm the eventual build runtime separately before activation.

The fresh root audit retains **17 package entries: 0 critical, 9 high, 8 moderate**
and exits 1. Frontend and backend production workspace audits each report zero.
Remaining Sanity/CLI chains include braces/globbing, YAML/TOML, sprintf-js and uuid;
their inherited findings remain unresolved. See
[Phase 4C dependency security evidence](PHASE4C_DEPENDENCY_SECURITY.md).
This phase does not authorize Studio deployment or claim those findings are fixed.

## Verification evidence

Detailed final counts, first-attempt failures, command logs, source checksums and
the 454-entry starting-tree comparison are retained outside Git at
`C:/Users/DCS/.codex/outputs/royal-fusion-phase4e-20261010/`.
Focused commands from the repository root are:

```powershell
npm --prefix frontend run test:blogs
npm --prefix frontend run test:blogs:browser
npm --prefix backend run test:blogs
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
```

First browser attempt: installed Chrome exceeded the unchanged 15-second launch
timeout, causing 10 setup failures before assertions. A standalone launch check
with identical options then passed. Second attempt: 7 tests passed before the
navigation check incorrectly matched a legitimate More Reads H3. The assertion now
checks the active H1 and separately preserves the expected sidebar H3. An additional
client-ignoring-cancellation test proves a delivered late response cannot overwrite
the current article. All 11 blog browser tests subsequently passed. No sleeps,
timeout increases or weakened security/publication assertions were introduced.

Validation deviation: the selected existing guest-checkout regressions execute
disposable in-memory PostgreSQL SQL. This exceeded this phase's no-SQL instruction.
They passed without an external database connection; no production SQL, migration
or database operation occurred. Further SQL-based suites were excluded. This
deviation is explicitly retained for independent review.

Frontend lint retains two pre-existing StorefrontProvider hook-dependency warnings;
the existing dependency arrays and reconciliation behavior are unchanged. The
production build retains its large-chunk warning. These warnings are not suppressed.

| Completed selection/check | Actual result |
| --- | --- |
| Phase 4B domain and Phase 4D API/middleware | 50/50 passed |
| Selected backend auth/security/guest-checkout/orders/protection | 65/65 passed; disposable SQL deviation above |
| New blog client integration | 12/12 passed, also included below |
| Full frontend regression suite | 142/142 passed |
| Final blogBrowser.test.mjs suite | 11/11 passed, including the synchronization change |
| Existing checkout browser suite | 10/10 passed |
| Existing variant browser suite | 10/10 passed |
| Admin Phase 1/2/3 browser selection | 31/31 passed |
| Initial admin-order/customer-account selection (historical) | Stopped after 4 passes and 1 failure; superseded by the confirmed separate runs below |
| Previously failing admin-order test, isolated | 1/1 passed |
| Complete adminOrdersBrowser.test.mjs suite | 9/9 passed |
| customerAuthBrowser.test.mjs suite | 1/1 passed |
| TypeScript, frontend/test lint, build, installed tree | Passed |
| Git whitespace and 454-entry integrity comparison | Passed; index empty |

Initial admin-order failure (historical): `adminOrdersBrowser.test.mjs:145`, “stale conflict refreshes
authoritative state before new action”. The second Add Private Note click at line
152 timed out at the unchanged 15-second limit. Playwright observed an unstable
button, viewport/detachment changes and then a disabled replacement. The test did
not reach its final new-action assertions. The exact root cause is not established;
no existing admin source, test, timeout or assertion was changed. The fail-fast
runner stopped the owned test process tree. Customer-account and later admin-order
tests were not executed in that initial attempt. The subsequent confirmed results
above supersede that incomplete verification state.

The read-only investigation found that a watched blog-test file edit overlapped
the active admin-order browser run. The installed Vite/Tailwind dependency-watching
path can trigger a full page reload for such scanned-file changes. This supports
the suspected concurrent reload interference, but the original HMR/navigation event
was not captured and the cause was not conclusively proven. It is not a confirmed
Phase 4E application regression.

After the successful blog run, its new navigation test gained an explicit wait for
the independently loaded related H3 before asserting its count. The subsequently
confirmed final blogBrowser.test.mjs run passed 11/11 with that synchronization
change included.

The subsequent terminal results supplied for this documentation update confirm
the isolated admin-order test passed 1/1, the complete adminOrdersBrowser.test.mjs
suite passed 9/9, the final blogBrowser.test.mjs suite passed 11/11, and the
customerAuthBrowser.test.mjs suite passed 1/1. No tests were executed for this
documentation update. The original evidence package retains its historical blocked
verdict and initial failures; it has not been overwritten. The fixture-only
implementation has passed the reported regression gates and remains uncommitted,
with independent final Git review pending. No claim of live Sanity compatibility,
production route activation, successful deployment or eliminated advisories is made.

## Deferred release gates

Independent review is required before any activation. Separately approve backend
route mounting, runtime/canonical configuration, live published-content compatibility,
editorial cutover, unpublish/cache policy, rollback, crawlable SEO delivery and
deployment. Fixture success does not establish production readiness. Studio/live
Sanity operations, SQL/schema changes, Belmo, ordering, deployment and Phase 4F are
outside this implementation. No staging, commit or push is performed.
