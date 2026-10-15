import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID,randomBytes } from 'node:crypto'
import express from 'express'
import cookieParser from 'cookie-parser'
import { createAuthConfig } from '../auth/config.js'
import { getAuthCookieNames, getSessionCsrfToken } from '../auth/cookies.js'
import { authErrorHandler, requestContext } from '../middleware/authSecurity.js'
import { createOrdersV1Router } from '../routes/ordersV1.js'
import { publicRouter } from '../routes/public.js'
import { OrdersV1Service } from '../services/ordersV1Service.js'
import { CheckoutQuoteService, checkoutCalendarDate } from '../services/checkoutQuoteService.js'
import { LegacyQuoteOracle } from './support/v1QuoteOracle.js'
import { parseCheckout, orderRequestSchema } from '../schemas/ordersV1.js'

export const productId = '45852db8-8b83-425e-8d1f-4112958ed505'
export const variantId = 'b35b3be7-a7dd-4c70-9c14-d1a9394d4711'
export const methodId = '60000000-0000-4000-8000-000000000001'
const customerId = '90000000-0000-4000-8000-000000000001'
export const input = (overrides = {}) => ({ idempotencyKey: randomUUID(), items: [{ variantId, quantity: 1 }],
  contact: { name: 'Fictional Customer', email: 'checkout@example.invalid', phone: '+92 300 0000000' },
  shipping: { address: 'Fictional Address', city: 'Example City', province: 'Example Province', notes: '' },
  paymentMethod: 'Cash on Delivery', couponCode: '', quoteFingerprint: '1'.repeat(64), ...overrides })
