import assert from 'node:assert/strict'
import test from 'node:test'
import { createCartStore } from '../src/store/cartStore.ts'
import {
  getCartLineId,
  getFixedPackLineId,
  getConfigurablePackLineId,
  restoreCartState,
} from '../src/store/cartPersistence.ts'
import { resolveCartItem } from '../src/services/productVariants.ts'
import { createCheckoutClient } from '../src/services/checkoutClient.ts'
import { createCheckoutIntentStore } from '../src/store/checkoutIntentStore.ts'
import { validIntent } from '../src/store/checkoutAttempt.ts'
import { quoteAcceptanceKey } from '../src/services/checkoutConfirmation.ts'
import { quoteV2Schema, orderV2Schema } from '../../backend/server/schemas/ordersV2.js'
import { mapProduct, mapProductVariant } from '../src/services/productionMappers.ts'
import { variantRow, productRow, productId, variantId } from './variantFixtures.mjs'

const standardProduct = { ...mapProduct(productRow), variants: [mapProductVariant(variantRow)] }

// Standalone tester fixture (size '5 ml', commerceKind 'tester')
const testerProductId = '10000000-0000-4000-8000-000000000001'
const testerVariantId = '20000000-0000-4000-8000-000000000001'
const testerProduct = {
  id: testerProductId,
  commerceKind: 'tester',
  name: 'Velvet Oud 5ml Tester',
  slug: 'velvet-oud-tester',
  variants: [
    {
      id: testerVariantId,
      productId: testerProductId,
      optionName: 'Size',
      optionValue: '5 ml',
      sku: 'RF-VO-5ML',
      regularPrice: 750,
      salePrice: null,
      stockQuantity: 50,
      active: true,
      available: true,
      displayOrder: 1,
    },
  ],
}

// Fixed tester pack fixture
const fixedPackId = '30000000-0000-4000-8000-000000000001'
const fixedPackRev = '1'
const fixedPack = {
  id: fixedPackId,
  definitionRevision: fixedPackRev,
  name: 'Royal Discovery Pack (5-Piece)',
  image: 'royal-pack.webp',
  available: true,
  availablePackCount: 20,
  mode: 'fixed',
  fixedRegularPrice: 2500,
  fixedSalePrice: 2200,
  effectivePrice: 2200,
  saleActive: true,
  salePrice: 2200,
}

// Configurable tester pack fixture
const configPackId = '40000000-0000-4000-8000-000000000001'
const configPackRev = '2'
const compVariant1 = '50000000-0000-4000-8000-000000000001'
const compVariant2 = '50000000-0000-4000-8000-000000000002'
const compVariant3 = '50000000-0000-4000-8000-000000000003'

const configPack = {
  id: configPackId,
  definitionRevision: configPackRev,
  name: 'Custom Discovery Set (Choose 3)',
  image: 'custom-pack.webp',
  available: true,
  mode: 'configurable',
  minimumUnits: 3,
  maximumUnits: 5,
  allowedVariants: [
    { testerVariantId: compVariant1, active: true, stockQuantity: 20, regularPrice: 800, salePrice: null },
    { testerVariantId: compVariant2, active: true, stockQuantity: 15, regularPrice: 850, salePrice: null },
    { testerVariantId: compVariant3, active: true, stockQuantity: 10, regularPrice: 900, salePrice: null },
  ],
}

function memoryStorage() {
  const store = new Map()
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
}

test('1. Existing standard cart compatibility: standard perfumes add, merge, and resolve identically', () => {
  const cart = createCartStore(memoryStorage())
  const added1 = cart.getState().addItem(standardProduct, variantId, 1)
  assert.equal(added1, true)
  assert.equal(cart.getState().items.length, 1)

  const lineId = getCartLineId(productId, variantId)
  assert.equal(cart.getState().items[0].lineId, lineId)
  assert.equal(cart.getState().items[0].quantity, 1)

  const added2 = cart.getState().addItem(standardProduct, variantId, 2)
  assert.equal(added2, true)
  assert.equal(cart.getState().items.length, 1)
  assert.equal(cart.getState().items[0].quantity, 3)

  const resolved = resolveCartItem(cart.getState().items[0], [standardProduct])
  assert.equal(resolved.eligible, true)
  assert.equal(resolved.variant?.id, variantId)
  assert.equal(resolved.unitPrice, 2900)
})

