import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createCatalogDatabase } from './support/catalogDatabase.js'
import { CheckoutQuoteService, checkoutCalendarDate } from '../services/checkoutQuoteService.js'
import { OrdersV1Service } from '../services/ordersV1Service.js'

const productId = '45852db8-8b83-425e-8d1f-4112958ed505', variantId = 'b35b3be7-a7dd-4c70-9c14-d1a9394d4711'
const methodId = '60000000-0000-4000-8000-000000000001'
const baseRequest = { items: [{ variantId, quantity: 1 }], contact: { name: 'SQL Fixture', email: 'sql@example.invalid', phone: '00000000000' },
  shipping: { address: 'Fictional SQL Address', city: 'Karachi', province: 'Sindh', notes: '' }, paymentMethod: 'Cash on Delivery', couponCode: '' }

// Test-only PostgREST-shaped adapter to an in-memory database. No credentials/network.
function adapter(db) {
  return { from(table) {
    const values = [], filters = []
    let columns = '*', head = false, range = ''
    const ordering = []
    const name = (value) => { assert.match(value, /^[a-z_]+$/); return `"${value}"` }
    const parameter = (value) => { values.push(value); return `$${values.length}` }
    const query = {
      select(value, options) { columns = value.split(',').map(name).join(','); head = options?.head; return query },
      eq(column, value) { filters.push(`${name(column)} = ${parameter(value)}`); return query },
      in(column, value) { filters.push(value.length ? `${name(column)} in (${value.map(parameter).join(',')})` : 'false'); return query },
      ilike(column, value) { filters.push(`${name(column)} ilike ${parameter(value)}`); return query },
      order(column) { ordering.push(name(column)); return query },
      range(start, end) { range = ` limit ${end - start + 1} offset ${start}`; return query },
      or(expression) {
        filters.push(`(${expression.split(',').map((part) => {
          const [column, operator, ...rest] = part.split('.')
          return `${name(column)} ${operator === 'ilike' ? 'ilike' : '='} ${parameter(operator === 'ilike' ? JSON.parse(rest.join('.')) : rest.join('.'))}`
        }).join(' or ')})`); return query
      },
      then(resolve, reject) {
        return db.query(`select ${head ? 'count(*)::int as count' : columns} from public.${name(table)}${filters.length ? ` where ${filters.join(' and ')}` : ''}${ordering.length ? ` order by ${ordering.join(',')}` : ''}${range}`, values)
          .then((result) => ({ data: head ? null : result.rows, count: head ? result.rows[0].count : null, error: null })).then(resolve, reject)
      },
    }; return query
  }, async rpc(name, args) {
    assert.equal(name, 'create_order_transaction')
    try {
      const result = await db.query('select public.create_order_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7::uuid,$8::uuid) as receipt',
        [args.p_idempotency_key, JSON.stringify(args.p_items), JSON.stringify(args.p_contact), JSON.stringify(args.p_shipping), args.p_payment_method, args.p_coupon_code, args.p_shipping_method_id, args.p_customer_id])
      return { data: result.rows[0].receipt, error: null }
    } catch (error) { return { data: null, error: { code: error.code, message: error.message } } }
  } }
}
test('migration 010 changes only approved locking/shipping/UTC blocks and preserves ACL/signature', async () => {
  const original = await readFile(new URL('../../supabase/migrations/002_launch_schema_foundation.sql', import.meta.url), 'utf8')
  const changed = await readFile(new URL('../../supabase/migrations/010_checkout_product_locking.sql', import.meta.url), 'utf8')
  const end = 'grant execute on function public.create_order_transaction(text, jsonb, jsonb, jsonb, text, text, uuid, uuid) to service_role;'
  const definition = (sql) => { const part = sql.slice(sql.indexOf('create or replace function public.create_order_transaction(')); return part.slice(0, part.indexOf(end) + end.length) }
  const removeLock = (sql) => definition(sql).replace(/\r/g, '').replace(/  -- (?:Deterministic row locking|Match Phase 1)[\s\S]*?(?=  with requested as)/, '')
  const oldShipping = /  select rates\.fee into v_shipping_fee[\s\S]*?  limit 1;/
  const newShipping = /  -- Reject every tie[\s\S]*?  end if;/
  const normalized = removeLock(changed).replace('  v_shipping_rate_count integer;\n', '')
    .replaceAll("(statement_timestamp() at time zone 'UTC')::date", 'current_date')
    .replace(newShipping, removeLock(original).match(oldShipping)[0])
  assert.equal(normalized, removeLock(original))
  assert.ok(changed.indexOf('for update of siblings') < changed.indexOf('for update of products'))
})

