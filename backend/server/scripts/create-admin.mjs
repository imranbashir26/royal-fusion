import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { updateDb, nowIso } from '../utils/database.js'

const args = parseArgs(process.argv.slice(2))

const email = args.email || process.env.ADMIN_EMAIL
const password = args.password || process.env.ADMIN_PASSWORD
const name = args.name || process.env.ADMIN_NAME || 'Royal Fusion Owner'
const role = args.role || 'Owner/Admin'

if (!email || !password) {
  console.error('Usage: npm run admin:create -- --email owner@example.com --password "StrongPassword123!" --name "Owner Name"')
  process.exit(1)
}

if (password.length < 8) {
  console.error('Password must be at least 8 characters.')
  process.exit(1)
}

await updateDb(async (db) => {
  const existing = db.users.find((user) => user.email.toLowerCase() === email.toLowerCase())
  if (existing) {
    existing.name = name
    existing.role = role
    existing.status = 'Active'
    existing.passwordHash = await bcrypt.hash(password, 12)
    existing.updatedAt = nowIso()
    console.log(`Updated admin user: ${email}`)
    return
  }

  db.users.push({
    id: `user-${Date.now()}`,
    name,
    email,
    role,
    status: 'Active',
    passwordHash: await bcrypt.hash(password, 12),
    createdAt: nowIso(),
    updatedAt: nowIso()
  })
  console.log(`Created admin user: ${email}`)
})

function parseArgs(rawArgs) {
  return rawArgs.reduce((acc, value, index) => {
    if (value.startsWith('--')) {
      const key = value.slice(2)
      acc[key] = rawArgs[index + 1]
    }
    return acc
  }, {})
}
