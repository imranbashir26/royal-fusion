import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { nativeFixture, connection } from './support/release005NativeFixture.js'
import { apply005, defaultTuplesSQL } from './support/post014DefaultAclHardening.js'
import { normalLine, requestV2, orderV2 } from './support/checkoutV2Database.js'
import { mutate014, state014 } from './support/fulfillmentV2Database.js'
import { testerFixture, saveTester } from './support/testerCatalogDatabase.js'
import { sqlClient } from './support/fulfillmentDatabase.js'
import { ProductAdminService } from '../services/productAdminService.js'

const sourceURL = new URL('../../supabase/release-migrations/006_standard_variant_availability.sql', import.meta.url)
const product = '45852db8-8b83-425e-8d1f-4112958ed505'
const variant = 'b35b3be7-a7dd-4c70-9c14-d1a9394d4711'
async function apply006(db, source = null) {
  try { await db.query(source ?? await readFile(sourceURL, 'utf8')) }
  catch (error) { await db.query('rollback'); throw error }
}
async function revision(db) { return (await db.query('select catalog_revision::text r from products where id=$1', [product])).rows[0].r }
async function stock(db, id = variant) {
  return (await db.query('select stock_quantity,available,standard_manual_available from product_variants where id=$1', [id])).rows[0]
}
async function write(db, changes, patch = {}, expected = null) {
  const row = (await db.query('select * from product_variants where id=$1', [variant])).rows[0]
  const variants = changes == null ? null : [{ id: variant, optionName: row.option_name, optionValue: row.option_value,
    sku: row.sku, regularPrice: Number(row.regular_price), salePrice: null, stockQuantity: row.stock_quantity,
    active: row.active, displayOrder: row.display_order, ...changes }]
  return (await db.query('select public.save_catalog_product($1,$2::jsonb,$3::jsonb,$4) result',
    [product, JSON.stringify(patch), variants == null ? null : JSON.stringify(variants), expected ?? await revision(db)])).rows[0].result
}
async function createV1(f, id = randomUUID()) {
  return (await f.db.query('select public.create_order_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7::uuid,null) result',
    ['checkout:' + id, JSON.stringify([{ variantId: variant, quantity: 1 }]), JSON.stringify({ name: 'Fixture', email: 'fixture@example.invalid', phone: '00000000000' }),
      JSON.stringify({ address: 'Fixture', city: 'Karachi', province: 'Sindh', notes: '' }), 'Cash on Delivery', '', f.shipping])).rows[0].result
}
async function create(f, version = 2) {
  if (version === 1) return createV1(f)
  return orderV2(f.db, await requestV2(f.db, [normalLine(variant)]))
}
async function cancel(f, order, options = {}) {
  return mutate014(f, order.id, 'cancel', { reason: 'Availability regression fixture' }, options)
}
async function reset(f, quantity = 1) {
  await f.db.query('update product_variants set stock_quantity=$1,standard_manual_available=true,active=true where id=$2', [quantity, variant])
  await f.db.query("update products set status='Published',active=true where id=$1", [product])
}
async function waitBlocked(observer, client) {
  const pid = (await client.query('select pg_backend_pid() pid')).rows[0].pid
  return pid
}
async function assertBlocked(observer, pid) {
  for (let i = 0; i < 100; i++) {
    const r = (await observer.query('select wait_event_type from pg_stat_activity where pid=$1', [pid])).rows[0]
    if (r?.wait_event_type === 'Lock') return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.fail('Expected a real PostgreSQL lock wait')
}

test('Release 006 owned native PG17 acceptance; stop on first critical failure', async t => {
  async function scenario(name, body) {
    let passed = false
    await t.test(name, async st => { await body(st); passed = true })
    if (!passed) throw Error('Stopped on critical verification failure: ' + name)
  }
  await scenario('Release 005 is required; wrong baseline and repeat execution fail without changes', async st => {
    const db = await nativeFixture(st)
    const before = await state014(db)
    await assert.rejects(() => apply006(db), /RELEASE005_REQUIRED/)
    assert.deepEqual(await state014(db), before)
    await apply005(db)
    await db.query('grant execute on function public.save_catalog_product(uuid,jsonb,jsonb,text) to anon')
    await assert.rejects(() => apply006(db), /BASELINE_DRIFT/)
    assert.equal((await db.query("select count(*)::int n from pg_attribute where attrelid='product_variants'::regclass and attname='standard_manual_available'")).rows[0].n, 0)
  })
  const db = await nativeFixture(t)
  await apply005(db)
  const admin = (await db.query("select ur.user_id from user_roles ur join roles r on r.id=ur.role_id where r.key='admin' and ur.active")).rows[0].user_id
  const f = { db, admin }
  await scenario('Conservative initialization preserves all inventory, tester intent, timestamps, revisions and historical false flags', async () => {
    for (const [size, quantity, available] of [['60 ml', 3, false], ['70 ml', 0, false], ['80 ml', 0, true]]) {
      await db.query('insert into product_variants(product_id,option_value,sku,regular_price,stock_quantity,available) values($1,$2,$3,2900,$4,$5)',
        [product, size, randomUUID(), quantity, available])
    }
    const tester = await testerFixture(db, admin, { stockQuantity: 0, available: false })
    f.tester = tester
    const before = await state014(db), defaults = (await db.query(defaultTuplesSQL)).rows[0].state
    await apply006(db)
    const after = await state014(db)
    assert.deepEqual(after.products, before.products)
    assert.deepEqual(after.testers, before.testers)
    for (const row of after.variants) {
      const old = before.variants.find(v => v.id === row.id)
      const standard = old.product_id === product
      assert.deepEqual(row, { ...old, standard_manual_available: standard ? old.available : true,
        available: standard ? old.available && old.stock_quantity > 0 : old.available })
    }
    assert.deepEqual((await db.query(defaultTuplesSQL)).rows[0].state, defaults)
    const installed = await state014(db)
    await assert.rejects(() => apply006(db), /BASELINE_DRIFT/)
    assert.deepEqual(await state014(db), installed)
  })
  await db.query("insert into shipping_methods(code,name,base_fee) values('rf006','Fixture',250) returning id").then(r => { f.shipping = r.rows[0].id })
  await db.query(`insert into site_settings(id,payments) values('site','[{"name":"Cash on Delivery","active":true}]') on conflict(id) do update set payments=excluded.payments`)
  for (const version of [1, 2]) await scenario('V' + version + ' last-unit checkout, cancellation, replay and duplicate conserve stock and intent', async () => {
    await reset(f)
    const order = await create(f, version)
    assert.deepEqual(await stock(db), { stock_quantity: 0, available: false, standard_manual_available: true })
    const mutation = randomUUID(), first = await cancel(f, order, { mutation, revision: '0' })
    assert.equal(first.changed, true)
    assert.deepEqual(await stock(db), { stock_quantity: 1, available: true, standard_manual_available: true })
    const state = await state014(db)
    assert.equal((await cancel(f, order, { mutation, revision: '0' })).replayed, true)
    assert.deepEqual(await state014(db), state)
    assert.equal((await cancel(f, order)).changed, false)
    assert.equal((await stock(db)).stock_quantity, 1)
    assert.equal((await db.query("select count(*)::int n,sum(quantity_delta)::int balance from inventory_movements where reference_id=$1 and reason in ('Order placed','Order cancelled')", [order.id])).rows[0].balance, 0)
  })
  await scenario('Blocked before checkout, replenishment, metadata edits and stale admin revisions preserve intent', async () => {
    await reset(f)
    await write(db, { standardManualAvailable: false })
    const state = await state014(db)
    await assert.rejects(() => create(f))
    await assert.rejects(() => createV1(f))
    assert.deepEqual(await state014(db), state)
    const oldRevision = await revision(db)
    await write(db, null, { stock_quantity: 4 })
    await write(db, null, { short_description: 'Metadata only' })
    await write(db, { stockQuantity: 7 })
    assert.deepEqual(await stock(db), { stock_quantity: 7, available: false, standard_manual_available: false })
    await assert.rejects(() => write(db, { stockQuantity: 8 }, {}, oldRevision), /CATALOG_STALE/)
    await write(db, { standardManualAvailable: true })
    assert.equal((await stock(db)).available, true)
  })
  for (const version of [1, 2]) await scenario('V' + version + ' explicit block after depletion survives cancellation; old false DTO echo does not create a block', async () => {
    await reset(f)
    const order = await create(f, version)
    await write(db, { available: false })
    assert.equal((await stock(db)).standard_manual_available, true)
    await write(db, { standardManualAvailable: false, available: false })
    await cancel(f, order)
    assert.deepEqual(await stock(db), { stock_quantity: 1, available: false, standard_manual_available: false })
    await write(db, { available: true })
    assert.equal((await stock(db)).standard_manual_available, true)
  })
  await scenario('Legacy DTO replenishment and creation map manual intent without stock-derived disabling', async () => {
    await reset(f, 0)
    await write(db, { stockQuantity: 2, available: false })
    assert.deepEqual(await stock(db), { stock_quantity: 2, available: true, standard_manual_available: true })
    for (const manual of [true, false]) {
      const id = randomUUID()
      const saved = (await db.query('select save_catalog_product(null,$1::jsonb,$2::jsonb,null) result',
        [JSON.stringify({ name: 'Created', slug: id, sku: id, price: 100, scent_family: 'Woody', main_image_url: '/fixture.webp', status: 'Draft' }),
          JSON.stringify([{ optionName: 'Size', optionValue: '50ml', sku: id + '-v', regularPrice: 100, stockQuantity: 0, active: true, available: manual, displayOrder: 0 }])])).rows[0].result
      const v = saved.variants[0]
      assert.equal(v.standard_manual_available, manual)
      assert.equal(v.available, false)
      await db.query('update product_variants set stock_quantity=1 where id=$1', [v.id])
      assert.equal((await stock(db, v.id)).available, manual)
    }
  })
  await scenario('Backend admin schema, DTO round trip, explicit intent, tester boundary and metadata-only updates', async () => {
    await reset(f, 0)
    const client = sqlClient(db)
    client.rpc = async (name, args) => {
      assert.equal(name, 'save_catalog_product')
      try { return { data: (await db.query('select save_catalog_product($1,$2::jsonb,$3::jsonb,$4) result',
        [args.p_product_id, JSON.stringify(args.p_patch), args.p_variants == null ? null : JSON.stringify(args.p_variants), args.p_expected_revision])).rows[0].result, error: null } }
      catch (e) { return { data: null, error: { code: e.code, message: e.message } } }
    }
    const service = new ProductAdminService(client, { warn() {} }), actor = { userId: admin, requestId: 'rf006' }
    let dto = await service.get(product)
    const v = dto.variants.find(v => v.id === variant)
    assert.equal(v.standardManualAvailable, true)
    dto = await service.update(product, { expectedRevision: dto.catalogRevision, variants: [{ ...v, stockQuantity: 3 }] }, actor)
    assert.equal(dto.variants.find(v => v.id === variant).available, true)
    await service.update(product, { shortDescription: 'API metadata' }, actor)
    assert.equal((await stock(db)).standard_manual_available, true)
    await assert.rejects(() => service.saveTester(null, { variants: [{ standardManualAvailable: false }] }, actor), /does not apply to testers/)
    assert.ok(!(await service.get(f.tester.product.id)).variants.some(v => Object.hasOwn(v, 'standardManualAvailable')))
  })
  await scenario('Tester registry remains authoritative across replenishment, block and unblocking', async () => {
    const id = f.tester.tester.variant_id
    await db.query('update product_variants set stock_quantity=5,standard_manual_available=false where id=$1', [id])
    assert.equal((await stock(db, id)).available, false)
    await db.query('update tester_variants set manual_available=true where variant_id=$1', [id])
    assert.equal((await stock(db, id)).available, true)
    const made = await testerFixture(db, admin, { available: false, stockQuantity: 3 })
    assert.equal((await stock(db, made.tester.variant_id)).available, false)
    assert.equal(made.tester.manual_available, false)
  })
  await scenario('Publication and variant activation remain independent checkout restrictions', async () => {
    for (const [sql, args] of [
      ['update product_variants set active=false where id=$1', [variant]],
      ['update products set active=false where id=$1', [product]],
      ["update products set status='Unpublished' where id=$1", [product]],
    ]) {
      await reset(f)
      await db.query(sql, args)
      assert.equal((await stock(db)).available, true)
      await assert.rejects(() => create(f))
      await assert.rejects(() => createV1(f))
    }
  })
  await scenario('Service-only execution, browser RLS and unauthorized cancellation remain restricted', async () => {
    await reset(f)
    for (const role of ['anon', 'authenticated']) {
      await db.query('set role ' + role)
      try {
        await assert.rejects(() => db.query('select save_catalog_product($1,$2::jsonb,null,null)', [product, '{"name":"Denied"}']), /permission denied/)
        await assert.rejects(() => db.query('update product_variants set standard_manual_available=false where id=$1', [variant]), /permission denied/)
      } finally { await db.query('reset role') }
    }
    await write(db, { standardManualAvailable: false })
    await db.query('set role anon')
    try { assert.equal((await db.query('select id from product_variants where id=$1', [variant])).rows.length, 0) }
    finally { await db.query('reset role') }
    await reset(f)
    const order = await create(f), before = await state014(db)
    await assert.rejects(() => cancel(f, order, { actor: randomUUID() }))
    assert.deepEqual(await state014(db), before)
    await cancel(f, order)
  })
  for (const version of [1, 2]) await scenario('V' + version + ' late audit failure rolls back restored availability, stock, ledger and all order effects', async () => {
    await reset(f)
    const order = await create(f, version), before = await state014(db)
    await db.query(`create function public.rf006_fail_audit() returns trigger language plpgsql as $$begin raise exception 'RF006_LATE_FAILURE';end$$;
      create trigger rf006_fail before insert on admin_audit_logs for each row execute function public.rf006_fail_audit()`)
    try {
      await assert.rejects(() => cancel(f, order), /RF006_LATE_FAILURE/)
      assert.deepEqual(await state014(db), before)
    } finally { await db.query('drop trigger rf006_fail on admin_audit_logs;drop function public.rf006_fail_audit()') }
    await cancel(f, order)
  })
  await scenario('Native lock wait: concurrent checkout cannot oversell the last unit', async () => {
    await reset(f)
    const input = await requestV2(db, [normalLine(variant)]), name = (await db.query('select current_database() n')).rows[0].n
    const a = await connection(name), b = await connection(name)
    try {
      await a.query('begin')
      const order = await orderV2(a, input), pid = await waitBlocked(db, b)
      const pending = orderV2(b, { ...input, idempotencyKey: randomUUID() }).then(value => ({ value }), error => ({ error }))
      await assertBlocked(db, pid)
      await a.query('commit')
      assert.ok((await pending).error)
      assert.deepEqual(await stock(db), { stock_quantity: 0, available: false, standard_manual_available: true })
      await cancel(f, order)
    } finally { await a.query('rollback'); await a.end(); await b.end() }
  })
  await scenario('Native lock wait: manual block racing cancellation survives stock restoration', async () => {
    await reset(f)
    const order = await create(f), name = (await db.query('select current_database() n')).rows[0].n
    const a = await connection(name), b = await connection(name)
    try {
      await a.query('begin'); await write(a, { standardManualAvailable: false })
      const pid = await waitBlocked(db, b)
      const pending = cancel({ db: b, admin }, order).then(value => ({ value }), error => ({ error }))
      await assertBlocked(db, pid); await a.query('commit')
      assert.equal((await pending).value.changed, true)
      assert.deepEqual(await stock(db), { stock_quantity: 1, available: false, standard_manual_available: false })
    } finally { await a.query('rollback'); await a.end(); await b.end() }
  })
  await scenario('Native lock wait: stale stock editor behind checkout fails without overwriting inventory', async () => {
    await reset(f)
    const expected = await revision(db), input = await requestV2(db, [normalLine(variant)])
    const name = (await db.query('select current_database() n')).rows[0].n, a = await connection(name), b = await connection(name)
    try {
      await a.query('begin'); const order = await orderV2(a, input), pid = await waitBlocked(db, b)
      const pending = write(b, { stockQuantity: 20 }, {}, expected).then(value => ({ value }), error => ({ error }))
      await assertBlocked(db, pid); await a.query('commit')
      assert.match((await pending).error.message, /CATALOG_STALE/)
      assert.equal((await stock(db)).stock_quantity, 0)
      await cancel(f, order)
    } finally { await a.query('rollback'); await a.end(); await b.end() }
  })
})
