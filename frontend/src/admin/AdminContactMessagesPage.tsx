import { useCallback, useEffect, useState } from 'react'
import { Button } from '../components/common/Button'
import { adminContactApi, type ContactFilters, type ContactMessage, type ContactPage, type ContactStatus } from '../services/adminContactApi'
import { AdminAuthError } from '../services/adminAuthClient'
import { useAdminAuth } from './AdminAuthProvider'

export function AdminContactMessagesPage() {
  const { can, refreshSession } = useAdminAuth()
  const allowed = can('contact_messages.manage')
  const [filters, setFilters] = useState<ContactFilters>({ page: 1, pageSize: 20 })
  const [page, setPage] = useState<ContactPage | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ContactMessage | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [revision, setRevision] = useState(0)
  const fail = useCallback((reason: unknown) => {
    setPage(null); setDetail(null)
    if (reason instanceof AdminAuthError && reason.status === 401) {
      setError('Session expired. Please sign in again.')
      void refreshSession().catch(() => {})
    } else if (reason instanceof AdminAuthError && reason.status === 403) {
      setError('You do not have permission to manage contact messages.')
    } else setError('Contact request could not be completed. Please try again.')
  }, [refreshSession])

  useEffect(() => {
    if (!allowed) return
    let active = true
    setLoading(true)
    adminContactApi.list(filters).then(data => { if (active) { setPage(data); setError('') } })
      .catch(reason => { if (active) fail(reason) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [allowed, filters, revision, fail])
  useEffect(() => {
    if (!allowed || !selectedId) return
    let active = true
    setDetail(null); setDetailLoading(true)
    adminContactApi.get(selectedId).then(data => { if (active) { setDetail(data); setError('') } })
      .catch(reason => { if (active) fail(reason) }).finally(() => { if (active) setDetailLoading(false) })
    return () => { active = false }
  }, [allowed, selectedId, fail])

  if (!allowed) return <p role="alert">You do not have permission to manage contact messages.</p>
  const update = async () => {
    if (!detail || saving) return
    setSaving(true); setError(''); setFeedback('')
    try {
      const next = await adminContactApi.setStatus(detail.id, detail.status === 'Read' ? 'Unread' : 'Read')
      setDetail(next); setFeedback(`Message marked ${next.status.toLowerCase()}.`)
      setRevision(value => value + 1)
    } catch (reason) { fail(reason) } finally { setSaving(false) }
  }
  const changePage = (next: number) => {
    setSelectedId(null); setDetail(null); setFeedback(''); setLoading(true)
    setFilters(value => ({ ...value, page: next }))
  }
  return <section className="space-y-6">
    <div><h1 className="font-serif text-3xl font-semibold text-burgundy">Contact Messages</h1>
      <p className="mt-2 text-sm text-brownroyal/70">Review inquiries sent through the contact form.</p></div>
    {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-800">{error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    <label className="grid max-w-xs gap-1 text-sm">Message status<select className="min-h-11 rounded-lg border px-3" disabled={saving}
      value={filters.status ?? ''} onChange={event => {
        setSelectedId(null); setDetail(null); setFeedback(''); setLoading(true)
        setFilters(value => ({ ...value, page: 1, status: event.target.value as ContactStatus || undefined }))
      }}><option value="">All</option><option>Unread</option><option>Read</option></select></label>
    {loading ? <p role="status">Loading contact messages…</p> : page && (page.items.length === 0
      ? <p>No contact messages match this filter.</p>
      : <div className="space-y-3">{page.items.map(item => <article key={item.id} className="rounded-lg border border-champagne/30 bg-ivory p-4">
        <h2 className="font-semibold text-burgundy">{item.subject}</h2>
        <p className="text-sm">{item.name} · {item.email} · {item.status} · {new Date(item.createdAt).toLocaleString()}</p>
        <Button className="mt-3" disabled={saving || selectedId === item.id} onClick={() => { setSelectedId(item.id); setDetail(null); setDetailLoading(true); setFeedback('') }} variant="outline">View message from {item.name}</Button>
      </article>)}</div>)}
    {page && <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>{page.total} messages · Page {filters.page}</span>
      <div className="flex gap-2"><Button variant="outline" disabled={loading || saving || filters.page <= 1} onClick={() => changePage(filters.page - 1)}>Previous</Button>
        <Button variant="outline" disabled={loading || saving || filters.page * filters.pageSize >= page.total} onClick={() => changePage(filters.page + 1)}>Next</Button></div></div>}
    {selectedId && <section aria-label="Message details" className="rounded-lg border border-champagne/30 bg-ivory p-5">
      {detailLoading ? <p role="status">Loading message…</p> : detail && <>
        <h2 className="font-serif text-2xl text-burgundy">{detail.subject}</h2>
        <p>{detail.name} · {detail.email}{detail.phone ? ` · ${detail.phone}` : ''}</p>
        <p className="text-sm">{detail.status} · {new Date(detail.createdAt).toLocaleString()}</p>
        <p className="my-4 whitespace-pre-wrap break-words">{detail.message}</p>
        <Button disabled={saving} onClick={() => void update()}>{saving ? 'Saving…' : `Mark ${detail.status === 'Read' ? 'unread' : 'read'}`}</Button>
      </>}
      <Button className="ml-3" variant="outline" disabled={saving} onClick={() => { setSelectedId(null); setDetail(null) }}>Close message</Button>
    </section>}
    {error && <Button variant="outline" onClick={() => { setSelectedId(null); setRevision(value => value + 1) }}>Retry loading</Button>}
  </section>
}
