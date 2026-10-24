import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { startIsolatedApi } from './support/isolatedApi.js'
import ts from 'typescript'
import { createHash } from 'node:crypto'
import { createCartStore, checkoutCompletionAvailable, getCartLineId, getFixedPackLineId, getConfigurablePackLineId } from '../../../frontend/src/store/cartStore.ts'
import { createCheckoutIntentStore } from '../../../frontend/src/store/checkoutIntentStore.ts'
import { resolveCartItem } from '../../../frontend/src/services/productVariants.ts'
import { createCheckoutClient, CheckoutClientError } from '../../../frontend/src/services/checkoutClient.ts'
import { quoteAcceptanceKey, isDefinitiveQuoteRejection } from '../../../frontend/src/services/checkoutConfirmation.ts'
import { mapProduct, mapProductVariant } from '../../../frontend/src/services/productionMappers.ts'
import { productRow, variantRow, productId, variantId, secondVariantId } from '../../../frontend/tests/variantFixtures.mjs'
import { memoryStorage, testerQuote, testerReceipt } from '../../../frontend/tests/support/testerCheckoutFixtures.mjs'
import { quoteRequestSchema, orderRequestSchema } from '../schemas/ordersV1.js'
import { quoteV2Schema, orderV2Schema } from '../schemas/ordersV2.js'

test('current guest checkout remains unauthenticated and authoritative in an isolated database', async (context) => {
  const api = await startIsolatedApi()
  context.after(() => api.stop())

  const response = await fetch(`${api.baseUrl}/api/public/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [{ productId: 'product-selected', size: '50 ml', quantity: 2 }],
      contact: {
        name: 'Fictional Customer',
        email: 'customer@example.invalid',
        phone: '+00 000 0000000',
      },
      shipping: {
        address: 'Fictional address',
        city: 'Example City',
        province: 'Example Province',
        notes: '',
      },
      paymentMethod: 'Cash on Delivery',
      couponCode: 'FICTIONAL10',
      subtotal: 1,
      shippingFee: 1,
      total: 1,
    }),
  })
  const result = await response.json()

  assert.equal(response.status, 201)
  assert.equal(result.status, 'confirmed')
  assert.equal(result.order.subtotal, 2000)
  assert.equal(result.order.discount, 200)
  assert.equal(result.order.shippingFee, 300)
  assert.equal(result.order.total, 2100)
  assert.equal(result.order.items.length, 1)
  assert.equal(result.order.items[0].productId, 'product-selected')

  const db = await api.readFixtureDb()
  assert.equal(db.products.find((item) => item.id === 'product-selected').stock, 6)
  assert.equal(db.products.find((item) => item.id === 'product-unselected').stock, 6)
  assert.equal(db.coupons[0].usedCount, 1)
  assert.equal(db.orders.length, 1)
})

test('failed guest order does not report success or mutate isolated persistence', async (context) => {
  const api = await startIsolatedApi()
  context.after(() => api.stop())

  const before = await api.readFixtureDb()
  const response = await fetch(`${api.baseUrl}/api/public/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [{ productId: 'missing-product', size: '50 ml', quantity: 1 }],
      contact: {
        name: 'Fictional Customer',
        email: 'customer@example.invalid',
        phone: '+00 000 0000000',
      },
      shipping: {
        address: 'Fictional address',
        city: 'Example City',
        province: 'Example Province',
      },
      paymentMethod: 'Cash on Delivery',
      couponCode: '',
    }),
  })
  const result = await response.json()
  const after = await api.readFixtureDb()

  assert.equal(response.status, 400)
  assert.equal('id' in result, false)
  assert.equal('order' in result, false)
  assert.equal(after.orders.length, before.orders.length)
  assert.deepEqual(after.products, before.products)
  assert.deepEqual(after.coupons, before.coupons)
})