export function fixtures() {
  return {
    products: [{ commerce_kind:'standard', id: productId, name: 'Baraan', active: true, status: 'Published' }],
    product_variants: [{ id: variantId, product_id: productId, option_value: '50 ml', sku: 'RF-BAR-001', regular_price: 2900, sale_price: null, stock_quantity: 12, active: true, available: true }],
    shipping_methods: [{ id: methodId, base_fee: 250, free_shipping_threshold: 7000, display_order: 0, created_at: '2026-01-01', active: true }],
    shipping_rates: [], site_settings: [{ id: 'site', payments: [{ name: 'Cash on Delivery', active: true }, { name: 'Bank Transfer', active: true }] }],
    public_site_settings: [], coupons: [], coupon_products: [], coupon_categories: [], product_categories: [], coupon_redemptions: [],
    orders: [], order_items: [], profiles: [{ id: customerId, status: 'Active' }],
  }
}
export function memoryClient(db = fixtures()) {
  const calls = [],issued=new Map()
  const subject=(request,customer)=>JSON.stringify([customer,request.items,request.email??request.contact?.email,request.shipping.city,request.shipping.province,(request.couponCode??'').toUpperCase()])
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.head = false }
    select(_columns, options) { this.head = options?.head; return this }
    eq(column, value) { this.filters.push((row) => row[column] === value); return this }
    in(column, values) { this.filters.push((row) => values.includes(row[column])); return this }
    ilike(column, value) { this.filters.push((row) => row[column]?.toLowerCase() === value.replace(/\\([%_*\\])/g, '$1').toLowerCase()); return this }
    order() { return this }
    range(start, end) { this.start = start; this.end = end; return this }
    or(expression) {
      this.filters.push((row) => expression.split(',').some((part) => {
        const [column, operator, ...rest] = part.split('.')
        const value = rest.join('.')
        const parsed = operator === 'ilike' ? JSON.parse(value).replace(/\\([%_*\\])/g, '$1') : value
        return operator === 'ilike' ? row[column]?.toLowerCase() === parsed.toLowerCase() : row[column] === parsed
      })); return this
    }
    then(resolve, reject) {
      const rows = db[this.table].filter((row) => this.filters.every((filter) => filter(row)))
      return Promise.resolve({ data: this.head ? null : rows.slice(this.start ?? 0, (this.end ?? rows.length) + 1), count: rows.length, error: null }).then(resolve, reject)
    }
  }
  const client = { db, calls, from: (table) => new Query(table), async rpc(name, args) {
    calls.push({ name, args: structuredClone(args) })
    if (client.rpcFailure) return { error: client.rpcFailure }
    const failure = (message, code = 'P0001') => ({ error: { code, message } })
    if(name==='quote_checkout_v1_checked') {
      try { const quote=await new LegacyQuoteOracle(client,{clock:client.clock??(()=>new Date())}).quote(args.p_request,args.p_customer_id)
        const idempotencyKey=randomUUID(),quoteFingerprint=randomBytes(32).toString('hex')
        issued.set('checkout:'+idempotencyKey,{quote,quoteFingerprint,subject:subject(args.p_request,args.p_customer_id),state:'active'})
        return {data:{...quote,idempotencyKey,quoteFingerprint},error:null} }
      catch(error){return failure(error.code==='INVALID_COUPON'?'Coupon is unavailable.':error.code==='CUSTOMER_UNAVAILABLE'?'Customer account is unavailable.':error.message,error.code==='CUSTOMER_UNAVAILABLE'?'23503':'P0001')}
    }
    if(name!=='create_order_transaction_v1_checked') return failure('Unknown RPC')

    if (args.p_customer_id && db.profiles.find(p => p.id === args.p_customer_id)?.status !== 'Active') return failure('Customer account is unavailable.', '23503')
    let order = db.orders.find((row) => row.idempotency_key === args.p_idempotency_key)
    if (order) {
      const items = db.order_items.filter(i => i.order_id === order.id).map(i => ({ variantId: i.variant_id, quantity: i.quantity }))
      if ((order.checkout_version ?? 1) !== 1 || order.quote_fingerprint != null && order.quote_fingerprint !== args.p_quote_fingerprint || JSON.stringify(items) !== JSON.stringify(args.p_items)
          || order.customer_id !== args.p_customer_id || order.customer_name !== args.p_contact.name || order.customer_email !== args.p_contact.email
          || order.customer_phone !== args.p_contact.phone || order.shipping_address !== args.p_shipping.address || order.shipping_city !== args.p_shipping.city
          || order.shipping_province !== args.p_shipping.province || order.order_notes !== args.p_shipping.notes
          || order.payment_method !== args.p_payment_method || order.coupon_code !== (args.p_coupon_code ?? '')) return failure('V2_IDEMPOTENCY_CONFLICT')
      return { data: rpcReceipt(order, true), error: null }
    }
    if(!args.p_quote_fingerprint) return failure('V2_INVALID_REQUEST')
    const attempt=issued.get(args.p_idempotency_key)
    if(!attempt)return failure('V1_ATTEMPT_UNAVAILABLE')
    const request={items:args.p_items,contact:args.p_contact,shipping:args.p_shipping,couponCode:args.p_coupon_code??''}
    if(attempt.quoteFingerprint!==args.p_quote_fingerprint||attempt.subject!==subject(request,args.p_customer_id)
      ||attempt.request&&JSON.stringify(attempt.request)!==JSON.stringify(args))return failure('V2_IDEMPOTENCY_CONFLICT')
    const retired=()=>({data:{outcome:'retired',code:'QUOTE_CHANGED',idempotencyKey:args.p_idempotency_key.slice(9)},error:null})
    if(attempt.state==='retired')return retired()
    let quote
    try {
      quote = await new LegacyQuoteOracle(client).quote({ items: args.p_items, shipping: { city: args.p_shipping.city, province: args.p_shipping.province }, email: args.p_contact.email, couponCode: args.p_coupon_code ?? '' }, args.p_customer_id)
      if (!quote.paymentMethods.includes(args.p_payment_method)) return failure('V1_PAYMENT_UNAVAILABLE')
    } catch (error) {
      if (['VARIANT_NOT_FOUND','VARIANT_UNAVAILABLE','OUT_OF_STOCK','INSUFFICIENT_STOCK'].includes(error.code)) return failure('One or more product variants are unavailable.')
      if (error.code === 'INVALID_COUPON') return failure('Coupon is unavailable.')
      return failure('V1_CONFIGURATION_UNAVAILABLE')
    }
    if(['subtotal','discount','shippingFee','total'].some(key=>quote[key]!==attempt.quote[key])){
      attempt.state='retired';attempt.request=structuredClone(args);return retired()
    }
    order = { id: randomUUID(), order_number: 'RF-20261002-1234ABCD', customer_id: args.p_customer_id,
      customer_name: args.p_contact.name, customer_email: args.p_contact.email, customer_phone: args.p_contact.phone,
      shipping_address: args.p_shipping.address, shipping_city: args.p_shipping.city, shipping_province: args.p_shipping.province, order_notes: args.p_shipping.notes,
      payment_method: args.p_payment_method, coupon_code: args.p_coupon_code ?? '', status: 'Pending', payment_status: args.p_payment_method === 'Cash on Delivery' ? 'Unpaid' : 'Pending',
      subtotal: quote.subtotal, discount: quote.discount, shipping_fee: quote.shippingFee, total: quote.total, currency: 'PKR', idempotency_key: args.p_idempotency_key }
    order.quote_fingerprint = args.p_quote_fingerprint
    attempt.state='committed';attempt.request=structuredClone(args)
    db.orders.push(order)
    args.p_items.forEach((item) => { db.order_items.push({ order_id: order.id, variant_id: item.variantId, quantity: item.quantity }); db.product_variants.find((row) => row.id === item.variantId).stock_quantity -= item.quantity })
    if (client.loseResponse) { client.loseResponse = false; throw new Error('Transport failure after commit') }
    return { data: rpcReceipt(order, false), error: null }
  } }
  // Simulate the RPC's advisory serialization; real locking is verified separately.
  const execute = client.rpc.bind(client)
  let queue = Promise.resolve()
  client.rpc = (...args) => {
    const pending = queue.then(() => execute(...args))
    queue = pending.catch(() => {})
    return pending
  }
  client.orderCalls=calls.filter.bind(calls,call=>call.name==='create_order_transaction_v1_checked')
  return client
}
async function issuedInput(client,raw=input(),customer=null){
 const quote=await new CheckoutQuoteService(client,{logger}).quote({items:raw.items,email:raw.contact.email,shipping:{city:raw.shipping.city,province:raw.shipping.province},couponCode:raw.couponCode},customer)
 return {...raw,idempotencyKey:quote.idempotencyKey,quoteFingerprint:quote.quoteFingerprint}
}
function rpcReceipt(order, idempotent) {
  return { id:order.id,idempotencyKey:order.idempotency_key.slice(9),orderNumber:order.order_number,status:order.status,
    paymentStatus:order.payment_status,paymentMethod:order.payment_method,subtotal:order.subtotal,discount:order.discount,
    shippingFee:order.shipping_fee,total:order.total,currency:order.currency,idempotent }
}
const logger = { warn() {} }

