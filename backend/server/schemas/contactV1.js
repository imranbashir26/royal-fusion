import { z } from 'zod'

const text = (min, max) => z.string().trim().min(min).max(max)
  .refine(value => !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), 'Invalid text.')
export const contactIdSchema = z.uuid()
export const publicContactSchema = z.strictObject({
  name: text(2, 80),
  email: z.string().trim().pipe(z.email().max(254)).transform(value => value.toLowerCase()),
  phone: z.string().trim().max(32).regex(/^[+\d ()-]*$/).default(''),
  message: text(10, 4000),
})
export const contactListSchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(['Read', 'Unread']).optional(),
})
export const contactStatusSchema = z.strictObject({ status: z.enum(['Read', 'Unread']) })