test('current checkout submits selected lines only and has no false-success fallback', async () => {
  const checkout = await readFile(
    new URL('../../../frontend/src/pages/CheckoutPage.tsx', import.meta.url),
    'utf8',
  )
  const service = await readFile(
    new URL('../../../frontend/src/services/orderService.ts', import.meta.url),
    'utf8',
  )
  const publicRoute = await readFile(new URL('../routes/public.js', import.meta.url), 'utf8')
  const orderRoute = publicRoute.slice(
    publicRoute.indexOf("publicRouter.post('/orders'"),
    publicRoute.indexOf('function upsertCustomer'),
  )

  assert.match(checkout, /items\.filter\(\(item\) => selectedLineIdSet\.has\(item\.lineId\)\)/)
  // 0d3e76a introduced typed request/purchase lines; d60d08b selected V1/V2.
  // Execute those production expressions and submit handlers below rather than
  // pinning the obsolete inline items/capturePurchase implementation shape.
  assert.match(checkout, /await complete\(result\)/)
  assert.match(service, /checkoutClient/)
  assert.doesNotMatch(service, /mock|fallback/i)
  assert.doesNotMatch(orderRoute, /supabase|requireAdmin|authorization|customer_id/i)
})

// Compile actual page declarations and complete submit handlers, not copied
// mapping functions. React rendering/effects are outside this unit boundary;
// useMemo evaluates its real callback once, as on an initial render. Missing or
// ambiguous source bindings fail explicitly instead of falling back to fixtures.
const pageFactory = (async () => {
  const source = await readFile(new URL('../../../frontend/src/pages/CheckoutPage.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('CheckoutPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  assert.equal(tree.parseDiagnostics.length, 0)
  const pages = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'CheckoutPage')
  assert.equal(pages.length, 1)
  const statements = pages[0].body.statements
  const variables = ['selectedLineIdSet', 'selectedCartItems', 'hasPacks', 'enrichedItems', 'usesV2', 'eligible',
    'requestLines', 'signature', 'currentQuote', 'acceptanceKey', 'confirmed', 'configuredPaymentMethods', 'activePaymentMethods', 'checkoutBlocked']
  const declarations = variables.map(name => {
    const matches = statements.filter(node => ts.isVariableStatement(node)
      && node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === name))
    assert.equal(matches.length, 1, 'Expected one production declaration: ' + name)
    return matches[0].getText(tree)
  })
  const handlers = ['submitFrozen', 'handleSubmit'].map(name => {
    const matches = statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    assert.equal(matches.length, 1, 'Expected one production handler: ' + name)
    return matches[0].getText(tree)
  })
  const compiled = ts.transpileModule([...declarations, ...handlers].join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }, reportDiagnostics: true,
  })
  assert.equal(compiled.diagnostics.length, 0)
  return scope => Function(...Object.keys(scope), compiled.outputText
    + '\nreturn {selectedCartItems,enrichedItems,eligible,usesV2,requestLines,signature,handleSubmit,submitFrozen};')(...Object.values(scope))
})()

const guestToken = '70000000-0000-4000-8000-000000000001'
const testerId = '10000000-0000-4000-8000-000000000001', testerVariant = '20000000-0000-4000-8000-000000000001'
const otherProduct = '45852db8-8b83-425e-8d1f-4112958ed506'
const fixedId = '30000000-0000-4000-8000-000000000001', configurableId = '40000000-0000-4000-8000-000000000001'
const componentA = 'a0000000-0000-4000-8000-000000000001', componentB = 'b0000000-0000-4000-8000-000000000001'
const components = [{ variantId: componentA, quantityPerPack: 2 }, { variantId: componentB, quantityPerPack: 1 }]

