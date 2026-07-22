import 'dotenv/config'

const required = [
  'CLIENT_ORIGIN',
  'JWT_SECRET',
  'ADMIN_SETUP_KEY',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VITE_SANITY_PROJECT_ID',
  'VITE_SANITY_DATASET',
  'VITE_SANITY_API_VERSION',
]

const optionalRecommended = [
  'SANITY_API_TOKEN',
  'SENTRY_DSN',
  'RESEND_API_KEY',
]

const missing = required.filter((key) => !process.env[key])
const weak = []

if ((process.env.JWT_SECRET ?? '').length < 32) weak.push('JWT_SECRET must be at least 32 characters.')
if ((process.env.ADMIN_SETUP_KEY ?? '').length < 24) weak.push('ADMIN_SETUP_KEY must be at least 24 characters.')
if ((process.env.CLIENT_ORIGIN ?? '').includes('localhost')) {
  weak.push('CLIENT_ORIGIN must be the production origin, not localhost.')
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