test('PGlite shipping ambiguity fails closed in quote and actual RPC, including identical fees', async (t) => {
  const db = await createCatalogDatabase(); t.after(() => db.close())
  await db.exec(await readFile(new URL('../../supabase/migrations/010_checkout_product_locking.sql', import.meta.url), 'utf8'))
  await db.query(`insert into public.products(id,name,slug,sku,price,scent_family,main_image_url,status,active)
    values($1,'Baraan','baraan','RF-BAR-001',2900,'Woody','https://example.invalid/fixture.webp','Published',true)`, [productId])
  await db.query(`insert into public.product_variants(id,product_id,option_value,sku,regular_price,stock_quantity) values($1,$2,'50 ml','RF-BAR-001',2900,12)`, [variantId, productId])
  await db.query(`insert into public.shipping_methods(id,code,name,base_fee) values($1,'standard','Standard',250)`, [methodId])
  await db.exec(`insert into public.site_settings(id,payments) values('site','[{"name":"Cash on Delivery","active":true}]') on conflict(id) do update set payments=excluded.payments`)
  const client = adapter(db), quote = new CheckoutQuoteService(client, { logger: { warn() {} } })
  const preview = () => quote.quote({ items: baseRequest.items, shipping: { city: 'Karachi', province: 'Sindh' }, email: baseRequest.contact.email, couponCode: '' })
  let transaction = false
  const direct = async () => {
    if (transaction) await db.exec('savepoint checkout_attempt')
    const result = await client.rpc('create_order_transaction', { p_idempotency_key: `checkout:${crypto.randomUUID()}`, p_items: baseRequest.items, p_contact: baseRequest.contact, p_shipping: baseRequest.shipping,
      p_payment_method: 'Cash on Delivery', p_coupon_code: null, p_shipping_method_id: methodId, p_customer_id: null })
    if (transaction) { if (result.error) await db.exec('rollback to checkout_attempt'); await db.exec('release checkout_attempt') }
    return result
  }
  for (const [scope, sameFee] of [['default', false], ['default', true], ['city', false], ['city', true]]) {
    await db.exec('begin')
    transaction = true
    // Default ties are schema-valid. City duplicates are prevented by the current index;
    // remove it ONLY inside this disposable transaction to test the defensive RPC rule.
    if (scope === 'city') await db.exec('drop index public.shipping_rates_scope_uidx')
    await db.query(`insert into public.shipping_rates(shipping_method_id,scope_type,scope_value,fee,minimum_subtotal)
      values($1,$2,$3,200,0),($1,$2,$4,$5,0)`, [methodId, scope, scope === 'city' ? 'Karachi' : '', scope === 'city' ? 'KARACHI' : 'alternate', sameFee ? 200 : 300])
    await assert.rejects(preview(), { code: 'CHECKOUT_UNAVAILABLE' })
    const result = await direct(); assert.equal(result.error.code, 'P0001'); assert.match(result.error.message, /ambiguous/)
    await assert.rejects(new OrdersV1Service(client, { logger: { warn() {} } }).create({ ...baseRequest, idempotencyKey: crypto.randomUUID() }), { code: 'CHECKOUT_UNAVAILABLE' })
    assert.equal((await db.query('select count(*)::int n from public.orders')).rows[0].n, 0)
    assert.equal((await db.query('select stock_quantity from public.product_variants where id=$1', [variantId])).rows[0].stock_quantity, 12)
    await db.exec('rollback')
    transaction = false
  }
  await db.query(`insert into public.shipping_rates(shipping_method_id,scope_type,scope_value,fee,minimum_subtotal) values($1,'default','',200,0),($1,'default','higher',175,1000)`, [methodId])
  assert.equal((await preview()).shippingFee, 175); assert.equal((await direct()).data.shippingFee, 175)
  await db.exec('delete from public.shipping_rates')
  assert.equal((await preview()).shippingFee, 250); assert.equal((await direct()).data.shippingFee, 250)
})

