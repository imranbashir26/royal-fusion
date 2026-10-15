# Backend verification

Run from the repository root using the locked Node 22.20+ or Node 24 dependencies.

- `npm run test:unit --workspace backend`: ordinary tests and embedded PGlite regressions. No external PostgreSQL is required. This is a partial verification result.
- `npm run test:native --workspace backend -- --pg-bin <PostgreSQL-17-bin>`: all required native groups through the existing owned runner.
- `npm test --workspace backend -- --pg-bin <PostgreSQL-17-bin>` (also `test:full`): unit/embedded and every required native group. Only this is the complete backend gate.
- `npm run test:list --workspace backend`: exact audited file selection. New test files must be classified in `server/scripts/backend-test-selection.mjs`; omissions and duplicates fail.

Install dependencies with `npm ci`. The locked `pg` dev dependency is used by default. `pg_config --bindir` can discover PostgreSQL binaries on PATH; explicit `--pg-bin` or `RF_TEST_PG_BIN` overrides discovery. Existing external test drivers may be specified by `--pg-module` or `RF_TEST_PG_MODULE`. No developer-specific paths, dotenv, production connection strings, or remote database are used. Windows requires a PostgreSQL 17 installation; Linux must run as an ordinary user because `initdb` rejects root.

`--output <fresh-directory>` preserves logs and JSON summaries. By default each run uses a unique OS temporary directory. Existing output/cluster directories are never reused. Fixtures connect only to 127.0.0.1:59705 and verify the cluster UUID marker, server version, database owner and actual data directory. An occupied test port fails; unrelated servers are never stopped.

The native groups are disjoint: V2/catalog regressions (`all`), Releases 005/006/007/008 acceptance (`acceptance`), and current V1/Admin compatibility (`compatibility`). Each group uses a new cluster. Tests retain their existing guarded migration/release installation sequences. Some regression cases use embedded PGlite; Release acceptance, checked-service integration, locking and restart-persistence cases use actual PostgreSQL 17. No mock is substituted for native transactional assertions.

Missing native prerequisites, skipped/cancelled tests, failed tests, incomplete TAP summaries, setup failure or shutdown failure prevent a full PASS. Failures stop the current selection; owned native cleanup completes before the orchestrator propagates failure. Native children retain their 10-minute test deadline; the outer 15-minute deadline includes initialization and teardown. Unit/embedded execution is bounded to 10 minutes. Interruptions are forwarded to the owned runner for cleanup.

Historical aliases containing native cases (`test:checkout`, `test:phase3`, `test:auth-transition`, `test:checkout-v2*`, `test:fulfillment-v2*`) now delegate the complete gate. The remaining targeted aliases are diagnostic subsets, not release acceptance.

`.github/workflows/backend-verification.yml` invokes the complete gate on pull requests and pushes using Ubuntu 24.04, Node 24 and explicitly installed PostgreSQL 17. It uses no production secrets. The repository administrator must configure `backend-required` as a required branch-protection check; local changes do not establish remote enforcement or prove a hosted CI run succeeded.
