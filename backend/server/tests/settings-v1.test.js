import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cookieParser from 'cookie-parser'
import express from 'express'
import test, { after } from 'node:test'
import { createAuthConfig } from '../auth/config.js'
import { getAuthCookieNames, getSessionCsrfToken } from '../auth/cookies.js'
import { authErrorHandler, requestContext } from '../middleware/authSecurity.js'
import { createAdminSettingsV1Router } from '../routes/settingsV1.js'
import { mapPublicSettingsRows } from '../../../frontend/src/services/publicSettingsMapper.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const origin = 'https://shop.example.invalid'
const config = createAuthConfig({
  NODE_ENV: 'test', CLIENT_ORIGIN: origin, AUTH_CSRF_SECRET: 'settings-contract-secret-1234567890',
  ADMIN_AUTH_PROVIDER: 'prototype', CUSTOMER_AUTH_PROVIDER: 'prototype', ENABLE_ADMIN_MFA: 'false',
})
const names = getAuthCookieNames(config)
const servers = []
after(async () => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))))

class Query {
  constructor(db, table) { this.db = db; this.table = table; this.filters = [] }
  select() { return this }
  eq(key, value) { this.filters.push((row) => row[key] === value); return this }
  in(key, values) { this.filters.push((row) => values.includes(row[key])); return this }
  maybeSingle() { return Promise.resolve({ data: this.db[this.table].find((row) => this.filters.every((filter) => filter(row))) ?? null, error: null }) }
  insert(row) { this.db[this.table].push(row); return Promise.resolve({ error: null }) }
  then(resolve, reject) { return Promise.resolve({ data: this.db[this.table].filter((row) => this.filters.every((filter) => filter(row))), error: null }).then(resolve, reject) }
}

