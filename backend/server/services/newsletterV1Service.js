export class NewsletterApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

const columns = 'id,email,subscribed_at'

export class NewsletterV1Service {
  constructor(client, logger = console) { this.client = client; this.logger = logger }

  requireClient() {
    if (!this.client) throw new NewsletterApiError(503, 'NEWSLETTER_UNAVAILABLE', 'Newsletter is unavailable.')
    return this.client
  }

  async subscribe(email, { manual = false, actor = null } = {}) {
    const client = this.requireClient()
    const { data, error } = await client.from('newsletter_subscribers')
      .insert({ email }).select(columns).single()
    if (error?.code === '23505') {
      if (manual) throw new NewsletterApiError(409, 'ALREADY_SUBSCRIBED', 'This email is already subscribed.')
      return { message: "You're already subscribed." }
    }
    if (error || !data) throw dbError()
    if (manual) {
      await this.audit('newsletter.add', data.id, actor)
      return dto(data)
    }
    return { message: 'Thank you for subscribing to Royal Fusion.' }
  }

  async list({ page, pageSize, search }) {
    let query = this.requireClient().from('newsletter_subscribers').select(columns, { count: 'exact' })
    if (search) query = query.ilike('email', `%${search}%`)
    const start = (page - 1) * pageSize
    const { data, count, error } = await query.order('subscribed_at', { ascending: false })
      .range(start, start + pageSize - 1)
    if (error) throw dbError()
    return { items: (data ?? []).map(dto), total: count ?? 0, page, pageSize }
  }

  async get(id) {
    const { data, error } = await this.requireClient().from('newsletter_subscribers')
      .select(columns).eq('id', id).maybeSingle()
    if (error) throw dbError()
    if (!data) throw new NewsletterApiError(404, 'SUBSCRIBER_NOT_FOUND', 'Subscriber not found.')
    return dto(data)
  }

  async remove(id, actor) {
    await this.get(id)
    const { error } = await this.requireClient().from('newsletter_subscribers').delete().eq('id', id)
    if (error) throw dbError()
    await this.audit('newsletter.delete', id, actor)
    return { id, removed: true }
  }

  async exportCsv(actor) {
    const rows = []
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.requireClient().from('newsletter_subscribers')
        .select(columns).order('subscribed_at', { ascending: false }).range(offset, offset + 499)
      if (error) throw dbError()
      rows.push(...(data ?? []))
      if ((data ?? []).length < 500) break
    }
    await this.audit('newsletter.export', null, actor)
    return '\uFEFFemail,subscribedAt\r\n' + rows.map((row) =>
      `${csvCell(row.email)},${csvCell(row.subscribed_at)}`,
    ).join('\r\n')
  }

  async audit(action, id, actor) {
    try {
      const { error } = await this.requireClient().from('admin_audit_logs').insert({
        admin_id: actor.userId, action, resource: 'newsletter_subscribers', resource_id: id ?? '',
        permission_key: 'newsletter.manage', request_id: actor.requestId, metadata: {},
      })
      if (error) throw error
    } catch {
      this.logger.warn?.({ event: 'newsletter.audit_failed', requestId: actor.requestId })
    }
  }
}

function dto(row) { return { id: row.id, email: row.email, subscribedAt: row.subscribed_at } }
function dbError() { return new NewsletterApiError(500, 'NEWSLETTER_ERROR', 'Newsletter request could not be completed.') }
function csvCell(value) {
  const text = String(value ?? '')
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}