test('UTC coupon dates agree around midnight regardless of database session timezone', async (t) => {
  const db = await createCatalogDatabase(); t.after(() => db.close())
  for (const timezone of ['UTC', 'Asia/Karachi', 'America/Los_Angeles']) {
    await db.query("select set_config('TimeZone',$1,false)", [timezone])
    for (const instant of ['2026-10-01T23:59:59.999Z', '2026-10-02T00:00:00.000Z', '2026-10-02T04:59:59+05:00']) {
      const expected = checkoutCalendarDate(new Date(instant))
      const result = (await db.query("select (($1::timestamptz at time zone 'UTC')::date)::text as calendar_day", [instant])).rows[0]
      assert.equal(result.calendar_day, expected)
      const eligibility = (await db.query("select ($1::timestamptz at time zone 'UTC')::date >= date '2026-10-02' started, ($1::timestamptz at time zone 'UTC')::date <= date '2026-10-01' unexpired", [instant])).rows[0]
      assert.equal(eligibility.started, expected >= '2026-10-02'); assert.equal(eligibility.unexpired, expected <= '2026-10-01')
    }
  }
})
test('PGlite actual RPC: Baraan snapshots, payment/inventory, replay, rollback and quote parity (not concurrency)', async (t) => {
  const db = await createCatalogDatabase(); t.after(() => db.close())
  await db.exec(await readFile(new URL('../../supabase/migrations/010_checkout_product_locking.sql', import.meta.url), 'utf8'))
  await db.query(`insert into public.products(id,name,slug,sku,price,scent_family,main_image_url,status,active)
    values($1,'Baraan','baraan','RF-BAR-001',2900,'Woody','https://example.invalid/baraan.webp','Published',true)`, [productId])
  await db.query(`insert into public.product_variants(id,product_id,option_value,sku,regular_price,stock_quantity) values($1,$2,'50 ml','RF-BAR-001',2900,12)`, [variantId, productId])
  await db.query(`insert into public.shipping_methods(id,code,name,base_fee,free_shipping_threshold) values($1,'standard','Standard',250,7000)`, [methodId])
  await db.query(`insert into public.shipping_rates(shipping_method_id,scope_type,scope_value,fee) values($1,'city','Karachi',200),($1,'province','Sindh',300),($1,'default','',250)`, [methodId])
  await db.exec(`insert into public.site_settings(id,payments) values('site','[{"name":"Cash on Delivery","active":true},{"name":"Bank Transfer","active":true}]') on conflict(id) do update set payments=excluded.payments`)
  const client = adapter(db), orders = new OrdersV1Service(client, { logger: { warn() {} } }), quotes = new CheckoutQuoteService(client)
  const request = { ...baseRequest, idempotencyKey: crypto.randomUUID() }
  const quote = await quotes.quote({ items: request.items, shipping: { city: 'Karachi', province: 'Sindh' }, email: request.contact.email, couponCode: '' })
  const receipt = await orders.create(request)
  assert.equal(receipt.total, 3100); assert.equal(receipt.paymentStatus, 'Unpaid'); assert.equal(receipt.status, 'Pending')
  for (const key of ['subtotal', 'discount', 'shippingFee', 'total']) assert.equal(receipt[key], quote[key])
  const snapshot = (await db.query('select * from public.order_items where order_id=$1', [receipt.id])).rows[0]
  assert.equal(snapshot.variant_id, variantId); assert.equal(snapshot.product_id, productId); assert.equal(snapshot.product_name, 'Baraan'); assert.equal(snapshot.size, '50 ml'); assert.equal(snapshot.sku, 'RF-BAR-001'); assert.equal(Number(snapshot.unit_price), 2900); assert.equal(Number(snapshot.line_total), 2900)
  assert.equal((await db.query('select stock_quantity from public.product_variants where id=$1', [variantId])).rows[0].stock_quantity, 11)
  assert.equal((await db.query('select stock_quantity from public.products where id=$1', [productId])).rows[0].stock_quantity, 11)
  const movement = (await db.query('select * from public.inventory_movements where reference_id=$1', [receipt.id])).rows[0]
  assert.equal(movement.quantity_delta, -1); assert.equal(movement.balance_after, 11)
  assert.equal((await db.query('select status from public.payments where order_id=$1', [receipt.id])).rows[0].status, 'Unpaid')
  assert.equal((await db.query('select count(*)::int n from public.order_status_history where order_id=$1', [receipt.id])).rows[0].n, 1)
  assert.equal((await orders.create(request)).idempotent, true)
  const before = (await db.query('select count(*)::int n from public.orders')).rows[0].n
  const counts = (await db.query('select (select count(*)::int from public.inventory_movements) movements,(select count(*)::int from public.payments) payments,(select count(*)::int from public.order_items) items')).rows[0]
  await db.exec(`create function public.fail_test_payment() returns trigger language plpgsql as $$ begin raise exception 'test-only payment failure'; end $$;
    create trigger test_payment_failure before insert on public.payments for each row execute function public.fail_test_payment();`)
  await assert.rejects(orders.create({ ...request, idempotencyKey: crypto.randomUUID() }))
  assert.equal((await db.query('select count(*)::int n from public.orders')).rows[0].n, before)
  assert.deepEqual((await db.query('select (select count(*)::int from public.inventory_movements) movements,(select count(*)::int from public.payments) payments,(select count(*)::int from public.order_items) items')).rows[0], counts)
  assert.equal((await db.query('select stock_quantity from public.product_variants where id=$1', [variantId])).rows[0].stock_quantity, 11)
  await db.exec('drop trigger test_payment_failure on public.payments; drop function public.fail_test_payment()')
  await db.exec(`insert into public.coupons(code,type,discount_value,per_customer_usage_limit) values('PARITY','Percentage',12.34,2)`)
  for (const settings of [
    { city: 'Karachi', province: 'Sindh', quantity: 1, couponCode: 'PARITY' },
    { city: 'Other', province: 'Sindh', quantity: 1, couponCode: '' },
    { city: 'Other', province: 'Other', quantity: 1, couponCode: '' },
    { city: 'Karachi', province: 'Sindh', quantity: 3, couponCode: '' },
  ]) {
    const candidate = { ...baseRequest, idempotencyKey: crypto.randomUUID(), items: [{ variantId, quantity: settings.quantity }], shipping: { ...baseRequest.shipping, city: settings.city, province: settings.province }, couponCode: settings.couponCode }
    const preview = await quotes.quote({ items: candidate.items, shipping: { city: settings.city, province: settings.province }, email: candidate.contact.email, couponCode: candidate.couponCode })
    const ordered = await orders.create(candidate)
    for (const key of ['subtotal', 'discount', 'shippingFee', 'total']) assert.equal(ordered[key], preview[key])
  }
  // Each parity case rolls back to preserve stock and coupon counters for the next case.
  for (const scenario of [
    { sale: 2500, couponType: 'Fixed Amount', value: 300, cap: null },
    { sale: 2500, couponType: 'Percentage', value: 12.34, cap: 100 },
    { sale: null, couponType: 'Free Shipping', value: 0, cap: null },
    { sale: 2400.01, couponType: 'Percentage', value: 12.34, cap: null, baseOnly: true },
  ]) {
    await db.exec('begin')
    await db.query('update public.product_variants set sale_price=$1 where id=$2', [scenario.sale, variantId])
    await db.query("update public.coupons set type=$1,discount_value=$2,max_discount_amount=$3 where code='PARITY'", [scenario.couponType, scenario.value, scenario.cap])
    if (scenario.baseOnly) await db.exec('delete from public.shipping_rates')
    const candidate = { ...baseRequest, idempotencyKey: crypto.randomUUID(), paymentMethod: 'Bank Transfer', couponCode: 'PARITY' }
    const preview = await quotes.quote({ items: candidate.items, shipping: { city: 'Karachi', province: 'Sindh' }, email: candidate.contact.email, couponCode: 'PARITY' })
    const result = await orders.create(candidate)
    assert.equal(result.paymentStatus, 'Pending')
    for (const key of ['subtotal', 'discount', 'shippingFee', 'total']) assert.equal(result[key], preview[key])
    await db.exec('rollback')
  }
  const acl = (await db.query(`select has_function_privilege('anon','public.create_order_transaction(text,jsonb,jsonb,jsonb,text,text,uuid,uuid)','execute') anon,
    has_function_privilege('authenticated','public.create_order_transaction(text,jsonb,jsonb,jsonb,text,text,uuid,uuid)','execute') authenticated,
    has_function_privilege('service_role','public.create_order_transaction(text,jsonb,jsonb,jsonb,text,text,uuid,uuid)','execute') service`)).rows[0]
  assert.deepEqual(acl, { anon: false, authenticated: false, service: true })
})
