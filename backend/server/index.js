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
import { createAuthV1Router } from './routes/authV1.js'
import { createCustomerAccountV1Router } from './routes/customerAccountV1.js'
import { adminRouter } from './routes/admin.js'
import { createAdminProductsV1Router } from './routes/adminProductsV1.js'
import { createAdminCategoriesV1Router } from './routes/adminCategoriesV1.js'
import { createAdminCollectionsV1Router } from './routes/adminCollectionsV1.js'
import { createAdminMediaV1Router } from './routes/adminMediaV1.js'
import { createAdminFragranceFinderV1Router, createPublicFragranceFinderV1Router } from './routes/fragranceFinderV1.js'
import { createAdminReviewsV1Router, createPublicReviewsV1Router } from './routes/reviewsV1.js'
import { createAdminNewsletterV1Router, createPublicNewsletterV1Router } from './routes/newsletterV1.js'
import { createAdminSettingsV1Router } from './routes/settingsV1.js'
import { createOrdersV1Router } from './routes/ordersV1.js'
import { createAdminOrdersV1Router } from './routes/adminOrdersV1.js'
import { mediaRouter } from './routes/media.js'
import { publicRouter } from './routes/public.js'
import { updateDb, nowIso } from './utils/database.js'
import { validateRuntimeEnv } from './utils/env.js'
import { sanitizeBody } from './utils/sanitize.js'
import { createAuthRuntime } from './auth/runtime.js'
import { AUTH_ERROR_CODES } from './auth/contracts.js'
import { getAuthReadiness, isAllowedCorsOrigin } from './auth/config.js'
import {
  authErrorHandler,
  createRedactedRequestLogger,
  requestContext,
} from './middleware/authSecurity.js'
import {
  checkSupabaseConnectivity,
  getDatabaseProvider,
  isSupabaseConfigured,
} from './services/supabaseClient.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const port = Number(process.env.PORT || 4177)

const authConfig = validateRuntimeEnv()
const authRuntime = createAuthRuntime({ config: authConfig })
if (authConfig.trustProxy) app.set('trust proxy', 1)

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}))
app.use(requestContext)
if (authConfig.environment !== 'test') app.use(createRedactedRequestLogger())
app.use(cors({
  origin(origin, callback) {
    if (isAllowedCorsOrigin(origin, authConfig)) return callback(null, true)
    return callback(Object.assign(new Error('Origin not allowed by CORS.'), {
      status: 403,
      code: AUTH_ERROR_CODES.ORIGIN_NOT_ALLOWED,
    }))
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-RF-CSRF', 'X-Request-ID', 'Authorization'],
}))
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 400,
  standardHeaders: true,
  legacyHeaders: false
}))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use('/api/v1/auth', createAuthV1Router(authRuntime))
app.use('/api/v1/customer', createCustomerAccountV1Router(authRuntime))
app.use(sanitizeBody)
app.use('/api/v1/admin/products', createAdminProductsV1Router(authRuntime))
app.use('/api/v1/admin/categories', createAdminCategoriesV1Router(authRuntime))
app.use('/api/v1/admin/collections', createAdminCollectionsV1Router(authRuntime))
app.use('/api/v1/admin/media', createAdminMediaV1Router(authRuntime))
app.use('/api/v1/admin/fragrance-finder', createAdminFragranceFinderV1Router(authRuntime))
app.use('/api/v1/public/fragrance-finder', createPublicFragranceFinderV1Router(authRuntime))
app.use('/api/v1/admin/reviews', createAdminReviewsV1Router(authRuntime))
app.use('/api/v1/public/reviews', createPublicReviewsV1Router(authRuntime))
app.use('/api/v1/admin/newsletter', createAdminNewsletterV1Router(authRuntime))
app.use('/api/v1/public/newsletter', createPublicNewsletterV1Router(authRuntime))
app.use('/api/v1/admin/settings', createAdminSettingsV1Router(authRuntime))
  app.use('/api/v1/public', createOrdersV1Router(authRuntime))
  app.use('/api/v1/admin/orders', createAdminOrdersV1Router(authRuntime))
app.use('/api/v1/admin/products/:productId/media', createAdminMediaV1Router(authRuntime))
app.use('/uploads', express.static(path.resolve(__dirname, 'uploads')))

app.get('/api/health', async (_req, res) => {
  const authReadiness = getAuthReadiness(authConfig)
  res.json({
    status: 'ok',
    databaseProvider: getDatabaseProvider(),
    supabaseConfigured: isSupabaseConfigured(),
    supabaseConnectivity: await checkSupabaseConnectivity(),
    authenticationConfigured: authReadiness.configured,
    authenticationStatus: authReadiness.status,
  })
})

app.use('/api/public', publicRouter)
if (authConfig.environment !== 'production' && authConfig.adminProvider === 'prototype') {
  app.use('/api/admin/auth', authRouter)
  app.use('/api/admin/media', mediaRouter)
  app.use('/api/admin', adminRouter)
}

app.use(authErrorHandler(authConfig))
app.use((error, req, res, _next) => {
  const status = error.status || 500
  const message = status >= 500 ? 'Something went wrong. Please try again.' : error.message
  if (status >= 500) {
    console.error({
      event: 'http.error',
      requestId: req.requestId,
      path: req.path,
      status,
    })
  }
  res.status(status).json({ message, requestId: req.requestId })
})

await maybeCreateFirstAdmin(authConfig)

app.listen(port, () => {
  console.log(`Royal Fusion API running on http://127.0.0.1:${port}`)
})

async function maybeCreateFirstAdmin(config) {
  if (config.environment === 'production' || config.adminProvider !== 'prototype') return
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
