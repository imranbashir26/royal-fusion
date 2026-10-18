import assert from 'node:assert/strict'
import test from 'node:test'
import { createCartStore } from '../src/store/cartStore.ts'
import { createCheckoutIntentStore } from '../src/store/checkoutIntentStore.ts'
import { resolveCartItem } from '../src/services/productVariants.ts'
import { publicTesterPacksApi, TesterPackApiError } from '../src/services/publicTesterPacksApi.ts'
import { createCheckoutClient } from '../src/services/checkoutClient.ts'
import { matchesV2Checkout } from '../src/services/checkoutV2Validation.ts'
import { configurablePackLimit, testerCatalogPrice } from '../src/services/testerPackShopping.ts'
import { quoteV2Schema, orderV2Schema } from '../../backend/server/schemas/ordersV2.js'
import { checkoutExecutionPolicy } from '../../backend/server/services/checkoutExecutionPolicy.js'
import { memoryStorage, testPackId, testVariantId, testerQuote, testerReceipt } from './support/testerCheckoutFixtures.mjs'

const option = { testerVariantId: testVariantId, productId: testPackId, name: 'Oud', sku: 'RF-OUD', regularPrice: 500, effectivePrice: 450, stockQuantity: 6 }
const pack = { id: testPackId, definitionRevision: '1', mode: 'configurable', available: true, minimumUnits: null, maximumUnits: 4, allowedVariants: [option] }
const fixed = { ...pack, mode: 'fixed', availablePackCount: 3, fixedRegularPrice: 1400, effectivePrice: 1250 }
const selected = [{ variantId: testVariantId, quantityPerPack: 2 }]
const line = { kind: 'configurable_tester_pack', packId: testPackId, definitionRevision: '1', quantity: 1, selections: selected }
const destination = { shipping: { city: 'Karachi', province: 'Sindh' }, email: '', couponCode: '' }
const contact = { name: 'Test Customer', email: 'customer@example.invalid', phone: '03000000000' }

test('production ordering stays disabled even when a non-production order option is supplied', () => {
  assert.equal(checkoutExecutionPolicy({ environment: 'production' }).orderingEnabled, false)
  assert.equal(checkoutExecutionPolicy({ environment: 'production', allowNonProductionOrders: true }).orderingEnabled, false)
})

test('two units of the same tester meet the default minimum; bounds, empty options and aggregate stock fail closed', () => {
  const cart = createCartStore(memoryStorage())
  assert.equal(cart.getState().addConfigurablePack(pack, [{ variantId: testVariantId, quantityPerPack: 1 }]), false)
  assert.equal(cart.getState().addConfigurablePack(pack, selected, 2), true)
  assert.equal(cart.getState().addConfigurablePack(pack, selected, 2), false, 'merged quantity must also respect stock')
  assert.equal(configurablePackLimit(pack, [{ variantId: testVariantId, quantityPerPack: 5 }]), 0)
  assert.equal(configurablePackLimit({ ...pack, minimumUnits: 3 }, selected), 0)
  assert.equal(configurablePackLimit({ ...pack, allowedVariants: [] }, selected), 0)
  assert.equal(configurablePackLimit(pack, [{ variantId: testVariantId, quantityPerPack: 2 }, { variantId: testVariantId, quantityPerPack: 2 }]), 1)
  assert.equal(configurablePackLimit(pack, [{ variantId: testVariantId, quantityPerPack: 2147483648 }]), 0)
  assert.equal(configurablePackLimit({ ...pack, allowedVariants: [{ ...option, active: false }] }, selected), 0)
})