test('Baraan request uses exact nine checked RPC arguments; guest, Bank Transfer and replay', async () => {
  const client = memoryClient(), service = new OrdersV1Service(client, { logger }), body = await issuedInput(client)
  client.auth = { setSession: () => assert.fail('Privileged auth state must not be mutated'), signInWithPassword: () => assert.fail('Privileged client must never sign in') }
  const result = await service.create(body)
  assert.equal(result.subtotal, 2900); assert.equal(result.total, 3150); assert.equal(result.paymentStatus, 'Unpaid')
  assert.notEqual(result.id, result.orderNumber)
  assert.deepEqual(client.orderCalls()[0], { name: 'create_order_transaction_v1_checked', args: {
    p_idempotency_key: `checkout:${body.idempotencyKey}`, p_items: body.items, p_contact: body.contact, p_shipping: body.shipping,
    p_payment_method: 'Cash on Delivery', p_coupon_code: null, p_shipping_method_id: null, p_customer_id: null, p_quote_fingerprint: body.quoteFingerprint,
  } })
  client.db.product_variants[0].active = false; client.db.product_variants[0].regular_price = 9000
  assert.equal((await service.create(body)).idempotent, true); assert.equal(client.orderCalls().length, 2)
  await assert.rejects(service.create({ ...body, shipping: { ...body.shipping, notes: 'changed' } }), { code: 'IDEMPOTENCY_CONFLICT' })
  await assert.rejects(service.create(body, customerId), { code: 'IDEMPOTENCY_CONFLICT' })
  const bank = memoryClient()
  assert.equal((await new OrdersV1Service(bank).create(await issuedInput(bank,input({ paymentMethod: 'Bank Transfer' }),customerId), customerId)).paymentStatus, 'Pending')
  assert.equal(bank.orderCalls()[0].args.p_customer_id, customerId)
  const inactive=await issuedInput(bank,input(),customerId);bank.db.profiles[0].status = 'Inactive'
  await assert.rejects(new OrdersV1Service(bank).create(inactive, customerId), { code: 'CUSTOMER_UNAVAILABLE' })
})
test('strict schema rejects injection, invalid UUID, quantities, methods and aggregates', () => {
  for (const body of [input({ price: 1 }), input({ total: 1 }), input({ customerId }), input({ status: 'Paid' }), input({ shippingFee: 0 }),
    input({ items: [{ variantId, quantity: 1, unitPrice: 1 }] }), input({ contact: { ...input().contact, customerId } })]) {
    assert.throws(() => parseCheckout(orderRequestSchema, body), { code: 'INVALID_CHECKOUT_REQUEST' })
  }
  assert.throws(() => parseCheckout(orderRequestSchema, input({ items: [{ variantId: 'bad', quantity: 1 }] })), { code: 'INVALID_VARIANT_ID' })
  for (const quantity of [0, -1, 1.2, 100, '1']) assert.throws(() => parseCheckout(orderRequestSchema, input({ items: [{ variantId, quantity }] })), { code: 'INVALID_QUANTITY' })
  assert.throws(() => parseCheckout(orderRequestSchema, input({ items: [{ variantId, quantity: 60 }, { variantId, quantity: 40 }] })), { code: 'INVALID_QUANTITY' })
  assert.throws(() => parseCheckout(orderRequestSchema, input({ paymentMethod: 'Stripe' })), { code: 'INVALID_PAYMENT_METHOD' })
  const parsed = parseCheckout(orderRequestSchema, input({ contact: { ...input().contact, email: ' CHECKOUT@EXAMPLE.INVALID ' }, items: [{ variantId, quantity: 2 }, { variantId, quantity: 3 }] }))
  assert.equal(parsed.contact.email, 'checkout@example.invalid'); assert.equal(parsed.items[0].quantity, 5)
})

