import 'dotenv/config'
import { createAuthConfig } from '../auth/config.js'

const required = [
  'CLIENT_ORIGIN',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'CUSTOMER_AUTH_PROVIDER',
  'ADMIN_AUTH_PROVIDER',
  'ENABLE_GUEST_ORDER_LINKING',
  'ENABLE_ADMIN_MFA',
  'AUTH_CSRF_SECRET',
  'AUTH_CALLBACK_URL',
  'AUTH_SECURE_COOKIES',
  'AUTH_TRUST_PROXY',
  'AUTH_ALLOW_DEV_LOOPBACK',
]

const optionalRecommended = [
  'SANITY_API_TOKEN',
  'SENTRY_DSN',
  'RESEND_API_KEY',
]

const missing = required.filter((key) => !process.env[key])
const weak = []

try {
  createAuthConfig({ ...process.env, NODE_ENV: 'production' })
} catch (error) {
  weak.push(error.message)
}

if (missing.length || weak.length) {
  console.error('Production environment is not ready.')
  if (missing.length) console.error(`Missing: ${missing.join(', ')}`)
  for (const issue of weak) console.error(issue)
  process.exit(1)
}

const optionalMissing = optionalRecommended.filter((key) => !process.env[key])
console.log('Required production environment variables are present.')
if (optionalMissing.length) {
  console.log(`Recommended but missing: ${optionalMissing.join(', ')}`)
}
