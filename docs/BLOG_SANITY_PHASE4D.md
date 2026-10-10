# Phase 4D — Sanity read adapter and isolated blog API

Starting checkpoint: `phase2-canonical-variants`,
`3b24b3151d0c9b2a3a9ca222315e77be6ca46fb1`, empty index. The existing protected
checkoutIntegration modification and root vercel.json deletion remain intact.
No development handoff was present. Phase 4B contracts, Studio schemas/configuration,
the production blueprint, API blueprint, authorization plan, environment documentation
and Phase 4C dependency-security evidence were reviewed before implementation.

## Reused contracts and authority boundary

`shared/contracts/blogV1.ts`, the Phase 4B Zod schemas, `BlogRepository`,
`BlogV1Service` and `blogErrorResponse` remain unchanged. The new source implements
the existing `BlogSource` interface. No additional public article DTO, custom
publication field, editor or persistence layer is introduced.

`createSanityBlogV1Service()` is an explicit composition factory. It creates a
token-free SDK client, a read source, the existing validating repository and the
existing service. Importing these modules creates no client or network connection.
The source exposes only `listPublished()` and `getPublishedBySlug()`; its SDK instance
and write methods are inaccessible to public handlers.

`createPublicBlogsV1Router(service)` is an isolated Express factory. **index.js does
not import or mount it.** Tests mount it only in an ephemeral loopback application.
Current backend/public routes, tracked/prototype content, frontend Sanity clients,
public blog pages and content authority remain unchanged. Studio remains the sole
editor for the new Sanity-backed path; no JSON, bundled-content or stale fallback
exists in this adapter.

## Nonsecret server configuration

The factory receives an environment object; it loads no dotenv file itself. Existing
environment files are never rewritten. Configuration is validated before constructing
the SDK; invalid configuration fails closed with a fixed, non-sensitive message.

| Variable | Value/contract |
| --- | --- |
| SANITY_PROJECT_ID | `6n1y88j4`; absent/blank uses this reviewed default; other values rejected |
| SANITY_DATASET | `production`; absent/blank uses this reviewed default; other values rejected |
| SANITY_API_VERSION | `2025-01-01`; absent/blank uses this pinned date; other values rejected |
| CLIENT_ORIGIN | Existing comma-separated allowlist; first entry must be the approved exact HTTPS storefront origin |
| SANITY_BLOG_TIMEOUT_MS | Default 5000; canonical integer 50–10000 milliseconds |

The first CLIENT_ORIGIN entry already defines the repository's canonical storefront
contract. No production domain is guessed or hardcoded. A localhost HTTP value cannot
satisfy the Phase 4B HTTPS canonical contract; local tests inject
`https://shop.example.invalid`. No actual deployment/environment value is changed.

This public dataset needs no token. SANITY_API_TOKEN, browser tokens, arbitrary
headers, preview options and API-host overrides are not read from the environment or
passed to the client. `perspective: 'published'` is explicit on client configuration
and each fetch, especially because the pinned pre-2025-02-19 API defaults to raw.
Stega and source maps are disabled. SDK retries are zero.

