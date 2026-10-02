import { z } from 'zod'

const text = (min, max) => z.string().trim().min(min).max(max).refine((value) => !/[<>\u0000]/.test(value))
const uuid = z.uuid().transform((value) => value.toLowerCase())
export const paymentMethods = ['Cash on Delivery', 'Bank Transfer']
const item = z.strictObject({ variantId: uuid, quantity: z.number().int().min(1).max(99) })
export function aggregateItems(items) {
  const grouped = new Map()
  for (const item of items) grouped.set(item.variantId, (grouped.get(item.variantId) ?? 0) + item.quantity)
  return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([variantId, quantity]) => ({ variantId, quantity }))
}
const items = z.array(item).min(1).max(100).superRefine((value, ctx) => {
  if (aggregateItems(value).some((item) => item.quantity > 99)) ctx.addIssue({ code: 'custom', message: 'Aggregated quantity exceeds 99.', path: ['quantity'] })
}).transform(aggregateItems)
const email = z.string().trim().toLowerCase().max(254).pipe(z.email())
const couponCode = text(0, 40).regex(/^[A-Za-z0-9_-]*$/).transform((value) => value.toUpperCase()).default('')
export const orderRequestSchema = z.strictObject({
  idempotencyKey: uuid,
  items,
  contact: z.strictObject({ name: text(2, 120), email, phone: text(7, 40) }),
  shipping: z.strictObject({ address: text(4, 500), city: text(2, 100), province: text(2, 100), notes: text(0, 1000).default('') }),
  paymentMethod: z.enum(paymentMethods),
  couponCode,
})
export const quoteRequestSchema = z.strictObject({
  items,
  shipping: z.strictObject({ city: text(2, 100), province: text(2, 100) }),
  email: z.union([email, z.literal('')]).default(''),
  couponCode,
})

export function parseCheckout(schema, body) {
  const result = schema.safeParse(body)
  if (result.success) return result.data
  const paths = result.error.issues.map((issue) => issue.path.join('.'))
  let code = 'INVALID_CHECKOUT_REQUEST'
  if (paths.some((path) => path === 'paymentMethod')) code = 'INVALID_PAYMENT_METHOD'
  else if (paths.some((path) => path.startsWith('shipping.'))) code = 'INVALID_SHIPPING_INFORMATION'
  else if (paths.some((path) => path.includes('variantId'))) code = 'INVALID_VARIANT_ID'
  else if (paths.some((path) => path.includes('quantity'))) code = 'INVALID_QUANTITY'
  throw Object.assign(new Error('Please check your checkout information.'), { status: 400, code })
}
