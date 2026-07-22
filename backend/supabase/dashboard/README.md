# Supabase SQL Editor Deployment

These scripts are for a **new, empty Supabase project**. They are a dashboard-friendly copy of the repository migrations and fictional starter data. They contain no credentials and do not connect the application to Supabase.

## Before You Start

1. Confirm the target Supabase project is new and has no Royal Fusion tables.
2. Use the Supabase Dashboard for the intended project and open **SQL Editor**.
3. Do not paste environment variables, service-role keys, customer data, or the live JSON database into the editor.
4. Keep each script in a separate SQL Editor query so failures are easy to identify.

## Execution Order

1. Open `001_apply_complete_schema.sql`, paste its complete contents into a new query, and select **Run** once.
2. Confirm the query reports success before continuing. This creates the full schema, functions, triggers, grants, constraints, and RLS policies.
3. Optional: open `002_apply_starter_seed.sql` in a new query and select **Run**. It adds only fictional catalog, media placeholder, shipping, promotion, and public-setting data.
4. Open `003_verify_deployment.sql` in a new query and select **Run**.
5. Review every row in the first result set. Every `check_passed` value must be `true`. Also review the policy inventory returned afterward.

The seed is optional. Skip it when real catalog data will be imported through a controlled migration or the Royal Fusion admin dashboard.

## If An Error Appears

1. Stop. Do not continue to the next script.
2. Record the script name, PostgreSQL error code, and line number. Do not include secret values in screenshots or reports.
3. Check that the project was empty and that the entire script was pasted without truncation.
4. If `001_apply_complete_schema.sql` failed, inspect whether its active transaction rolled back. The file contains migration transactions; do not assume every object was removed without checking.
5. Do not repeatedly edit and rerun individual statements in production. Correct the repository migration first, regenerate the dashboard script, and test against a disposable local or staging project.
6. Rerun `003_verify_deployment.sql` after any approved correction. It is read-only and identifies missing objects and unsafe grants.

## Rollback Warning

The repository rollback file at `../rollback/002_launch_schema_foundation_rollback.sql` reverses migration 002 only. It does **not** remove migration 001, and rollback can destroy launch-schema data. Never run rollback SQL against production without a verified backup, a maintenance window, and an approved recovery plan.

For a disposable new project where deployment fails before real data exists, deleting and recreating the Supabase project is usually clearer than manually attempting a partial rollback. Do not use that approach after customers, orders, or other production data exist.

## What Verification Covers

The verification script checks PostgreSQL catalogs for required tables, selected functions, triggers, indexes, RLS, browser grants, private-setting isolation, and backend-only checkout execution. It does not insert rows, call checkout, test concurrency, or prove application integration. Those runtime tests remain required in a safe local or staging Supabase environment.
