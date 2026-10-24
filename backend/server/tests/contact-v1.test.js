import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import { createAuthConfig, isAllowedCorsOrigin } from '../auth/config.js'
import { getAuthCookieNames, getSessionCsrfToken } from '../auth/cookies.js'
import { authErrorHandler, requestContext } from '../middleware/authSecurity.js'
import { createAdminContactV1Router, createPublicContactV1Router } from '../routes/contactV1.js'
import { contactDatabase } from './support/contactDatabase.js'

const origin = 'https://shop.example.invalid'
const config = createAuthConfig({ NODE_ENV: 'test', CLIENT_ORIGIN: origin,
  AUTH_CSRF_SECRET: 'contact-test-secret-12345678901234567890',
  ADMIN_AUTH_PROVIDER: 'prototype', CUSTOMER_AUTH_PROVIDER: 'prototype', ENABLE_ADMIN_MFA: 'false' })
const names = getAuthCookieNames(config)
const manager = '00000000-0000-4000-8000-000000000001'
const customer = '00000000-0000-4000-8000-000000000002'
const denied = '00000000-0000-4000-8000-000000000003'
const legacyPermissionHolder = '00000000-0000-4000-8000-000000000004'
let fixture
before(async () => {
  fixture = await contactDatabase()
  await fixture.db.query('insert into auth.users (id) values ($1)', [manager])
})
after(async () => { await fixture?.db.close() })
const payload = { name: 'Customer Name', email: 'customer@example.com', phone: '+92 300 1234567', message: 'Please help me choose a fragrance.' }

