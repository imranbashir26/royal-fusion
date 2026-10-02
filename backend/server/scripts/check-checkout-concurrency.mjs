import { spawn, spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Explicitly local, empty, disposable PostgreSQL only. No dotenv or database URLs.
const argument = (name) => process.argv[process.argv.indexOf(name) + 1]
const database = process.argv.includes('--database') ? argument('--database') : ''
const port = process.argv.includes('--port') ? argument('--port') : '5432'
const user = process.argv.includes('--user') ? argument('--user') : 'postgres'
if (!/^[a-z][a-z0-9_]*_phase3_disposable$/.test(database) || !/^\d{2,5}$/.test(port) || !/^[a-z][a-z0-9_]*$/.test(user)) {
  throw new Error('Use --database <name>_phase3_disposable [--port <local port>] [--user <local user>]. The database must already exist and be empty.')
}
const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'ComSpec', 'WINDIR', 'PATHEXT'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]))
if (spawnSync('psql', ['--version'], { env, windowsHide: true }).status !== 0) throw new Error('Local psql is unavailable. Concurrency verification was NOT run; PGlite is not a substitute.')
const args = ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', port, '-U', user, '-d', database]
function session(sql) {
  const child = spawn('psql', args, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = '', errors = '', lockedResolve
  const locked = new Promise((resolve) => { lockedResolve = resolve })
  child.stdout.on('data', (chunk) => { output += chunk; if (output.includes('LOCKED')) lockedResolve() })
  child.stderr.on('data', (chunk) => { errors += chunk })
  const timeout = setTimeout(() => child.kill(), 20000)
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => { clearTimeout(timeout); resolve({ code, output, errors }) })
  })
  child.stdin.end(sql)
  return { done, locked }
}
async function run(sql) {
  const result = await session(sql).done
  assert.equal(result.code, 0, 'Disposable PostgreSQL statement failed. Inspect the local database; no production connection is used.')
  return result.output.trim()
}
assert.equal(await run("select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema') and table_type='BASE TABLE';"), '0', 'Refusing a nonempty database')
await run(`do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key,email text,phone text,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
grant usage on schema auth to anon,authenticated,service_role;`)
for (const file of ['001_initial_schema.sql', '002_launch_schema_foundation.sql', '003_auth_schema_hardening.sql', '005_product_card_presentation.sql', '009_catalog_product_variants.sql', '010_checkout_product_locking.sql', '011_admin_order_fulfillment.sql']) {
  await run((await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8')).replace(/create extension if not exists pgcrypto;/i, ''))
}
const product = '45852db8-8b83-425e-8d1f-4112958ed505', a = 'b35b3be7-a7dd-4c70-9c14-d1a9394d4711', b = '8baeb954-f221-4990-a644-81d558aa22f2'
await run(`insert into public.products(id,name,slug,sku,price,scent_family,main_image_url,status,active)
values('${product}','Baraan','baraan','RF-BAR-001',2900,'Woody','https://example.invalid/fixture.webp','Published',true);
insert into public.product_variants(id,product_id,option_value,sku,regular_price,stock_quantity)
values('${a}','${product}','50 ml','RF-BAR-001',2900,12),('${b}','${product}','100 ml','RF-BAR-100',4000,12);
insert into public.shipping_methods(code,name,base_fee) values('standard','Standard',250);`)
const role = "select set_config('request.jwt.claim.role','service_role',false); set statement_timeout='10s'; set lock_timeout='8s';"
const order = (key, id, quantity) => `select public.create_order_transaction('${key}', '[{"variantId":"${id}","quantity":${quantity}}]',
'{"name":"Concurrent Fixture","email":"fixture@example.invalid","phone":"00000000000"}',
'{"address":"Fictional Address","city":"Karachi","province":"Sindh","notes":""}','Cash on Delivery',null,null,null);`
async function concurrent(first, second, secondFails = false, expectedError = null) {
  const left = session(`${role} begin; ${first} select 'LOCKED'; select pg_sleep(2); commit;`)
  const marker = await Promise.race([left.locked.then(() => true), left.done.then(() => false)])
  assert.equal(marker, true, 'First session did not reach its lock checkpoint')
  const start = Date.now(), right = await session(`${role} ${second}`).done
  assert.ok(Date.now() - start >= 1000, 'Second session did not wait for sibling/variant locks')
  assert.equal((await left.done).code, 0)
  assert.equal(right.code === 0, !secondFails)
  if (expectedError) assert.ok(right.errors.includes(expectedError), 'Unexpected conflict category')
}
await concurrent(order('same-variant-session-a', a, 8), order('same-variant-session-b', a, 8), true)
assert.equal(await run(`select stock_quantity from public.product_variants where id='${a}';`), '4')
await run(`update public.product_variants set stock_quantity=12,available=true;`)
await concurrent(order('siblings-session-a', a, 2), order('siblings-session-b', b, 3))
assert.equal(await run(`select stock_quantity from public.products where id='${product}';`), '19')
assert.equal(await run(`select sum(stock_quantity) from public.product_variants where product_id='${product}' and active;`), '19')
await concurrent(order('catalog-session-checkout', a, 1), `select public.save_catalog_product('${product}','{"description":"Concurrent metadata save"}',null);`)
assert.equal(await run(`select stock_quantity from public.products where id='${product}';`), '18')
const before = await run('select count(*) from public.orders;')
const rolledBack = await session(`${role} begin; ${order('atomic-rollback-fixture', b, 1)} select 1/0; commit;`).done
assert.notEqual(rolledBack.code, 0)
assert.equal(await run('select count(*) from public.orders;'), before)
assert.equal(await run(`select stock_quantity from public.products where id='${product}';`), '18')
// Relational admin races: all actors, orders and stock below are disposable fixtures.
const actor = randomUUID()
await run(`insert into auth.users(id,email) values('${actor}','admin-concurrency@example.invalid');
insert into public.user_roles(user_id,role_id) select '${actor}',id from public.roles where key='owner';`)
const admin = (id, action, revision, payload, mutation = randomUUID()) =>
  `select public.apply_admin_order_action('${id}','${actor}','${action}','${mutation}','${revision}','${JSON.stringify(payload)}','req_concurrency_fixture');`
const orderRevision = (id) => run(`select revision from public.orders where id='${id}';`)
const catalogRevision = () => run(`select catalog_revision from public.products where id='${product}';`)
async function fixtureOrder() {
  await run(`update public.product_variants set stock_quantity=12,available=true where product_id='${product}';`)
  const key = `checkout:${randomUUID()}`
  await run(`${role} ${order(key, a, 2)}`)
  return run(`select id from public.orders where idempotency_key='${key}';`)
}
let id = await fixtureOrder(), revision = await orderRevision(id)
await concurrent(admin(id, 'cancel', revision, { reason: 'Duplicate race' }), admin(id, 'cancel', revision, { reason: 'Duplicate race' }), true, 'ORDER_STALE')
assert.equal(await run(`select stock_quantity from public.product_variants where id='${a}';`), '12')
assert.equal(await run(`select count(*) from public.inventory_movements where reference_type='order' and reference_id='${id}' and reason='Order cancelled';`), '1')
await run(`${role} ${admin(id, 'cancel', await orderRevision(id), { reason: 'Acknowledged cancellation' })}`)
assert.equal(await run(`select stock_quantity from public.product_variants where id='${a}';`), '12')

id = await fixtureOrder(); revision = await orderRevision(id)
await concurrent(order(`checkout:${randomUUID()}`, a, 1), admin(id, 'cancel', revision, { reason: 'Checkout/restock race' }))
assert.equal(await run(`select stock_quantity from public.product_variants where id='${a}';`), '11')
assert.equal(await run(`select stock_quantity from public.products where id='${product}';`), '23')

id = await fixtureOrder(); revision = await orderRevision(id)
let catalogVersion = await catalogRevision()
await concurrent(admin(id, 'cancel', revision, { reason: 'Stale catalog race' }),
  `select public.save_catalog_product('${product}','{"stock_quantity":10}',null,'${catalogVersion}');`, true, 'CATALOG_STALE')
assert.equal(await run(`select stock_quantity from public.product_variants where id='${a}';`), '12')
const staleSave = await session(`${role} select public.save_catalog_product('${product}','{"stock_quantity":10}',null,'${catalogVersion}');`).done
assert.notEqual(staleSave.code, 0); assert.ok(staleSave.errors.includes('CATALOG_STALE'))

id = await fixtureOrder(); revision = await orderRevision(id); catalogVersion = await catalogRevision()
await concurrent(`select public.save_catalog_product('${product}','{"description":"Catalog/cancel race"}',null,'${catalogVersion}');`,
  admin(id, 'cancel', revision, { reason: 'Catalog save followed by cancellation' }))
assert.equal(await run(`select stock_quantity from public.product_variants where id='${a}';`), '12')

id = await fixtureOrder()
await run(`${role} ${admin(id, 'status', await orderRevision(id), { status: 'Confirmed', reason: '' })}`)
await run(`${role} ${admin(id, 'status', await orderRevision(id), { status: 'Processing', reason: '' })}`)
revision = await orderRevision(id)
await concurrent(admin(id, 'status', revision, { status: 'Shipped', courier: 'Fixture Courier', trackingNumber: 'FIXTURE-TRACK', reason: '' }),
  admin(id, 'cancel', revision, { reason: 'Too late' }), true, 'ORDER_STALE')
assert.equal(await run(`select status from public.orders where id='${id}';`), 'Shipped')
assert.equal(await run(`select stock_quantity from public.product_variants where id='${a}';`), '10')
console.log('PASS: real multi-connection PostgreSQL checkout locks/rollback, checkout vs cancellation, catalog vs cancellation, cancellation vs cancellation, fulfillment vs cancellation and stale catalog rejection. Delete this disposable database after inspection.')