test('2. Standalone tester representation: standalone testers use normal_variant line kind and 5ml variant identity', () => {
  const cart = createCartStore(memoryStorage())
  const added = cart.getState().addItem(testerProduct, testerVariantId, 2)
  assert.equal(added, true)
  assert.equal(cart.getState().items.length, 1)

  const item = cart.getState().items[0]
  assert.equal(item.productId, testerProductId)
  assert.equal(item.variantId, testerVariantId)
  assert.equal(item.size, '5 ml')
  assert.equal(item.quantity, 2)

  const resolved = resolveCartItem(item, [testerProduct])
  assert.equal(resolved.eligible, true)
  assert.equal(resolved.unitPrice, 750)
  assert.equal(resolved.lineAmount, 1500)
})

test('3. Fixed pack representation: fixed pack line ID binds packId and definitionRevision with quantity', () => {
  const cart = createCartStore(memoryStorage())
  const added = cart.getState().addFixedPack(fixedPack, 1)
  assert.equal(added, true)
  assert.equal(cart.getState().items.length, 1)

  const item = cart.getState().items[0]
  assert.equal(item.kind, 'fixed_tester_pack')
  assert.equal(item.packId, fixedPackId)
  assert.equal(item.definitionRevision, fixedPackRev)
  assert.equal(item.lineId, getFixedPackLineId(fixedPackId, fixedPackRev))
  assert.equal(item.quantity, 1)

  const resolved = resolveCartItem(item, [], [fixedPack])
  assert.equal(resolved.eligible, true)
  assert.equal(resolved.unitPrice, 2200)
  assert.equal(resolved.lineAmount, 2200)
})

test('4. Configurable pack representation: configurable pack cart line stores component selections and pack revision', () => {
  const cart = createCartStore(memoryStorage())
  const selections = [
    { variantId: compVariant1, quantityPerPack: 2, testerName: 'Amber Royal' },
    { variantId: compVariant2, quantityPerPack: 1, testerName: 'Rose Imperial' },
  ]
  const added = cart.getState().addConfigurablePack(configPack, selections, 1)
  assert.equal(added, true)
  assert.equal(cart.getState().items.length, 1)

  const item = cart.getState().items[0]
  assert.equal(item.kind, 'configurable_tester_pack')
  assert.equal(item.packId, configPackId)
  assert.equal(item.definitionRevision, configPackRev)
  assert.equal(item.selections.length, 2)
  assert.equal(item.lineId, getConfigurablePackLineId(configPackId, configPackRev, selections))

  const resolved = resolveCartItem(item, [], [configPack])
  assert.equal(resolved.eligible, true)
})

test('5. Distinct configurable selections: two configurable packs with different selections produce distinct cart lines', () => {
  const cart = createCartStore(memoryStorage())
  const selA = [
    { variantId: compVariant1, quantityPerPack: 2 },
    { variantId: compVariant2, quantityPerPack: 1 },
  ]
  const selB = [
    { variantId: compVariant1, quantityPerPack: 1 },
    { variantId: compVariant3, quantityPerPack: 2 },
  ]

  const addedA = cart.getState().addConfigurablePack(configPack, selA, 1)
  const addedB = cart.getState().addConfigurablePack(configPack, selB, 1)
  assert.equal(addedA, true)
  assert.equal(addedB, true)

  assert.equal(cart.getState().items.length, 2)
  assert.notEqual(cart.getState().items[0].lineId, cart.getState().items[1].lineId)
})

test('6. Duplicate identical selections: identical selections merge quantities on the same line ID regardless of order', () => {
  const cart = createCartStore(memoryStorage())
  const selOrder1 = [
    { variantId: compVariant1, quantityPerPack: 1 },
    { variantId: compVariant2, quantityPerPack: 2 },
  ]
  const selOrder2 = [
    { variantId: compVariant2, quantityPerPack: 2 },
    { variantId: compVariant1, quantityPerPack: 1 },
  ]

  const added1 = cart.getState().addConfigurablePack(configPack, selOrder1, 1)
  const added2 = cart.getState().addConfigurablePack(configPack, selOrder2, 2)
  assert.equal(added1, true)
  assert.equal(added2, true)

  assert.equal(cart.getState().items.length, 1)
  assert.equal(cart.getState().items[0].quantity, 3)
})

test('7. Pack quantity greater than one: pack multiplier applies to physical unit demand without flattening components', () => {
  const cart = createCartStore(memoryStorage())
  cart.getState().addFixedPack(fixedPack, 4)
  assert.equal(cart.getState().items[0].quantity, 4)

  const resolved = resolveCartItem(cart.getState().items[0], [], [fixedPack])
  assert.equal(resolved.eligible, true)
  assert.equal(resolved.lineAmount, 8800)
})