test('authoritative receipt is allowlisted; missing, malformed or wrong-token RPC results fail closed', async () => {
  const client=memoryClient(),body=await issuedInput(client),service=new OrdersV1Service(client,{logger}),receipt=await service.create(body)
  client.rpc=async()=>({data:{...receipt,idempotent:true,customer_email:'private@example.invalid',quote_snapshot:{secret:'private'}}})
  const replay=await service.create(body);assert.deepEqual(replay,{...receipt,idempotent:true})
  // Historical monetary values belong to SQL; the service does not re-price them.
  client.rpc=async()=>({data:{...receipt,idempotent:true,subtotal:0,discount:0,shippingFee:0,total:0}})
  assert.equal((await service.create(body)).total,0)
  for(const change of [()=>null,()=>({id:receipt.id,idempotent:true}),r=>({...r,idempotencyKey:randomUUID()}),
    r=>({...r,idempotent:'true'}),r=>({...r,total:'NaN'}),r=>({...r,total:-1}),r=>({...r,id:'not-a-uuid'})]){
    client.rpc=async()=>({data:change(receipt)});await assert.rejects(()=>service.create(body),{code:'CHECKOUT_UNAVAILABLE'})
  }
})

test('SQL domain errors are deterministic and redacted; order-number retries retain the same token',async()=>{
  const body=input(),entries=[],client=memoryClient(),service=new OrdersV1Service(client,{logger:{warn:e=>entries.push(e)}})
  for(const [message,code,status] of [['V2_IDEMPOTENCY_CONFLICT','IDEMPOTENCY_CONFLICT',409],['V2_IDEMPOTENCY_AMBIGUOUS','IDEMPOTENCY_AMBIGUOUS',409],
    ['V2_INVALID_REQUEST','INVALID_CHECKOUT_REQUEST',400],['V1_PAYMENT_UNAVAILABLE','INVALID_PAYMENT_METHOD',422],['V1_CONFIGURATION_UNAVAILABLE','CHECKOUT_UNAVAILABLE',503]]){
    client.rpcFailure={code:'P0001',message};await assert.rejects(()=>service.create(body,null,'domain-request-id'),{code,status})
  }
  for(const sqlCode of ['22023','22P02']){client.rpcFailure={code:sqlCode,message:'SECRET SQL Authorization customer@example.invalid'}
    await assert.rejects(()=>service.create(body,null,'domain-request-id'),e=>e.code==='INVALID_CHECKOUT_REQUEST'&&!/SECRET|Authorization|customer@/.test(e.message))}
  assert.ok(entries.every(e=>e.requestId==='domain-request-id'));assert.doesNotMatch(JSON.stringify(entries),/SECRET|Authorization|customer@/)
  const retry=memoryClient(),rpc=retry.rpc.bind(retry),keys=[];let attempts=0
  retry.rpc=async(name,args)=>{if(name!=='create_order_transaction_v1_checked')return rpc(name,args);keys.push(args.p_idempotency_key);if(attempts++<2)return {error:{code:'23505',message:'orders_order_number_key'}};return rpc(name,args)}
  assert.equal((await new OrdersV1Service(retry,{logger}).create(await issuedInput(retry,body))).idempotent,false)
  assert.equal(keys.length,3);assert.equal(new Set(keys).size,1)
})
test('lost response, concurrent conflict and safe RPC error mapping', async () => {
  const client = memoryClient(), service = new OrdersV1Service(client, { logger }), body = await issuedInput(client)
  client.loseResponse = true
  await assert.rejects(service.create(body), { code: 'CHECKOUT_UNAVAILABLE' })
  assert.equal((await service.create(body)).idempotent, true); assert.equal(client.db.orders.length, 1)
  const concurrent = memoryClient(), concurrently = new OrdersV1Service(concurrent, { logger }), request = await issuedInput(concurrent)
  const outcomes = await Promise.allSettled([concurrently.create(request), concurrently.create({ ...request, shipping: { ...request.shipping, notes: 'different' } })])
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1)
  assert.equal(outcomes.find((outcome) => outcome.status === 'rejected').reason.code, 'IDEMPOTENCY_CONFLICT')
  for (const [failure, code] of [[{ code: 'P0001', message: 'Coupon has expired.' }, 'INVALID_COUPON'], [{ code: 'P0001', message: 'No shipping method is available.' }, 'CHECKOUT_UNAVAILABLE'], [{ code: 'XX000', message: 'SECRET SQL' }, 'CHECKOUT_FAILED']]) {
    const failed = memoryClient(); failed.rpcFailure = failure
    await assert.rejects(new OrdersV1Service(failed, { logger }).create(input()), (error) => error.code === code && !error.message.includes('SECRET'))
  }
})
test('new-order commerce rejection comes from RPC; diagnostics preserve public errors', async () => {
  for (const [change, code] of [
    [(db) => { db.product_variants = [] }, 'VARIANT_NOT_FOUND'],
    [(db) => { db.product_variants[0].active = false }, 'VARIANT_UNAVAILABLE'],
    [(db) => { db.product_variants[0].stock_quantity = 0 }, 'OUT_OF_STOCK'],
    [(db) => { db.product_variants[0].stock_quantity = 0; db.product_variants[0].available = false }, 'OUT_OF_STOCK'],
    [(db) => { db.product_variants[0].available = false }, 'VARIANT_UNAVAILABLE'],
    [(db) => { db.product_variants[0].stock_quantity = 0.5 }, 'INSUFFICIENT_STOCK'],
    [(db) => { db.shipping_methods = [] }, 'CHECKOUT_UNAVAILABLE'],
    [(db) => { db.site_settings[0].payments[0].active = false }, 'INVALID_PAYMENT_METHOD'],
  ]) {
    const client = memoryClient(),body=await issuedInput(client);change(client.db)
    await assert.rejects(new OrdersV1Service(client).create(body), { code }); assert.equal(client.orderCalls().length, 1)
  }
})

