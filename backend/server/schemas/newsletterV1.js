import { z } from 'zod'

export const subscriberIdSchema = z.uuid()
export const newsletterEmailSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).email(),
})
export const newsletterListSchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(80).regex(/^[\p{L}\p{N}@._+-]*$/u).optional(),
})
