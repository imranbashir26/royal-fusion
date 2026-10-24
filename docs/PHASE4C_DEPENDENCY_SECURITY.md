# Phase 4C targeted dependency security correction

This local correction starts from `1596d70436a2f7fec4cffcf757f91cd94d7d1deb`
and preserves the accepted, uncommitted blog Studio foundation. No application
business logic, content models, hosting configuration or production state changes.

## Compatible corrections

| Package | Starting resolution | Corrected resolution | Use |
| --- | --- | --- | --- |
| proxy-addr | 2.0.7 | 2.0.8 | Express backend client-IP resolution |
| concurrently | 10.0.3 | 10.0.6 | Root local development launcher |
| shell-quote | 1.8.4 | 1.12.0 | concurrently argument quoting |
| multer | 2.2.0 | 2.4.0 | Authenticated backend multipart uploads |
| react-router / react-router-dom | 7.18.0 | 7.18.4 | Website browser routing |
| ip-address | 10.2.0 | 10.7.3 | express-rate-limit IPv6 key generation |
| qs | 6.15.3 | 6.16.0 | Express/body-parser dependency |
| @sanity/client's nanoid | 3.3.15 | 3.3.20 | Client IDs; frontend and shared SDK dependency |

Direct parents are pinned to the reviewed versions. Transitive updates stay inside
their parents' declared ranges; no overrides, force fixes, peer bypasses or Sanity
major downgrades are used. Multer drops unused concat-stream/typedarray dependencies.
React/React DOM, Sanity, CLI, Vite and content schemas retain their Phase 4C versions.

## Runtime ancestry and exposure

- **proxy-addr:** backend → Express 5.2.1 → proxy-addr. Production auth configuration
  defaults proxy trust on, but `index.js` always uses numeric `app.set('trust proxy', 1)`.
  Express compiles this as a hop-count function, without compiling IP/CIDR subnets.
  The advisory's malformed IPv4-mapped subnet condition is therefore not reached by
  repository configuration. This is a source assessment, not production inspection.
  One-hop trust still requires a trustworthy proxy that overwrites forwarded headers
  and consistent network paths. Patching does not establish that deployment guarantee.
- **shell-quote:** root devDependency concurrently imports `quote`, not `parse`.
  Its argument-expansion calls receive CLI string arrays. The fixed `dev:full` command
  supplies neither comment objects nor argument placeholders, so the documented
  comment-token-plus-newline injection is not demonstrated through that command.
  No request handler invokes this launcher. The parent patch removes both advisories.
- **multer:** backend direct runtime dependency. Modern admin routes authenticate,
  check permission, origin and CSRF before parsing one file into memory, capped at 5 MB.
  Legacy disk uploads are authenticated, capped at 3 MB/eight files, and mounted only
  for the non-production prototype provider. Authentication/limits reduce exposure;
  they do not repair crafted field-name, abort/descriptor or parser vulnerabilities.
  Version 2.4.0 repairs the applicable 2.x advisories without changing these controls.
- **react-router:** frontend → react-router-dom → react-router. The application uses
  BrowserRouter in a Vite SPA and has no unstable RSC server actions. The advisory's
  RSC CSRF execution path is absent; the same-major patch removes the flagged version.
- **ip-address:** backend → express-rate-limit → ip-address. The caller first checks
  Node's `isIPv6`, then uses Address6/is4/to4/networkForm for rate-limit keys. The
  application does not use its SSRF allowlist classifiers or accept arbitrary text
  directly into Address6. IPv6 parsing remains security-sensitive, so compatible
  patches are applied and rate-limit/auth/contact regressions remain required.
- **qs:** Express uses the default simple query parser; no custom extended parser,
  urlencoded middleware or hostile-object parse/stringify round-trip was found in
  application routes. It remains a backend runtime dependency and is patched.
- **nanoid 3.x:** shared Sanity client dependency; no application caller supplies an
  attacker-controlled generator size. The compatible 3.x patch removes the infinite
  loop findings. Backend nanoid 5.1.16 was already outside those affected ranges.

