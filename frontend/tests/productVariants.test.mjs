import assert from 'node:assert/strict'
import test from 'node:test'
import { mapProduct, mapProductVariant } from '../src/services/productionMappers.ts'
import { loadPublicVariants } from '../src/services/storefrontVariants.ts'
import { defaultVariant, variantPrice, isVariantEligible, selectedProductVariant, resolveCartItem, canSubmitLegacyCart, legacyVariant, normalizeSize } from '../src/services/productVariants.ts'
import { createCartStore } from '../src/store/cartStore.ts'
import { restoreCartState, reconcileCartState, CART_VERSION } from '../src/store/cartPersistence.ts'
import { productId, variantId, secondVariantId, productRow, variantRow } from './variantFixtures.mjs'
import { applyCatalogRefresh } from '../src/services/catalogRefresh.ts'

const variant = mapProductVariant(variantRow)
const product = { ...mapProduct(productRow), variants: [variant], variantIdentityScope: 'complete' }
function memoryStorage(initial) {
  let value = initial ? JSON.stringify(initial) : null
  return { getItem: () => value, setItem: (_key, next) => { value = next }, removeItem: () => { value = null } }
}

test('Baraan exposes its exact canonical UUID, option, PKR 2900 and stock 12 without a synthetic size', () => {
  assert.equal(product.id, productId)
  assert.deepEqual(product.sizeOptions, [])
  assert.equal(defaultVariant(product).id, variantId)
  assert.equal(variant.optionValue, '50 ml')
  assert.equal(variantPrice(variant), 2900)
  assert.equal(variant.stockQuantity, 12)
  assert.equal(selectedProductVariant(product, '').id, variantId)
})

test('variant pricing preserves null semantics and valid zero sales, rejects invalid pricing', () => {
  assert.equal(variantPrice({ ...variant, salePrice: 2500 }), 2500)
  assert.equal(variantPrice({ ...variant, salePrice: 0 }), 0)
  assert.equal(isVariantEligible({ ...variant, salePrice: NaN }), false)
  assert.equal(isVariantEligible({ ...variant, salePrice: 3000 }), false)
})

test('default selection is stable and never falls back to legacy size strings', () => {
  const second = { ...variant, id: secondVariantId, displayOrder: 1 }
  assert.equal(defaultVariant({ ...product, variants: [second, variant] }).id, variantId)
  assert.equal(defaultVariant({ ...product, variants: [] }), undefined)
  assert.equal(defaultVariant({ ...product, variants: undefined }), undefined)
  for (const patch of [{ active: false }, { available: false }, { stockQuantity: 0 }]) {
    assert.equal(defaultVariant({ ...product, variants: [{ ...variant, ...patch }] }), undefined)
  }
  assert.equal(selectedProductVariant(undefined, variantId), undefined)
  const nextProduct = { ...product, id: 'b4035721-28fc-4539-a988-a08264c5a862',
    variants: [{ ...variant, id: secondVariantId, productId: 'b4035721-28fc-4539-a988-a08264c5a862' }] }
  assert.equal(selectedProductVariant(nextProduct, variantId).id, secondVariantId)
})

test('real cart stores UUID, merges same variant, separates different variants and enforces stock', () => {
  const store = createCartStore(memoryStorage())
  const second = { ...variant, id: secondVariantId, optionValue: '50 ml', regularPrice: 5000 }
  const catalogProduct = { ...product, variants: [variant, second] }
  assert.equal(store.getState().addItem(catalogProduct, variantId, 2), true)
  assert.equal(store.getState().addItem(catalogProduct, variantId, 3), true)
  assert.equal(store.getState().items[0].variantId, variantId)
  assert.equal(store.getState().items[0].quantity, 5)
  assert.equal(store.getState().addItem(catalogProduct, secondVariantId), true)
  assert.equal(store.getState().items.length, 2)
  assert.equal(store.getState().addItem(catalogProduct, variantId, 8), false)
  const line = store.getState().items[0].lineId
  for (const quantity of [0, -1, 1.5, 13, NaN, Infinity]) {
    assert.equal(store.getState().updateQuantity(line, quantity, [catalogProduct]), false)
  }
  assert.equal(store.getState().updateQuantity(line, 12, [catalogProduct]), true)
  store.getState().removeItem(line)
  assert.equal(store.getState().items[0].variantId, secondVariantId)
})

test('all unavailable and fabricated variant adds fail without changing cart', () => {
  const store = createCartStore(memoryStorage())
  for (const patch of [{ active: false }, { available: false }, { stockQuantity: 0 }]) {
    assert.equal(store.getState().addItem({ ...product, variants: [{ ...variant, ...patch }] }, variantId), false)
  }
  assert.equal(store.getState().addItem(product, '50ml'), false)
  assert.deepEqual(store.getState().items, [])
})

