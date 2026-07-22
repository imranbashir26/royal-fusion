import 'dotenv/config'
import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { authRouter } from './routes/auth.js'
import { adminRouter } from './routes/admin.js'
import { mediaRouter } from './routes/media.js'
import { publicRouter } from './routes/public.js'
import { updateDb, nowIso } from './utils/database.js'
import { validateRuntimeEnv } from './utils/env.js'
import { sanitizeBody } from './utils/sanitize.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const port = Number(process.env.PORT || 4177)

validateRuntimeEnv()

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}))
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true)
    if (process.env.CLIENT_ORIGIN?.split(',').includes(origin)) return callback(null, true)
    if (/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) return callback(null, true)
    return callback(new Error('Origin not allowed by CORS.'))
  },
  credentials: false
}))
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 400,
  standardHeaders: true,
  legacyHeaders: false
}))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use(sanitizeBody)
app.use('/uploads', express.static(path.resolve(__dirname, 'uploads')))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'royal-fusion-api' })
})

app.use('/api/public', publicRouter)
app.use('/api/admin/auth', authRouter)
app.use('/api/admin/media', mediaRouter)
app.use('/api/admin', adminRouter)

app.use((error, _req, res, _next) => {
  const status = error.status || 500
  const message = status >= 500 ? 'Something went wrong. Please try again.' : error.message
  if (status >= 500) console.error(error)
  res.status(status).json({ message })
})

await maybeCreateFirstAdmin()

app.listen(port, () => {
  console.log(`Royal Fusion API running on http://127.0.0.1:${port}`)
})

async function maybeCreateFirstAdmin() {
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) return

  await updateDb(async (db) => {
    if (db.users.length > 0) return
    db.users.push({
      id: 'user-owner',
      name: process.env.ADMIN_NAME || 'Royal Fusion Owner',
      email,
      role: 'Owner/Admin',
      status: 'Active',
      passwordHash: await bcrypt.hash(password, 12),
      createdAt: nowIso(),
      updatedAt: nowIso()
    })
  })
}
