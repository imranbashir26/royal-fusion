import { useEffect, useState } from 'react'
import { Button } from '../components/common/Button'
import { adminNewsletterApi, type SubscriberPage } from '../services/adminNewsletterApi'
import { useAdminAuth } from './AdminAuthProvider'

export function AdminNewsletterPage() {
  const { can } = useAdminAuth()
  const allowed = can('newsletter.manage')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [draftSearch, setDraftSearch] = useState('')
  const [email, setEmail] = useState('')
  const [data, setData] = useState<SubscriberPage>({ items: [], total: 0, page: 1, pageSize: 25 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!allowed) return
    let active = true
    adminNewsletterApi.list(page, search).then((next) => { if (active) { setData(next); setError('') } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Subscribers could not be loaded.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [allowed, page, search, revision])

  if (!allowed) return <p role="alert">You do not have permission to manage newsletter subscribers.</p>

  const add = async () => {
    setBusy(true); setError(''); setMessage('')
    try {
      await adminNewsletterApi.add(email)
      setEmail(''); setMessage('Subscriber added.'); setRevision((value) => value + 1)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Subscriber could not be added.') }
    finally { setBusy(false) }
  }
  const remove = async (id: string) => {
    if (!window.confirm('Remove this subscriber permanently?')) return
    setBusy(true); setError(''); setMessage('')
    try {
      await adminNewsletterApi.remove(id)
      setMessage('Subscriber removed.'); setRevision((value) => value + 1)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Subscriber could not be removed.') }
    finally { setBusy(false) }
  }
  const exportCsv = async () => {
    setBusy(true); setError('')
    try {
      const blob = await adminNewsletterApi.exportCsv()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'royal-fusion-newsletter.csv'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Export could not be completed.') }
    finally { setBusy(false) }
  }

  return <section className="space-y-6">
    <div><h1 className="font-serif text-3xl font-semibold text-burgundy">Newsletter Subscribers</h1>
      <p className="mt-2 text-sm text-brownroyal/70">Manage the production newsletter audience.</p></div>
    {error && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
    {message && <p className="rounded-lg border border-champagne/40 bg-ivory p-3 text-sm" role="status">{message}</p>}
    <div className="flex flex-wrap items-end gap-3">
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(draftSearch) }}>
        <label className="grid gap-1 text-sm">Search email<input className="min-h-11 rounded-lg border px-3" maxLength={80} onChange={(event) => setDraftSearch(event.target.value)} value={draftSearch} /></label>
        <Button type="submit" variant="outline">Search</Button>
      </form>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void add() }}>
        <label className="grid gap-1 text-sm">Email address<input className="min-h-11 rounded-lg border px-3" maxLength={254} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
        <Button disabled={busy} type="submit">Add Subscriber</Button>
      </form>
      <Button disabled={busy} onClick={() => void exportCsv()} variant="outline">Export CSV</Button>
    </div>
    {loading ? <p role="status">Loading subscribers…</p> : data.items.length === 0 ? <p>No subscribers match this search.</p> : (
      <div className="overflow-x-auto rounded-lg border border-champagne/30 bg-ivory"><table className="w-full min-w-[540px] text-left text-sm"><thead><tr><th className="p-4">Email</th><th className="p-4">Subscribed</th><th className="p-4">Action</th></tr></thead><tbody>{data.items.map((subscriber) => <tr className="border-t border-champagne/25" key={subscriber.id}><td className="break-all p-4">{subscriber.email}</td><td className="p-4">{new Date(subscriber.subscribedAt).toLocaleDateString()}</td><td className="p-4"><Button disabled={busy} onClick={() => void remove(subscriber.id)} variant="outline">Remove</Button></td></tr>)}</tbody></table></div>
    )}
    <div className="flex items-center justify-between gap-3 text-sm"><span>{data.total} subscribers · Page {page}</span><div className="flex gap-2"><Button disabled={loading || page <= 1} onClick={() => { setLoading(true); setPage((value) => value - 1) }} variant="outline">Previous</Button><Button disabled={loading || page * data.pageSize >= data.total} onClick={() => { setLoading(true); setPage((value) => value + 1) }} variant="outline">Next</Button></div></div>
  </section>
}