const origin = 'https://checkout.example.invalid'
async function api(t, { production = false, orderLimit = 20 } = {}) {
  const config = createAuthConfig({ NODE_ENV: 'test', CLIENT_ORIGIN: origin, AUTH_CSRF_SECRET: 'checkout-test-secret-at-least-32-characters' })
  const client = memoryClient(), app = express(), names = getAuthCookieNames(config)
  const runtime = { config: { ...config, environment: production ? 'production' : 'test', secureCookies: production }, repository: { client }, sessionService: {
    async restore(cookies) { return { identity: { id: customerId }, record: { sessionClass: cookies.accessToken === 'admin' ? 'administrator' : 'customer' } } },
  } }
  app.use(requestContext, express.json(), cookieParser())
  app.use('/api/v1/public', createOrdersV1Router(runtime, { logger, orderLimit }))
  app.use(authErrorHandler(config))
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return { client,async issue(body=input(),options={}){const result=await this.request({items:body.items,shipping:{city:body.shipping.city,province:body.shipping.province},email:body.contact.email,couponCode:body.couponCode},{...options,quote:true});assert.equal(result.status,200);return {...body,idempotencyKey:result.body.data.idempotencyKey,quoteFingerprint:result.body.data.quoteFingerprint}}, async request(body, { actor, csrf = true, requestOrigin = origin, quote = false } = {}) {
    const headers = { 'Content-Type': 'application/json' }
    if (requestOrigin) headers.Origin = requestOrigin
    if (actor) {
      const token = getSessionCsrfToken('handle', config)
      const jwt = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.sig`
      // Session class uses an explicit token marker in this test-only gateway.
      runtime.sessionService.restore = async () => ({ identity: { id: customerId }, record: { sessionClass: actor === 'admin' ? 'administrator' : 'customer' } })
      headers.Cookie = `${names.access}=${jwt}; ${names.refresh}=refresh; ${names.session}=handle; ${names.csrf}=${token}`
      if (csrf) headers['X-RF-CSRF'] = token
    }
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/public/${quote ? 'checkout/quote' : 'orders'}`, { method: 'POST', headers, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  } }
}
test('HTTP guest/customer, origin, conditional CSRF, admin rejection and production launch gate', async (t) => {
  const server = await api(t)
  const body = await server.issue()
  assert.equal((await server.request(body, { requestOrigin: 'https://evil.invalid' })).status, 403)
  assert.equal((await server.request(body, { requestOrigin: null })).status, 403)
  assert.equal((await server.request(body, { actor: 'customer', csrf: false })).status, 403)
  assert.equal((await server.request(body, { actor: 'admin' })).status, 403)
  const guest = await server.request(body); assert.equal(guest.status, 201); assert.equal(guest.body.data.idempotent, false)
  assert.equal((await server.request(body)).status, 200)
  assert.equal((await server.request(await server.issue(input(),{actor:'customer'}), { actor: 'customer' })).status, 201)
  assert.equal(server.client.calls.at(-1).args.p_customer_id, customerId)
  const gated = await api(t, { production: true })
  const preview = await gated.request({ items: body.items, shipping: { city: 'Karachi', province: 'Sindh' }, email: '', couponCode: '' }, { quote: true })
  assert.equal(preview.status, 200); assert.equal(preview.body.data.orderingEnabled, false)
  assert.equal((await gated.request(input())).body.error.code, 'CHECKOUT_UNAVAILABLE')
  assert.deepEqual(gated.client.calls.map(call => call.name), ['quote_checkout_v1_checked'])
})
test('HTTP rate limit and malformed body have safe envelopes', async (t) => {
  const server = await api(t, { orderLimit: 2 })
  const invalid = await server.request(input({ items: [{ variantId: 'bad', quantity: 1 }] }))
  assert.equal(invalid.status, 400); assert.equal(invalid.body.error.code, 'INVALID_VARIANT_ID'); assert.ok(invalid.body.error.requestId)
  await server.request(input())
  assert.equal((await server.request(input())).body.error.code, 'CHECKOUT_RATE_LIMITED')
})
test('production legacy order and coupon paths are fenced before JSON access', async (t) => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production'
  t.after(() => { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous })
  const app = express(); app.use(express.json()); app.use('/api/public', publicRouter)
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  for (const path of ['orders', 'coupons/validate']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/public/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'CHECKOUT_UNAVAILABLE')
  }
})

