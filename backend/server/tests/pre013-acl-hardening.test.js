import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  pre013Fixture, installHistoricalAclDrift, applyHardening, catalogSnapshot,
  preservedSnapshot, affectedRelations, browserRolesFor, excessPrivileges,
  hardeningURL, hardenedHash, historicalHash, hardenedTablesHash,
} from './support/pre013AclHardening.js'
import { shapeSQL } from './support/catalogManifest.js'
import { applyV2, normalLine, quoteRequest, quoteV2 } from './support/checkoutV2Database.js'
import { testerFixture } from './support/testerCatalogDatabase.js'
import { sessionSqlClient } from './support/singleAdminDatabase.js'
import { AdminAuthorizationService } from '../services/adminAuthorizationService.js'

const productId = '45852db8-8b83-425e-8d1f-4112958ed505'
const variantId = 'b35b3be7-a7dd-4c70-9c14-d1a9394d4711'
async function fixture(t) {
  const f = await pre013Fixture()
  t.after(() => f.db.close())
  return f
}
async function manifestHash(db) { return (await db.query(shapeSQL)).rows[0].shape }
async function seedNormal(db) {
  await db.query("insert into public.products(id,name,slug,sku,price,scent_family,main_image_url,status,active) values($1,'Baraan','baraan','RF-BAR-001',2900,'Woody','/fixture.webp','Published',true)", [productId])
  await db.query("insert into public.product_variants(id,product_id,option_value,sku,regular_price,stock_quantity) values($1,$2,'50 ml','RF-BAR-001-50',2900,12)", [variantId, productId])
}
async function assertDenied(db, reference) {
  for (const name of affectedRelations) {
    const table = reference.tables.find(t => t[0] === name)
    for (const role of browserRolesFor(name)) {
      for (const privilege of excessPrivileges) {
        assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed', [role, `public.${name}`, privilege])).rows[0].allowed, false, `${name}/${role}/${privilege}`)
      }
      for (const column of table[5]) {
        assert.equal((await db.query('select has_column_privilege($1,$2,$3,$4) allowed', [role, `public.${name}`, column[0], 'REFERENCES'])).rows[0].allowed, false, `${name}.${column[0]}/${role}`)
      }
    }
  }
}

for (const styles of [['LF', 'LF'], ['LF', 'CRLF'], ['CRLF', 'LF'], ['CRLF', 'CRLF']]) {
  test(`pre-013 ACL release: exact repair, preservation and rerun ${styles.join('/')}`, async t => {
    const { db } = await fixture(t)
    await seedNormal(db)
    const reference = await catalogSnapshot(db)
    assert.equal(await manifestHash(db), hardenedHash)
    await installHistoricalAclDrift(db)
    assert.equal(await manifestHash(db), historicalHash)
    const preserved = await preservedSnapshot(db)
    await applyHardening(db, styles[0])
    assert.equal(await manifestHash(db), hardenedHash)
    assert.equal((await db.query("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') hash", [JSON.stringify((await catalogSnapshot(db)).tables)])).rows[0].hash, hardenedTablesHash)
    assert.deepEqual(await catalogSnapshot(db), reference)
    await assertDenied(db, reference)
    assert.deepEqual(await preservedSnapshot(db), preserved)
    await applyHardening(db, styles[1])
    assert.deepEqual(await catalogSnapshot(db), reference)
    assert.deepEqual(await preservedSnapshot(db), preserved)
    // Section 6 explicitly permits 013 in a disposable database; never apply 014.
    await applyV2(db)
    assert.equal(await manifestHash(db), 'e195cbf3221767a490c8c340c128b3f4ea8bdf42711d4845e3629160aa366557')
    await assert.rejects(() => applyHardening(db), /RF_PRE013_ACL_BASELINE_DRIFT/)
  })
}

