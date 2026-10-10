import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { phase3Database } from './phase3Database.js'

// Selected approved DDL/functions in a new in-memory database only. No migration
// file is executed, no installation guard is bypassed on an existing database.
export async function phase3CheckoutDatabase() {
  const f = await phase3Database(), { db } = f
  const read = name => readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8')
  const initial = await read('001_initial_schema.sql'), foundation = await read('002_launch_schema_foundation.sql')
  const tester = await read('012_tester_catalog_foundation.sql'), checkout = await read('013_tester_checkout_order_snapshots.sql')
  const table = (sql, name) => sql.match(new RegExp(`create table(?: if not exists)? public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]
  // Only columns read by the unchanged quote engine are added to these fixture parents.
  await db.exec("alter table products add column sku text default 'fixture', add column category_id uuid references categories(id), add column status text default 'Published', add column active boolean default true")
  for (const name of ['product_variants', 'product_categories', 'shipping_methods', 'shipping_rates', 'public_site_settings']) await db.exec(table(foundation, name))
  await db.exec(table(initial, 'site_settings'))
  await db.exec('alter table product_variants add constraint fixture_variant_owner unique(id,product_id)')
  for (const name of ['tester_variants', 'tester_packs', 'tester_pack_components', 'tester_pack_allowed_variants']) await db.exec(table(tester, name))
  const fn = (sql, name) => sql.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\$fn\\$;`))[0]
  await db.exec(fn(tester, 'tester_pack_definition_hash'))
  for (const name of ['compact', 'hash', 'keys', 'integer', 'uuid', 'text', 'lines', 'canonical', 'resolve']) await db.exec(fn(checkout, `checkout_v2_${name}`))
  f.actor = randomUUID(); await db.query('insert into auth.users values($1)', [f.actor])
  f.parent = randomUUID(); f.component = randomUUID(); f.variant = randomUUID(); f.parentCategory = randomUUID(); f.componentCategory = randomUUID()
  for (const [id, name] of [[f.parentCategory, 'Parent'], [f.componentCategory, 'Component']]) await db.query('insert into categories values($1,$2)', [id, name])
  await db.query("insert into products(id,name,commerce_kind,category_id) values($1,'Pack','tester_pack',$2),($3,'Tester','tester',$4)", [f.parent, f.parentCategory, f.component, f.componentCategory])
  await db.query("insert into product_variants(id,product_id,option_value,sku,regular_price,stock_quantity) values($1,$2,'5 ml','FIXTURE-5',250,12)", [f.variant, f.component])
  await db.query('insert into tester_variants(variant_id,tester_product_id) values($1,$2)', [f.variant, f.component])
  await db.query("insert into tester_packs(product_id,mode,fixed_regular_price,definition_fingerprint) values($1,'fixed',450,$2)", [f.parent, '0'.repeat(64)])
  await db.query('insert into tester_pack_components(pack_id,tester_variant_id,quantity_per_pack) values($1,$2,2)', [f.parent, f.variant])
  await db.query('update tester_packs set definition_fingerprint=tester_pack_definition_hash(product_id) where product_id=$1', [f.parent])
  await db.exec("insert into shipping_methods(code,name,base_fee) values('fixture','Fixture',250); insert into site_settings(id,payments) values('site','[{\"name\":\"Cash on Delivery\",\"active\":true}]')")
  f.quote = async (code, lines = [{ kind: 'fixed_tester_pack', packId: f.parent, definitionRevision: '1', quantity: 1 }]) => (await db.query('select public.checkout_v2_resolve(public.checkout_v2_canonical($1::jsonb,null,false),false) as result', [JSON.stringify({ contractVersion: 2, lines, shipping: { city: 'Karachi', province: 'Sindh' }, email: 'fixture@example.invalid', couponCode: code })])).rows[0].result
  return f
}