test('8. Invalid pack identity: non-UUID pack ID or invalid revision is rejected during add and persistence', () => {
  const cart = createCartStore(memoryStorage())
  assert.equal(cart.getState().addFixedPack({ ...fixedPack, id: 'bad-pack-id' }), false)
  assert.equal(cart.getState().addFixedPack({ ...fixedPack, definitionRevision: 'invalid-rev!' }), false)

  const restored = restoreCartState({
    items: [
      { kind: 'fixed_tester_pack', packId: 'invalid-uuid', definitionRevision: '1', quantity: 1 },
      { kind: 'fixed_tester_pack', packId: fixedPackId, definitionRevision: '-5', quantity: 1 },
    ],
  })
  assert.equal(restored.items.length, 0)
})

test('9. Missing component identity: configurable pack with missing or non-UUID components is rejected', () => {
  const cart = createCartStore(memoryStorage())
  assert.equal(cart.getState().addConfigurablePack(configPack, [{ variantId: 'not-a-uuid', quantityPerPack: 3 }]), false)
  assert.equal(cart.getState().addConfigurablePack(configPack, []), false)

  const restored = restoreCartState({
    items: [
      { kind: 'configurable_tester_pack', packId: configPackId, definitionRevision: '1', quantity: 1, selections: [] },
      { kind: 'configurable_tester_pack', packId: configPackId, definitionRevision: '1', quantity: 1, selections: [{ variantId: 'bad', quantityPerPack: 3 }] },
    ],
  })
  assert.equal(restored.items.length, 0)
})

test('10. Invalid selection counts: pack rules (minimumUnits / maximumUnits) reject under- or over-filled packs', () => {
  const cart = createCartStore(memoryStorage())
  // Minimum is 3; 2 units must be rejected
  const underfilled = [{ variantId: compVariant1, quantityPerPack: 2 }]
  assert.equal(cart.getState().addConfigurablePack(configPack, underfilled), false)

  // Maximum is 5; 6 units must be rejected
  const overfilled = [{ variantId: compVariant1, quantityPerPack: 6 }]
  assert.equal(cart.getState().addConfigurablePack(configPack, overfilled), false)
})

test('11. Invalid or unavailable stock: out-of-stock pack or components mark cart item ineligible', () => {
  const outOfStockPack = { ...fixedPack, availablePackCount: 0 }
  const resolvedFixed = resolveCartItem(
    { kind: 'fixed_tester_pack', lineId: 'x', productId: fixedPackId, packId: fixedPackId, definitionRevision: '1', quantity: 1 },
    [],
    [outOfStockPack]
  )
  assert.equal(resolvedFixed.eligible, false)
  assert.match(resolvedFixed.message, /stock/i)

  const oosComponentPack = {
    ...configPack,
    allowedVariants: [
      { testerVariantId: compVariant1, active: true, stockQuantity: 0 },
      { testerVariantId: compVariant2, active: true, stockQuantity: 10 },
    ],
  }
  const resolvedConfig = resolveCartItem(
    {
      kind: 'configurable_tester_pack',
      lineId: 'y',
      productId: configPackId,
      packId: configPackId,
      definitionRevision: configPackRev,
      quantity: 1,
      selections: [{ variantId: compVariant1, quantityPerPack: 3 }],
    },
    [],
    [oosComponentPack]
  )
  assert.equal(resolvedConfig.eligible, false)
  assert.match(resolvedConfig.message, /exceed stock|unavailable/i)
})

test('12. Safe persistence and rehydration: tester packs rehydrate from storage and preserve standard cart items', () => {
  const rawStorage = {
    items: [
      { lineId: getCartLineId(productId, variantId), productId, variantId, size: '100 ml', quantity: 2 },
      { kind: 'fixed_tester_pack', packId: fixedPackId, definitionRevision: fixedPackRev, quantity: 1 },
      {
        kind: 'configurable_tester_pack',
        packId: configPackId,
        definitionRevision: configPackRev,
        quantity: 2,
        selections: [{ variantId: compVariant1, quantityPerPack: 3 }],
      },
      // Corrupt record should be ignored without affecting valid records
      { kind: 'fixed_tester_pack', packId: 'corrupt', definitionRevision: '1', quantity: 1 },
    ],
    selectedLineIds: [getCartLineId(productId, variantId), getFixedPackLineId(fixedPackId, fixedPackRev)],
  }

  const restored = restoreCartState(rawStorage, 2)
  assert.equal(restored.items.length, 3)
  assert.equal(restored.selectedLineIds.length, 2)
  assert.ok(restored.selectedLineIds.includes(getFixedPackLineId(fixedPackId, fixedPackRev)))
})