test('versioned storage reload preserves canonical identity and selections', () => {
  const storage = memoryStorage()
  const first = createCartStore(storage)
  first.getState().addItem(product, variantId, 2)
  first.getState().setAllItemsSelected(false)
  assert.equal(JSON.parse(storage.getItem()).version, CART_VERSION)
  const second = createCartStore(storage)
  assert.equal(second.getState().items[0].variantId, variantId)
  assert.deepEqual(second.getState().selectedLineIds, [])
})

test('size-only legacy hydration preserves lines, aliases and selection without assigning any UUID', () => {
  const oldId = JSON.stringify([productId, '50ml'])
  const storage = memoryStorage({ version: 0, state: {
    items: [{ productId, size: '50ml', quantity: 2 }, { productId, size: '50 ml', quantity: 3 }],
    selectedLineIds: [oldId],
  } })
  const store = createCartStore(storage)
  assert.equal(store.getState().items[0].variantId, null)
  store.getState().reconcile([])
  assert.equal(store.getState().items.length, 2)
  store.getState().reconcile([product])
  assert.equal(store.getState().items.length, 2)
  assert.deepEqual(store.getState().items.map((item) => [item.variantId, item.size, item.quantity]),
    [[null, '50ml', 2], [null, '50 ml', 3]])
  assert.deepEqual(store.getState().selectedLineIds, [store.getState().items[0].lineId])
  assert.deepEqual(createCartStore(storage).getState().items, store.getState().items)
  assert.equal(normalizeSize(' 50 ML '), '50ml')
})

test('missing, ambiguous and empty legacy sizes remain unresolved, with no silent quantity loss', () => {
  const state = restoreCartState({ items: [{ productId, size: '50ml', quantity: 15 }] })
  const duplicate = { ...variant, id: secondVariantId, optionValue: '50ml' }
  assert.equal(reconcileCartState(state, [{ ...product, variants: [variant, duplicate] }]).items[0].variantId, null)
  const resolved = reconcileCartState(state, [product])
  assert.equal(resolved.items[0].quantity, 15)
  assert.equal(resolveCartItem(resolved.items[0], [product]).eligible, false)
  const missing = resolveCartItem(state.items[0], [])
  assert.equal(missing.product.name, 'Unavailable product')
  assert.ok(missing.message)
  assert.equal(reconcileCartState(restoreCartState({ items: [{ productId, size: '', quantity: 1 }] }), [product]).items[0].variantId, null)
})

test('cart summary resolves canonical price/stock, not stale parent size prices; checkout is guarded', () => {
  const item = { lineId: 'line', productId, variantId, size: 'old label', quantity: 2 }
  const resolved = resolveCartItem(item, [{ ...product, price: 9999, sizeOptions: [{ value: 'old label', label: 'old label', price: 1 }] }])
  assert.equal(resolved.unitPrice, 2900)
  assert.equal(resolved.size, '50 ml')
  assert.equal(resolved.variant.stockQuantity, 12)
  assert.equal(canSubmitLegacyCart([item]), false)
  assert.equal(canSubmitLegacyCart([{ ...item, variantId: null }]), false)
})

function queryClient(pages) {
  const calls = []
  const client = { from(table) {
    const call = { table, filters: [], orders: [] }; calls.push(call)
    const query = { select(value) { call.select = value; return query },
      in(key, values) { call.ids = values; call.filters.push([key, values]); return query },
      eq(key, value) { call.filters.push([key, value]); return query },
      order(key) { call.orders.push(key); return query },
      async range(start, end) { call.range = [start, end]; return pages.shift() ?? { data: [], error: null } } }
    return query
  } }
  return { client, calls }
}

test('public reader batches products and maps Baraan without per-product requests', async () => {
  const { client, calls } = queryClient([{ data: [variantRow], error: null }])
  const variants = await loadPublicVariants(client, [productId, 'another-product', productId])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].table, 'product_variants')
  assert.deepEqual(calls[0].ids, [productId, 'another-product'])
  // Public purchases only read active/available variants under the existing RLS.
  assert.ok(calls[0].filters.some(([key, value]) => key === 'active' && value === true))
  assert.ok(calls[0].filters.some(([key, value]) => key === 'available' && value === true))
  assert.deepEqual(variants, [variant])
  assert.deepEqual(await loadPublicVariants(client, []), [])
})

test('public reader handles pagination, ID chunking and failures without synthetic variants', async () => {
  const { client, calls } = queryClient([{ data: Array(500).fill(variantRow), error: null }, { data: [variantRow], error: null }])
  assert.equal((await loadPublicVariants(client, [productId])).length, 501)
  assert.deepEqual(calls[1].range, [500, 999])
  const chunked = queryClient([])
  await loadPublicVariants(chunked.client, Array.from({ length: 101 }, (_, index) => String(index)))
  assert.deepEqual(chunked.calls.map((call) => call.ids.length), [100, 1])
  const failed = queryClient([{ data: null, error: new Error('RLS/network failure') }])
  await assert.rejects(loadPublicVariants(failed.client, [productId]), /RLS\/network failure/)
})

