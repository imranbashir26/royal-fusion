import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// In-memory PostgreSQL only. No dotenv, connection strings or network database.
export async function createCatalogDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text, phone text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create function auth.role() returns text language sql stable as $$
      select current_setting('request.jwt.claim.role', true)
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    select set_config('request.jwt.claim.role', 'service_role', false);
  `)
  for (const name of ['001_initial_schema.sql', '002_launch_schema_foundation.sql',
    '005_product_card_presentation.sql', '009_catalog_product_variants.sql']) {
    let sql = await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8')
    // UUID generation is built into PostgreSQL; pgcrypto isn't bundled in PGlite.
    sql = sql.replace(/create extension if not exists pgcrypto;/i, '')
    await db.exec(sql)
  }
  return db
}

export async function saveCatalog(db, id, patch, variants = null) {
  const result = await db.query('select public.save_catalog_product($1::uuid, $2::jsonb, $3::jsonb) as saved',
    [id, JSON.stringify(patch), variants === null ? null : JSON.stringify(variants)])
  return result.rows[0].saved
}
