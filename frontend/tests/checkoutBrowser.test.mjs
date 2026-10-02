import assert from 'node:assert/strict'
import { test } from 'node:test'
import { productId, variantId, secondVariantId } from './variantFixtures.mjs'
import { pageFixture, storedCart, origin, otherId } from './support/variantBrowserHarness.mjs'

const lineId = JSON.stringify([productId, variantId])
const cart = () => ({ version: 2, state: { items: [
  { lineId, productId, variantId, identity: 'canonical', size: '50 ml', quantity: 2 },
  { lineId: JSON.stringify([otherId, secondVariantId]), productId: otherId, variantId: secondVariantId, identity: 'canonical', size: '100 ml', quantity: 1 },
], selectedLineIds: [lineId] } })
async function fill(page) {
  for (const [label, value] of [['Full Name', 'Fictional Customer'], ['Email', 'customer@example.invalid'], ['Phone', '00000000000'], ['Address', 'Fictional Address'], ['City', 'Lahore'], ['Province / Region', 'Punjab']]) {
    await page.getByLabel(label, { exact: true }).fill(value)
  }
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find((button) => button.textContent.includes('Place Order'))?.disabled)
}

test('rendered quote, double submission guard, purchased quantity consumption and success refresh', { timeout: 90000 }, async (t) => {
  let release
  const checkout = { pending: new Promise((resolve) => { release = resolve }) }
  const { page, orders } = await pageFixture(t, { legacy: cart(), checkout })
  await page.goto(`${origin}/checkout`)
  await page.getByRole('heading', { name: 'Order Summary', exact: true }).waitFor()
  assert.equal(orders.length, 0)
  assert.equal(await page.getByRole('button', { name: 'Place Order' }).isDisabled(), true)
  await fill(page)
  assert.match(await page.locator('aside').innerText(), /6,577/)
  await page.locator('main form').evaluate((form) => {
    for (let i = 0; i < 2; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await page.getByRole('heading', { name: 'Saved checkout attempt' }).waitFor()
  await page.evaluate(async () => {
    const { useCartStore } = await import('/src/store/cartStore.ts')
    useCartStore.setState((state) => ({ items: state.items.map((item) => item.quantity === 2 ? { ...item, quantity: 3 } : item) }))
  })
  release()
  await page.getByRole('heading', { name: /Thank you/ }).waitFor()
  assert.equal(orders.length, 1)
  assert.deepEqual(orders[0].items, [{ variantId, quantity: 2 }])
  assert.equal('total' in orders[0], false); assert.equal('subtotal' in orders[0], false)
  const after = (await storedCart(page)).state.items
  assert.deepEqual(after.map((item) => item.quantity), [1, 1])
  assert.match(await page.locator('main').innerText(), /RF-20261002-1234ABCD/)
  assert.doesNotMatch(await page.locator('main').innerText(), /80000000-0000/)
  await page.reload(); await page.getByRole('heading', { name: /Thank you/ }).waitFor()
  assert.deepEqual((await storedCart(page)).state.items, after)
})
test('rendered lost response recovers frozen token after refresh with hidden catalog variant', { timeout: 90000 }, async (t) => {
  const checkout = { mode: 'network' }
  const { page, orders, catalog } = await pageFixture(t, { legacy: cart(), checkout })
  await page.goto(`${origin}/checkout`); await fill(page)
  await page.getByRole('button', { name: 'Place Order' }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(orders.length, 1)
  const before = (await storedCart(page)).state.items
  catalog.variants = []
  await page.reload()
  await page.getByRole('heading', { name: 'Saved checkout attempt' }).waitFor()
  checkout.mode = 'success'
  await page.getByRole('button', { name: 'Retry saved attempt' }).click()
  await page.getByRole('heading', { name: /Thank you/ }).waitFor()
  assert.deepEqual(orders[1], orders[0])
  assert.equal(before[0].variantId, variantId)
  assert.deepEqual((await storedCart(page)).state.items.map((item) => item.productId), [otherId])
})
test('rendered malformed receipt and stock failure never consume cart', { timeout: 90000 }, async (t) => {
  for (const mode of ['malformed', 'stock']) {
    const { page, orders } = await pageFixture(t, { legacy: cart(), checkout: { mode } })
    await page.goto(`${origin}/checkout`); await fill(page)
    const before = (await storedCart(page)).state.items
    await page.getByRole('button', { name: 'Place Order' }).click()
    await page.getByRole('alert').waitFor()
    assert.deepEqual((await storedCart(page)).state.items, before)
    assert.equal(orders.length, 1)
  }
})
test('rendered unresolved cart types make zero order calls, and direct success is safe', { timeout: 90000 }, async (t) => {
  for (const kind of ['legacy', 'corrupt', 'missing']) {
    const saved = cart(); saved.state.items = [saved.state.items[0]]
    if (kind === 'legacy') { saved.version = 1; delete saved.state.items[0].variantId; delete saved.state.items[0].identity }
    if (kind === 'corrupt') saved.state.items[0].variantId = 'bad'
    if (kind === 'missing') saved.state.items[0].variantId = '90000000-0000-4000-8000-000000000009'
    const { page, orders } = await pageFixture(t, { legacy: saved, checkout: {} })
    await page.goto(`${origin}/checkout`)
    await page.getByRole('heading', { name: 'Order Summary', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Place Order' }).isDisabled(), true)
    await page.locator('main form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await page.getByRole('alert').waitFor(); assert.equal(orders.length, 0)
    await page.goto(`${origin}/checkout/success`)
    await page.getByRole('heading', { name: 'No order confirmation is available' }).waitFor()
    assert.equal(orders.length, 0)
  }
})

test('rendered production availability fence disables submit without freezing an intent', { timeout: 90000 }, async (t) => {
  const checkout = { orderingEnabled: false }
  const { page, orders } = await pageFixture(t, { legacy: cart(), checkout })
  await page.goto(`${origin}/checkout`)
  for (const [label, value] of [['Full Name', 'Fictional Customer'], ['Email', 'customer@example.invalid'], ['Phone', '00000000000'], ['Address', 'Fictional Address'], ['City', 'Lahore'], ['Province / Region', 'Punjab']]) await page.getByLabel(label, { exact: true }).fill(value)
  await page.getByText('Ordering is temporarily unavailable. Your cart has been saved.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Place Order' }).isDisabled(), true)
  await page.locator('main form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await page.getByRole('alert').waitFor()
  assert.equal(orders.length, 0)
  assert.equal(await page.evaluate(() => sessionStorage.getItem('royal-fusion-checkout-intent-v1')), null)
})

test('rendered historical receipt never blocks the next checkout or consumes its later same-variant cart', { timeout: 90000 }, async (t) => {
  const { page, orders } = await pageFixture(t, { legacy: cart(), checkout: {} })
  await page.goto(`${origin}/checkout`); await fill(page); await page.getByRole('button', { name: 'Place Order' }).click()
  await page.getByRole('heading', { name: /Thank you/ }).waitFor()
  const first = orders[0]
  // Navigate through the header/route, deliberately skipping Continue shopping.
  await page.goto(`${origin}/shop`)
  await page.getByRole('button', { name: 'Add Baraan to cart', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Add Baraan to cart', exact: true }).click()
  await page.getByRole('button', { name: 'Close cart', exact: true }).click()
  const before = (await storedCart(page)).state.items
  for (let n = 0; n < 2; n++) {
    await page.goto(`${origin}/checkout/success`); await page.getByRole('heading', { name: /Thank you/ }).waitFor()
    await page.reload(); await page.getByRole('heading', { name: /Thank you/ }).waitFor()
    assert.deepEqual((await storedCart(page)).state.items, before)
  }
  await page.goto(`${origin}/checkout`); await page.getByRole('heading', { name: 'Order Summary', exact: true }).waitFor()
  await fill(page); await page.getByRole('button', { name: 'Place Order' }).click()
  await page.getByRole('heading', { name: /Thank you/ }).waitFor()
  assert.equal(orders.length, 2); assert.notEqual(orders[1].idempotencyKey, first.idempotencyKey)
  assert.equal((await storedCart(page)).state.items.some((item) => item.variantId === variantId), false)
})
test('rendered second tab cannot erase completion protection or let an old success page consume its new cart', { timeout: 90000 }, async (t) => {
  const { page, orders } = await pageFixture(t, { legacy: cart(), checkout: {} })
  await page.goto(`${origin}/checkout`); await fill(page)
  const second = await page.context().newPage()
  await second.goto(`${origin}/cart`); await second.getByRole('heading', { name: 'Baraan', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Place Order' }).click(); await page.getByRole('heading', { name: /Thank you/ }).waitFor()
  await second.evaluate(async () => {
    const { useCartStore } = await import('/src/store/cartStore.ts')
    const { mapProduct, mapProductVariant } = await import('/src/services/productionMappers.ts')
    const productId = '45852db8-8b83-425e-8d1f-4112958ed505', variantId = 'b35b3be7-a7dd-4c70-9c14-d1a9394d4711'
    const product = { ...mapProduct({ id: productId, name: 'Baraan', slug: 'baraan', price: 2900, active: true, status: 'Published' }), variants: [mapProductVariant({ id: variantId, product_id: productId, option_value: '50 ml', regular_price: 2900, sale_price: null, stock_quantity: 12, active: true, available: true })] }
    useCartStore.getState().clearCart(); useCartStore.getState().addItem(product, variantId, 3)
  })
  const before = (await storedCart(second)).state.items
  assert.equal(before[0].quantity, 3)
  await page.reload(); await page.getByRole('heading', { name: /Thank you/ }).waitFor()
  assert.deepEqual((await storedCart(page)).state.items, before); assert.equal(orders.length, 1)
})
test('rendered corrupted potentially submitted attempt stays in recovery and makes zero fresh order requests', { timeout: 90000 }, async (t) => {
  const { page, orders } = await pageFixture(t, { legacy: cart(), checkout: {} })
  await page.goto(`${origin}/cart`); await page.getByRole('heading', { name: 'Baraan', exact: true }).waitFor()
  await page.evaluate(() => sessionStorage.setItem('royal-fusion-checkout-intent-v1', '{unreadable'))
  await page.goto(`${origin}/checkout`); await page.getByRole('heading', { name: 'Saved checkout attempt' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Place Order' }).count(), 0)
  assert.match(await page.locator('main').innerText(), /may already have been submitted/)
  assert.equal(orders.length, 0); assert.equal((await storedCart(page)).state.items[0].quantity, 2)
})

test('browser without Web Locks blocks a fresh checkout before token creation or order transport', { timeout: 90000 }, async (t) => {
  const { page, orders } = await pageFixture(t, { legacy: cart(), checkout: {}, webLocks: false })
  await page.goto(`${origin}/checkout`)
  await page.getByRole('heading', { name: 'Order Summary', exact: true }).waitFor()
  const before = (await storedCart(page)).state.items
  for (const [label, value] of [['Full Name', 'Fictional Customer'], ['Email', 'customer@example.invalid'], ['Phone', '00000000000'], ['Address', 'Fictional Address'], ['City', 'Lahore'], ['Province / Region', 'Punjab']]) await page.getByLabel(label, { exact: true }).fill(value)
  await page.getByText('Checkout is unavailable in this browser. Your cart has been saved; no order was submitted.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Place Order' }).isDisabled(), true)
  await page.evaluate(() => {
    window.checkoutUUIDs = 0
    const original = crypto.randomUUID.bind(crypto)
    crypto.randomUUID = () => { window.checkoutUUIDs++; return original() }
  })
  await page.locator('main form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await page.getByRole('alert').waitFor()
  assert.equal(orders.length, 0); assert.equal(await page.evaluate(() => window.checkoutUUIDs), 0)
  assert.equal(await page.evaluate(() => sessionStorage.getItem('royal-fusion-checkout-intent-v1')), null)
  assert.deepEqual((await storedCart(page)).state.items, before)
})

test('browser without Web Locks preserves and retries an existing token, shows receipt recovery and never substitutes a token', { timeout: 90000 }, async (t) => {
  const { page, orders } = await pageFixture(t, { legacy: cart(), checkout: {}, webLocks: false })
  await page.goto(`${origin}/cart`); await page.getByRole('heading', { name: 'Baraan', exact: true }).waitFor()
  // Seed the actual persisted active-attempt format, representing a prior unknown outcome.
  const frozen = await page.evaluate(async () => {
    const { useCheckoutIntentStore } = await import('/src/store/checkoutIntentStore.ts')
    const { useCartStore } = await import('/src/store/cartStore.ts')
    const cart = useCartStore.getState(), variantId = 'b35b3be7-a7dd-4c70-9c14-d1a9394d4711'
    return useCheckoutIntentStore.getState().freeze({ items: [{ variantId, quantity: 2 }],
      contact: { name: 'Fictional Customer', email: 'customer@example.invalid', phone: '00000000000' },
      shipping: { address: 'Fictional Address', city: 'Lahore', province: 'Punjab', notes: '' }, paymentMethod: 'Cash on Delivery', couponCode: '' },
    cart.capturePurchase(cart.items.filter((item) => item.variantId === variantId).map(({ lineId, variantId, quantity }) => ({ lineId, variantId, quantity }))))
  })
  const before = (await storedCart(page)).state.items
  await page.goto(`${origin}/checkout`); await page.getByRole('heading', { name: 'Saved checkout attempt' }).waitFor()
  assert.match(await page.locator('main').innerText(), /Recovery required: checkout completion is unavailable/)
  assert.equal(await page.getByRole('button', { name: 'Start a new attempt' }).isDisabled(), true)
  await page.evaluate(() => {
    window.checkoutUUIDs = 0
    const original = crypto.randomUUID.bind(crypto)
    crypto.randomUUID = () => { window.checkoutUUIDs++; return original() }
  })
  await page.getByRole('button', { name: 'Retry saved attempt' }).click()
  await page.getByRole('alert').waitFor()
  assert.deepEqual(orders, [frozen.request]); assert.equal(await page.evaluate(() => window.checkoutUUIDs), 0)
  assert.match(await page.locator('main').innerText(), /Order received: RF-20261002-1234ABCD/)
  assert.deepEqual((await storedCart(page)).state.items, before)
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('royal-fusion-checkout-intent-v1')))
  assert.equal(saved.intent.request.idempotencyKey, frozen.request.idempotencyKey); assert.ok(saved.recovery)
  assert.equal(saved.pendingReceipt.idempotencyKey, frozen.request.idempotencyKey)
  await page.reload(); await page.getByRole('heading', { name: 'Saved checkout attempt' }).waitFor()
  await page.getByRole('button', { name: 'Retry saved attempt' }).click(); await page.getByRole('alert').waitFor()
  assert.deepEqual(orders, [frozen.request, frozen.request]); assert.deepEqual((await storedCart(page)).state.items, before)
})
