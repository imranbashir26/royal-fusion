import { z } from 'zod'

export const finderPreferenceKeySchema = z.enum(['fresh', 'sweet', 'woody', 'oud', 'spicy', 'floral'])

export const updateFinderPreferenceSchema = z.object({
  productId: z.string().uuid().nullable(),
  active: z.boolean(),
}).strict()
