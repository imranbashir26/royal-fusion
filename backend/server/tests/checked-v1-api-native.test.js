import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import express from 'express'
import cookieParser from 'cookie-parser'
import {createAuthConfig} from '../auth/config.js'
import {getAuthCookieNames,getSessionCsrfToken} from '../auth/cookies.js'
import {authErrorHandler,requestContext} from '../middleware/authSecurity.js'
import {createOrdersV1Router} from '../routes/ordersV1.js'
import { nativeFixture } from './support/release005NativeFixture.js'
import { apply005 } from './support/post014DefaultAclHardening.js'
import { state014 } from './support/fulfillmentV2Database.js'
import { sqlClient } from './support/fulfillmentDatabase.js'
import { CheckoutQuoteService } from '../services/checkoutQuoteService.js'
import { OrdersV1Service } from '../services/ordersV1Service.js'
import { testerFixture, savePack, productPatch } from './support/testerCatalogDatabase.js'
import { fixedLine, configuredLine, requestV2, orderV2 } from './support/checkoutV2Database.js'

const variantId = 'b35b3be7-a7dd-4c70-9c14-d1a9394d4711'
const contact = { name: 'Fixture', email: 'fixture@example.invalid', phone: '00000000000' }
const shipping = { address: 'Fixture address', city: 'Karachi', province: 'Sindh', notes: '' }
const quotedInput = (couponCode = '') => ({ items: [{ variantId, quantity: 1 }], shipping: { city: shipping.city, province: shipping.province }, email: contact.email, couponCode })
const orderInput = (quote, couponCode = '') => ({ idempotencyKey: quote?.idempotencyKey ?? randomUUID(), items: quotedInput().items, contact, shipping, paymentMethod: 'Cash on Delivery', couponCode, ...(quote ? { quoteFingerprint: quote.quoteFingerprint } : {}) })
async function install(db, name) {
  try { await db.query(await readFile(new URL('../../supabase/release-migrations/' + name, import.meta.url), 'utf8')) }
  catch (error) { await db.query('rollback'); throw error }
}

// Bound-value transport to the real public RPCs under their actual service-role ACL.
// This adapter never loads Supabase credentials or connects outside the owned fixture.
function transport(db) {
  const client = { ...sqlClient(db), calls: [], loseResponse: false, async rpc(name, args) {
    client.calls.push({ name, args: structuredClone(args) })
    let result
    await db.query('set role service_role')
    try {
      if (name === 'quote_checkout_v1_checked') result = await db.query('select public.quote_checkout_v1_checked($1::jsonb,$2::uuid) result', [JSON.stringify(args.p_request), args.p_customer_id])
      else {
        assert.equal(name, 'create_order_transaction_v1_checked')
        result = await db.query('select public.create_order_transaction_v1_checked($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7::uuid,$8::uuid,$9) result', [args.p_idempotency_key, JSON.stringify(args.p_items), JSON.stringify(args.p_contact), JSON.stringify(args.p_shipping), args.p_payment_method, args.p_coupon_code, args.p_shipping_method_id, args.p_customer_id, args.p_quote_fingerprint])
      }
    } catch (error) { return { data: null, error: { code: error.code, message: error.message } } }
    finally { await db.query('reset role') }
    if (name === 'create_order_transaction_v1_checked' && client.loseResponse) { client.loseResponse = false; throw Error('Lost response after actual commit') }
    return { data: result.rows[0].result, error: null }
  } }
  return client
}

