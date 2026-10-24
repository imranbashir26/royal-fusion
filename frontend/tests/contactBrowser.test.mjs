import assert from 'node:assert/strict'
import test from 'node:test'
import { pageFixture, origin } from './support/variantBrowserHarness.mjs'

const adminFixture = (permissions = ['*']) => ({ paths: [], session: {
  authenticated: true, csrfToken: 'fixture-csrf',
  identity: { id: 'actor', email: 'admin@example.invalid', emailVerified: true },
  administrator: { userId: 'actor', name: 'Operator', role: 'Admin', roleKey: 'admin', permissions },
} })
async function setup(t, admin = null) {
  const { page } = await pageFixture(t, { admin })
  page.setDefaultTimeout(15000)
  const legacy = []
  page.context().on('request', request => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/admin/') || path === '/api/public/contact') legacy.push(path)
  })
  t.after(() => assert.deepEqual(legacy, []))
  return page
}
async function fillForm(page) {
  await page.getByLabel('Name', { exact: true }).fill('Customer Name')
  await page.getByLabel('Phone', { exact: true }).fill('03001234567')
  await page.getByLabel('Email', { exact: true }).fill('customer@example.com')
  await page.getByLabel('Message', { exact: true }).fill('Please help me choose a fragrance.')
}
test('contact form validates, submits once while pending, confirms success and resets', async t => {
  const page = await setup(t), requests = []
  let release
  const pending = new Promise(resolve => { release = resolve })
  await page.route('**/api/v1/public/contact', async route => {
    requests.push(route.request().postDataJSON())
    await pending
    return route.fulfill({ status: 201, json: { data: { message: 'Thank you. Our fragrance concierge will contact you shortly.' } } })
  })
  await page.goto(`${origin}/contact`)
  await page.getByRole('button', { name: 'Send Message', exact: true }).click()
  assert.deepEqual(requests, [])
  await fillForm(page)
  await page.getByRole('button', { name: 'Send Message', exact: true }).click()
  try {
    await page.getByRole('button', { name: 'Sending…', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Sending…', exact: true }).isDisabled(), true)
    await page.locator('main form').evaluate(form => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
  } finally { release() }
  await page.getByRole('status').filter({ hasText: 'Our fragrance concierge' }).waitFor()
  assert.equal(requests.length, 1)
  assert.deepEqual(Object.keys(requests[0]).sort(), ['email', 'message', 'name', 'phone'])
  assert.equal(await page.getByLabel('Message', { exact: true }).inputValue(), '')
})
for (const mode of ['failure', 'malformed', 'network']) {
  test(`contact ${mode} response preserves the form and never reports success`, async t => {
    const page = await setup(t)
    await page.route('**/api/v1/public/contact', route => mode === 'network' ? route.abort() : route.fulfill({
      status: mode === 'failure' ? 500 : 201, json: mode === 'failure' ? { error: { message: 'secret database failure' } } : { data: {} },
    }))
    await page.goto(`${origin}/contact`); await fillForm(page)
    await page.getByRole('button', { name: 'Send Message', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Your message could not be sent.' }).waitFor()
    assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Customer Name')
    const textarea = page.locator('main form textarea')
    t.diagnostic(JSON.stringify(await textarea.evaluate(field => ({ label: field.labels[0].textContent, value: field.value }))))
    assert.equal(await textarea.inputValue(), 'Please help me choose a fragrance.')
    assert.doesNotMatch(await page.locator('main').innerText(), /secret database/)
  })
}
test('admin inbox loads PostgreSQL DTOs, pages, fetches details and changes only read/unread status', async t => {
  const admin = adminFixture(), page = await setup(t, admin), requests = []
  const rows = Array.from({ length: 21 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, name: `Customer ${index + 1}`,
    email: `person${index + 1}@example.com`, phone: '03001234567', subject: 'Website inquiry',
    status: 'Unread', createdAt: '2026-01-01T00:00:00Z', message: `Private message ${index + 1}`,
  }))
  await page.route('**/api/v1/admin/contact-messages**', route => {
    const req = route.request(), url = new URL(req.url()), id = url.pathname.split('/')[5]
    requests.push({ method: req.method(), path: url.pathname, body: req.postDataJSON(), headers: req.headers() })
    const row = rows.find(item => item.id === id)
    let data
    if (req.method() === 'PATCH') { row.status = req.postDataJSON().status; data = row }
    else if (id) data = row
    else {
      const filtered = rows.filter(item => !url.searchParams.get('status') || item.status === url.searchParams.get('status'))
      const current = Number(url.searchParams.get('page')), start = (current - 1) * 20
      data = { items: filtered.slice(start, start + 20).map(({ message: _message, ...summary }) => summary), total: filtered.length, page: current, pageSize: 20 }
    }
    return route.fulfill({ json: { data } })
  })
  await page.goto(`${origin}/admin/contact-messages`)
  await page.getByRole('button', { name: 'View message from Customer 1', exact: true }).waitFor()
  assert.equal(await page.getByText('Private message 1', { exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: 'View message from Customer 21', exact: true }).click()
  await page.getByText('Private message 21', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Mark read', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Message marked read.' }).waitFor()
  await page.getByRole('button', { name: 'Mark unread', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Message marked unread.' }).waitFor()
  const mutations = requests.filter(req => req.method === 'PATCH')
  assert.deepEqual(mutations.map(req => req.body), [{ status: 'Read' }, { status: 'Unread' }])
  assert.ok(mutations.every(req => req.headers['x-rf-csrf'] === 'fixture-csrf'))
  await page.getByLabel('Message status').selectOption('Read')
  await page.getByText('No contact messages match this filter.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: /^(Export|Delete|Add Contact)/ }).count(), 0)
})
test('contact-only permission exposes the inbox navigation and grants list/detail access without wildcard', async t => {
  const admin = adminFixture(['contact_messages.manage']), page = await setup(t, admin), requests = []
  const item = { id: '00000000-0000-4000-8000-000000000001', name: 'Focused Customer', email: 'person@example.invalid',
    phone: '03001234567', subject: 'Website inquiry', status: 'Unread', createdAt: '2026-01-01T00:00:00Z' }
  await page.route('**/api/v1/admin/contact-messages**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    requests.push({ method: request.method(), path })
    return route.fulfill({ json: { data: path.endsWith(item.id) ? { ...item, message: 'Focused private inquiry.' }
      : { items: [item], total: 1, page: 1, pageSize: 20 } } })
  })
  await page.goto(`${origin}/admin/customers`)
  const nav = page.getByRole('navigation', { name: 'Admin navigation' })
  await nav.getByRole('link', { name: 'Contact Messages', exact: true }).waitFor()
  assert.deepEqual(admin.session.administrator.permissions, ['contact_messages.manage'])
  assert.deepEqual(await nav.getByRole('link').allTextContents(), ['Contact Messages'])
  await nav.getByRole('link', { name: 'Contact Messages', exact: true }).click()
  await page.getByRole('button', { name: 'View message from Focused Customer', exact: true }).click()
  await page.getByText('Focused private inquiry.', { exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/admin/contact-messages')
  assert.ok(requests.every(request => request.method === 'GET'))
  // StrictMode can repeat safe reads; the allowed endpoint set must remain exact.
  assert.deepEqual([...new Set(requests.map(request => request.path))], [
    '/api/v1/admin/contact-messages', `/api/v1/admin/contact-messages/${item.id}`,
  ])
})
test('unrelated permission hides contact navigation and denies the direct inbox without any contact request', async t => {
  const admin = adminFixture(['catalog.read']), page = await setup(t, admin)
  await page.goto(`${origin}/admin/contact-messages`)
  await page.getByRole('alert').filter({ hasText: 'You do not have permission' }).waitFor()
  assert.equal(await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('link', { name: 'Contact Messages', exact: true }).count(), 0)
  assert.equal(admin.paths.some(path => path.includes('contact-messages')), false)
})
test('contact inbox hides data for permission denial and uses a safe API error', async t => {
  const denied = adminFixture(['catalog.read']), page = await setup(t, denied)
  await page.goto(`${origin}/admin/contact-messages`)
  await page.getByRole('alert').filter({ hasText: 'You do not have permission' }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'Contact Messages', exact: true }).count(), 0)
  assert.equal(denied.paths.some(path => path.includes('contact-messages')), false)
  const admin = adminFixture(), other = await setup(t, admin)
  await other.route('**/api/v1/admin/contact-messages**', route => route.fulfill({ status: 403, json: { error: { code: 'PERMISSION_DENIED', message: 'secret database details' } } }))
  await other.goto(`${origin}/admin/contact-messages`)
  await other.getByRole('alert').filter({ hasText: 'You do not have permission' }).waitFor()
  assert.doesNotMatch(await other.locator('main').innerText(), /secret database/)
})
test('expired contact inbox session refreshes identity and returns to Admin Login', async t => {
  const admin = adminFixture(), page = await setup(t, admin)
  await page.route('**/api/v1/admin/contact-messages**', route => {
    admin.session = { authenticated: false, csrfToken: 'fixture-csrf' }
    return route.fulfill({ status: 401, json: { error: { code: 'SESSION_EXPIRED', message: 'Session expired.' } } })
  })
  await page.goto(`${origin}/admin/contact-messages`)
  await page.getByRole('heading', { name: 'Admin Login', exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/admin/login')
})
