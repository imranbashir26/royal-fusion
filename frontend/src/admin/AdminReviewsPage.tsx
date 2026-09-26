import { useEffect, useState } from 'react'
import { Button } from '../components/common/Button'
import { adminReviewsApi, type AdminReview, type ReviewFilters, type ReviewStatus } from '../services/adminReviewsApi'
import { useAdminAuth } from './AdminAuthProvider'

const initialFilters: ReviewFilters = { page: 1, pageSize: 20 }

export function AdminReviewsPage() {
  const { can } = useAdminAuth()
  const allowed = can('reviews.manage')
  const [filters, setFilters] = useState<ReviewFilters>(initialFilters)
  const [draftSearch, setDraftSearch] = useState('')
  const [page, setPage] = useState<{ items: AdminReview[]; total: number }>({ items: [], total: 0 })
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!allowed) return
    let active = true
    adminReviewsApi.products().then((data) => { if (active) setProducts(data) })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Products could not be loaded.') })
    return () => { active = false }
  }, [allowed])

  useEffect(() => {
    if (!allowed) return
    let active = true
    adminReviewsApi.list(filters).then((data) => { if (active) { setPage(data); setError('') } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Reviews could not be loaded.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [allowed, filters, revision])

  if (!allowed) return <p role="alert">You do not have permission to manage reviews.</p>

  const changeFilter = (patch: Partial<ReviewFilters>) => { setLoading(true); setFilters((value) => ({ ...value, page: 1, ...patch })) }
  const update = async (review: AdminReview, status: ReviewStatus, featured = review.featured) => {
    setBusyId(review.id); setError(''); setMessage('')
    try {
      await adminReviewsApi.update(review.id, status, featured)
      setMessage(`Review ${status.toLowerCase()}.`)
      setRevision((value) => value + 1)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Review could not be updated.') }
    finally { setBusyId(null) }
  }
  const remove = async (review: AdminReview) => {
    if (!window.confirm('Remove this review permanently?')) return
    setBusyId(review.id); setError(''); setMessage('')
    try {
      await adminReviewsApi.remove(review.id)
      setMessage('Review removed.')
      setRevision((value) => value + 1)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Review could not be removed.') }
    finally { setBusyId(null) }
  }

  return <section className="space-y-6">
    <div><h1 className="font-serif text-3xl font-semibold text-burgundy">Customer Reviews</h1>
      <p className="mt-2 text-sm text-brownroyal/70">Moderate product reviews before they appear publicly.</p></div>
    {error && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
    {message && <p className="rounded-lg border border-champagne/40 bg-ivory p-3 text-sm" role="status">{message}</p>}
    <form className="grid gap-3 md:grid-cols-5" onSubmit={(event) => { event.preventDefault(); changeFilter({ search: draftSearch }) }}>
      <label className="grid gap-1 text-sm">Search reviewer or text<input className="min-h-11 min-w-0 rounded-lg border px-3" maxLength={80} onChange={(event) => setDraftSearch(event.target.value)} value={draftSearch} /></label>
      <label className="grid gap-1 text-sm">Status<select className="min-h-11 rounded-lg border px-3" onChange={(event) => changeFilter({ status: event.target.value as ReviewStatus || undefined })} value={filters.status ?? ''}><option value="">All</option><option>Pending</option><option>Approved</option><option>Rejected</option></select></label>
      <label className="grid gap-1 text-sm">Product<select className="min-h-11 min-w-0 rounded-lg border px-3" onChange={(event) => changeFilter({ productId: event.target.value || undefined })} value={filters.productId ?? ''}><option value="">All</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Rating<select className="min-h-11 rounded-lg border px-3" onChange={(event) => changeFilter({ rating: Number(event.target.value) || undefined })} value={filters.rating ?? ''}><option value="">All</option>{[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating}</option>)}</select></label>
      <Button className="self-end" type="submit">Search</Button>
    </form>
    {loading ? <p role="status">Loading reviews…</p> : page.items.length === 0 ? <p>No reviews match these filters.</p> : (
      <div className="space-y-4">{page.items.map((review) => <article className="rounded-lg border border-champagne/30 bg-ivory p-5" key={review.id}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-burgundy">{review.name} · {review.rating}/5</h2><p className="text-sm text-brownroyal/65">{review.product || 'Product unavailable'}{review.city ? ` · ${review.city}` : ''} · {new Date(review.createdAt).toLocaleDateString()}</p></div><span className="text-sm font-semibold">{review.status}</span></div>
        <p className="mt-3 whitespace-pre-wrap text-sm text-brownroyal">{review.text}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button disabled={busyId !== null || review.status === 'Approved'} onClick={() => void update(review, 'Approved')}>Approve</Button>
          <Button disabled={busyId !== null || review.status === 'Rejected'} onClick={() => void update(review, 'Rejected')} variant="outline">Reject</Button>
          <label className="flex items-center gap-2 text-sm"><input checked={review.featured} disabled={busyId !== null} onChange={(event) => void update(review, review.status, event.target.checked)} type="checkbox" />Featured</label>
          <Button disabled={busyId !== null} onClick={() => void remove(review)} variant="outline">Remove</Button>
        </div>
      </article>)}</div>
    )}
    <div className="flex items-center justify-between gap-3 text-sm"><span>{page.total} reviews · Page {filters.page}</span><div className="flex gap-2"><Button disabled={loading || filters.page <= 1} onClick={() => setFilters((value) => ({ ...value, page: value.page - 1 }))} variant="outline">Previous</Button><Button disabled={loading || filters.page * filters.pageSize >= page.total} onClick={() => setFilters((value) => ({ ...value, page: value.page + 1 }))} variant="outline">Next</Button></div></div>
  </section>
}