test('trusted label diagnostics count identities before eligibility but never authorize cart migration', () => {
  const state = restoreCartState({ items: [{ productId, size: ' 50ML ', quantity: 1 }] }, 1)
  const second = { ...variant, id: secondVariantId, optionValue: '50ml' }
  for (const patch of [{}, { available: false }, { active: false }, { stockQuantity: 0 }]) {
    const catalog = [{ ...product, variants: [{ ...variant, ...patch }, second] }]
    const result = reconcileCartState(state, catalog)
    assert.equal(legacyVariant(catalog[0], state.items[0].size), undefined)
    assert.equal(result.items[0].variantId, null)
    assert.equal(resolveCartItem(result.items[0], catalog).lineAmount, null)
  }
  for (const patch of [{}, { available: false }, { active: false }, { stockQuantity: 0 }]) {
    const catalog = [{ ...product, variants: [{ ...variant, ...patch }] }]
    const result = reconcileCartState(state, catalog)
    assert.equal(legacyVariant(catalog[0], state.items[0].size).id, variantId)
    assert.equal(result.items[0].variantId, null)
    assert.equal(resolveCartItem(result.items[0], catalog).eligible, false)
  }
  assert.equal(reconcileCartState(state, [{ ...product, variants: [] }]).items[0].variantId, null)
  // The real public RLS may hide a second matching identity. Never infer uniqueness.
  assert.equal(reconcileCartState(state, [{ ...product, variantIdentityScope: 'public' }]).items[0].variantId, null)
  assert.equal(reconcileCartState(state, [{ ...product, variantIdentityScope: undefined }]).items[0].variantId, null)
})

test('v1 legacy survives v2 reload; malformed or missing v2 canonical identity never remaps by size', () => {
  const storage = memoryStorage({ version: 1, state: { items: [{ productId, size: '50ml', quantity: 2 }] } })
  let store = createCartStore(storage)
  assert.equal(store.getState().items[0].identity, 'legacy')
  store = createCartStore(storage)
  store.getState().reconcile([product])
  assert.equal(store.getState().items[0].variantId, null)
  for (const fields of [{ variantId: 'broken-id' }, { variantId: '' }, { variantId: null }, {}]) {
    const badStorage = memoryStorage({ version: 2, state: {
      items: [{ lineId: 'corrupted', productId, size: '50ml', quantity: 2, ...fields }], selectedLineIds: ['corrupted'],
    } })
    const badStore = createCartStore(badStorage)
    badStore.getState().reconcile([product])
    badStore.getState().reconcile([product])
    assert.equal(badStore.getState().items[0].variantId, null)
    assert.equal(badStore.getState().items[0].identity, 'corrupt')
    assert.equal(resolveCartItem(badStore.getState().items[0], [product]).lineAmount, null)
    assert.equal(createCartStore(badStorage).getState().items[0].identity, 'corrupt')
  }
})

test('v1 public legacy policy preserves the line across reload/refresh, blocks purchase, allows explicit re-add and removal', () => {
  const storage = memoryStorage({ version: 1, state: {
    items: [{ productId, size: '50ml', quantity: 2 }], selectedLineIds: [JSON.stringify([productId, '50ml'])],
  } })
  const store = createCartStore(storage)
  const publicProduct = { ...product, variantIdentityScope: 'public' }
  const original = store.getState().items[0]
  store.getState().reconcile([publicProduct])
  const line = store.getState().items[0]
  assert.deepEqual(line, original)
  assert.equal(line.identity, 'legacy')
  assert.equal(line.variantId, null)
  assert.equal(line.quantity, 2)
  assert.equal(resolveCartItem(line, [publicProduct]).eligible, false)
  assert.equal(resolveCartItem(line, [publicProduct]).lineAmount, null)
  assert.match(resolveCartItem(line, [publicProduct]).message, /Requires reselection/)
  assert.equal(canSubmitLegacyCart([line]), false)
  assert.equal(store.getState().updateQuantity(line.lineId, 1, [publicProduct]), false)
  assert.deepEqual(createCartStore(storage).getState().items, [line])
  assert.equal(store.getState().addItem(publicProduct, variantId), true)
  assert.deepEqual(store.getState().items.map((item) => [item.variantId, item.quantity]), [[null, 2], [variantId, 1]])
  store.getState().removeItem(line.lineId)
  assert.deepEqual(store.getState().items.map((item) => [item.variantId, item.quantity]), [[variantId, 1]])
  assert.deepEqual(createCartStore(storage).getState().items, store.getState().items)
})

