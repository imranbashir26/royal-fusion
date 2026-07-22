const isProduction = process.env.NODE_ENV === 'production'

export function validateRuntimeEnv() {
  const errors = []

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters.')
  }

  if (isProduction) {
    if (!process.env.CLIENT_ORIGIN || process.env.CLIENT_ORIGIN.includes('localhost')) {
      errors.push('CLIENT_ORIGIN must be set to the production website origin.')
    }
    if (!process.env.ADMIN_SETUP_KEY || process.env.ADMIN_SETUP_KEY.length < 24) {
      errors.push('ADMIN_SETUP_KEY must be a private value of at least 24 characters.')
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.join(' ')}`)
  }
}