async function checkoutPageFixture(selected, { normalize = false, mutate, response = 'valid', holdCompletion = false } = {}) {
  const standard = { ...mapProduct(productRow), variants: [mapProductVariant(variantRow)] }
  const other = { ...standard, id: otherProduct, variants: [{ ...standard.variants[0], id: secondVariantId, productId: otherProduct }] }
  const tester = { ...standard, id: testerId, commerceKind: 'tester', variants: [{ ...standard.variants[0], id: testerVariant, productId: testerId, optionValue: '5 ml' }] }
  const fixed = { id: fixedId, definitionRevision: '3', mode: 'fixed', available: true, availablePackCount: 20, fixedRegularPrice: 1250 }
  const configurable = { id: configurableId, definitionRevision: '5', mode: 'configurable', available: true, minimumUnits: 3, maximumUnits: 5,
    allowedVariants: components.map(s => ({ testerVariantId: s.variantId, active: true, stockQuantity: 20, regularPrice: 450, salePrice: null })) }
  const normal = (p, v, quantity) => ({ kind: 'normal_variant', productId: p, variantId: v, lineId: getCartLineId(p, v), identity: 'canonical', size: '50 ml', quantity })
  const catalog = {
    standard: normal(productId, variantId, 2), other: normal(otherProduct, secondVariantId, 1), tester: normal(testerId, testerVariant, 3),
    fixed: { kind: 'fixed_tester_pack', productId: fixedId, packId: fixedId, definitionRevision: '3', quantity: 2, identity: 'canonical', size: 'Tester pack', lineId: getFixedPackLineId(fixedId, '3') },
    configurable: { kind: 'configurable_tester_pack', productId: configurableId, packId: configurableId, definitionRevision: '5', selections: structuredClone(components),
      quantity: 1, identity: 'canonical', size: 'Tester pack', lineId: getConfigurablePackLineId(configurableId, '5', components) },
  }
  const storage = memoryStorage(), items = Object.values(catalog).map(item => ({ ...item, price: 1, total: 1 }))
  storage.setItem('royal-fusion-cart', JSON.stringify({ version: 2, state: { items, selectedLineIds: selected.map(key => catalog[key].lineId),
    lineInstances: Object.fromEntries(items.map((item, i) => [item.lineId, '71000000-0000-4000-8000-00000000000' + (i + 1)])),
    lineAppliedUnits: Object.fromEntries(items.map(item => [item.lineId, 0])) } }))
  const cart = createCartStore(storage)
  if (normalize) assert.equal(cart.getState().addConfigurablePack(configurable, [components[1],
    { variantId: componentA.toUpperCase(), quantityPerPack: 1 }, { variantId: componentA, quantityPerPack: 1 }], 1), true)
  if (mutate) cart.setState({ items: cart.getState().items.map(item => selected.includes(Object.keys(catalog).find(key => catalog[key].lineId === item.lineId)) ? mutate(structuredClone(item)) : item) })
  const calls = [], captures = [], events = [], errors = [], navigation = []
  const store = createCheckoutIntentStore(storage, () => guestToken, (...args) => cart.getState().consumePurchased(...args))
  let releaseCompletion, enteredCompletion
  const completionGate = new Promise(resolve => { releaseCompletion = resolve })
  const completionEntered = new Promise(resolve => { enteredCompletion = resolve })
  const client = createCheckoutClient(async (url, options) => {
    if (url === '/api/v1/auth/session') return { ok: true, json: async () => ({ data: { authenticated: false, csrfToken: 'isolated-csrf' } }) }
    assert.equal(options.credentials, 'include'); assert.equal(options.headers['X-RF-CSRF'], 'isolated-csrf')
    assert.equal(Object.hasOwn(options.headers, 'Authorization'), false)
    const body = JSON.parse(options.body), v2 = url.startsWith('/api/v2/'), quote = url.endsWith('/checkout/quote')
    const schema = quote ? (v2 ? quoteV2Schema : quoteRequestSchema) : (v2 ? orderV2Schema : orderRequestSchema)
    assert.equal(schema.safeParse(body).success, true, 'Actual emitted request must satisfy its strict production schema')
    calls.push({ url, body })
    if (!quote && response === 'network') throw Error('Isolated unknown outcome')
    const amounts = { subtotal: 7333, discount: 0, shippingFee: 250, total: 7583, currency: 'PKR' }
    let data = quote ? (v2 ? testerQuote(body.lines, { orderingEnabled: true }) : { ...amounts, quoteFingerprint: 'c'.repeat(64), idempotencyKey: guestToken,
      shippingMethodId: '60000000-0000-4000-8000-000000000001', paymentMethods: ['Cash on Delivery'], orderingEnabled: true })
      : v2 ? testerReceipt(body) : { ...amounts, id: '72000000-0000-4000-8000-000000000001', idempotencyKey: body.idempotencyKey,
        orderNumber: 'RF-20261021-1234ABCD', status: 'Pending', paymentStatus: 'Unpaid', paymentMethod: body.paymentMethod, idempotent: false,
        pricingOutcome: { policy: 'GLOBAL_PERCENTAGE_V1', strategy: 'SALE', couponOutcome: 'not_requested', requestedCouponCode: '', appliedCouponId: null,
          appliedCouponCode: null, regularSubtotal: 7333, saleSubtotal: 7333, couponSubtotal: null, couponDiscount: 0, merchandiseTotal: 7333,
          acceptedQuoteFingerprint: createHash('sha256').update('rf:v1:capability:008:' + body.quoteFingerprint).digest('hex') },
        lines: [{ kind: 'normal_variant', id: '73000000-0000-4000-8000-000000000001', variantId, quantity: 2, unitPrice: 3666.5, lineTotal: 7333 }] }
    if (!quote && response === 'invalid') data = { ...data, idempotencyKey: '70000000-0000-4000-8000-000000000002' }
    return { ok: true, json: async () => ({ data }) }
  }, '/api', 'auto')
  const scope = { ...cart.getState(), products: [standard, other, tester], testerPacks: [fixed, configurable], isLoading: false, packsLoading: false, packsError: '',
    payments: [{ name: 'Cash on Delivery', active: true }],
    form: { name: 'Fixture Customer', email: 'guest@example.invalid', phone: '00000000000', address: 'Fixture address', city: 'Karachi', province: 'Sindh', notes: '' },
    paymentMethod: 'Cash on Delivery', couponCode: '', quote: null, acceptedQuote: null, resolveCartItem, quoteAcceptanceKey, isDefinitiveQuoteRejection, CheckoutClientError,
    completionAvailable: checkoutCompletionAvailable(), checkoutCompletionAvailable, useMemo: fn => fn(), Landmark: null, Wallet: null,
    inFlight: { current: false }, useCheckoutIntentStore: store, orderService: client, Date: { now: () => 12345 },
    capturePurchase: lines => { const captured = cart.getState().capturePurchase(lines); captures.push(structuredClone(captured)); return captured },
    freeze: (...args) => store.getState().freeze(...args), rejectQuote: (...args) => store.getState().rejectQuote(...args),
    complete: async receipt => { events.push('complete-start'); enteredCompletion(); if (holdCompletion) await completionGate;
      await store.getState().complete(receipt); events.push('complete-end') },
    navigate: (...args) => { events.push('navigate'); navigation.push(args) },
    setOrderError: error => errors.push(error), setIsSubmitting() {}, setAcceptedQuote() {}, setQuote() {}, setQuoteError() {}, setQuoteNotice() {}, setQuoteReload() {},
  }
  const evaluate = await pageFactory, projection = evaluate(scope)
  if (projection.eligible) {
    const data = await client.quote(JSON.parse(projection.signature))
    scope.quote = { signature: projection.signature, data, at: 12345 }
    scope.acceptedQuote = quoteAcceptanceKey(projection.signature, data, scope.paymentMethod)
  }
  return { page: evaluate(scope), cart, store, storage, calls, captures, events, errors, navigation, catalog, completionEntered, releaseCompletion }
}