test('13. V2 quote payload mapping: purchase lines map faithfully to backend quoteV2Schema', () => {
  const quoteBody = {
    contractVersion: 2,
    lines: [
      { kind: 'normal_variant', variantId, quantity: 2 },
      { kind: 'fixed_tester_pack', packId: fixedPackId, definitionRevision: fixedPackRev, quantity: 1 },
      {
        kind: 'configurable_tester_pack',
        packId: configPackId,
        definitionRevision: configPackRev,
        quantity: 1,
        selections: [
          { variantId: compVariant1, quantityPerPack: 2 },
          { variantId: compVariant2, quantityPerPack: 1 },
        ],
      },
    ],
    shipping: { city: 'Lahore', province: 'Punjab' },
    email: 'test@example.com',
    couponCode: '',
  }

  const parsed = quoteV2Schema.safeParse(quoteBody)
  assert.equal(parsed.success, true, 'Wire quote payload must satisfy canonical quoteV2Schema')
})

test('14. V2 order payload mapping: order request maps faithfully to backend orderV2Schema', () => {
  const orderBody = {
    contractVersion: 2,
    idempotencyKey: '70000000-0000-4000-8000-000000000001',
    lines: [
      { kind: 'normal_variant', variantId, quantity: 1 },
      { kind: 'fixed_tester_pack', packId: fixedPackId, definitionRevision: fixedPackRev, quantity: 2 },
      {
        kind: 'configurable_tester_pack',
        packId: configPackId,
        definitionRevision: configPackRev,
        quantity: 1,
        selections: [{ variantId: compVariant1, quantityPerPack: 3 }],
      },
    ],
    contact: { name: 'Royal Customer', email: 'customer@example.com', phone: '+923001234567' },
    shipping: { address: '123 Royal Boulevard', city: 'Lahore', province: 'Punjab', notes: '' },
    paymentMethod: 'Cash on Delivery',
    couponCode: '',
    quoteFingerprint: 'a'.repeat(64),
  }

  const parsed = orderV2Schema.safeParse(orderBody)
  assert.equal(parsed.success, true, 'Wire order payload must satisfy canonical orderV2Schema')
})

test('15. Checkout never sends client prices and rejects an incomplete pack quote', async () => {
  let capturedBody = null
  const mockFetch = async (url, opts) => {
    if (url.includes('/auth/session')) {
      return { ok: true, json: async () => ({ data: { csrfToken: 'test-csrf' } }) }
    }
    capturedBody = JSON.parse(opts.body)
    return {
      ok: true,
      json: async () => ({
        data: {
          subtotal: 5000,
          discount: 0,
          shippingFee: 200,
          total: 5200,
          currency: 'PKR',
          shippingMethodId: '80000000-0000-4000-8000-000000000001',
          paymentMethods: ['Cash on Delivery'],
          orderingEnabled: true,
          quoteFingerprint: 'b'.repeat(64),
        },
      }),
    }
  }

  const client = createCheckoutClient(mockFetch, '/api', 'v2')
  await assert.rejects(() => client.quote({
    lines: [
      { kind: 'normal_variant', variantId, quantity: 1 },
      { kind: 'fixed_tester_pack', packId: fixedPackId, definitionRevision: fixedPackRev, quantity: 1 },
    ],
    shipping: { city: 'Lahore', province: 'Punjab' },
    email: 'test@example.com',
    couponCode: '',
  }), { code: 'INVALID_RESPONSE' })

  assert.ok(capturedBody)
  assert.equal(capturedBody.contractVersion, 2)
  for (const line of capturedBody.lines) {
    assert.equal('price' in line, false, 'Line must not have client price')
    assert.equal('unitPrice' in line, false, 'Line must not have client unitPrice')
    assert.equal('lineTotal' in line, false, 'Line must not have client lineTotal')
  }
})

test('16. Mixed standard/tester/pack cart: cart manages all 4 purchase types concurrently', () => {
  const cart = createCartStore(memoryStorage())
  cart.getState().addItem(standardProduct, variantId, 1)
  cart.getState().addItem(testerProduct, testerVariantId, 2)
  cart.getState().addFixedPack(fixedPack, 1)
  cart.getState().addConfigurablePack(configPack, [{ variantId: compVariant1, quantityPerPack: 3 }], 1)

  assert.equal(cart.getState().items.length, 4)
  assert.equal(cart.getState().getItemCount(), 5)
})