test('quotes: regular/sale prices, scoped shipping, base/default, thresholds and coupons', async () => {
  const client = memoryClient(), service = new CheckoutQuoteService(client)
  const quote = (overrides = {}) => service.quote({ items: [{ variantId, quantity: 1 }], shipping: { city: 'Karachi', province: 'Sindh' }, email: 'checkout@example.invalid', couponCode: '', ...overrides })
  assert.equal((await quote()).subtotal, 2900); assert.ok(client.calls.every(call=>call.name==='quote_checkout_v1_checked'))
  client.db.shipping_rates.push({ shipping_method_id: methodId, active: true, scope_type: 'default', scope_value: '', fee: 240, minimum_subtotal: 0 })
  assert.equal((await quote()).shippingFee, 240)
  client.db.shipping_rates.push({ shipping_method_id: methodId, active: true, scope_type: 'province', scope_value: 'Sindh', fee: 300, minimum_subtotal: 0 })
  assert.equal((await quote()).shippingFee, 300)
  client.db.shipping_rates.push({ shipping_method_id: methodId, active: true, scope_type: 'city', scope_value: 'Karachi', fee: 0, minimum_subtotal: 0 })
  assert.equal((await quote()).shippingFee, 0)
  client.db.product_variants[0].sale_price = 2500
  assert.equal((await quote()).subtotal, 2500)
  assert.equal((await quote({ items: [{ variantId, quantity: 3 }] })).shippingFee, 0)
  const coupon = { id: randomUUID(), code: 'SAVE', status: 'Active', type: 'Percentage', discount_value: 10, minimum_order_amount: 0, usage_limit: 0, used_count: 0, per_customer_usage_limit: 1, max_discount_amount: null }
  client.db.coupons.push(coupon)
  assert.equal((await quote({ couponCode: 'save' })).discount, 250)
  client.db.coupon_redemptions.push({ coupon_id: coupon.id, customer_id: null, customer_email: 'checkout@example.invalid' })
  await assert.rejects(quote({ couponCode: 'SAVE' }), { code: 'INVALID_COUPON' })
  client.db.coupon_redemptions = []; coupon.type = 'Fixed Amount'; coupon.discount_value = 9999; coupon.max_discount_amount = 100
  assert.equal((await quote({ couponCode: 'SAVE' })).discount, 100)
  coupon.type = 'Free Shipping'; assert.equal((await quote({ couponCode: 'SAVE' })).shippingFee, 0)
  client.db.coupon_products.push({ coupon_id: coupon.id, product_id: randomUUID() })
  await assert.rejects(quote({ couponCode: 'SAVE' }), { code: 'INVALID_COUPON' })
  await assert.rejects(quote({ couponCode: 'MISSING' }), { code: 'INVALID_COUPON' })
  client.db.coupon_products = []; coupon.type = 'Percentage'; coupon.discount_value = 10; coupon.max_discount_amount = null
  client.db.shipping_rates.at(-1).fee = 200
  const belowFree = await quote({ items: [{ variantId, quantity: 3 }], couponCode: 'SAVE' })
  assert.equal(belowFree.subtotal - belowFree.discount, 6750); assert.equal(belowFree.shippingFee, 200)
  client.db.coupon_categories.push({ coupon_id: coupon.id, category_id: 'category' })
  await assert.rejects(quote({ couponCode: 'SAVE' }), { code: 'INVALID_COUPON' })
  client.db.product_categories.push({ product_id: productId, category_id: 'category' })
  assert.equal((await quote({ couponCode: 'SAVE' })).discount, 250)
  coupon.end_date = '2000-01-01'; await assert.rejects(quote({ couponCode: 'SAVE' }), { code: 'INVALID_COUPON' })
  assert.ok(client.calls.every(call=>call.name==='quote_checkout_v1_checked'))
})