test('actual checkout page sends only selected standard guest items through V1 and captures their UUIDs', async () => {
  const f = await checkoutPageFixture(['standard'])
  assert.equal(f.page.usesV2, false)
  await f.page.handleSubmit({ preventDefault() {} })
  assert.deepEqual(f.calls.map(call => call.url), ['/api/v1/public/checkout/quote', '/api/v1/public/orders'])
  assert.deepEqual(f.calls[1].body.items, [{ variantId, quantity: 2 }]); assert.equal('lines' in f.calls[1].body, false)
  assert.equal(f.captures[0].length, 1); assert.equal(f.captures[0][0].lineId, getCartLineId(productId, variantId)); assert.equal(f.captures[0][0].quantity, 2)
  assert.deepEqual(f.events, ['complete-start', 'complete-end', 'navigate']); assert.equal(f.navigation.length, 1)
  assert.equal(f.cart.getState().items.length, 4); assert.equal(f.store.getState().completion.receipt.total, 7583)
})

for (const [name, selected, expected] of [
  ['standalone tester', ['tester'], [{ kind: 'normal_variant', variantId: testerVariant, quantity: 3 }]],
  ['fixed pack', ['fixed'], [{ kind: 'fixed_tester_pack', packId: fixedId, definitionRevision: '3', quantity: 2 }]],
  ['configurable pack', ['configurable'], [{ kind: 'configurable_tester_pack', packId: configurableId, definitionRevision: '5', selections: components, quantity: 2 }]],
  ['mixed cart', ['standard', 'fixed'], [{ kind: 'normal_variant', variantId, quantity: 2 }, { kind: 'fixed_tester_pack', packId: fixedId, definitionRevision: '3', quantity: 2 }]],
]) test('actual checkout page serializes selected ' + name + ' through V2 without client prices', async () => {
  const f = await checkoutPageFixture(selected, { normalize: name === 'configurable pack' })
  assert.equal(f.page.usesV2, true); assert.deepEqual(f.page.requestLines, expected)
  await f.page.handleSubmit({ preventDefault() {} })
  assert.deepEqual(f.calls.map(call => call.url), ['/api/v2/public/checkout/quote', '/api/v2/public/orders'])
  assert.deepEqual(f.calls[0].body.lines, expected); assert.deepEqual(f.calls[1].body.lines, expected)
  assert.equal('items' in f.calls[1].body, false)
  for (const call of f.calls) for (const key of ['price', 'unitPrice', 'subtotal', 'total']) assert.equal(key in call.body, false)
  assert.equal(f.captures[0].length, expected.length)
  for (const [i, line] of f.captures[0].entries()) {
    const { lineId, entryId, ...purchase } = line
    assert.deepEqual(purchase, expected[i]); assert.match(entryId, /^[0-9a-f-]{36}$/)
    assert.equal(lineId, f.page.selectedCartItems[i].lineId)
  }
  assert.deepEqual(f.events, ['complete-start', 'complete-end', 'navigate']); assert.equal(f.navigation.length, 1)
  assert.equal(f.cart.getState().items.length, 5 - selected.length)
})

