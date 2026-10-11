import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('contact navigation and resource configuration use the canonical database permission', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', envDir: false, optimizeDeps: { noDiscovery: true } })
  try {
    const { adminNav, resourceConfigs } = await server.ssrLoadModule('/src/admin/adminConfig.ts')
    const contact = adminNav.filter(item => item.to === '/admin/contact-messages')
    assert.equal(contact.length, 1)
    assert.equal(contact[0].permission, 'contact_messages.manage')
    assert.equal(resourceConfigs['contact-messages'].permission, 'contact_messages.manage')
  } finally { await server.close() }
})

test('public contact client uses the modern route, sends only form fields and never retries', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', envDir: false, optimizeDeps: { noDiscovery: true } })
  const original = globalThis.fetch
  try {
    const requests = []
    let mode = 'success'
    globalThis.fetch = async (path, options) => {
      requests.push({ path, options })
      if (mode === 'network') throw new Error('network unavailable')
      return new Response(JSON.stringify(mode === 'success' ? { data: { message: 'Thank you.' } } : mode === 'malformed' ? { data: {} } : { error: { message: 'secret database error' } }), { status: mode === 'failure' ? 500 : 201 })
    }
    const { contactService } = await server.ssrLoadModule('/src/services/contactService.ts')
    const payload = { name: 'Customer', email: 'person@example.com', phone: '03001234567', message: 'Please help me choose.' }
    assert.deepEqual(await contactService.sendMessage(payload), { message: 'Thank you.' })
    assert.equal(requests[0].path, '/api/v1/public/contact')
    assert.equal(requests[0].options.method, 'POST')
    assert.deepEqual(JSON.parse(requests[0].options.body), payload)
    for (mode of ['failure', 'malformed', 'network']) {
      const count = requests.length
      await assert.rejects(contactService.sendMessage(payload))
      assert.equal(requests.length, count + 1)
    }
  } finally { globalThis.fetch = original; await server.close() }
})
test('admin contact client uses cookie/CSRF transport for list, details and status-only mutation', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', envDir: false, optimizeDeps: { noDiscovery: true } })
  const originals = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document }
  try {
    globalThis.window = { location: { protocol: 'http:' } }
    globalThis.document = { cookie: 'rf-dev-csrf=contact-csrf' }
    const requests = []
    globalThis.fetch = async (path, options) => { requests.push({ path, options }); return new Response(JSON.stringify({ data: {} })) }
    const { adminContactApi } = await server.ssrLoadModule('/src/services/adminContactApi.ts')
    const id = '00000000-0000-4000-8000-000000000001'
    await adminContactApi.list({ page: 2, pageSize: 20, status: 'Unread' })
    await adminContactApi.get(id)
    await adminContactApi.setStatus(id, 'Read')
    assert.equal(requests[0].path, '/api/v1/admin/contact-messages?page=2&pageSize=20&status=Unread')
    assert.equal(requests[1].path, `/api/v1/admin/contact-messages/${id}`)
    assert.equal(requests[2].path, `/api/v1/admin/contact-messages/${id}/status`)
    assert.ok(requests.every(({ options }) => options.credentials === 'include'))
    assert.equal(requests[2].options.method, 'PATCH')
    assert.equal(requests[2].options.headers['X-RF-CSRF'], 'contact-csrf')
    assert.deepEqual(JSON.parse(requests[2].options.body), { status: 'Read' })
  } finally { Object.assign(globalThis, originals); await server.close() }
})