test('17. Material pack-selection change invalidates confirmation signature', () => {
  const linesA = [
    { kind: 'configurable_tester_pack', packId: configPackId, definitionRevision: configPackRev, quantity: 1, selections: [{ variantId: compVariant1, quantityPerPack: 3 }] },
  ]
  const linesB = [
    { kind: 'configurable_tester_pack', packId: configPackId, definitionRevision: configPackRev, quantity: 1, selections: [{ variantId: compVariant2, quantityPerPack: 3 }] },
  ]

  const sigA = JSON.stringify({ lines: linesA, shipping: { city: 'Lahore', province: 'Punjab' }, email: 'a@example.com', couponCode: '' })
  const sigB = JSON.stringify({ lines: linesB, shipping: { city: 'Lahore', province: 'Punjab' }, email: 'a@example.com', couponCode: '' })

  assert.notEqual(sigA, sigB)
  const mockQuote = {
    quoteFingerprint: 'f'.repeat(64),
    contractVersion: 2,
    subtotal: 5000,
    discount: 0,
    shippingFee: 250,
    total: 5250,
    currency: 'PKR',
    shippingMethodId: '80000000-0000-4000-8000-000000000001',
    orderingEnabled: true,
    paymentMethods: ['Cash on Delivery'],
  }
  const keyA = quoteAcceptanceKey(sigA, mockQuote, 'Cash on Delivery')
  const keyB = quoteAcceptanceKey(sigB, mockQuote, 'Cash on Delivery')
  assert.ok(keyA)
  assert.ok(keyB)
  assert.notEqual(keyA, keyB, 'Altering pack selections must change acceptance key')
})

test('18. Frozen attempt recovery remains intact: pack purchase lines validate in frozen intent', () => {
  const intentStore = createCheckoutIntentStore(memoryStorage(), () => '70000000-0000-4000-8000-000000000001')
  const request = {
    lines: [
      { kind: 'fixed_tester_pack', packId: fixedPackId, definitionRevision: fixedPackRev, quantity: 1 },
    ],
    contact: { name: 'Customer', email: 'test@example.com', phone: '+923001234567' },
    shipping: { address: 'Address', city: 'Lahore', province: 'Punjab', notes: '' },
    paymentMethod: 'Cash on Delivery',
    couponCode: '',
    quoteFingerprint: 'c'.repeat(64),
  }
  const purchasedLines = [
    { kind: 'fixed_tester_pack', lineId: getFixedPackLineId(fixedPackId, fixedPackRev), entryId: '80000000-0000-4000-8000-000000000001', packId: fixedPackId, definitionRevision: fixedPackRev, quantity: 1 },
  ]

  const frozen = intentStore.getState().freeze(request, purchasedLines, '70000000-0000-4000-8000-000000000001')
  assert.equal(validIntent(frozen), true, 'Frozen pack intent must validate')
})

test('19. Unsupported items block order submission: invalid pack stops cart checkout', () => {
  const stalePack = { ...fixedPack, definitionRevision: '99' }
  const item = { kind: 'fixed_tester_pack', lineId: 'x', productId: fixedPackId, packId: fixedPackId, definitionRevision: '1', quantity: 1 }

  const resolved = resolveCartItem(item, [], [stalePack])
  assert.equal(resolved.eligible, false)
  assert.match(resolved.message, /definition changed/i)
})

test('20. Existing V1 fixture compatibility: V1 checkout intent with items: [...] validates without error', () => {
  const legacyRequest = {
    idempotencyKey: '70000000-0000-4000-8000-000000000001',
    items: [{ variantId, quantity: 2 }],
    contact: { name: 'Fictional Customer', email: 'customer@example.invalid', phone: '00000000000' },
    shipping: { address: 'Fictional Address', city: 'Lahore', province: 'Punjab', notes: '' },
    paymentMethod: 'Cash on Delivery',
    couponCode: '',
    quoteFingerprint: 'd'.repeat(64),
  }
  const standardLines = [
    { lineId: JSON.stringify([productId, variantId]), entryId: '71000000-0000-4000-8000-000000000001', variantId, quantity: 2 },
  ]

  assert.equal(validIntent({ request: legacyRequest, lines: standardLines }), true)
})