test('pack persistence retains entry identities, selection, repeated units and distinct configurations', () => {
  const disk = memoryStorage(), cart = createCartStore(disk)
  cart.getState().addConfigurablePack(pack, selected)
  cart.getState().addConfigurablePack(pack, [{ variantId: testVariantId, quantityPerPack: 3 }])
  cart.getState().addFixedPack(fixed)
  cart.getState().toggleItemSelection(cart.getState().items[0].lineId)
  const loaded = createCartStore(disk)
  for (const key of ['items', 'selectedLineIds', 'lineInstances', 'lineAppliedUnits']) assert.deepEqual(loaded.getState()[key], cart.getState()[key])
  assert.equal(loaded.getState().items.length, 3)
  const item = loaded.getState().items[0]
  assert.equal(resolveCartItem(item, []).eligible, false, 'saved labels alone never authorize checkout')
  assert.equal(resolveCartItem(item, [], [pack]).eligible, true)
  assert.equal(resolveCartItem(item, [], [{ ...pack, allowedVariants: [] }]).eligible, false)
  assert.equal(resolveCartItem(item, [], [{ ...pack, definitionRevision: '2' }]).eligible, false)
  assert.equal(resolveCartItem(item, [], [{ ...pack, available: false }]).eligible, false)
  assert.equal(loaded.getState().updateQuantity(item.lineId, 3, [], [pack]), true)
  assert.equal(loaded.getState().updateQuantity(item.lineId, 4, [], [pack]), false)
  assert.equal(loaded.getState().updateQuantity(item.lineId, 1.5, [], [pack]), false)
})

test('scheduled inactive sale values do not override effective catalog prices', () => {
  assert.equal(testerCatalogPrice({ regularPrice: 500, salePrice: 300, saleActive: false }), 500)
  assert.equal(testerCatalogPrice({ regularPrice: 500, effectivePrice: 450, salePrice: 300, saleActive: false }), 450)
})

test('public discovery pagination resolves later slugs by ID; missing, invalid and interrupted catalog states differ', async () => {
  const original = globalThis.fetch, calls = []
  const publicPack = { ...fixed, status: 'Published', active: true, name: 'Discovery', slug: 'later-page', components: [], allowedVariants: [] }
  try {
    globalThis.fetch = async url => {
      calls.push(url)
      if (url.includes('?page=1&')) return Response.json({ data: { items: [], total: 1, totalPages: 2 } })
      if (url.includes('?page=2&')) return Response.json({ data: { items: [publicPack], total: 1, totalPages: 2 } })
      return Response.json({ data: publicPack })
    }
    assert.equal((await publicTesterPacksApi.getBySlugOrId('later-page')).id, testPackId)
    assert.equal(calls.length, 3)
    globalThis.fetch = async () => Response.json({ error: {} }, { status: 404 })
    assert.equal(await publicTesterPacksApi.getBySlugOrId(testPackId), null)
    globalThis.fetch = async () => { throw new Error('offline') }
    await assert.rejects(() => publicTesterPacksApi.getBySlugOrId(testPackId), TesterPackApiError)
    globalThis.fetch = async () => Response.json({ data: [] })
    await assert.rejects(() => publicTesterPacksApi.get(testPackId), /invalid pack/i)
  } finally { globalThis.fetch = original }
})

test('auto transport preserves V1 items and sends mixed typed lines exclusively to canonical V2', async () => {
  const dispatched = []
  const client = createCheckoutClient(async (url, options) => {
    if (url.endsWith('/session')) return Response.json({ data: { csrfToken: 'csrf' } })
    const body = JSON.parse(options.body); dispatched.push({ url, body })
    if (url.includes('/v1/')) return Response.json({ data: { ...testerQuote([{ kind: 'normal_variant', ...body.items[0] }]), contractVersion: undefined, idempotencyKey: testPackId } })
    assert.equal(quoteV2Schema.safeParse(body).success, true)
    return Response.json({ data: testerQuote(body.lines) })
  }, '/api', 'auto')
  await client.quote({ ...destination, items: [{ variantId: testVariantId, quantity: 1 }] })
  const lines = [{ kind: 'normal_variant', variantId: testVariantId, quantity: 1 }, line]
  const quote = await client.quote({ ...destination, lines })
  assert.equal(quote.orderingEnabled, false)
  assert.ok(dispatched[0].url.includes('/v1/'))
  assert.ok(dispatched[1].url.includes('/v2/'))
  assert.deepEqual(dispatched[1].body.lines, lines)
  assert.equal('items' in dispatched[1].body, false)
  assert.throws(() => createCheckoutClient(async () => { throw new Error('must not send') }).quote({ ...destination, lines }), /V2 contract/)
})