test('legacy and corrupt identity markers cannot authorize purchase even when supplied a valid matching UUID', () => {
  for (const identity of ['legacy', 'corrupt']) {
    const item = { lineId: identity, identity, productId, variantId, size: '50ml', quantity: 1 }
    assert.equal(resolveCartItem(item, [product]).eligible, false)
    assert.equal(resolveCartItem(item, [product]).lineAmount, null)
    assert.deepEqual(reconcileCartState({ items: [item], selectedLineIds: [identity] }, [product]).items, [item])
  }
})

test('repeated public reconciliation of mixed legacy, malformed and hidden canonical lines never writes or substitutes UUIDs', () => {
  const hiddenId = JSON.stringify([productId, secondVariantId])
  const storage = memoryStorage({ version: 1, state: { items: [
    { productId, size: '50ml', quantity: 2 },
    { productId, variantId: 'broken', size: '50ml', quantity: 3 },
    { lineId: hiddenId, productId, variantId: secondVariantId, size: '50ml', quantity: 4 },
  ] } })
  let writes = 0, notifications = 0
  const store = createCartStore({ ...storage, setItem(key, value) { writes++; storage.setItem(key, value) } })
  const before = store.getState()
  const persisted = storage.getItem()
  writes = 0
  const unsubscribe = store.subscribe(() => notifications++)
  for (let i = 0; i < 5; i++) store.getState().reconcile([{ ...product, variantIdentityScope: 'public' }])
  assert.equal(store.getState(), before)
  assert.deepEqual(before.items.map((item) => [item.identity, item.variantId, item.quantity]),
    [['legacy', null, 2], ['corrupt', null, 3], ['canonical', secondVariantId, 4]])
  assert.equal(writes, 0)
  assert.equal(notifications, 0)
  assert.equal(storage.getItem(), persisted)
  assert.equal(before.selectedLineIds.length, 3)
  unsubscribe()
})

test('missing and hidden canonical UUIDs are retained, excluded from amounts, then recover only the same UUID', () => {
  const store = createCartStore(memoryStorage())
  store.getState().addItem(product, variantId, 2)
  for (const variants of [[], [{ ...variant, active: false }], [{ ...variant, available: false }],
    [{ ...variant, stockQuantity: 1 }], [{ ...variant, id: secondVariantId }]]) {
    const catalog = [{ ...product, variants }]
    store.getState().reconcile(catalog)
    const item = store.getState().items[0]
    assert.equal(item.variantId, variantId)
    assert.equal(item.quantity, 2)
    assert.equal(resolveCartItem(item, catalog).lineAmount, null)
    assert.equal(resolveCartItem(item, catalog).unitPrice, 0)
    assert.equal(canSubmitLegacyCart([item]), false)
  }
  assert.equal(resolveCartItem(store.getState().items[0], [product]).lineAmount, 5800)
})

test('corrupted persisted line keys cannot collide with or merge into a later explicit UUID add', () => {
  const canonicalKey = JSON.stringify([productId, variantId])
  const storage = memoryStorage({ version: 2, state: { items: [{ lineId: canonicalKey,
    productId, variantId: 'malformed', size: '50ml', quantity: 2 }], selectedLineIds: [canonicalKey] } })
  const store = createCartStore(storage)
  store.getState().reconcile([product])
  store.getState().addItem(product, variantId)
  assert.deepEqual(store.getState().items.map((item) => [item.variantId, item.quantity]), [[null, 2], [variantId, 1]])
  assert.equal(store.getState().items[0].identity, 'corrupt')
  assert.deepEqual(createCartStore(storage).getState().items, store.getState().items)
})

test('repeated reconciliation produces zero subscriber and persistence writes for identical contents', () => {
  let writes = 0, notifications = 0
  const storage = memoryStorage()
  const store = createCartStore({ ...storage, setItem(key, value) { writes++; storage.setItem(key, value) } })
  store.getState().addItem(product, variantId, 2)
  const snapshot = store.getState()
  const persisted = storage.getItem()
  writes = 0
  const unsubscribe = store.subscribe(() => notifications++)
  for (let i = 0; i < 5; i++) store.getState().reconcile([structuredClone(product)])
  assert.equal(store.getState(), snapshot)
  assert.equal(writes, 0)
  assert.equal(notifications, 0)
  assert.equal(storage.getItem(), persisted)
  assert.deepEqual(store.getState().selectedLineIds, snapshot.selectedLineIds)
  unsubscribe()
})

test('catalog failure preserves the previous products, while a successful empty catalog replaces them', () => {
  const previous = { products: [product] }
  const failed = applyCatalogRefresh(previous, { products: [], catalogLoad: { status: 'failed', error: 'query failed' } })
  assert.equal(failed.products, previous.products)
  assert.deepEqual(applyCatalogRefresh(previous, { products: [], catalogLoad: { status: 'success' } }).products, [])
})
