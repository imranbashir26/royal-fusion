import { readDb } from '../utils/database.js'

const db = await readDb()

assert(Array.isArray(db.products) && db.products.length > 0, 'products are seeded')
assert(Array.isArray(db.categories) && db.categories.length >= 10, 'default categories are seeded')
assert(Array.isArray(db.coupons), 'coupons collection exists')
assert(Array.isArray(db.orders), 'orders collection exists')
assert(Array.isArray(db.users), 'users collection exists')
assert(db.settings?.brandName, 'website settings exist')
assert(db.shipping?.defaultShippingFee >= 0, 'shipping settings exist')
assert(Array.isArray(db.payments) && db.payments.length > 0, 'payment settings exist')
assert(Array.isArray(db.seo), 'SEO settings exist')

const hasCommittedPassword = db.users.some((user) => 'password' in user)
assert(!hasCommittedPassword, 'plain text passwords are not stored')

console.log('Royal Fusion API smoke checks passed.')

function assert(condition, message) {
  if (!condition) {
    console.error(`Smoke test failed: ${message}`)
    process.exit(1)
  }
}
