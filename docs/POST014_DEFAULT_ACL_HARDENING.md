# Release 005: future browser table defaults

Local implementation for independent review only. This document does not approve
production access, SQL execution, deployment, ordering enablement, or another release.

## Scope and evidence

The supplied production checkpoint reports PostgreSQL 17.6, post-014 application
manifest `9f09f8db7c51e08bb92fd8e0e1fa1de15c628456ba8b8ff88c5a3be2853b3987`,
43 tables and one view owned by postgres, seven event triggers, and twenty enabled
public triggers using `set_updated_at()`. These are recorded observations, not a
fresh assessment of production. Source checkpoint is branch
`phase2-canonical-variants`, commit `0534be6a8f54c988152970c62be039b8ff55b3da`.

The actual production SELECT-only precheck returned phase `pre-release005`,
`overall_pass=false`, and `exact_pre_defaults=false`; every other check passed.
The application manifest and Baraan fingerprints/stock remained correct. No
production modification occurred. The blocker was an incomplete local ACL model,
not an unrelated manifest or business-state failure.

Production's postgres/public schema-specific TABLES default ACL contains exactly
twenty nondelegable tuples, all granted by postgres:

| Grantee | Explicit default privileges | Count |
| --- | --- | --- |
| postgres | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN | 8 |
| service_role | TRUNCATE, REFERENCES, TRIGGER, MAINTAIN | 4 |
| anon | TRUNCATE, REFERENCES, TRIGGER, MAINTAIN | 4 |
| authenticated | TRUNCATE, REFERENCES, TRIGGER, MAINTAIN | 4 |

Release 005 revokes only the eight browser tuples. Its exact post-state contains
twelve tuples: all eight owner grants and all four service_role grants, unchanged
in grantor, grantee, privilege and grant option. No owner grant is revoked or
normalized. Missing/changed owner grants, extra privileges or grantees, PUBLIC
grants, grant options and partial browser revocations fail closed.

The original twelve-to-four assumption excluded the eight explicit owner grants;
the original native fixture artificially removed them. Actual production evidence
invalidates that assumption and the fixture normalization. The corrected fixture
models the observed twenty-tuple profile without removing owner grants. Earlier
review/checksum evidence does not approve these corrected artifacts: a new
independent review and fresh production pre-verification are required before any
Release 005 execution can be authorized.

This is a latent security exposure on future objects, with potentially high impact
if a privileged creator adds an application relation without explicitly closing
its ACL. RLS does not provide a substitute for removing TRUNCATE authority. No
current exploitation, current production privilege drift or data loss is claimed.

The release changes one default-ACL entry, through one schema-specific statement.
Existing grants, service privileges on the 39 currently privileged relations, the
five restricted relations, column ACLs, DML permissions, ownership, functions,
policies, constraints, indexes and records are preserved. Other creator/schema
defaults, including supabase_admin table/sequence/function defaults, are preserved.
Migrations 001–014, releases 001–004 and rollback files remain unchanged.

## PostgreSQL semantics and conservative decisions

Default privileges apply to the current object-creating role, not defaults of its
member roles. Schema defaults add to global/hardwired defaults; a schema REVOKE
cannot remove global grants. Existing objects are unaffected. See
[PostgreSQL 17 ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).

The release requires no global postgres table-default entry. Even a seemingly
benign explicit global row requires separate review; it is not normalized away.
Browser superuser/role-creation/database-creation/RLS-bypass attributes and effective
or SET access to privileged roles, including pg_maintain, are rejected. An exact
schema ACL excludes PUBLIC and alternative-grantee privilege paths in that entry.
This release does not change global privileges, roles or memberships. It cannot
secure tables created by a different role or in another schema.

The eight explicit owner defaults and four future service_role grants remain.
The owner tuples are part of the exact observed baseline even where PostgreSQL's
hardwired owner privileges would otherwise provide the same effective authority.
They must remain explicitly present; effective-privilege equivalence is not an
excuse to remove or normalize them. Removing service_role defaults would need a separate
review of service maintenance, creation and foreign-key/trigger dependencies and
an explicit decision about future service operation. Apparent excess alone is not
evidence that revoking them is compatible. Existing service grants would still be
outside that option's scope.

