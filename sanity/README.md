# Royal Fusion — standalone blog Studio

Phase 4C configures a local npm workspace for the existing Royal Fusion project
`6n1y88j4`, public dataset `production`, as supplied by the project owner.
This phase does not create a project/dataset, deploy Studio, or change live content.

## Local startup

From the repository root:

```powershell
npm run dev:studio
```

Open `http://127.0.0.1:3333`. The equivalent workspace command is
`npm run dev --workspace @royal-fusion/studio`.
Studio uses Sanity's own sign-in and project roles. Royal Fusion admin cookies do not
grant Sanity access. There are no embedded write tokens or custom authentication providers.

An authenticated Studio session can autosave edits to production, including drafts.
Do not create, edit, upload, publish, unpublish or delete content as a verification step.
Login/CORS/member-permission checks require separate manual read-only review.
If the exact local origin is absent from allowed credentialed CORS origins, stop and
ask the project owner to review that setting; this phase makes no CORS changes.

## Nonsecret configuration

`studioConfiguration.ts` and `sanity.cli.ts` use the reviewed defaults:

| Variable | Default |
| --- | --- |
| SANITY_STUDIO_PROJECT_ID | 6n1y88j4 |
| SANITY_STUDIO_DATASET | production |
| SANITY_STUDIO_API_VERSION | 2025-01-01 |
| SANITY_STUDIO_CANONICAL_ORIGIN | unset |

Optional local values belong in ignored `sanity/.env.local`, using `.env.example`.
Blank existing values use the reviewed defaults. A different project/dataset is
rejected. No frontend/backend environment values are changed by this configuration.
All `SANITY_STUDIO_` variables are public bundle configuration; never put secrets in them.

A primary storefront origin was not supplied for Phase 4C. Canonical overrides
remain read-only until an approved exact HTTPS origin is explicitly configured.
Leave canonical blank for the future repository's automatic article URL.
Stored overrides are preserved; invalid/unverifiable overrides prevent publication.

## Registered schemas and preserved content

Only `blogPost`, `author` and the existing `blogCategory` document names are registered.
Portable Text uses native `block` and inline `image` objects, preserving historical
`_type: "image"`, asset references, crop and hotspot metadata.

Articles support title, validated/native-unique slug, excerpt, strong author/category
references, tags, featured image, historical `imageAlt`, publication date, rich body,
optional reading time, SEO title/description, canonical override, noindex and OG image.
The body supports paragraphs, H2/H3, quotes, bullet/number lists, approved decorators,
safe links, and images with required alt text and optional captions.
No arbitrary HTML, embeds or table/page builders are registered.

Native Draft/Publish/Unpublish controls are authoritative. The former custom `status`
field is omitted, without unsetting existing stored values. Existing `readTime`,
author fields and category document names are retained. Do not remove unknown fields
from historical documents merely because Studio displays them.

Reference validators use parameterized, published-perspective reads through Sanity's
native authenticated validation context. Draft-only/weak unresolved references and
upstream failures block publication with safe messages. Tests use mocked clients only.

Non-blog starter files remain on disk but are not imported or registered. This neither
deletes their documents nor restricts server-side project permissions. Studio validation
is not a Content Lake security boundary; native Sanity roles still enforce access.

## Dependencies and local checks

Dependencies are pinned in this workspace and resolved by the root npm lockfile.
Node >=22.12 is required. The local verified runtime is Node 24.19.0/npm 11.17.0.
The Studio uses Sanity 6.18.0, CLI 8.16.0, React/React DOM 19.2.8,
styled-components 6.5.3 and TypeScript 6.0.3.

The current Portable Text editor requires React >=19.2.8. Website and Studio use the
same pinned 19.2.8 patch pair; root dev dependencies anchor that shared runtime so the
CLI build tooling's private React 19.3 does not replace it. Existing website Vite,
React plugin, Zustand and backend Zod resolutions are pinned to their checkpoint
versions. No application logic or delivery configuration is changed.

Repeatable installation uses `npm ci --ignore-scripts --no-audit --no-fund` from the root;
package lifecycle scripts are disabled. No project initializer is required.

```powershell
npm run typecheck:studio
npm run test:studio
npm run build:studio
```

The build is local-only, with auto-updates disabled. Automatic schema extraction and
TypeGen are disabled. No deploy, schema-deploy, import, migration or live-document
validation command is part of this phase.

The historical checkout source-integrity test is updated only for the six intentionally
adapted Studio starter files (`.env.example`, this README, author, blogCategory,
blogPost and index). Its migration, authentication, cart, hosting, checkout-test and
non-blog schema hashes remain unchanged; no assertion is removed.

## Dependency security review gate

The initial 2026-10-10 audit reported 26 affected package entries: 2 critical, 15 high,
9 moderate. Targeted compatible corrections reduce the graph to 17 entries:
0 critical, 9 high, 8 moderate. Backend/frontend dependencies and the local launcher
receive security patches; the remaining entries belong to Sanity/CLI tooling chains.
See [the dependency security review](../docs/PHASE4C_DEPENDENCY_SECURITY.md) for exact
versions, ancestry, actual exposure, compatible-patch limits and residual controls.
These counts include inherited advisory chains, not 17 distinct exploits.

The report is not a clean security audit. In particular, the Sanity CLI/codegen
dependency chain contains [braces with no published patch](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
Do not apply npm's suggested CLI/Studio major downgrade or force dependency overrides
without a separate compatibility/security review. Production use/deployment requires
independent review of the full audit and remediation or explicit risk disposition.
This phase uses trusted local configuration, disables automatic codegen/TypeGen and
binds the dev server to loopback; these limits do not erase package advisories.

## Delivery remains unchanged

Phase 4B contracts and fixtures remain unchanged. Studio imports only shared domain
types to align Portable Text styles. Current storefront services still include their
historical status filter; this phase does not replace production blog delivery or
promise that new native publications appear through that filter.

A real Sanity repository adapter, API mounting, production authority cutover, rendering,
sitemap/robots, caching/webhooks and deployment remain deferred to later approval.
The independent reviewer must approve this foundation before any subsequent phase.
