import { createAuthConfig } from '../auth/config.js'

export function validateRuntimeEnv() {
  const errors = []
  let authConfig

  const prototypeAdmin = process.env.NODE_ENV !== 'production' &&
    (process.env.ADMIN_AUTH_PROVIDER ?? 'prototype') === 'prototype'
  if (prototypeAdmin && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
    errors.push('JWT_SECRET must be at least 32 characters.')
  }

  try {
    authConfig = createAuthConfig(process.env)
  } catch (error) {
    errors.push(error.message)
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.join(' ')}`)
  }
  return authConfig
}