test('pack receipts bind frozen identity, revision, units, fingerprint and idempotency before any consumption', async () => {
  const disk = memoryStorage(), cart = createCartStore(disk)
  cart.getState().addConfigurablePack(pack, selected)
  const item = cart.getState().items[0]
  const intentDisk = memoryStorage()
  const intents = createCheckoutIntentStore(intentDisk, () => testPackId, (attempt, order, lines) => cart.getState().consumePurchased(attempt, order, lines))
  const request = { lines: [line], contact, shipping: { ...destination.shipping, address: 'Test Street', notes: '' }, paymentMethod: 'Cash on Delivery', couponCode: '', quoteFingerprint: 'c'.repeat(64) }
  const frozen = intents.getState().freeze(request, cart.getState().capturePurchase([{ ...line, lineId: item.lineId }]))
  const receipt = testerReceipt(frozen.request)
  assert.equal(orderV2Schema.safeParse({ contractVersion: 2, ...frozen.request }).success, true)
  assert.equal(matchesV2Checkout(receipt, [line], request.quoteFingerprint), true)
  for (const mutate of [r => { r.quoteFingerprint = 'f'.repeat(64) }, r => { r.lines[0].definitionRevision = '2' },
    r => { r.lines[0].components[0].quantityPerPack = 1 }, r => { r.lines[0].components[0].totalPhysicalQuantity = 99 }, r => { r.lines = [] }]) {
    const bad = structuredClone(receipt); mutate(bad)
    await assert.rejects(() => intents.getState().complete(bad), /Invalid checkout receipt/)
    assert.equal(cart.getState().items.length, 1)
    assert.equal(createCheckoutIntentStore(intentDisk).getState().hydrationStatus, 'active')
  }
  await intents.getState().complete(receipt)
  assert.equal(cart.getState().items.length, 0)
  await intents.getState().complete(receipt)
  assert.equal(cart.getState().items.length, 0)
})

test('network and disabled-order responses retain the immutable attempt and cart; retry uses the same request', async () => {
  const disk = memoryStorage(), cart = createCartStore(disk)
  cart.getState().addFixedPack(fixed)
  const item = cart.getState().items[0], purchased = { kind: 'fixed_tester_pack', packId: testPackId, definitionRevision: '1', quantity: 1 }
  const intents = createCheckoutIntentStore(memoryStorage(), () => testPackId)
  const frozen = intents.getState().freeze({ lines: [purchased], contact, shipping: { ...destination.shipping, address: 'Test Street', notes: '' }, paymentMethod: 'Cash on Delivery', couponCode: '', quoteFingerprint: 'c'.repeat(64) }, cart.getState().capturePurchase([{ ...purchased, lineId: item.lineId }]))
  const sent = []; let mode = 'offline'
  const client = createCheckoutClient(async (url, options) => {
    if (url.endsWith('/session')) return Response.json({ data: { csrfToken: 'csrf' } })
    sent.push(JSON.parse(options.body))
    if (mode === 'offline') throw new Error('offline')
    return Response.json({ error: { code: 'CHECKOUT_UNAVAILABLE', message: 'Ordering is temporarily unavailable. Your cart has been saved.' } }, { status: 503 })
  }, '/api', 'auto')
  await assert.rejects(() => client.createOrder(frozen.request), { code: 'NETWORK_ERROR', unknownOutcome: true })
  mode = 'disabled'
  await assert.rejects(() => client.createOrder(frozen.request), { code: 'CHECKOUT_UNAVAILABLE' })
  assert.deepEqual(sent[0], sent[1])
  assert.ok(Object.isFrozen(intents.getState().intent.request.lines[0]))
  assert.equal(cart.getState().items.length, 1)
  assert.equal(intents.getState().receipt, null)
})