The factory is compatible with the installed, reviewed `@sanity/client` 7.23.0 and
the existing Studio API date. Native client construction/configuration is verified
without issuing a native SDK request. See the official
[perspectives documentation](https://www.sanity.io/docs/content-lake/perspectives).

## Centralized GROQ and projection

`sanityBlogQueries.js` exports two `defineQuery` queries. All interpolated fragments
are fixed source constants; slugs and slice bounds are SDK parameters.

- Listing sends `{offset, end}`. One request computes a page and total from the same
  blogPost filter, explicitly excluding `drafts.**` and `versions.**`. It projects
  summary fields, resolved author/category and image metadata. It never requests body
  or legacy content/status fields.
- Ordering is chronological publishedAt descending, then native `_id` ascending.
  GROQ uses `dateTime(publishedAt)` to agree with the existing repository's ISO-offset
  comparison, including historical timestamps with offsets and tied dates.
- A per-page `_slugMatchCount` counts published matches globally for each selected
  slug. Duplicate slugs fail even when a conflicting document lies on another page.
  This internal field is stripped by the existing repository and never becomes a DTO.
- Detail sends `{slug}` and fetches at most two matching documents. Zero is missing;
  two is ambiguous/unavailable. Full structured Portable Text is projected only here.
- Published author/category references are dereferenced and allowlisted; draft/release
  identities or missing references fail existing repository validation. Asset references
  retain IDs, HTTPS CDN URLs and dimensions; alt, crop, hotspot and captions are preserved.
- Native missing optional fields are conditionally omitted or coalesced to the existing
  defaults. This avoids treating GROQ's null values as incompatible optional booleans,
  text styles or marks. Missing required data still fails; malformed content is never
  silently repaired or hidden.
- Historical status and descriptive publication dates do not decide availability.
  Native Publish/Unpublish remains authoritative. Unpublish tests remove only the
  in-memory published fixture snapshot, retaining its draft to prove there is no fallback.

Slice bounds remain the approved page contract: page 1–1000, size 1–50, default 20.
The source validates offset/limit/order again, with maximum end 50000. Stable ordering
is deterministic for a fixed dataset; separate page requests can naturally observe
editorial changes. Offset pagination, totals and per-page duplicate detection have
upstream query costs. Cursor pagination/performance tuning are future reviewed work,
not a contract change in this phase.

## Isolated public HTTP contracts

| Request | Success |
| --- | --- |
| GET /api/v1/public/blogs?page=1&pageSize=20 | `{data: BlogSummary[], pagination: {page, pageSize, total, totalPages}}` |
| GET /api/v1/public/blogs/:slug | `{data: BlogArticle}` |

Slugs retain the Phase 4B lowercase ASCII/hyphen contract, maximum 96 characters.
Unknown, repeated, array-shaped and noncanonical numeric query values are rejected
before source access. Detail accepts no query parameters. Malformed URI escapes and
extra path segments receive fixed JSON validation errors. HEAD follows GET semantics
without a body; OPTIONS returns 204. Mutation methods return 405 with an Allow header.
The 405 body reuses INVALID_BLOG_REQUEST rather than expanding the approved error model.

- 200: valid listing/detail, including empty or beyond-final pages.
- 400 INVALID_BLOG_REQUEST: invalid query/slug/URI.
- 404 BLOG_NOT_FOUND: no published article with that slug.
- 503 BLOGS_UNAVAILABLE: timeout, SDK failure, malformed content, ambiguous slug or
  inconsistent source result.

Errors use the unchanged Phase 4B helper and fixed messages, with optional UUID
requestId only. The existing request-context middleware/header behavior is preserved;
non-UUID request IDs are omitted from error bodies under the approved contract.
SDK messages, tokens, query URLs, stacks, raw documents and private metadata are never
returned. A separate aborting deadline bounds even an injected client that ignores
its signal; the timer is cleared on completion. An unavailable source returns 503,
with no draft, JSON or stale-content fallback.

All router responses use `Cache-Control: no-store`, and SDK reads bypass the CDN.
Application/shared/edge caching remains deferred so this foundation has no intentional
stale unpublish behavior. Future activation must review caching, throughput and rate
limits together with the existing global security middleware. No current auth, RBAC,
CSRF, origin, ordering or middleware behavior changes.

## Fixture verification and dependencies

The new client fixture contains raw native-shaped document/reference/asset records.
It executes the actual centralized queries through existing `groq-js` instead of
returning canned per-query documents. Published-perspective fixtures filter native
draft/version identities; adversarial fixtures can ignore perspective to independently
verify query/reference defenses. All fixtures are disposable memory objects.

The SDK factory is injected, and a loopback-only fetch/socket guard rejects external
connections before I/O during adapter/API tests. Native SDK configuration checks never
call native fetch. There are no live Sanity calls, token generation, content mutations,
SQL execution, migration execution or external databases in this phase's verification.

Backend declares the **already-installed reviewed versions** explicitly:
@sanity/client 7.23.0 and groq 6.18.0 at runtime; groq-js 2.0.0 for tests. The offline
lock update changes only backend workspace metadata. No package resolution, integrity,
third-party version, override or dependency node changes. This avoids relying on
frontend/Studio hoisting for a future backend deployment.

The backend adapter requires **Node.js 22.12 or later**: @sanity/client requires
Node 20 or later, while the existing groq and groq-js versions require 22.12 or later.
Local verification used Node 24.19.0. Confirm the future backend runtime meets this
requirement before activation; no production runtime or hosting setting was inspected
or changed in this phase.

The root audit retains 17 existing Sanity tooling entries: **0 critical, 9 high,
8 moderate**. Backend production dependency audit remains zero. Braces, YAML/TOML,
sprintf-js and uuid chains and their inherited findings remain unresolved; see
[Phase 4C security evidence](PHASE4C_DEPENDENCY_SECURITY.md). This phase does not
claim to repair them, authorize Studio deployment or introduce unreviewed upgrades.

Focused commands from the repository root:

```powershell
npm --prefix backend run test:blogs
npm --prefix backend run test:blog-adapter
```

The existing default backend test script retains its coverage and adds the new adapter
test file. The selected Phase 4D backend regression command intentionally uses existing
HTTP/mock suites, avoiding migration-executing suites under this phase's restriction.

## Completed local verification

| Check | Result |
| --- | --- |
| Phase 4B domain and Phase 4D adapter/API tests | 46/46 passed: 20 existing and 26 new |
| Existing backend authentication, security, guest checkout, orders and protected-file regressions | 65/65 passed |
| Complete frontend default regression suite | 130/130 passed |
| Rendered checkout browser regressions | 10/10 passed |
| Strict JavaScript/TypeScript checking of configuration, queries and source | Passed |
| Frontend TypeScript production validation | Passed through the production build |
| Frontend lint and targeted backend/test lint | Passed |
| Frontend production build | Passed, 2619 modules |
| Installed dependency tree | Passed, no resolved package changes |
| Git whitespace check | Passed |

All test runs passed on their first run in this phase, with zero failures, skips or
cancellations. The backend has no separate build script. The Express router is exercised
through real local HTTP tests and lint; no claim of strict Express type checking is made.
The frontend tests emitted a nonfatal Vite dependency-scan/server-closing warning, and
the build emitted its existing large-chunk warning. Neither affected test assertions
or build success. The root audit's unresolved findings remain as recorded above.

Logs, the starting 447-file integrity snapshot, dependency evidence and the independent
review package are stored outside the repository in
`C:/Users/DCS/.codex/outputs/royal-fusion-phase4d-20261010/`.

## Deferred activation gates

Independent review is required before mounting the new routes or changing authority.
Production content compatibility, read traffic/latency, canonical origin approval,
unpublish cache policy, CDN/shared caching, editorial cutover and rollback need a
separate release decision. Frontend DTO consumption, Portable Text rendering, SSR or
prerendering, technical SEO, sitemap/robots, webhooks, Studio/application deployment
and Phase 4E are not implemented or activated.

Future renderers must escape text and serialize metadata safely; structured API data
does not authorize arbitrary HTML rendering. The existing frontend delivery path still
uses its historical model/status filter until the separately approved cutover.