for (const [name, selected, mutate] of [
  ['wrong product/variant association', ['standard'], item => ({ ...item, variantId: secondVariantId })],
  ['invalid normal quantity', ['standard'], item => ({ ...item, quantity: 0 })],
  ['stale pack revision', ['fixed'], item => ({ ...item, definitionRevision: '999' })],
  ['malformed configurable selection', ['configurable'], item => ({ ...item, selections: [{ variantId: componentA, quantityPerPack: 0 }] })],
]) test('actual checkout eligibility blocks ' + name + ' before quote, capture or submission', async () => {
  const f = await checkoutPageFixture(selected, { mutate }), before = structuredClone(f.cart.getState().items)
  assert.equal(f.page.eligible, false); assert.equal(f.page.selectedCartItems.length, 1)
  await f.page.handleSubmit({ preventDefault() {} })
  assert.equal(f.calls.length, 0); assert.equal(f.captures.length, 0); assert.equal(f.navigation.length, 0)
  assert.equal(f.store.getState().intent, null); assert.deepEqual(f.cart.getState().items, before)
})

test('actual submit handler awaits receipt completion before navigation and does not resubmit frozen attempts in flight', async () => {
  const f = await checkoutPageFixture(['fixed'], { holdCompletion: true })
  const pending = f.page.handleSubmit({ preventDefault() {} })
  await f.completionEntered
  assert.deepEqual(f.events, ['complete-start']); assert.equal(f.navigation.length, 0)
  assert.equal(f.cart.getState().items.length, 5)
  await f.page.handleSubmit({ preventDefault() {} }); assert.equal(f.calls.length, 2)
  f.releaseCompletion(); await pending
  assert.deepEqual(f.events, ['complete-start', 'complete-end', 'navigate']); assert.equal(f.cart.getState().items.length, 4)
})

for (const response of ['invalid', 'network']) test('actual submit preserves frozen attempt and cart after ' + response + ' outcome', async () => {
  const f = await checkoutPageFixture(['fixed'], { response }), before = structuredClone(f.cart.getState().items)
  await f.page.handleSubmit({ preventDefault() {} })
  assert.equal(f.navigation.length, 0); assert.equal(f.store.getState().intent.request.idempotencyKey, guestToken)
  assert.equal(f.store.getState().completion, null); assert.deepEqual(f.cart.getState().items, before)
  assert.ok(f.errors.some(message => /saved|Retry/.test(message)))
  const first = f.calls[1].body
  await f.page.submitFrozen(); assert.deepEqual(f.calls[2].body, first, 'Retry must replay the same frozen request')
})