test('committed replay precedes disabled payment configuration; new token fails and changed intent conflicts', async () => {
  const client = memoryClient(), service = new OrdersV1Service(client, { logger }), body = await issuedInput(client)
  const first = await service.create(body)
  client.db.site_settings[0].payments[0].active = false
  const replay = await service.create(body)
  assert.equal(replay.id, first.id); assert.equal(replay.idempotent, true); assert.equal(replay.idempotencyKey, body.idempotencyKey)
  await assert.rejects(service.create({ ...body, shipping: { ...body.shipping, notes: 'changed' } }), { code: 'IDEMPOTENCY_CONFLICT' })
  await assert.rejects(service.create(await issuedInput(client,body)), { code: 'INVALID_PAYMENT_METHOD' })
  assert.equal(client.orderCalls().length, 4)
})
test('SQL decides replay/conflict without service quote or textual read optimizations', async () => {
  for (const changed of [false, true]) {
    const client = memoryClient(), body = await issuedInput(client), first = new OrdersV1Service(client, { logger })
    const quote = new CheckoutQuoteService(client, { logger })
    quote.withRequestId = () => quote
    await first.create(body)
    quote.quote = quote.read = () => assert.fail('Service preflight must not override SQL replay')
    const second = new OrdersV1Service(client, { logger, quoteService: quote })
    const racing = changed ? { ...body, shipping: { ...body.shipping, notes: 'changed' } } : body
    if (changed) await assert.rejects(second.create(racing), { code: 'IDEMPOTENCY_CONFLICT' })
    else assert.equal((await second.create(racing)).idempotent, true)
    assert.equal(client.orderCalls().length, 2); assert.equal(client.db.orders.length, 1)
  }
})
test('read diagnostics retain only request/operation/subsystem/normalized category', async () => {
  const entries = [], quote = new CheckoutQuoteService({ from: () => {
    const query = { select: () => query, order: () => query, range: async () => ({ data: null, error: { code: 'PGRST301', message: 'SECRET SQL/customer@example.invalid' } }) }
    return query
  } }, { logger: { warn: (entry) => entries.push(entry) }, requestId: 'req_fixture_diagnostics' })
  await assert.rejects(quote.read('shipping_rates', 'id'), (error) => error.code === 'CHECKOUT_UNAVAILABLE' && !error.message.includes('SECRET'))
  assert.deepEqual(entries, [{ event: 'checkout.internal_failure', requestId: 'req_fixture_diagnostics', operation: 'relational_read', subsystem: 'shipping_rates', category: 'PGRST301' }])
  assert.doesNotMatch(JSON.stringify(entries), /SECRET|customer@|Authorization/)
})

test('order error mapping preserves the original requestId in internal read/RPC diagnostics', async () => {
  const client = memoryClient(), entries = [], requestId = 'req_order_mapping_fixture'
  client.rpcFailure = { code: 'P0001', message: 'One or more product variants are unavailable.' }
  const from = client.from
  client.from = (table) => {
    const query = from(table)
    if (table === 'product_variants' && client.calls.length) query.range = async () => ({ data: null,
      error: { code: 'PGRST301', message: 'SECRET SQL/Authorization/customer@example.invalid' } })
    return query
  }
  await assert.rejects(new OrdersV1Service(client, { logger: { warn: (entry) => entries.push(entry) } }).create(input(), null, requestId),
    (error) => error.code === 'VARIANT_UNAVAILABLE' && !error.message.includes('SECRET'))
  assert.deepEqual(entries, [
    { event: 'checkout.internal_failure', requestId, operation: 'rpc', subsystem: 'create_order_transaction_v1_checked', category: 'P0001' },
    { event: 'checkout.internal_failure', requestId, operation: 'relational_read', subsystem: 'product_variants', category: 'PGRST301' },
  ])
  assert.doesNotMatch(JSON.stringify(entries), /SECRET|customer@|Authorization/)
  assert.equal(client.db.orders.length, 0)
})
test('quote coupon boundaries use explicit UTC rather than local calendar date', async () => {
  const client = memoryClient()
  client.db.coupons.push({ id: randomUUID(), code: 'MIDNIGHT', status: 'Active', type: 'Fixed Amount', discount_value: 100, minimum_order_amount: 0, usage_limit: 0, used_count: 0, per_customer_usage_limit: 0, max_discount_amount: null, start_date: '2026-10-02', end_date: '2026-10-02' })
  const body = { items: [{ variantId, quantity: 1 }], shipping: { city: 'Karachi', province: 'Sindh' }, email: 'fixture@example.invalid', couponCode: 'MIDNIGHT' }
  for (const [instant, allowed] of [['2026-10-02T04:59:59+05:00', false], ['2026-10-02T05:00:00+05:00', true], ['2026-10-03T00:00:00Z', false]]) {
    client.clock = () => new Date(instant) // SQL fixture clock; the application sends no timestamp.
    const quote = new CheckoutQuoteService(client, { logger })
    assert.equal(checkoutCalendarDate(new Date(instant)), new Date(instant).toISOString().slice(0, 10))
    if (allowed) assert.equal((await quote.quote(body)).discount, 100)
    else await assert.rejects(quote.quote(body), { code: 'INVALID_COUPON' })
  }
})