`set_updated_at()` assigns NEW.updated_at using now() under SECURITY INVOKER; its
current implementation does not elevate the caller. PostgreSQL requires function
EXECUTE to create a trigger. Native tests distinguish this creation check from
execution of an already installed trigger after a test-only ACL revoke. Preserving
its implicit EXECUTE avoids altering future trigger installation dependencies and
the accepted manifest. Browser removal of future table TRIGGER defaults addresses
the chosen boundary. No function ACL, search path or trigger definition changes.
See [CREATE TRIGGER](https://www.postgresql.org/docs/17/sql-createtrigger.html).

`rls_auto_enable()` and every existing event trigger remain unchanged. ALTER DEFAULT
PRIVILEGES can fire DDL event callbacks; local platform callbacks model supplied
metadata with no-op bodies, not undisclosed production implementation. Callback
source/ACL/settings are captured for preservation, and bounded public row snapshots
detect persistent public business changes. Unknown external side effects or auth/
platform row mutations are outside that public snapshot scope. Review the fresh
callback metadata and established platform behavior before production authorization.
See [event-trigger matrix](https://www.postgresql.org/docs/17/event-trigger-matrix.html).

`has_permission(text)` remains the active-admin wildcard resolver installed by
release 003, with the recorded 35 policy dependencies. Backend
AdminAuthorizationService also requires an Active profile, active canonical admin
assignment and wildcard permission. The ignored argument is not redesigned into
granular authorization. `is_admin(admin_role[])`, its historical dependencies,
checkout, inventory, pricing, cancellation and fulfillment remain unchanged.

## Artifacts and local tests

- Release: backend/supabase/release-migrations/005_post014_browser_default_acl_hardening.sql
- Precheck: backend/supabase/tests/release005_pre_verification.sql
- Postcheck: backend/supabase/tests/release005_post_verification.sql
- Native integration: backend/server/tests/post014-default-acl-hardening.test.js
- Support: backend/server/tests/support/post014DefaultAclHardening.js and release005NativeFixture.js
- Runner: backend/server/scripts/test-release005-native.mjs

The runner requires PostgreSQL 17 binaries and an installed local node-postgres
module. Supply their paths explicitly; no dotenv, connection URL, production
credential, Supabase client or inherited PG connection settings are used. Example
from the repository root (use a new output directory for each run):

```powershell
node backend/server/scripts/test-release005-native.mjs --pg-bin 'C:\Program Files\PostgreSQL\17\bin' --pg-module 'C:\Users\DCS\AppData\Local\Temp\royal-fusion-release-012-014-b301c411\node_modules\pg\lib\index.js' --output 'C:\Users\DCS\.codex\outputs\release005-independent-native'
```

It initializes a fresh owned cluster, binds only 127.0.0.1:59705, verifies data-directory
identity and an ownership marker, and stops the server in finally. A prototype uses
the established migration/support infrastructure; each scenario gets a disposable
clone. Native evidence separates source-pattern checks from executable SQL tests.
LF/CRLF combinations, negative prerequisites, exact rerun, transaction rollback,
real lock/statement timeouts, real future-table privileges and preservation are
tested. The corrected baseline test requires the genuine twenty-to-twelve
transition, exactly eight browser removals, no additions and byte-for-byte
preservation of the owner/service tuples. Negative scenarios reject unexpected
owner-grant changes, grantees, grant options, partial browser changes, conflicting
global defaults and unsafe role inheritance. Short timeout variants and failure
injection exist only in test copies.

Ordinary backend test discovery skips this native suite without the runner's owned
configuration; a skip is not a native pass. Use the explicit runner for acceptance.
Synthetic Baraan rows reproduce identity and stock, not production row values.
Their before/after rows and fingerprints must match, but they intentionally fail
the production-only fingerprint gate in the verification scripts. No test exception
is allowed when using those scripts in production.

The installed local server is PostgreSQL 17.11; production is recorded as 17.6.
Do not claim exact-minor-version execution. Fixture-only managed callbacks and
supabase_admin default tuples prove preservation mechanics, not current managed
production definitions. A first critical test failure stops the suite.

## Preconditions, transaction and rerun

The SQL requires postgres, PostgreSQL major 17, READ COMMITTED, required roles,
expected public schema/database ownership, exact post-014 application manifest,
44 postgres-owned application relations, seven events and twenty enabled updated-at
triggers. The function must retain postgres ownership, SECURITY INVOKER, implicit
ACL and no fixed configuration. Only the exact twenty-tuple pre-state or exact
twelve-tuple post-state is accepted. The pre-state contains owner eight, service
four and browser eight; the post-state contains owner eight and service four.
Partial hardening or any change to preserved owner/service tuples fails.

One BEGIN/COMMIT transaction has 5-second lock and 60-second statement timeouts.
An advisory transaction lock coordinates this release only; it does not block
uncooperative DDL/DML. A quiet, controlled window remains mandatory.
Before mutation it captures preserved metadata and bounded public business row/
tuple-version digests. Each of 43 tables has a 10,000-row cap; reaching row 10,001
fails before mutation. Postconditions require the exact twelve preserved tuples and unchanged
manifest, other defaults, roles, schemas, functions, raw ACLs, policies, triggers,
indexes, constraints and public row snapshots. Failures abort the transaction.
An exact rerun accepts only the complete twelve-tuple post-state, validates all
other prerequisites and returns without another ACL write. It does not repair
owner defaults, add missing preserved grants or complete a partial browser revoke.

No application object or temporary table/function is created by the release. No
application table is locked for writes merely to change a default. Catalog/row
reads still acquire normal read locks and may block on external DDL.

## Proposed production runbook — later review only

1. Obtain fresh independent approval of the corrected twenty-to-twelve artifacts
   and their new checksums. The previous twelve-to-four approval is insufficient.
   Verify the intended
   production project name/reference, current source checkpoint and postgres role.
   Keep Belmo stopped and ordering disabled; arrange a quiet window with no concurrent DDL, default-
   privilege changes, migrations or business writes. Do not rerun 012–014 or 004.
2. Accept a current recovery checkpoint. Confirm the intended project's backup,
   timestamp, checksum, readable archive and coverage, including post-014 schema,
   roles/default ACLs, auth/platform dependencies and event triggers as required by
   the recovery objective. The old pre-012 public-only dump is not proof of current
   full recovery. A broader backup/restore exercise requires separate authorization.
   Capture the exact twenty original default tuples, including all eight owner
   and four service_role tuples. Record grantor, grantee, privilege and grant
   option. A digest cannot reconstruct missing tuples or restore row values.
3. Run the complete precheck alone in a fresh SQL Editor tab as postgres. It is one
   SELECT with transaction-local search_path normalization, no explicit BEGIN/COMMIT
   and no persistent write. Save the full JSON securely. Require
   phase=pre-release005, overall_pass=true, exact_pre_defaults=true, every other
   check true, and exactly twenty tuples matching the approved profile above.
   The earlier false exact_pre_defaults result is not acceptable for the corrected
   precheck. Errors, cap hits, missing prerequisites, unexpected grants,
   role inheritance, stock/fingerprint differences or nonempty required business
   sets are STOP conditions. Do not reinterpret failures or edit the accepted hash.
4. Review the actual results and backup/recovery acceptance. Obtain separate explicit
   human authorization to execute Release 005. This document grants none.
5. Only after that approval, submit the entire exact release file once as postgres,
   without partial selection or an outer transaction. It manages BEGIN/COMMIT.
   Do not combine it with verification files. It returns no approval result set.
6. Run the postcheck alone and save its complete JSON. Require every check and
   overall_pass true; exactly twelve default tuples comprising the unchanged
   eight owner and four service_role grants; exactly eight browser removals and
   no additions. The application manifest remains
   9f09f8db7c51e08bb92fd8e0e1fa1de15c628456ba8b8ff88c5a3be2853b3987 because
   the existing manifest excludes pg_default_acl. An unchanged manifest alone is
   NOT evidence of successful hardening.
7. Compare pre/post preserved_metadata_sha256, supabase_admin_defaults_sha256,
   effective privilege hashes, event metadata, updated-at trigger arrays, all 43
   business snapshot rows and Baraan fingerprints exactly. Snapshot tuples are
   [table, visible_count, within_cap, row_value_sha256, tuple_version_sha256].
   Require unchanged Baraan product fingerprint
   19f3efa868003a05f6f06936ff0cc419bd49e9036721075786e5a5b514dc3693
   and variant fingerprint
   0499a08df4c7390b2d91f10987980c402ef25d8c202207424bf0dceaec191f7c,
   stock 12/12, standard identity, no orders/payments/movements/tester/component
   records. Keep exports private: deterministic hashes are not encryption.
8. Stop on SQL failure, timeout, lost response or uncertain completion. Preserve
   submitted file/hash, timestamps, errors and actual outputs. Assess state with
   the reviewed SELECT scripts before any retry. A new editor tab does not prove
   the original connection was rolled back. Do not send an improvised COMMIT,
   grant broad privileges, revoke/normalize owner grants, restore a backup or run
   an automatic reversal. A verified exact twelve-tuple state is the valid rerun
   profile, not evidence of missing owner grants. A twenty-tuple state means the
   browser defaults remain; any other tuple set requires independent assessment.
   Prefer retaining successful hardening while investigating verified issues;
   any compensation requires its own reviewed forward artifact and authorization.

This release provides no deployment, production migration or ordering approval.