Primary advisory references:
[proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h),
[shell-quote](https://github.com/advisories/GHSA-pqg4-j6r4-53mv),
[Multer](https://github.com/advisories/GHSA-3pph-fpjx-jg34),
[React Router](https://github.com/advisories/GHSA-qwww-vcr4-c8h2),
[ip-address](https://github.com/advisories/GHSA-h3mg-xc3c-68pw),
[qs](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g),
[nanoid](https://github.com/advisories/GHSA-2v37-7h3g-55p8).

## Remaining Sanity/CLI findings

The initial root audit reports **26 package entries: 2 critical, 15 high, 9 moderate**.
The corrected graph reports **17: 0 critical, 9 high, 8 moderate**. These include
inherited advisory chains, not 17 distinct exploits. A nonzero audit exit remains
expected and must not be converted into a claim of a clean security result.

| Chain | Actual use / compatible-patch limit | Residual risk and controls |
| --- | --- | --- |
| Sanity → CLI → codegen → chokidar/globby → fast-glob/micromatch → braces 3.0.3 | Query discovery and TypeGen watching. Latest codegen 8.2.0 retains these parents; braces has no published patch. | Malicious deeply nested local glob patterns can exhaust the stack. TypeGen/automatic extraction are disabled; use trusted local paths/configuration only. This does not remove the advisory. |
| CLI 8.16.0 → @vercel/frameworks 3.29.0 → js-yaml 3.13.1 / smol-toml 1.5.2 | Framework detection/scaffolding. CLI pins the parent; even latest frameworks 3.35.0 retains vulnerable parser pins. Patched parsers exist (3.15.2 / 1.9.1) but are outside these exact declarations. | Untrusted YAML/TOML or templates can cause pollution/DoS. Do not run init/scaffold/import against untrusted templates. Ordinary schema validation/build uses existing trusted config; no scaffolding is part of this phase. |
| js-yaml → argparse 1.0.10 → sprintf-js 1.0.3 | YAML command-line argument/help formatting; no application caller found. Parent uses ~1.0.2, and latest sprintf-js 1.1.3 remains flagged. | Unbounded precision can consume resources. Do not invoke the YAML CLI with untrusted formats. No compatible patch is claimed. |
| CLI → typeid-js 1.2.0 → uuid 10.0.0 | CLI telemetry trace IDs. Inspected typeid code uses its UUIDv7 generator and uuid parse/stringify, not vulnerable v3/v5/v6 buffer-writing calls. Latest typeid retains ^10; patched uuid starts at 11.1.1. | Buffer bounds advisory remains in the installed package. Validation disables telemetry through CI/DO_NOT_TRACK; an upstream compatible parent update is required. |

Inherited audit entries also include sanity, @sanity/cli, @sanity/cli-build and
@sanity/runtime-cli. npm may label these as production dependencies because Sanity
itself depends on CLI tooling. That flag does not establish exposure in website
responses or the Studio browser bundle. Backend and frontend runtime classifications
must be assessed by workspace ancestry and actual imports, separately from Studio
runtime and CLI tools.

No browser-serving parser/glob entry point is demonstrated for these remaining
chains. This is not proof that all SDK paths are unreachable. Keep Studio local,
bind it to loopback, retain Sanity authentication, use trusted configuration, and
require independent residual-risk review before broader use or deployment.

References: [braces, no patched version](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
[YAML](https://github.com/advisories/GHSA-2883-xcg3-v3hh),
[TOML](https://github.com/advisories/GHSA-r4xh-jqrq-34v2),
[sprintf-js](https://github.com/advisories/GHSA-hp3w-g68c-fv3c),
[uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

## Verification and safety boundary

Use clean installation with lifecycle scripts disabled, complete dependency-tree
validation, a fresh audit, Studio mock tests/typecheck/local schema validation/build,
backend security/auth/contact/media/blog/checkout regressions, frontend regressions,
browser tests, lint, builds and protected-file checks. Stop at any critical security,
data-integrity or checkout regression failure. Do not weaken assertions or timeouts.

The user explicitly permits **existing disposable SQL fixtures only** for regression
tests; no external database connection or production SQL is authorized. Native Studio
validation checks schemas, not live documents. Offline build validation blocks
network access and does not use tokens.

`git check-ignore -v sanity/.env.local` matches the root `.gitignore` `*.local` rule;
the file is untracked. Never add write credentials to SANITY_STUDIO variables.
No Studio login, content writes, production access, Belmo startup, ordering change,
Git staging/commit/push, deployment or Phase 4D work is included.

## Completed local verification — 2026-10-10

| Check | Actual result |
| --- | --- |
| Clean `npm ci --ignore-scripts --no-audit --no-fund --prefer-offline` | Passed; 1,067 packages installed |
| `npm ls --all --json` and workspace depth-zero dependency validation | Both exit 0; no invalid dependency tree |
| Fresh root audit | 17 entries: 0 critical, 9 high, 8 moderate; exit 1 because those findings remain |
| Backend and frontend `npm audit --workspace ... --omit=dev --json` | Each reports 0 findings |
| Backend auth/security/contact/media/blog/checkout selection, 15 test files | 733/733 passed, including nested cases; 0 failed/cancelled/skipped |
| New dependency-security regressions, also included in backend selection | 5/5 passed |
| Full frontend default regression selection, 18 test files | 130/130 passed; 0 failed/cancelled/skipped |
| All seven existing browser suites | 61/61 passed; 0 failed/cancelled/skipped |
| Studio fixture tests | 10/10 passed; 0 failed/cancelled/skipped |
| Studio `tsc --noEmit` | Passed |
| Native local `schemas validate` | 0 errors, 0 warnings; 3 guarded processes, 0 network attempts |
| Studio build | Passed; 7 guarded processes, 0 network attempts |
| Frontend `tsc -b && vite build` | Passed; 2,619 modules transformed |
| Frontend lint and targeted Studio/security-test/protected-test lint | Passed |
| Git whitespace and starting-tree integrity comparison | Passed; index empty, checkpoint and exclusions preserved |

Browser coverage includes variants, checkout, contact, customer authentication,
Admin orders, Phase 1 and Phase 3. In particular, the previously corrected
same-product refresh test passes without changing its assertions or synchronization.
Backend counts describe the requested 15-file selection, not the complete default
backend script. SQL execution was confined to the explicitly permitted existing
disposable PGlite fixtures.

### First-run failures retained, rather than hidden

1. **Backend validation:** the fail-fast first attempt recorded 312 passing cases
   and one failure before termination. The new shell-quote test's injection-rejection
   assertion passed, but its benign-command assertion incorrectly required the
   literal text `npm run dev:backend`. Patched quoting emits `npm run dev\:backend`;
   parsing it returns exactly the original argument array. The new test now asserts
   that semantic round-trip, retaining the exact malicious-input rejection check.
   The focused five tests and complete 733-case selection then passed.
2. **Frontend validation:** the first external runner recorded 20 passes and one
   failure before termination. It launched the tests from the repository root,
   while the existing Vite SSR tests use the default working-directory root and
   require the frontend directory. The module exists; correcting only the external
   runner's working directory to match the existing npm script resolved the failure.
   No frontend test or application source was changed. All 130 cases then passed.
3. **Browser runtime preflight:** the first installed-Chrome launch exceeded the
   existing 15-second timeout before running any application test. One retry with
   identical settings passed (Chrome 154.0.8037.99), followed by all 61 browser
   tests. No arbitrary sleeps, assertion changes or timeout increases were used.

Nonfatal output remains visible: clean installation warns that uuid 10 is deprecated;
the frontend SSR fixture emits a dependency-scan/server-closing warning despite the
media-client assertions passing; the frontend build warns about a 673.91 kB main
chunk exceeding the 500 kB reporting threshold. No unrelated refactoring or warning
suppression was performed. No critical application security, data-integrity or
checkout regression was demonstrated.

### Exact correction scope and evidence

Relative to the current-tree starting snapshot, only six existing files changed:
root `package.json`/`package-lock.json`, `backend/package.json`,
`frontend/package.json`, `sanity/README.md`, and
`backend/server/tests/checkout-v2-protected.test.js`. Only two files were added:
`backend/server/tests/dependency-security.test.js` and this report.
The source-integrity test's security-pass edit updates only the README fingerprint
after the documented security paragraph change; all 42 protected entries and their
assertions remain, with the other 41 fingerprints unchanged from the starting tree.
Existing Phase 4C schema/configuration work is preserved.

Comparison of all 445 starting entries confirms no other source or existing
environment-file changes. The protected checkoutIntegration test remains
`87dc83af5c5d5d182870a7bea0a7f45b86282c75c2555687d69c6286e18882ac`;
`frontend/vercel.json` remains
`59f90930c70f98d5925bbecd8aa6847c4a6fc45d241a0d048121b7765d82d4de`;
root `vercel.json` remains deleted. Branch and HEAD remain the stated checkpoint.

Detailed ancestry, primary registry metadata, original/final audit JSON, exact lock
changes, first-run and final TAP output, offline network logs and integrity results
are retained outside Git at:
`C:/Users/DCS/.codex/outputs/royal-fusion-phase4c-security-20261010/`.

The local corrections are ready for independent review with the **9 high and
8 moderate residual entries explicitly unresolved**. This is not production
authorization or approval to proceed to Phase 4D.