test('checked quotation is an allowlisted SQL adapter with no caller totals or timestamps',async()=>{
 const calls=[],response={subtotal:2900,discount:0,shippingFee:250,total:3150,currency:'PKR',shippingMethodId:methodId,paymentMethods:['Cash on Delivery'],quoteFingerprint:'a'.repeat(64),idempotencyKey:randomUUID(),_coupon:{secret:'PRIVATE'}}
 const service=new CheckoutQuoteService({rpc:async(name,args)=>{calls.push({name,args});return {data:response,error:null}},from:()=>assert.fail('Quotation must be SQL-authoritative')},{logger})
 const request={items:[{variantId,quantity:1}],shipping:{city:'Karachi',province:'Sindh'},email:'fixture@example.invalid',couponCode:''}
 const q=await service.quote(request);assert.equal(q.total,3150);assert.equal(q.quoteFingerprint,response.quoteFingerprint);assert.equal('_coupon' in q,false)
 assert.deepEqual(calls,[{name:'quote_checkout_v1_checked',args:{p_request:request,p_customer_id:null}}])
 await assert.rejects(()=>service.quote({...request,total:1}),{code:'INVALID_CHECKOUT_REQUEST'})
})
test('missing and forged credentials cannot authorize replacement or effects',async()=>{
 const client=memoryClient(),service=new OrdersV1Service(client,{logger}),body=await issuedInput(client)
 await assert.rejects(()=>service.create({...body,quoteFingerprint:undefined}),{code:'INVALID_CHECKOUT_REQUEST',status:400})
 await assert.rejects(()=>service.create({...body,quoteFingerprint:'0'.repeat(64)}),{code:'IDEMPOTENCY_CONFLICT',status:409})
 assert.equal(client.db.orders.length,0);assert.equal(client.orderCalls().length,2)
})
test('rolled-back price exceptions cannot authorize replacement',async t=>{
 const server=await api(t);server.client.rpcFailure={code:'P0001',message:'V1_QUOTE_CHANGED'}
 const result=await server.request(input());assert.equal(result.status,503);assert.equal(result.body.error.code,'CHECKOUT_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(result.body),/V1_QUOTE_CHANGED|SQL/)
})

test('only matching committed terminal envelopes become safe HTTP quotation conflicts',async t=>{
 const server=await api(t),body=await server.issue()
 server.client.rpc=async(name,args)=>{assert.equal(name,'create_order_transaction_v1_checked');return {data:{outcome:'retired',code:'QUOTE_CHANGED',idempotencyKey:args.p_idempotency_key.slice(9)},error:null}}
 const response=await server.request(body);assert.equal(response.status,409);assert.equal(response.body.error.code,'QUOTE_CHANGED')
 const service=new OrdersV1Service(server.client,{logger})
 for(const data of [{outcome:'retired',code:'QUOTE_CHANGED',idempotencyKey:randomUUID()},{outcome:'retired',code:'QUOTE_REQUIRED',idempotencyKey:body.idempotencyKey},{outcome:'unknown',code:'QUOTE_CHANGED',idempotencyKey:body.idempotencyKey},{outcome:'retired',code:'QUOTE_CHANGED',idempotencyKey:body.idempotencyKey,private:'hidden'}]){
  server.client.rpc=async()=>({data,error:null});await assert.rejects(()=>service.create(body),{code:'CHECKOUT_UNAVAILABLE',status:503})
 }
})
test('unknown transport results never change the checked fingerprint or token on retry',async()=>{
 const client=memoryClient(),service=new OrdersV1Service(client,{logger}),request=await issuedInput(client);client.loseResponse=true
 await assert.rejects(()=>service.create(request),{code:'CHECKOUT_UNAVAILABLE'});assert.equal((await service.create(request)).idempotent,true)
 assert.deepEqual(client.orderCalls()[0],client.orderCalls()[1]);assert.equal(client.db.orders.length,1)
})
