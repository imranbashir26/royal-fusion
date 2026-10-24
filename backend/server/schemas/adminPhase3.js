import { z } from 'zod'

const plain = max => z.string().trim().max(max).refine(v => !/[<>\u0000-\u001f\u007f]/.test(v))
const money = z.number().min(0).max(9999999999.99).refine(v => /^\d+(\.\d{1,2})?$/.test(String(v)))
const limit = z.number().int().min(0).max(2147483647)
const date = z.iso.date().refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}).nullable()
export const idSchema = z.uuid()
export const emptyQuerySchema = z.strictObject({})
export const listSchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(80).regex(/^[\p{L}\p{N}@._+ '-]*$/u).default(''),
})
export const couponConfigSchema = z.strictObject({
  discountValue: money, minimumOrderAmount: money, maxDiscountAmount: money.nullable(),
  startDate: date, endDate: date, usageLimit: limit, perCustomerUsageLimit: limit,
  status: z.enum(['Active', 'Inactive']), description: plain(500),
})
export const couponCreateSchema = couponConfigSchema.extend({
  code: z.string().trim().toUpperCase().min(2).max(40).regex(/^[A-Z0-9_-]+$/),
  type: z.literal('Percentage'),
})
export const couponUpdateSchema = couponConfigSchema.extend({ expectedUpdatedAt: z.iso.datetime({ offset: true }) })
export const seoPages = Object.freeze({ home: '/', shop: '/shop', collections: '/collections', attars: '/attars', about: '/about', contact: '/contact' })
export const seoKeySchema = z.enum(Object.keys(seoPages))
export const seoUpdateSchema = z.strictObject({
  title: plain(70), description: plain(160), canonicalUrl: z.string().trim().max(2048),
  ogTitle: plain(70), ogDescription: plain(160), ogImage: z.string().trim().max(2048),
  expectedUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
})