test('Checked V1 issued-token application adapters against native PG17; stop on critical failure', async t => {
  const db = await nativeFixture(t)
  await apply005(db); await install(db, '006_standard_variant_availability.sql')
  await db.query("insert into shipping_methods(code,name,base_fee) values('api007','Fixture',250)")
  await db.query(`insert into site_settings(id,payments) values('site','[{"name":"Cash on Delivery","active":true},{"name":"Bank Transfer","active":true}]') on conflict(id) do update set payments=excluded.payments`)
  const historical = orderInput(null)
  const legacy = (await db.query('select public.create_order_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,null,null,null) result', ['checkout:' + historical.idempotencyKey, JSON.stringify(historical.items), JSON.stringify(contact), JSON.stringify(shipping), historical.paymentMethod])).rows[0].result
  await install(db, '007_checked_v1_checkout.sql')
  await install(db, '008_durable_checkout_attempts.sql')
  const client = transport(db), logger = { warn() {} }, quotes = new CheckoutQuoteService(client, { logger }), orders = new OrdersV1Service(client, { logger, quoteService: quotes })
  async function scenario(name, run) { let passed = false; await t.test(name, async () => { await run(); passed = true }); if (!passed) throw Error('Critical verification failure: ' + name) }
  async function reset() {
    await db.query('update product_variants set stock_quantity=12,regular_price=2900,sale_price=null,standard_manual_available=true where id=$1', [variantId])
    await db.query("update shipping_methods set base_fee=250 where code='api007'")
  }
  await scenario('Actual SQL quote and checked service submission preserve order/payment/stock financials', async () => {
    const quote = await quotes.quote(quotedInput()), input = orderInput(quote)
    assert.equal(quote.total, 3150); assert.match(quote.quoteFingerprint, /^[0-9a-f]{64}$/); assert.equal('_coupon' in quote, false)
    const stock = (await db.query('select stock_quantity from product_variants where id=$1', [variantId])).rows[0].stock_quantity
    const receipt = await orders.create(input)
    assert.equal(receipt.total, quote.total); assert.equal(receipt.idempotent, false)
    const stored = (await db.query('select subtotal,discount,shipping_fee,total,v1_quote_fingerprint from orders where id=$1', [receipt.id])).rows[0]
    assert.deepEqual([Number(stored.subtotal), Number(stored.discount), Number(stored.shipping_fee), Number(stored.total)], [quote.subtotal, quote.discount, quote.shippingFee, quote.total])
    const expectedVerifier = createHash('sha256').update('rf:v1:capability:008:' + input.quoteFingerprint, 'utf8').digest('hex')
    // Release 008 persists the verifier, never the bearer. Boolean assertions
    // prevent a storage regression from printing the raw capability in TAP.
    assert.ok(stored.v1_quote_fingerprint === expectedVerifier, 'Stored confirmation must equal the canonical verifier')
    assert.ok(stored.v1_quote_fingerprint !== input.quoteFingerprint, 'Raw quote capability must not be stored')
    assert.equal((await db.query('select amount from payments where order_id=$1', [receipt.id])).rows.length, 1)
    assert.equal(Number((await db.query('select amount from payments where order_id=$1', [receipt.id])).rows[0].amount), quote.total)
    assert.equal((await db.query('select stock_quantity from product_variants where id=$1', [variantId])).rows[0].stock_quantity, stock - 1)
    const before = await state014(db)
    await assert.rejects(() => orders.create({ ...input, quoteFingerprint: stored.v1_quote_fingerprint }), { status: 409, code: 'IDEMPOTENCY_CONFLICT' })
    assert.deepEqual(await state014(db), before)
    const replay = await orders.create(input)
    assert.equal(replay.idempotent, true)
    assert.ok(replay.id === receipt.id, 'Committed replay must return the original order')
    assert.deepEqual(await state014(db), before)
  })
  await scenario('Missing, forged and mismatched issuance cannot authorize replacement or produce effects', async () => {
    const issued = orderInput(await quotes.quote(quotedInput())), other = orderInput(await quotes.quote(quotedInput()))
    const before = await state014(db)
    await assert.rejects(() => orders.create({ ...issued, idempotencyKey: undefined }), { status: 400, code: 'INVALID_CHECKOUT_REQUEST' })
    await assert.rejects(() => orders.create({ ...issued, idempotencyKey: randomUUID() }), { status: 503, code: 'CHECKOUT_UNAVAILABLE' })
    await assert.rejects(() => orders.create({ ...issued, quoteFingerprint: undefined }), { status: 400, code: 'INVALID_CHECKOUT_REQUEST' })
    await assert.rejects(() => orders.create({ ...issued, quoteFingerprint: 'bad' }), { status: 400, code: 'INVALID_CHECKOUT_REQUEST' })
    await assert.rejects(() => orders.create({ ...issued, quoteFingerprint: '0'.repeat(64) }), { status: 409, code: 'IDEMPOTENCY_CONFLICT' })
    await assert.rejects(() => orders.create({ ...issued, quoteFingerprint: other.quoteFingerprint }), { status: 409, code: 'IDEMPOTENCY_CONFLICT' })
    assert.deepEqual(await state014(db), before)
    assert.deepEqual((await db.query('select state from checkout_v1_attempts where token=any($1) order by token', [[issued, other].map(x => 'checkout:' + x.idempotencyKey)])).rows, [{ state: 'active' }, { state: 'active' }])
  })
  await scenario('Product price change rejects old quote, then explicit fresh confirmation succeeds', async () => {
    await reset(); const quote = await quotes.quote(quotedInput()), input = orderInput(quote)
    await db.query('update product_variants set sale_price=2500 where id=$1', [variantId]); const before = await state014(db)
    await assert.rejects(() => orders.create(input), { status: 409, code: 'QUOTE_CHANGED' }); assert.deepEqual(await state014(db), before)
    assert.equal((await db.query('select state from checkout_v1_attempts where token=$1', ['checkout:' + input.idempotencyKey])).rows[0].state, 'retired')
    const fresh = await quotes.quote(quotedInput()); assert.equal(fresh.total, 2750); assert.notEqual(fresh.quoteFingerprint, quote.quoteFingerprint)
    assert.equal((await orders.create(orderInput(fresh))).total, fresh.total)
  })
  await scenario('Shipping mutation is a no-effect public conflict', async () => {
    await reset(); const input = orderInput(await quotes.quote(quotedInput()))
    await db.query("update shipping_methods set base_fee=500 where code='api007'"); const before = await state014(db)
    await assert.rejects(() => orders.create(input), { status: 409, code: 'QUOTE_CHANGED' }); assert.deepEqual(await state014(db), before)
  })
  await scenario('Coupon mutation and lost eligibility are rejected without redemption', async () => {
    await reset(); await db.query("insert into coupons(code,type,discount_value,status) values('API007','Percentage',10,'Active')")
    const input = orderInput(await quotes.quote(quotedInput('API007')), 'API007')
    await db.query("update coupons set discount_value=20 where code='API007'"); let before = await state014(db)
    await assert.rejects(() => orders.create(input), { status: 409, code: 'QUOTE_CHANGED' }); assert.deepEqual(await state014(db), before)
    const fresh = orderInput(await quotes.quote(quotedInput('API007')), 'API007')
    await db.query("update coupons set status='Inactive' where code='API007'"); before = await state014(db)
    await assert.rejects(() => orders.create(fresh), { status: 422, code: 'INVALID_COUPON' }); assert.deepEqual(await state014(db), before)
  })
  await scenario('Material changed input cannot reuse a financial confirmation', async () => {
    await reset(); const input = orderInput(await quotes.quote(quotedInput())), before = await state014(db)
    await assert.rejects(() => orders.create({ ...input, items: [{ variantId, quantity: 2 }] }), { code: 'IDEMPOTENCY_CONFLICT' }); assert.deepEqual(await state014(db), before)
  })
  await scenario('Lost actual committed response retries exact fingerprint/token and never repeats effects', async () => {
    await reset(); const input = orderInput(await quotes.quote(quotedInput())); client.loseResponse = true
    await assert.rejects(() => orders.create(input), { code: 'CHECKOUT_UNAVAILABLE' })
    const priorCall = client.calls.at(-1), before = await state014(db)
    await db.query('update product_variants set sale_price=2000,stock_quantity=0 where id=$1', [variantId]); const changed = await state014(db)
    const replay = await orders.create(input); assert.equal(replay.idempotent, true); assert.equal(replay.total, 3150)
    assert.deepEqual(client.calls.at(-1), priorCall); assert.deepEqual(await state014(db), changed)
    assert.equal(before.orders.filter(row => row.id === replay.id).length, 1)
  })
  await scenario('Historical unchecked committed replay works through checked service after catalog changes', async () => {
    const before = await state014(db), replay = await orders.create(historical)
    assert.equal(replay.id, legacy.id); assert.equal(replay.idempotent, true); assert.equal(replay.total, legacy.total); assert.deepEqual(await state014(db), before)
    assert.ok(client.calls.every(call => ['quote_checkout_v1_checked', 'create_order_transaction_v1_checked'].includes(call.name)))
  })
  await scenario('Lost durable rejection response retains original request and recovers terminal state', async () => {
    await reset(); const body = orderInput(await quotes.quote(quotedInput()))
    await db.query('update product_variants set regular_price=3000 where id=$1', [variantId]); const before = await state014(db)
    client.loseResponse = true
    await assert.rejects(() => orders.create(body), { code: 'CHECKOUT_UNAVAILABLE', status: 503 })
    const originalCall = client.calls.at(-1)
    assert.equal((await db.query('select state from checkout_v1_attempts where token=$1', ['checkout:' + body.idempotencyKey])).rows[0].state, 'retired')
    await assert.rejects(() => orders.create(body), { code: 'QUOTE_CHANGED', status: 409 })
    assert.deepEqual(client.calls.at(-1), originalCall); assert.deepEqual(await state014(db), before)
  })
  await scenario('Uncommitted historical saved tokens fail closed without creating or retiring an attempt', async () => {
    const before = await state014(db), count = (await db.query('select count(*)::int n from checkout_v1_attempts')).rows[0].n
    await assert.rejects(() => orders.create(orderInput(null)), { code: 'INVALID_CHECKOUT_REQUEST', status: 400 })
    await assert.rejects(() => orders.create({ ...orderInput(null), quoteFingerprint: 'a'.repeat(64) }), { code: 'CHECKOUT_UNAVAILABLE', status: 503 })
    assert.deepEqual(await state014(db), before); assert.equal((await db.query('select count(*)::int n from checkout_v1_attempts')).rows[0].n, count)
  })
  await scenario('Real HTTP quote/order routes enforce issued tokens, session binding, origin, CSRF, rate limits and production gates', async () => {
    await reset()
    const customerId=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[customerId,'customer-http@example.invalid'])
    await db.query("update profiles set status='Active' where id=$1",[customerId])
    const origin='https://native-checkout.example.invalid'
    const config=createAuthConfig({NODE_ENV:'test',CLIENT_ORIGIN:origin,AUTH_CSRF_SECRET:'native-checkout-fixture-secret-at-least-32-characters'})
    const names=getAuthCookieNames(config),csrf=getSessionCsrfToken('fixture-handle',config)
    const jwt=`e30.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.sig`
    let sessionClass='customer'
    const runtime={config:{...config,environment:'test'},repository:{client},sessionService:{restore:async()=>({identity:{id:customerId},record:{sessionClass}})}}
    const app=express();app.use(requestContext,express.json(),cookieParser());app.use('/api',createOrdersV1Router(runtime,{client,logger,orderLimit:20}));app.use(authErrorHandler(config))
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve))
    const request=async(path,body,{actor=false,csrfValid=true,requestOrigin=origin}={})=>{
      const headers={'Content-Type':'application/json',Origin:requestOrigin}
      if(actor){headers.Cookie=`${names.access}=${jwt}; ${names.refresh}=fixture-refresh; ${names.session}=fixture-handle; ${names.csrf}=${csrf}`;if(csrfValid)headers['X-RF-CSRF']=csrf}
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`,{method:'POST',headers,body:JSON.stringify(body)})
      return {status:response.status,body:await response.json()}
    }
    try{
      const issued=await request('checkout/quote',quotedInput(),{actor:true});assert.equal(issued.status,200)
      const body=orderInput(issued.body.data)
      const before=await state014(db)
      assert.equal((await request('orders',body,{actor:true,csrfValid:false})).status,403)
      assert.equal((await request('orders',body,{requestOrigin:'https://evil.invalid'})).status,403)
      sessionClass='administrator';assert.equal((await request('orders',body,{actor:true})).status,403);sessionClass='customer'
      assert.equal((await request('orders',body)).body.error.code,'IDEMPOTENCY_CONFLICT')
      assert.deepEqual(await state014(db),before)
      const submitted=await request('orders',body,{actor:true});assert.equal(submitted.status,201)
      assert.equal((await db.query('select customer_id from orders where id=$1',[submitted.body.data.id])).rows[0].customer_id,customerId)
      const committed=await state014(db);const replay=await request('orders',body,{actor:true});assert.equal(replay.status,200);assert.equal(replay.body.data.id,submitted.body.data.id);assert.deepEqual(await state014(db),committed)
      const stale=(await request('checkout/quote',quotedInput())).body.data
      await db.query('update product_variants set regular_price=3000 where id=$1',[variantId])
      const rejected=await request('orders',orderInput(stale));assert.equal(rejected.status,409);assert.equal(rejected.body.error.code,'QUOTE_CHANGED')
      assert.equal((await db.query('select state from checkout_v1_attempts where token=$1',['checkout:'+stale.idempotencyKey])).rows[0].state,'retired')
      const fresh=(await request('checkout/quote',quotedInput())).body.data;assert.notEqual(fresh.idempotencyKey,stale.idempotencyKey)
      assert.equal((await request('orders',orderInput(fresh))).status,201)
      runtime.config.environment='production';runtime.config.secureCookies=true;const callCount=client.calls.length
      assert.equal((await request('orders',orderInput(fresh))).status,503);assert.equal(client.calls.length,callCount)
      const preview=await request('checkout/quote',quotedInput());assert.equal(preview.status,200);assert.equal(preview.body.data.orderingEnabled,false)
      runtime.config.environment='test';runtime.config.secureCookies=false
      let limited=false
      for(let i=0;i<25;i++){const result=await request('orders',{...body,items:[]});if(result.status===429){assert.equal(result.body.error.code,'CHECKOUT_RATE_LIMITED');limited=true;break}assert.equal(result.status,400)}
      assert.equal(limited,true)
    }finally{await new Promise(resolve=>server.close(resolve))}
  })
  await scenario('Standalone tester checked V1 and independent fixed/component-priced V2 packs remain compatible', async () => {
    await reset()
    const admin = (await db.query('select user_id from user_roles limit 1')).rows[0].user_id
    const tester = await testerFixture(db, admin), testerId = tester.tester.variant_id
    const request = { ...quotedInput(), items: [{ variantId: testerId, quantity: 1 }] }
    const quote = await quotes.quote(request)
    assert.equal(quote.subtotal, 250)
    const receipt = await orders.create({ ...orderInput(quote), items: request.items })
    assert.equal(receipt.total, quote.total)
    assert.equal((await db.query('select stock_quantity from product_variants where id=$1', [testerId])).rows[0].stock_quantity, 11)
    const patch = () => { const value = productPatch(); delete value.price; return value }
    const fixed = await savePack(db, admin, null, patch(), { mode: 'fixed', fixedRegularPrice: 450, components: [{ testerVariantId: testerId, quantityPerPack: 2, displayOrder: 0 }] })
    const configurable = await savePack(db, admin, null, patch(), { mode: 'configurable', allowedVariants: [{ testerVariantId: testerId, active: true, displayOrder: 0 }] })
    const f = { fixed, configurable, tester }
    const input = await requestV2(db, [fixedLine(f), configuredLine(f)])
    const v2 = await orderV2(db, input)
    assert.equal(v2.subtotal, 950); assert.equal(v2.total, 1200)
    assert.equal((await db.query('select stock_quantity from product_variants where id=$1', [testerId])).rows[0].stock_quantity, 7)
    const before = await state014(db)
    await assert.rejects(() => orders.create({ ...orderInput(quote), items: request.items, idempotencyKey: input.idempotencyKey }), { code: 'IDEMPOTENCY_CONFLICT' })
    assert.deepEqual(await state014(db), before)
  })
})
