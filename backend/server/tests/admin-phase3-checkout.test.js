import assert from 'node:assert/strict'
import test from 'node:test'
import { CouponsService } from '../services/adminPhase3Service.js'
import { CheckoutQuoteService } from '../services/checkoutQuoteService.js'
import { phase3CheckoutDatabase } from './support/phase3CheckoutDatabase.js'

const input = { code: 'PARENT10', type: 'Percentage', discountValue: 10, minimumOrderAmount: 0, maxDiscountAmount: null, description: '', startDate: null, endDate: null, usageLimit: 10, perCustomerUsageLimit: 0, status: 'Active' }
async function fixture(t) {
  const f = await phase3CheckoutDatabase(); t.after(() => f.db.close())
  f.service = new CouponsService(f.client); f.actorContext = { userId: f.actor, requestId: 'phase3-quote-regression' }
  f.coupon = await f.service.create(input, f.actorContext)
  return f
}
const config = row => Object.fromEntries([...Object.keys(input).filter(key => !['code', 'type'].includes(key)).map(key => [key, row[key]]), ['expectedUpdatedAt', row.updatedAt]])

test('admin-created coupons feed unchanged V1/V2 rounding, caps, fixed and free-shipping calculations', async t => {
  const f = await fixture(t), v1 = new CheckoutQuoteService(f.client)
  const raw = { items: [{ variantId: f.variant, quantity: 1 }], shipping: { city: 'Karachi', province: 'Sindh' }, email: 'fixture@example.invalid', couponCode: input.code }
  assert.equal((await v1.quote(raw)).discount, 25)
  assert.equal((await f.quote(input.code)).discount, 45)
  const capped = await f.service.update(f.coupon.id, { ...config(f.coupon), discountValue: 12.5, maxDiscountAmount: 30 }, f.actorContext)
  assert.equal((await v1.quote(raw)).discount, 30); assert.equal((await f.quote(input.code)).discount, 30)
  for (const [type, discountValue, code, discount, shipping] of [['Fixed Amount', 1000, 'FIXED', 450, 250], ['Free Shipping', 0, 'SHIP', 0, 0]]) {
    await f.service.create({ ...input, type, discountValue, code }, f.actorContext)
    const q = await f.quote(code); assert.equal(q.discount, discount); assert.equal(q.shippingFee, shipping); assert.ok(q.total >= 0); assert.equal(q.orderingEnabled, false)
  }
  assert.equal(capped.usedCount, 0); assert.equal((await f.db.query('select count(*) from orders')).rows[0].count, 0)
  assert.equal((await f.db.query('select stock_quantity from product_variants')).rows[0].stock_quantity, 12)
})

test('unchanged V2 engine discounts monetary pack parents/categories, never physical tester components', async t => {
  const f = await fixture(t)
  await f.db.query('insert into coupon_products(coupon_id,product_id) values($1,$2)', [f.coupon.id, f.parent])
  await f.db.query('insert into coupon_categories(coupon_id,category_id) values($1,$2)', [f.coupon.id, f.parentCategory])
  assert.equal((await f.quote(input.code)).discount, 45)
  const updated = await f.service.update(f.coupon.id, { ...config(f.coupon), discountValue: 20 }, f.actorContext)
  assert.equal((await f.quote(input.code)).discount, 90)
  assert.deepEqual((await f.service.detail(f.coupon.id)).productIds, [f.parent])
  await f.db.query('update coupon_categories set category_id=$2 where coupon_id=$1', [f.coupon.id, f.componentCategory])
  await assert.rejects(() => f.quote(input.code), /V2_INVALID_COUPON/)
  await f.db.query('update coupon_products set product_id=$2 where coupon_id=$1', [f.coupon.id, f.component])
  await assert.rejects(() => f.quote(input.code), /V2_INVALID_COUPON/)
  assert.equal((await f.quote(input.code, [{ kind: 'normal_variant', variantId: f.variant, quantity: 1 }])).discount, 50)
  assert.equal(updated.usedCount, 0)
})

test('admin deactivation, dates and usage limits remain enforced by unchanged checkout without inventory or redemption writes', async t => {
  const f = await fixture(t)
  let row = await f.service.update(f.coupon.id, { ...config(f.coupon), status: 'Inactive' }, f.actorContext)
  await assert.rejects(() => f.quote(input.code), /V2_INVALID_COUPON/)
  row = await f.service.update(row.id, { ...config(row), status: 'Active', endDate: '2000-01-01' }, f.actorContext)
  await assert.rejects(() => f.quote(input.code), /V2_INVALID_COUPON/)
  row = await f.service.update(row.id, { ...config(row), endDate: null, usageLimit: 1 }, f.actorContext)
  await f.db.query('update coupons set used_count=1 where id=$1', [row.id])
  await assert.rejects(() => f.quote(input.code), /V2_INVALID_COUPON/)
  assert.equal((await f.db.query('select stock_quantity from product_variants')).rows[0].stock_quantity, 12)
  assert.equal((await f.db.query('select count(*) from coupon_redemptions')).rows[0].count, 0)
  assert.equal((await f.db.query('select count(*) from orders')).rows[0].count, 0)
})
