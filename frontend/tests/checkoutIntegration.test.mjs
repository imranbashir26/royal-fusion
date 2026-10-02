import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createCheckoutClient, isOrderReceipt, CheckoutClientError } from '../src/services/checkoutClient.ts'
import { createCheckoutIntentStore } from '../src/store/checkoutIntentStore.ts'
import { validIntent } from '../src/store/checkoutAttempt.ts'
import { createCartStore } from '../src/store/cartStore.ts'
import { mapProduct, mapProductVariant } from '../src/services/productionMappers.ts'
import { resolveCartItem } from '../src/services/productVariants.ts'
import { variantRow, productRow, productId, variantId, secondVariantId } from './variantFixtures.mjs'
const product = { ...mapProduct(productRow), variants: [mapProductVariant(variantRow)] }
const token = '70000000-0000-4000-8000-000000000001', token2 = '70000000-0000-4000-8000-000000000002'
const entryId = '71000000-0000-4000-8000-000000000001', entry2 = '71000000-0000-4000-8000-000000000002'
const receipt = { id: '80000000-0000-4000-8000-000000000001', idempotencyKey: token, orderNumber: 'RF-20261002-1234ABCD', status: 'Pending', paymentStatus: 'Unpaid', paymentMethod: 'Cash on Delivery', subtotal: 5800, discount: 0, shippingFee: 250, total: 6050, currency: 'PKR', idempotent: false }
const request = () => ({ items: [{ variantId, quantity: 2 }], contact: { name: 'Fictional Customer', email: 'customer@example.invalid', phone: '00000000000' }, shipping: { address: 'Fictional Address', city: 'Lahore', province: 'Punjab', notes: '' }, paymentMethod: 'Cash on Delivery', couponCode: '' })
const lines = () => [{ lineId: JSON.stringify([productId, variantId]), entryId, variantId, quantity: 2 }]
const storage = () => { const rows = new Map(); return { rows, getItem: (key) => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: (key) => rows.delete(key) } }
const capture = (cart) => cart.getState().capturePurchase(cart.getState().items.map(({ lineId, variantId, quantity }) => ({ lineId, variantId, quantity })))
const intent = () => ({ request: { ...request(), idempotencyKey: token }, lines: lines() })
const savedKey = 'royal-fusion-checkout-intent-v1'

test('only an absent key implicitly permits a fresh token; active hydration preserves its token', () => {
  const disk = storage(); let minted = 0
  const store = createCheckoutIntentStore(disk, () => { minted++; return token })
  assert.equal(store.getState().hydrationStatus, 'absent')
  store.getState().freeze(request(), lines())
  assert.equal(minted, 1); assert.equal(store.getState().hydrationStatus, 'active')
  const restored = createCheckoutIntentStore(disk, () => assert.fail('Active hydration must not replace the token'))
  assert.equal(restored.getState().hydrationStatus, 'active')
  assert.equal(restored.getState().freeze(request(), lines()).request.idempotencyKey, token)
})

for (const [label, serialized] of [
  ['JSON null', 'null'], ['JSON false', 'false'], ['JSON zero', '0'], ['JSON empty string', '""'],
  ['malformed JSON', '{broken'], ['empty stored bytes', ''], ['wrong object', '{}'], ['array', '[]'],
  ['older empty envelope', JSON.stringify({ version: 1, intent: null, receipt: null })],
  ['missing fields', JSON.stringify({ version: 2, intent: null })],
  ['unexplained empty envelope', JSON.stringify({ version: 2, intent: null, completion: null, pendingReceipt: null, recovery: null })],
  ['invalid UUID', JSON.stringify({ version: 2, intent: { ...intent(), request: { ...intent().request, idempotencyKey: 'bad' } }, completion: null, pendingReceipt: null, recovery: null })],
]) test(`hydration of ${label} requires recovery and repeated freeze attempts mint zero UUIDs`, () => {
  const disk = storage(); disk.setItem(savedKey, serialized); let minted = 0
  const store = createCheckoutIntentStore(disk, () => { minted++; return token })
  assert.equal(store.getState().hydrationStatus, 'recovery_required'); assert.ok(store.getState().recovery)
  for (let n = 0; n < 3; n++) assert.throws(() => store.getState().freeze(request(), lines()), /recovery/)
  assert.equal(minted, 0); assert.equal(disk.getItem(savedKey), serialized, 'Corruption must remain untouched until deliberate reset')
})

