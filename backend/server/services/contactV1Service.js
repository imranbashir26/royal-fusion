export class ContactApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}

const summaryColumns = 'id,name,email,phone,subject,status,created_at'
const detailColumns = `${summaryColumns},message`
export const contactConfirmation = 'Thank you. Our fragrance concierge will contact you shortly.'

export class ContactV1Service {
  constructor(client, logger = console) { this.client = client; this.logger = logger }
  requireClient() {
    if (!this.client) throw new ContactApiError(503, 'CONTACT_UNAVAILABLE', 'Contact messages are temporarily unavailable.')
    return this.client
  }
  async submit(input) {
    const { error } = await this.requireClient().from('contact_messages')
      .insert({ ...input, subject: 'Website inquiry', status: 'Unread' })
    if (error) throw dbError()
    return { message: contactConfirmation }
  }
  async list({ page, pageSize, status }) {
    let query = this.requireClient().from('contact_messages').select(summaryColumns, { count: 'exact' })
    if (status) query = query.eq('status', status)
    const start = (page - 1) * pageSize
    const { data, count, error } = await query.order('created_at', { ascending: false })
      .order('id', { ascending: false }).range(start, start + pageSize - 1)
    if (error) throw dbError()
    return { items: (data ?? []).map(dto), total: count ?? 0, page, pageSize }
  }
  async get(id) {
    const { data, error } = await this.requireClient().from('contact_messages')
      .select(detailColumns).eq('id', id).maybeSingle()
    if (error) throw dbError()
    if (!data) throw new ContactApiError(404, 'CONTACT_NOT_FOUND', 'Contact message not found.')
    return dto(data)
  }
  async setStatus(id, status, actor) {
    const current = await this.get(id)
    if (current.status === status) return current
    const { data, error } = await this.requireClient().from('contact_messages')
      .update({ status }).eq('id', id).select(detailColumns).maybeSingle()
    if (error) throw dbError()
    if (!data) throw new ContactApiError(404, 'CONTACT_NOT_FOUND', 'Contact message not found.')
    try {
      const { error: auditError } = await this.requireClient().from('admin_audit_logs').insert({
        admin_id: actor.userId, action: 'contact.status', resource: 'contact_messages', resource_id: id,
        permission_key: 'contact_messages.manage', request_id: actor.requestId, metadata: { status },
      })
      if (auditError) throw auditError
    } catch { this.logger.warn?.({ event: 'contact.audit_failed', requestId: actor.requestId }) }
    return dto(data)
  }
}
function dto(row) {
  return { id: row.id, name: row.name, email: row.email, phone: row.phone, subject: row.subject,
    status: row.status, createdAt: row.created_at, ...(Object.hasOwn(row, 'message') ? { message: row.message } : {}) }
}
function dbError() { return new ContactApiError(500, 'CONTACT_ERROR', 'Contact request could not be completed.') }