async function start(t, { client = fixture.client, legacy = false, proxyFixture = false } = {}) {
  await fixture.db.exec('truncate contact_messages, admin_audit_logs')
  const logs = []
  const runtime = { config, repository: { client },
    sessionService: { restore: async ({ accessToken }) => {
      if (!accessToken) throw Object.assign(new Error(), { code: 'AUTH_REQUIRED' })
      if (accessToken === 'expired') throw Object.assign(new Error(), { code: 'SESSION_EXPIRED' })
      return { record: { sessionClass: accessToken === customer ? 'customer' : 'administrator', mfaAssurance: 'aal2' },
        identity: { id: accessToken, assuranceLevel: 'aal2' } }
    } },
    adminAuthorization: { resolve: async id => ({ userId: id,
      permissions: id === manager ? ['contact_messages.manage'] : id === legacyPermissionHolder ? ['contactMessages:manage'] : [],
    }) },
  }
  const app = express()
  if (proxyFixture) app.set('trust proxy', 1)
  app.use(requestContext, cookieParser())
  app.use(cors({ origin(value, cb) {
    cb(isAllowedCorsOrigin(value, config) ? null : Object.assign(new Error(), { code: 'ORIGIN_NOT_ALLOWED' }), true)
  }, credentials: true, methods: ['GET', 'POST', 'PATCH', 'OPTIONS'], allowedHeaders: ['Content-Type', 'X-RF-CSRF'] }))
  app.use('/api/v1/public/contact', createPublicContactV1Router(runtime, { client, logger: { warn: entry => logs.push(entry) } }))
  app.use('/api/v1/admin/contact-messages', createAdminContactV1Router(runtime, { client, logger: { warn: entry => logs.push(entry) } }))
  if (legacy) {
    const { publicRouter } = await import('../routes/public.js')
    app.use('/api/public', express.json(), publicRouter)
  }
  app.use(authErrorHandler(config))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  return { base: `http://127.0.0.1:${server.address().port}`, logs }
}
async function request(api, route, { method = 'GET', actor, body, raw, csrf = true, requestOrigin = origin, ip } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (ip) headers['X-Forwarded-For'] = ip
  if (requestOrigin) headers.Origin = requestOrigin
  if (actor) {
    const token = getSessionCsrfToken('handle', config)
    headers.Cookie = `${names.access}=${actor}; ${names.refresh}=refresh; ${names.session}=handle; ${names.csrf}=${token}`
    if (csrf) headers['X-RF-CSRF'] = token
  }
  const response = await fetch(`${api.base}${route}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) })
  const text = await response.text()
  return { status: response.status, body: response.headers.get('content-type')?.includes('application/json') && text ? JSON.parse(text) : text || null, headers: response.headers }
}
const submit = (api, body = payload) => request(api, '/api/v1/public/contact', { method: 'POST', body })
const rows = async () => (await fixture.db.query('select * from contact_messages order by id')).rows

test('public API persists into PostgreSQL with server-owned fields and minimal response', async t => {
  const api = await start(t)
  const result = await submit(api, { ...payload, email: 'CUSTOMER@example.com' })
  assert.equal(result.status, 201)
  assert.deepEqual(Object.keys(result.body.data), ['message'])
  assert.equal(result.headers.get('cache-control'), 'no-store')
  assert.ok(result.body.meta.requestId)
  const [row] = await rows()
  assert.equal(row.email, 'customer@example.com'); assert.equal(row.status, 'Unread')
  assert.equal(row.subject, 'Website inquiry'); assert.equal(row.message, payload.message)
  assert.match(row.id, /^[a-f\d-]{36}$/); assert.ok(row.created_at)
  assert.deepEqual(api.logs, [])
  assert.equal((await request(api, '/api/v1/public/contact')).status, 404)
})
test('strict public validation rejects forged fields, HTML, invalid email/phone and text lengths', async t => {
  for (const body of [
    { ...payload, status: 'Read' }, { ...payload, id: randomUUID() }, { ...payload, subject: 'Forged' },
    { ...payload, name: 'a' }, { ...payload, name: 'x'.repeat(81) }, { ...payload, email: 'bad' },
    { ...payload, phone: '<script>' }, { ...payload, message: 'short' },
    { ...payload, message: 'x'.repeat(4001) }, { ...payload, message: '<script>danger()</script>' },
  ]) {
    const api = await start(t)
    assert.equal((await submit(api, body)).status, 400)
    assert.deepEqual(await rows(), [])
  }
})
test('raw byte limit and malformed JSON fail safely before persistence', async t => {
  const api = await start(t)
  for (const [raw, status] of [['{"secret":', 400], [JSON.stringify({ ...payload, ignored: 'x'.repeat(17000) }), 413]]) {
    const result = await request(api, '/api/v1/public/contact', { method: 'POST', raw })
    assert.equal(result.status, status); assert.doesNotMatch(JSON.stringify(result.body), /secret|SyntaxError|stack/)
  }
  assert.deepEqual(await rows(), [])
})
test('public Origin/CORS deny foreign origins, accept the allowlist and preflight', async t => {
  const api = await start(t)
  const foreign = await request(api, '/api/v1/public/contact', { method: 'POST', body: payload, requestOrigin: 'https://evil.invalid' })
  assert.equal(foreign.status, 403); assert.equal(foreign.headers.get('access-control-allow-origin'), null)
  assert.equal((await request(api, '/api/v1/public/contact', { method: 'POST', body: payload, requestOrigin: null })).status, 403)
  const preflight = await request(api, '/api/v1/public/contact', { method: 'OPTIONS' })
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), origin)
  assert.equal((await submit(api)).headers.get('access-control-allow-origin'), origin)
})
test('submission-specific limiter accepts five attempts and rejects the sixth', async t => {
  const api = await start(t)
  for (let n = 0; n < 5; n++) assert.equal((await submit(api, { ...payload, email: `person${n}@example.com` })).status, 201)
  const limited = await submit(api)
  assert.equal(limited.status, 429); assert.ok(limited.headers.get('retry-after'))
  assert.equal((await rows()).length, 5)
})
test('database unavailability/errors never expose messages, credentials or submitted PII', async t => {
  for (const client of [null, { from() { throw new Error('secret credentials customer@example.com') } },
    { from: () => ({ insert: async () => ({ error: { message: 'secret credentials customer@example.com' } }) }) }]) {
    const api = await start(t, { client })
    const result = await submit(api)
    assert.equal(result.status, client === null ? 503 : 500)
    assert.doesNotMatch(JSON.stringify(result.body), /secret|credentials|customer@example.com/)
    assert.deepEqual(api.logs, []); assert.deepEqual(await rows(), [])
  }
})
test('email abuse signal remains bounded across distinct IPs and normalized email case', async t => {
  const api = await start(t, { proxyFixture: true })
  for (let index = 1; index <= 6; index++) {
    const result = await request(api, '/api/v1/public/contact', { method: 'POST', ip: `192.0.2.${index}`,
      body: { ...payload, email: index % 2 ? 'CUSTOMER@example.com' : 'customer@example.com' } })
    assert.equal(result.status, index <= 5 ? 201 : 429)
  }
  assert.equal((await rows()).length, 5)
})
test('audit failure logs only event/request ID and does not falsely report a failed status mutation', async t => {
  const client = { from: table => table === 'admin_audit_logs'
    ? { insert: async () => ({ error: { message: 'secret customer@example.com' } }) }
    : fixture.client.from(table) }
  const api = await start(t, { client })
  await submit(api)
  const [row] = await rows()
  const changed = await request(api, `/api/v1/admin/contact-messages/${row.id}/status`, {
    method: 'PATCH', actor: manager, body: { status: 'Read' },
  })
  assert.equal(changed.status, 200); assert.equal((await rows())[0].status, 'Read')
  assert.equal(api.logs.length, 1)
  assert.deepEqual(Object.keys(api.logs[0]).sort(), ['event', 'requestId'])
  assert.doesNotMatch(JSON.stringify(api.logs), /secret|customer@example.com/)
})
test('admin session, customer denial, permissions and private response caching fail closed', async t => {
  const api = await start(t)
  for (const [actor, status] of [[undefined, 401], ['expired', 401], [customer, 403], [denied, 403], [manager, 200]]) {
    const result = await request(api, '/api/v1/admin/contact-messages', { actor })
    assert.equal(result.status, status); assert.equal(result.headers.get('cache-control'), 'no-store')
  }
})
test('contact-only authorized identity can list/read/update; the legacy spelling is not a backend grant', async t => {
  const api = await start(t)
  await submit(api)
  const [row] = await rows(), base = '/api/v1/admin/contact-messages'
  assert.equal((await request(api, base, { actor: manager })).status, 200)
  assert.equal((await request(api, `${base}/${row.id}`, { actor: manager })).status, 200)
  for (const actor of [denied, legacyPermissionHolder]) {
    assert.equal((await request(api, base, { actor })).status, 403)
    assert.equal((await request(api, `${base}/${row.id}`, { actor })).status, 403)
    assert.equal((await request(api, `${base}/${row.id}/status`, { actor, method: 'PATCH', body: { status: 'Read' } })).status, 403)
    assert.deepEqual((await rows())[0], row)
  }
  const changed = await request(api, `${base}/${row.id}/status`, { actor: manager, method: 'PATCH', body: { status: 'Read' } })
  assert.equal(changed.status, 200)
  assert.deepEqual(api.logs, [], 'Audit insert must satisfy the actual schema without fallback warnings')
  const [audit] = (await fixture.db.query('select * from admin_audit_logs')).rows
  assert.equal(audit.admin_id, manager)
  assert.equal(audit.resource_id, row.id)
  assert.equal(audit.permission_key, 'contact_messages.manage')
  assert.ok(audit.request_id); assert.ok(audit.created_at); assert.match(audit.id, /^[a-f\d-]{36}$/)
})
test('audit fixture retains committed column types, required fields, defaults, primary key and actor FK', async t => {
  await start(t)
  const { rows: columns } = await fixture.db.query(`select column_name, data_type, is_nullable
    from information_schema.columns where table_schema='public' and table_name='admin_audit_logs' order by ordinal_position`)
  assert.deepEqual(columns.map(row => [row.column_name, row.data_type, row.is_nullable]), [
    ['id', 'uuid', 'NO'], ['admin_id', 'uuid', 'YES'], ['action', 'text', 'NO'], ['resource', 'text', 'NO'],
    ['resource_id', 'text', 'NO'], ['metadata', 'jsonb', 'NO'], ['created_at', 'timestamp with time zone', 'NO'],
    ['permission_key', 'text', 'NO'], ['request_id', 'text', 'NO'],
  ])
  const [defaults] = (await fixture.db.query(`insert into admin_audit_logs (admin_id,action,resource)
    values ($1,'fixture.defaults','contact_messages') returning *`, [manager])).rows
  assert.match(defaults.id, /^[a-f\d-]{36}$/); assert.ok(defaults.created_at)
  assert.deepEqual(defaults.metadata, {}); assert.equal(defaults.resource_id, '')
  assert.equal(defaults.permission_key, ''); assert.equal(defaults.request_id, '')
  await assert.rejects(fixture.db.query(`insert into admin_audit_logs (id,action,resource)
    values ($1,'duplicate','contact_messages')`, [defaults.id]), error => error.code === '23505')
  await assert.rejects(fixture.db.query(`insert into admin_audit_logs (admin_id,action,resource)
    values ($1,'bad actor','contact_messages')`, [randomUUID()]), error => error.code === '23503')
  for (const column of ['action', 'resource', 'resource_id', 'metadata', 'created_at', 'permission_key', 'request_id']) {
    // Column names are a fixed test allowlist, never request input.
    const names = column === 'action' || column === 'resource' ? 'action,resource' : `action,resource,${column}`
    const values = column === 'action' ? "null,'contact_messages'" : column === 'resource' ? "'probe',null" : "'probe','contact_messages',null"
    await assert.rejects(fixture.db.query(`insert into admin_audit_logs (${names}) values (${values})`), error => error.code === '23502')
  }
})
test('admin pagination is bounded, stable for tied timestamps, filtered and excludes message bodies', async t => {
  const api = await start(t)
  await fixture.db.query(`insert into contact_messages (id,name,email,subject,message,created_at,status)
    values ($1,'First','first@example.com','Inquiry','Private first message','2026-01-01','Read'),
    ($2,'Second','second@example.com','Inquiry','Private second message','2026-01-01','Unread')`,
  ['00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000011'])
  const first = await request(api, '/api/v1/admin/contact-messages?pageSize=1', { actor: manager })
  assert.equal(first.body.data.total, 2); assert.equal(first.body.data.items[0].name, 'Second')
  assert.equal(Object.hasOwn(first.body.data.items[0], 'message'), false)
  const second = await request(api, '/api/v1/admin/contact-messages?pageSize=1&page=2', { actor: manager })
  assert.equal(second.body.data.items[0].name, 'First')
  const filtered = await request(api, '/api/v1/admin/contact-messages?status=Read', { actor: manager })
  assert.equal(filtered.body.data.total, 1); assert.equal(filtered.body.data.items[0].name, 'First')
  for (const query of ['pageSize=51', 'page=0', 'status=Deleted', 'sort=message', 'page=100001']) {
    assert.equal((await request(api, `/api/v1/admin/contact-messages?${query}`, { actor: manager })).status, 400)
  }
})
test('details and read/unread transitions require CSRF/Origin and preserve content; repeat is idempotent', async t => {
  const api = await start(t)
  await submit(api)
  const [before] = await rows(), detailPath = `/api/v1/admin/contact-messages/${before.id}`
  const detail = await request(api, detailPath, { actor: manager })
  assert.equal(detail.body.data.message, payload.message)
  assert.equal((await request(api, `/api/v1/admin/contact-messages/${randomUUID()}`, { actor: manager })).status, 404)
  for (const options of [{ csrf: false }, { requestOrigin: 'https://evil.invalid' }, { actor: denied }, { actor: customer }]) {
    assert.equal((await request(api, `${detailPath}/status`, { method: 'PATCH', actor: manager, body: { status: 'Read' }, ...options })).status, 403)
    assert.deepEqual((await rows())[0], before)
  }
  for (const body of [{ status: 'Deleted' }, { status: 'Read', message: 'tamper' }]) {
    assert.equal((await request(api, `${detailPath}/status`, { method: 'PATCH', actor: manager, body })).status, 400)
  }
  for (const status of ['Read', 'Read', 'Unread']) {
    assert.equal((await request(api, `${detailPath}/status`, { method: 'PATCH', actor: manager, body: { status } })).status, 200)
    assert.deepEqual((await rows())[0], { ...before, status })
  }
  const audit = (await fixture.db.query('select * from admin_audit_logs')).rows
  assert.deepEqual(api.logs, [], 'Valid status changes must persist real audit rows')
  assert.equal(audit.length, 2); assert.deepEqual(audit[0].metadata, { status: 'Read' })
  assert.equal(audit[0].permission_key, 'contact_messages.manage')
  assert.doesNotMatch(JSON.stringify(audit), /customer@example.com|Please help/)
  assert.equal((await request(api, detailPath, { method: 'DELETE', actor: manager })).status, 404)
  assert.equal((await request(api, '/api/v1/admin/contact-messages', { method: 'POST', actor: manager, body: payload })).status, 404)
})
test('production legacy contact fence preserves JSON bytes and existing ordering/coupon guards', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rf-contact-json-'))
  const file = path.join(directory, 'db.json'), bytes = '{"contactMessages":[],"orders":[]}'
  await writeFile(file, bytes)
  const oldEnv = { NODE_ENV: process.env.NODE_ENV, RF_DB_PATH: process.env.RF_DB_PATH }
  process.env.NODE_ENV = 'production'; process.env.RF_DB_PATH = file
  t.after(async () => {
    for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    await rm(directory, { recursive: true, force: true })
  })
  const api = await start(t, { legacy: true })
  assert.equal((await request(api, '/api/public/contact', { method: 'POST', body: payload })).status, 410)
  for (const endpoint of ['orders', 'coupons/validate']) assert.equal((await request(api, `/api/public/${endpoint}`, { method: 'POST', body: {} })).status, 503)
  await submit(api)
  assert.equal(await readFile(file, 'utf8'), bytes)
  assert.equal((await rows()).length, 1)
})