async function start() {
  const db = {
    site_settings: [{ id: 'site', settings: { contactReceiverEmail: 'private@example.com', apiSecret: 'secret' }, homepage: {}, shipping: {}, payments: [
      { name: 'Cash on Delivery', active: true, internal: 'secret' },
      { name: 'Bank Transfer', active: true, accountNumber: 'secret' },
      { name: 'Card', active: true, token: 'secret' },
    ] }],
    public_site_settings: [
      { key: 'branding', value: { brandName: 'Royal Fusion', currency: 'PKR' }, active: true },
      { key: 'commerce', value: { announcementEnabled: true }, active: true },
    ],
    admin_audit_logs: [],
  }
  const client = {
    from: (table) => new Query(db, table),
    rpc: async (name, args) => {
      assert.equal(name, 'update_site_settings_section')
      if (args.p_section === 'payments') {
        for (const desired of args.p_patch) {
          const row = db.site_settings[0].payments.find((item) => item.name === desired.name)
          if (row) row.active = desired.active
          else db.site_settings[0].payments.push(desired)
        }
      } else Object.assign(db.site_settings[0][args.p_section], args.p_patch)
      for (const [key, patch] of Object.entries(args.p_public_rows)) {
        let row = db.public_site_settings.find((item) => item.key === key)
        if (!row) { row = { key, value: {}, active: true }; db.public_site_settings.push(row) }
        row.value = key === 'payments' ? patch : { ...row.value, ...patch }
      }
      return { error: null }
    },
  }
  const runtime = {
    config, repository: { client },
    sessionService: { restore: async ({ accessToken }) => {
      if (!accessToken) throw Object.assign(new Error('Authentication required'), { code: 'AUTH_REQUIRED' })
      return { record: { sessionClass: 'administrator', mfaAssurance: 'aal2' }, identity: { id: accessToken, assuranceLevel: 'aal2' } }
    } },
    adminAuthorization: { resolve: async (id) => ({ userId: id, permissions: id === 'manager' ? ['settings.manage'] : [] }) },
  }
  const app = express()
  app.use(requestContext)
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/v1/admin/settings', createAdminSettingsV1Router(runtime, { client, logger: { warn() {} } }))
  app.use(authErrorHandler(config))
  app.use((error, req, res, _next) => res.status(500).json({ error: { code: 'UNEXPECTED', requestId: req.requestId } }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  servers.push(server)
  return { base: `http://127.0.0.1:${server.address().port}/api/v1`, db }
}

async function request(api, route, { method = 'GET', actor, body, csrf = true, requestOrigin = origin } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (actor) {
    const token = getSessionCsrfToken('handle', config)
    headers.Cookie = `${names.access}=${actor}; ${names.refresh}=refresh; ${names.session}=handle; ${names.csrf}=${token}`
    if (csrf) headers['X-RF-CSRF'] = token
  }
  if (method !== 'GET' && requestOrigin) headers.Origin = requestOrigin
  const response = await fetch(`${api.base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}

const put = (api, section, body, options = {}) => request(api, `/admin/settings/${section}`, { method: 'PUT', actor: 'manager', body, ...options })

test('Admin Settings requires authenticated settings permission and CSRF/Origin on writes', async () => {
  const api = await start()
  assert.equal((await request(api, '/admin/settings')).status, 401)
  assert.equal((await request(api, '/admin/settings', { actor: 'denied' })).status, 403)
  assert.equal((await request(api, '/admin/settings/settings', { method: 'PUT', actor: 'denied', body: { brandName: 'Royal' } })).status, 403)
  assert.equal((await put(api, 'settings', { brandName: 'Royal' }, { csrf: false })).status, 403)
  assert.equal((await put(api, 'settings', { brandName: 'Royal' }, { requestOrigin: 'https://evil.invalid' })).status, 403)
  assert.equal(api.db.site_settings[0].settings.brandName, undefined)
})

test('validated settings patches preserve unrelated private values and public allowlist', async () => {
  const api = await start()
  const initial = await request(api, '/admin/settings', { actor: 'manager' })
  assert.equal(initial.status, 200)
  assert.equal(initial.body.data.settings.brandName, 'Royal Fusion')
  assert.equal(initial.body.data.settings.contactReceiverEmail, 'private@example.com')
  assert.equal(initial.body.data.settings.apiSecret, undefined)
  const result = await put(api, 'settings', {
    brandName: 'Royal Fusion Atelier', contactReceiverEmail: 'staff@example.com',
    whatsappNumber: '+92 321 1234567', announcementEnabled: false,
    announcementCtaUrl: '/shop',
  })
  assert.equal(result.status, 200)
  assert.equal(api.db.site_settings[0].settings.apiSecret, 'secret')
  assert.equal(api.db.site_settings[0].settings.contactReceiverEmail, 'staff@example.com')
  const rows = api.db.public_site_settings
  const publicValue = mapPublicSettingsRows(rows)
  assert.equal(publicValue.settings.brandName, 'Royal Fusion Atelier')
  assert.equal(publicValue.settings.whatsappNumber, '+92 321 1234567')
  assert.equal(publicValue.settings.announcementEnabled, false)
  assert.equal(publicValue.settings.announcementCtaUrl, '/shop')
  assert.equal(JSON.stringify(rows).includes('staff@example.com'), false)
  assert.equal(JSON.stringify(rows).includes('secret'), false)
  assert.equal(api.db.admin_audit_logs[0].action, 'settings.update')
  assert.equal(api.db.admin_audit_logs[0].metadata.section, 'settings')
  assert.deepEqual(api.db.admin_audit_logs[0].metadata.keys.sort(), [
    'brandName', 'contactReceiverEmail', 'whatsappNumber', 'announcementEnabled', 'announcementCtaUrl',
  ].sort())
  assert.ok(api.db.admin_audit_logs[0].request_id)
})

test('shipping zeros remain zero and payment display excludes Card and private credentials', async () => {
  const api = await start()
  assert.equal((await put(api, 'shipping', { defaultShippingFee: 0, freeShippingAbove: 0, returnPolicyText: 'Returns' })).status, 200)
  assert.equal((await put(api, 'payments', [
    { name: 'Cash on Delivery', active: false }, { name: 'Bank Transfer', active: false },
  ])).status, 200)
  const publicValue = mapPublicSettingsRows(api.db.public_site_settings)
  assert.equal(publicValue.shipping.defaultShippingFee, 0)
  assert.equal(publicValue.shipping.freeShippingAbove, 0)
  assert.deepEqual(publicValue.payments.map((item) => [item.name, item.active]), [
    ['Cash on Delivery', false], ['Bank Transfer', false],
  ])
  assert.equal(JSON.stringify(api.db.public_site_settings).includes('Card'), false)
  assert.equal(JSON.stringify(api.db.public_site_settings).includes('accountNumber'), false)
  assert.equal(api.db.site_settings[0].payments[1].accountNumber, 'secret')
  assert.equal(api.db.site_settings[0].payments[2].name, 'Card')
})

test('unknown fields, unsafe URLs, invalid contacts and Card payload are rejected', async () => {
  const api = await start()
  for (const [section, body] of [
    ['settings', { apiSecret: 'leak' }],
    ['settings', { announcementCtaUrl: 'javascript:alert(1)' }],
    ['settings', { announcementCtaUrl: 'https://user:secret@example.com/shop' }],
    ['settings', { instagramLink: 'https://evil.example/account' }],
    ['settings', { whatsappNumber: '123' }],
    ['settings', { emailAddress: 'support@example.invalid' }],
    ['settings', { businessAddress: 'Fictional address' }],
    ['homepage', { primaryCtaLink: 'data:text/html,hello' }],
    ['payments', [{ name: 'Cash on Delivery', active: true }, { name: 'Card', active: true }]],
    ['shipping', { defaultShippingFee: -1 }],
  ]) assert.equal((await put(api, section, body)).status, 400)
  assert.equal((await put(api, 'private', { foo: 'bar' })).status, 400)
  assert.equal(api.db.admin_audit_logs.length, 0)
})

test('settings migration keeps private table closed and projection atomic and service-only', () => {
  const sql = readFileSync(path.join(root, 'supabase/migrations/008_settings_projection_rpc.sql'), 'utf8')
  assert.match(sql, /auth\.role\(\).*service_role/)
  assert.match(sql, /insert into public\.site_settings/)
  assert.match(sql, /insert into public\.public_site_settings/)
  assert.match(sql, /revoke all on function public\.update_site_settings_section.*from public, anon, authenticated/)
  assert.match(sql, /grant execute on function public\.update_site_settings_section.*to service_role/)
  const prototype = readFileSync(path.join(root, 'server/routes/admin.js'), 'utf8')
  assert.match(prototype, /\['settings', 'homepage', 'shipping', 'payments'\]/)
})
