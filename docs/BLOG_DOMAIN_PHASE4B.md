# Phase 4B — Blog domain foundation

Local foundation only, based on the Phase 4A read-only audit at commit
`54e7dd558ec8823ee99ac77bb47701a74aa4f173` on `phase2-canonical-variants`.
The development handoff was unavailable; the production blueprint, API contract,
authorization plan, environment instructions and Phase 4A findings were reviewed.

## Ownership and activation boundary

Sanity Studio is the proposed sole editor and Content Lake the authoritative source.
This phase does not initialize either, read live content, import the SDK on the server,
mount routes, change existing pages or replace existing production authority.
No commerce, static-page SEO, Supabase schema, configuration or deployment change is included.

## Domain contract

`shared/contracts/blogV1.ts` defines the public DTOs and repository/source interfaces.
The existing frontend `BlogPost` extends its `BlogIdentity` without changing any
existing fields or consumers. It remains the historical flattened display model.
The separate versioned `BlogSummary`/`BlogArticle` DTOs are for the future public API,
not an incompatible replacement for that model.

- Identity: native document ID, slug, title, excerpt and publication date.
- Summary: identity, modification date, resolved author/category identities,
  featured image, tags and blog SEO. It contains no article body or legacy `content`.
- Detail: summary plus allowlisted Portable Text blocks and images.
- Author/category: IDs and approved public editorial fields; no staff credentials.
- Images: original asset reference, HTTPS Sanity CDN URL, dimensions, editorial alt,
  crop, hotspot and optional caption. Unselected asset metadata is discarded.
- Text: paragraphs, H2/H3, blockquotes, bullet/number lists, nesting levels,
  spans, supported decorators, link definitions and images. Arbitrary HTML/embeds
  and unsafe links are rejected. Renderers must still escape text and serialize
  metadata safely; this phase implements no renderer.
- SEO: optional title/description and OG image, `noIndex` default false, canonical
  constrained to the injected approved HTTPS origin and exact article path.
  Missing canonical uses that origin/path. Foreign/invalid upstream canonical
  data fails closed. OG fallback and HTML metadata rendering remain deferred.
- Dates: valid offset-bearing ISO timestamps, returned in UTC.

Only native publishing controls public availability. There is no custom status,
`published` boolean, date-based visibility filter or second publication engine.
Historical `status` fields are ignored and excluded from responses.

## Repository and source boundary

`BlogRepository` receives a source and explicit canonical origin. It performs no
environment loading, network calls, persistence or caching.

The future source must query the **published perspective**, resolve author/category
and image references against that same perspective, and count/page the same published
article population. `listPublished` receives a bounded offset/limit and the required
global order: `publishedAt desc, _id asc`. It must return at most the requested page.
`getPublishedBySlug` returns one resolved article or `null`; ambiguous slugs must fail
rather than arbitrarily selecting a document. No SDK adapter is implemented here.

The repository rejects dotted identities (including native `drafts.*` and `versions.*`),
unpublished resolved references, malformed source data, duplicate page identities/slugs,
incorrect page length and incorrect within-page ordering. Source implementations are a
trusted boundary: a page cannot independently prove global count/order/uniqueness.
Those properties require adapter integration tests before any route is mounted.

`createBlogFixtureSource` models disposable native document snapshots. Only normal
document IDs exist in its published view; drafts and release versions do not.
It resolves no live project and never writes or serves tracked legacy JSON/bundled blogs.
Each fixture and response is isolated by cloning and projection.

## Future GET contracts — not mounted

`GET /api/v1/public/blogs?page=1&pageSize=20`

Returns `{ data: BlogSummary[], pagination: { page, pageSize, total, totalPages } }`.
Page defaults to 1 and is limited to 1–1000. Page size defaults to 20 and is limited
to 1–50. Unknown query keys, arrays, booleans, fractional/exponential values and
noncanonical numeric strings are rejected. Empty/beyond-final pages return an empty
array with accurate pagination; zero records means zero total pages.

`GET /api/v1/public/blogs/:slug`

Returns `{ data: BlogArticle }`. Slugs are 1–96 lowercase ASCII letters/digits with
single separating hyphens. Paths, escapes, whitespace and query fragments are rejected
before calling the source. The repository returns `null` for absence; the service maps
that to `404 BLOG_NOT_FOUND`. Source failure/corruption becomes `503 BLOGS_UNAVAILABLE`.
Invalid input becomes `400 INVALID_BLOG_REQUEST`.

The error helper returns `{ status, body: { error: { code, message, requestId? } } }`.
Messages are fixed; source exceptions, validation details, tokens and stacks are never
returned. Only a valid UUID request ID is included. Response objects are explicitly
projected at each nested boundary; no raw document spreading crosses into the public DTO.

## Verification

Run `npm --prefix backend run test:blogs` for the fixture-driven suite. It is also
included in the default backend test command. Tests cover pagination/order, input
validation, native publication, missing/unavailable behavior, rich body/image/reference
preservation, credential stripping, malformed upstream responses, unsafe metadata and
fixture mutation isolation. All credentials in fixtures are synthetic sentinels.

The shared TypeScript contract and legacy display compatibility can be checked with
`node node_modules/typescript/bin/tsc -p frontend/tsconfig.app.json --noEmit`.

Local results on 2026-10-10:

| Check | Final result |
| --- | --- |
| Blog foundation | 20 passed, 0 failed |
| Combined blog + auth-contract + guest-checkout + protected checkout suites | 36 passed, 0 failed |
| Complete frontend regression suite | 130 passed, 0 failed |
| Frontend type check | Passed |
| Strict JavaScript type check of the three new backend modules | Passed |
| Frontend lint and targeted foundation lint | Passed |

First-run failures are retained here: the strict JavaScript check initially found
missing annotations/type-import extensions, then a readonly ordering-tuple mismatch.
These were corrected without relaxing compiler settings. An initial concurrent
backend regression run passed 15/16; one guest-checkout test exceeded the existing
8-second isolated API startup deadline before reaching its checkout assertions.
Its isolated rerun passed 3/3 and the final serial combined run passed 36/36.
No checkout code, test assertion or timeout was changed. The exact cause of that
startup delay was not established. Frontend tests emitted Vite websocket-port warnings
but all 130 tests passed. No live provider integration or browser rendering was tested.

## Deferred gates

Independent review is required before the next phase. Project ownership, dataset
isolation/visibility, editorial roles and existing content still require human evidence.
Studio setup, a real published-perspective Sanity adapter, public API mounting,
production authority cutover, Portable Text UI, SSR, sitemap/robots, cache/webhooks,
configuration and deployment are not authorized by this foundation.

Protected exclusions remain the modified checkoutIntegration test, deleted root
vercel.json and unchanged frontend/vercel.json. Belmo and ordering remain untouched.