const rejectedStates = [
  ['partial repair', 'revoke trigger on public.orders from anon', /BASELINE_DRIFT/],
  ['unexpected browser SELECT', 'grant select on public.orders to anon', /BASELINE_DRIFT/],
  ['grant option', 'grant trigger on public.orders to anon with grant option', /BASELINE_DRIFT/],
  ['explicit column grant', 'grant references (id) on public.orders to anon', /BASELINE_DRIFT/],
  ['service privilege drift', 'revoke update on public.orders from service_role', /BASELINE_DRIFT/],
  ['owner drift', 'alter table public.orders owner to service_role', /OBJECT_DRIFT/],
  ['view replaced by table', 'alter view public.product_sales_rankings rename to pre013_old_view; create table public.product_sales_rankings(id integer)', /OBJECT_DRIFT/],
  ['missing relation', 'drop table public.contact_messages', /OBJECT_DRIFT/],
  ['missing role', 'alter role anon rename to pre013_missing_anon', /ROLES_REQUIRED/],
  ['unexpected public function', 'create function public.pre013_unapproved() returns integer language sql as $$select 1$$', /BASELINE_DRIFT/],
]
for (const [label, mutation, expected] of rejectedStates) {
  test(`pre-013 ACL release rejects ${label} without modifying its input`, async t => {
    const { db } = await fixture(t)
    await installHistoricalAclDrift(db)
    await db.exec(mutation)
    const before = await catalogSnapshot(db), preserved = await preservedSnapshot(db)
    await assert.rejects(() => applyHardening(db), expected)
    assert.deepEqual(await catalogSnapshot(db), before)
    assert.deepEqual(await preservedSnapshot(db), preserved)
  })
}

test('pre-013 ACL release rolls back all revokes on a late failure', async t => {
  const { db } = await fixture(t)
  await installHistoricalAclDrift(db)
  const before = await catalogSnapshot(db), preserved = await preservedSnapshot(db)
  const source = await readFile(hardeningURL, 'utf8')
  const injected = source.replace('-- @PRE013-POSTCHECK', "raise exception 'RF_PRE013_ACL_INJECTED_LATE_FAILURE';\n -- @PRE013-POSTCHECK")
  assert.notEqual(injected, source)
  await assert.rejects(() => applyHardening(db, 'LF', injected), /INJECTED_LATE_FAILURE/)
  assert.deepEqual(await catalogSnapshot(db), before)
  assert.deepEqual(await preservedSnapshot(db), preserved)
  assert.equal(await manifestHash(db), historicalHash)
})

test('pre-013 ACL release preserves public reads, customer access, backend authority and tester/V1/V2 flows', async t => {
  const { db, admin } = await fixture(t)
  await seedNormal(db)
  await db.exec("create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('fixture.user_uuid',true),'')::uuid$$")
  await installHistoricalAclDrift(db)
  await applyHardening(db)
  const customer = (await db.query('select id from auth.users where id<>$1 limit 1', [admin])).rows[0].id
  await db.exec('set role anon')
  try {
    assert.equal((await db.query('select name from public.products where id=$1', [productId])).rows[0].name, 'Baraan')
    await assert.rejects(() => db.exec('truncate public.orders'), /permission denied/)
    await assert.rejects(() => db.exec('select * from public.tester_variants'), /permission denied/)
  } finally { await db.exec('reset role') }
  await db.query("select set_config('fixture.user_uuid',$1,false)", [customer])
  await db.exec('set role authenticated')
  try {
    assert.equal((await db.query('select id from public.profiles where id=$1', [customer])).rows[0].id, customer)
    await db.query('update public.profiles set full_name=$1 where id=$2', ['Synthetic customer update', customer])
  } finally { await db.exec('reset role') }
  assert.deepEqual((await new AdminAuthorizationService(sessionSqlClient(db)).resolve(admin)).permissions, ['*'])
  await testerFixture(db, admin)
  const method = (await db.query("insert into public.shipping_methods(code,name,base_fee) values('pre013-fixture','Fixture',250) returning id")).rows[0].id
  await db.exec(`insert into public.site_settings(id,payments) values('site','[{"name":"Cash on Delivery","active":true}]') on conflict(id) do update set payments=excluded.payments`)
  await db.exec('set role service_role')
  try {
    const receipt = (await db.query('select public.create_order_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7::uuid,$8::uuid) receipt',
      ['pre013-v1-'+createHash('sha256').update('fixture').digest('hex'), JSON.stringify([{ variantId, quantity: 1 }]), JSON.stringify({ name: 'Synthetic customer', email: 'fixture@example.invalid', phone: '00000000000' }), JSON.stringify({ address: 'Synthetic address', city: 'Karachi', province: 'Sindh', notes: '' }), 'Cash on Delivery', null, method, null])).rows[0].receipt
    assert.ok(receipt.id)
  } finally { await db.exec('reset role') }
  await applyV2(db)
  const quote = await quoteV2(db, quoteRequest([normalLine(variantId)]))
  assert.match(quote.quoteFingerprint, /^[0-9a-f]{64}$/)
})