test('storage read exceptions, unavailable adapters and browser access restrictions never imply absence', () => {
  for (const adapter of [{ getItem() { throw new Error('Storage unavailable') }, setItem() {} }, { getItem() { return undefined }, setItem() {} }]) {
    let minted = 0
    const store = createCheckoutIntentStore(adapter, () => { minted++; return token })
    assert.equal(store.getState().hydrationStatus, 'recovery_required')
    for (let n = 0; n < 3; n++) assert.throws(() => store.getState().freeze(request(), lines()), /recovery/)
    assert.equal(minted, 0)
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  try {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('Privacy restriction') } })
    const store = createCheckoutIntentStore(undefined, () => assert.fail('Access failure must not generate a token'))
    assert.equal(store.getState().hydrationStatus, 'recovery_required')
    assert.throws(() => store.getState().freeze(request(), lines()), /recovery/)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor)
    else delete globalThis.sessionStorage
  }
})

test('only a successfully persisted deliberate reset releases corrupted state for a new attempt', () => {
  const disk = storage(); disk.setItem(savedKey, 'false'); let minted = 0
  const store = createCheckoutIntentStore(disk, () => { minted++; return token })
  const save = disk.setItem
  disk.setItem = () => { throw new Error('Cannot save reset') }
  assert.throws(() => store.getState().newAttempt()); assert.ok(store.getState().recovery)
  assert.throws(() => store.getState().freeze(request(), lines()), /recovery/); assert.equal(minted, 0)
  disk.setItem = save; store.getState().newAttempt()
  assert.equal(store.getState().hydrationStatus, 'reset'); assert.equal(JSON.parse(disk.getItem(savedKey)).reset, true)
  const restored = createCheckoutIntentStore(disk, () => { minted++; return token })
  assert.equal(restored.getState().hydrationStatus, 'reset')
  restored.getState().freeze(request(), lines()); assert.equal(minted, 1)
})

