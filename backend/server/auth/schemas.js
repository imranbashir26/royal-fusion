import { z } from 'zod'

const email = z.string().trim().email().max(254)
const password = z.string().min(8).max(256)

export const authSchemas = Object.freeze({
  signUp: z.object({
    email,
    password,
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(40).optional().default(''),
  }).strict(),
  signIn: z.object({ email, password }).strict(),
  adminSignIn: z.object({
    email,
    password,
    verificationCode: z.string().regex(/^\d{6}$/).optional(),
  }).strict(),
  forgotPassword: z.object({ email }).strict(),
  resetPassword: z.object({ newPassword: password }).strict(),
  resendVerification: z.object({ email }).strict(),
})

export function validateAuthBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The submitted information is invalid.',
          requestId: req.requestId,
          fields: [...new Set(result.error.issues.map((issue) => issue.path.join('.')))],
        },
      })
    }
    req.body = result.data
    next()
  }
}
