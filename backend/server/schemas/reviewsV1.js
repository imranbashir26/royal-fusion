import { z } from 'zod'

const uuid = z.uuid()
const plainText = (min, max) => z.string().trim().min(min).max(max)
  .refine((value) => !/[<>]/.test(value), 'HTML is not allowed.')

export const reviewIdSchema = uuid
export const publicReviewSchema = z.strictObject({
  productId: uuid,
  name: plainText(2, 80),
  city: plainText(0, 80).default(''),
  rating: z.number().int().min(1).max(5),
  text: plainText(10, 2000),
})
export const adminReviewListSchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(['Pending', 'Approved', 'Rejected']).optional(),
  productId: uuid.optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  search: z.string().trim().max(80).regex(/^[\p{L}\p{N} '-]*$/u).optional(),
})
export const adminReviewUpdateSchema = z.strictObject({
  status: z.enum(['Pending', 'Approved', 'Rejected']),
  featured: z.boolean(),
})