test('frozen intent survives refresh, clicks and retry, is immutable and does not substitute UUIDs', async () => {
  const session = storage(), store = createCheckoutIntentStore(session, () => token, async () => 'consumed'), body = request()
  const frozen = store.getState().freeze(body, lines())
  assert.equal(store.getState().freeze({ ...body, items: [{ variantId: secondVariantId, quantity: 1 }] }, []), frozen)
  body.contact.name = 'changed outside store'; assert.equal(frozen.request.contact.name, 'Fictional Customer')
  assert.throws(() => { frozen.request.contact.name = 'mutated' }, TypeError)
  const restored = createCheckoutIntentStore(session, () => assert.fail('Replacement token'), async () => 'consumed')
  assert.deepEqual(restored.getState().intent, frozen)
  await restored.getState().complete(receipt)
  assert.equal(restored.getState().intent, null)
  assert.equal(restored.getState().hydrationStatus, 'completed')
  assert.equal(createCheckoutIntentStore(session).getState().hydrationStatus, 'completed')
  assert.deepEqual(createCheckoutIntentStore(session).getState().receipt, receipt)
  restored.getState().newAttempt(); assert.equal(restored.getState().intent, null); assert.deepEqual(restored.getState().receipt, receipt)
})
test('transport sends canonical fields only, credentials/CSRF and attempt-bound receipts', async () => {
  const calls = [], client = createCheckoutClient(async (url, options) => {
    calls.push({ url, options })
    return Response.json(url.endsWith('/session') ? { data: { csrfToken: 'csrf' } } : { data: url.endsWith('/quote')
      ? { subtotal: 5800, discount: 0, shippingFee: 250, total: 6050, currency: 'PKR', shippingMethodId: token, paymentMethods: ['Cash on Delivery'], orderingEnabled: true } : receipt })
  }, '/api')
  assert.deepEqual(await client.createOrder({ ...request(), idempotencyKey: token, total: 1, customerId: token, items: [{ variantId, quantity: 2, price: 1 }] }), receipt)
  const sent = JSON.parse(calls[1].options.body)
  assert.deepEqual(Object.keys(sent.items[0]).sort(), ['quantity', 'variantId']); assert.equal('total' in sent, false); assert.equal('customerId' in sent, false)
  assert.equal(calls[1].options.credentials, 'include'); assert.equal(calls[1].options.headers['X-RF-CSRF'], 'csrf')
  assert.equal((await client.quote({ items: request().items, shipping: { city: 'Lahore', province: 'Punjab' }, email: '', couponCode: '' })).shippingFee, 250)
  assert.ok(calls.every((call) => !call.url.includes('/rpc/') && call.url !== '/api/public/orders'))
})
test('malformed success, network and stock failures preserve frozen request/cart', async () => {
  const cart = createCartStore(storage()), store = createCheckoutIntentStore(storage(), () => token)
  cart.getState().addItem(product, variantId, 2); const frozen = store.getState().freeze(request(), capture(cart)), before = structuredClone(cart.getState().items)
  for (const failure of ['network', 'malformed', 'stock']) {
    const client = createCheckoutClient(async (url) => {
      if (url.endsWith('/session')) return Response.json({ data: { csrfToken: '' } })
      if (failure === 'network') throw new Error('lost response')
      return Response.json(failure === 'malformed' ? { data: { ...receipt, total: 1 } } : { error: { code: 'INSUFFICIENT_STOCK', message: 'Not enough stock.' } }, { status: failure === 'stock' ? 409 : 200 })
    })
    await assert.rejects(client.createOrder(frozen.request), CheckoutClientError)
    assert.deepEqual(cart.getState().items, before); assert.equal(store.getState().intent.request.idempotencyKey, token); assert.equal(store.getState().receipt, null)
  }
  assert.equal(isOrderReceipt({ ...receipt, id: receipt.orderNumber }), false)
})
test('quantity snapshot consumes exactly once and preserves additions/unrelated lines on reload', async () => {
  const disk = storage(), cart = createCartStore(disk)
  cart.getState().addItem(product, variantId, 2); const purchased = capture(cart)
  cart.getState().addItem(product, variantId, 1)
  const other = { ...product, id: token, variants: [{ ...product.variants[0], id: secondVariantId, productId: token }] }
  cart.getState().addItem(other, secondVariantId, 1)
  assert.equal(await cart.getState().consumePurchased(token, receipt.id, purchased), 'consumed')
  assert.deepEqual(cart.getState().items.map((item) => item.quantity), [1, 1])
  const refresh = createCartStore(disk)
  assert.equal(await refresh.getState().consumePurchased(token, receipt.id, purchased), 'already-consumed')
  assert.deepEqual(refresh.getState().items.map((item) => item.quantity), [1, 1])
})
test('old receipt survives more than 100 later completions without consuming a later same-variant cart', async () => {
  const disk = storage(), cart = createCartStore(disk)
  cart.getState().addItem(product, variantId, 2); const purchased = capture(cart)
  await cart.getState().consumePurchased(token, receipt.id, purchased)
  for (let n = 2; n < 104; n++) await cart.getState().consumePurchased(`70000000-0000-4000-8000-${String(n).padStart(12, '0')}`, receipt.id, purchased)
  cart.getState().addItem(product, variantId, 3)
  for (let n = 0; n < 3; n++) {
    const reload = createCartStore(disk); assert.equal(await reload.getState().consumePurchased(token, receipt.id, purchased), 'already-consumed')
    assert.equal(reload.getState().items[0].quantity, 3)
  }
  const page = readFileSync(new URL('../src/pages/CheckoutSuccessPage.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(page, /consumePurchased|useEffect|useCartStore/)
})
test('two tabs merge latest cart and cannot overwrite immutable consumption records', async () => {
  const disk = storage(); let writes = 0
  const save = disk.setItem; disk.setItem = (key, value) => { writes++; save(key, value) }
  const a = createCartStore(disk)
  a.getState().addItem(product, variantId, 2); const b = createCartStore(disk), purchased = capture(a)
  const outcomes = await Promise.all([a.getState().consumePurchased(token, receipt.id, purchased), b.getState().consumePurchased(token, receipt.id, purchased)])
  assert.deepEqual(outcomes.sort(), ['already-consumed', 'consumed'])
  b.getState().clearCart(); b.getState().addItem(product, variantId, 3)
  const beforeSync = writes
  a.getState().syncFromStorage(); assert.equal(a.getState().items[0].quantity, 3)
  assert.equal(writes, beforeSync, 'Cross-tab hydration must never write a stale cart back')
  assert.equal(await createCartStore(disk).getState().consumePurchased(token, receipt.id, purchased), 'already-consumed')
  assert.equal(createCartStore(disk).getState().items[0].quantity, 3)
})
test('an older writer dropping line-instance metadata cannot authorize pending consumption', async () => {
  const disk = storage(), cart = createCartStore(disk)
  cart.getState().addItem(product, variantId, 2); const purchased = capture(cart)
  const saved = JSON.parse(disk.getItem('royal-fusion-cart')); delete saved.state.lineInstances; saved.state.items[0].quantity = 3
  disk.setItem('royal-fusion-cart', JSON.stringify(saved))
  assert.equal(await cart.getState().consumePurchased(token, receipt.id, purchased), 'cart-replaced')
  assert.equal(cart.getState().items[0].quantity, 3)
})
test('same UUID in a replacement cart is a different line instance and cannot be consumed by a pending old attempt', async () => {
  const cart = createCartStore(storage()); cart.getState().addItem(product, variantId, 2); const purchased = capture(cart)
  cart.getState().clearCart(); cart.getState().addItem(product, variantId, 3)
  assert.notEqual(capture(cart)[0].entryId, purchased[0].entryId)
  assert.equal(await cart.getState().consumePurchased(token, receipt.id, purchased), 'cart-replaced')
  assert.equal(cart.getState().items[0].quantity, 3)
})
test('completion interleaved with another tab rebuilding the cart never writes its old snapshot over the new cart', async () => {
  const disk = storage(), a = createCartStore(disk)
  a.getState().addItem(product, variantId, 2); const purchased = capture(a), b = createCartStore(disk)
  const save = disk.setItem; let interleaved = false
  disk.setItem = (key, value) => {
    if (key.startsWith('royal-fusion-consumed-units-v1:') && !interleaved) {
      interleaved = true; b.getState().clearCart(); b.getState().addItem(product, variantId, 3)
    }
    save(key, value)
  }
  await a.getState().consumePurchased(token, receipt.id, purchased)
  assert.equal(a.getState().items[0].quantity, 3); assert.equal(createCartStore(disk).getState().items[0].quantity, 3)
  assert.equal(await a.getState().consumePurchased(token, receipt.id, purchased), 'already-consumed')
})
test('a failed write leaves a durable recovery claim and never retries consumption on a new cart', async () => {
  const disk = storage(), cart = createCartStore(disk); cart.getState().addItem(product, variantId, 2); const purchased = capture(cart)
  const setItem = disk.setItem; disk.setItem = (key, value) => { if (key.startsWith('royal-fusion-consumed-units-v1:')) throw new Error('disk full'); setItem(key, value) }
  await assert.rejects(cart.getState().consumePurchased(token, receipt.id, purchased))
  disk.setItem = setItem; cart.getState().clearCart(); cart.getState().addItem(product, variantId, 3)
  assert.equal(await cart.getState().consumePurchased(token, receipt.id, purchased), 'recovery-required'); assert.equal(cart.getState().items[0].quantity, 3)
})
test('exact request/line equivalence: omitted/duplicate/substituted mappings fail, reverse order and aggregated request succeed', () => {
  const candidate = intent(); candidate.request.items.push({ variantId: secondVariantId, quantity: 1 })
  const second = { lineId: JSON.stringify([productId, secondVariantId]), entryId: entry2, variantId: secondVariantId, quantity: 1 }
  candidate.lines.push(second); assert.equal(validIntent(candidate), true)
  assert.equal(validIntent({ ...candidate, lines: [second, candidate.lines[0]] }), true)
  assert.equal(validIntent({ ...candidate, lines: [candidate.lines[0], candidate.lines[0]] }), false)
  assert.equal(validIntent({ ...candidate, lines: [candidate.lines[0]] }), false)
  assert.equal(validIntent({ ...candidate, lines: [{ ...candidate.lines[0], quantity: 1 }, second] }), false)
  assert.equal(validIntent({ ...candidate, lines: [{ ...candidate.lines[0], lineId: second.lineId }, second] }), false)
  const duplicate = intent(); duplicate.request.items = [{ variantId, quantity: 1 }, { variantId, quantity: 1 }]
  assert.equal(validIntent(duplicate), true)
  const store = createCheckoutIntentStore(storage(), () => token); store.getState().freeze({ ...request(), items: duplicate.request.items }, lines())
  assert.deepEqual(store.getState().intent.request.items, [{ variantId, quantity: 2 }])
})
test('corrupted submitted state and malformed/unbound stored receipts remain unresolved without generating tokens', async () => {
  for (const serialized of [
    '{broken', JSON.stringify({ version: 1, intent: intent(), receipt }),
    JSON.stringify({ version: 2, intent: { ...intent(), lines: [] }, completion: null, pendingReceipt: null, recovery: null }),
    JSON.stringify({ version: 2, intent: intent(), completion: null, pendingReceipt: { ...receipt, total: 1 }, recovery: null }),
    JSON.stringify({ version: 2, intent: null, completion: { intent: intent(), receipt: { ...receipt, idempotencyKey: token2 }, consumption: 'consumed' }, pendingReceipt: null, recovery: null }),
  ]) {
    const disk = storage(); disk.setItem(savedKey, serialized)
    const store = createCheckoutIntentStore(disk, () => assert.fail('Must not mint a new token'))
    assert.ok(store.getState().recovery); assert.equal(store.getState().receipt, null)
    assert.throws(() => store.getState().freeze(request(), lines()), /recovery/)
  }
  const store = createCheckoutIntentStore(storage(), () => token, async () => assert.fail('Unbound receipt must not consume'))
  store.getState().freeze(request(), lines()); await assert.rejects(store.getState().complete({ ...receipt, idempotencyKey: token2 }))
})
test('first completion becomes historical; fresh checkout without Continue Shopping uses a new token and rejects old receipt', async () => {
  const disk = storage(), cart = createCartStore(disk), session = storage(); let next = token
  const consume = (attemptId, orderId, purchased) => cart.getState().consumePurchased(attemptId, orderId, purchased)
  const store = createCheckoutIntentStore(session, () => next, consume)
  cart.getState().addItem(product, variantId, 2); store.getState().freeze(request(), capture(cart)); await store.getState().complete(receipt)
  assert.equal(store.getState().intent, null); cart.getState().addItem(product, variantId, 2); next = token2
  store.getState().freeze(request(), capture(cart)); assert.equal(store.getState().intent.request.idempotencyKey, token2)
  assert.deepEqual(store.getState().receipt, receipt)
  await assert.rejects(store.getState().complete(receipt)); assert.equal(cart.getState().items[0].quantity, 2)
  await store.getState().complete({ ...receipt, id: token2, idempotencyKey: token2 }); assert.equal(cart.getState().items.length, 0)
  assert.equal(createCheckoutIntentStore(session).getState().intent, null)
})
test('new purchase eligibility rejects legacy, corrupt and missing variants', () => {
  for (const line of [
    { productId, variantId: null, identity: 'legacy', size: '50 ml', quantity: 1, lineId: 'legacy' },
    { productId, variantId: 'bad', identity: 'corrupt', size: '50 ml', quantity: 1, lineId: 'corrupt' },
    { productId, variantId: secondVariantId, identity: 'canonical', size: '50 ml', quantity: 1, lineId: 'missing' },
  ]) assert.equal(resolveCartItem(line, [product]).eligible, false)
})
