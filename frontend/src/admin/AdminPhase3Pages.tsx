import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/common/Button'
import { AdminAuthError } from '../services/adminAuthClient'
import { adminCustomersApi, adminCouponsApi, adminSeoApi, couponRestrictionSources, seoPages, type Filters, type Page, type Customer, type CustomerDetail, type CustomerOrder, type Coupon, type CouponConfig, type CouponDetail, type SeoSetting, type SeoKey, type SeoInput } from '../services/adminPhase3Api'
import { useAdminAuth } from './AdminAuthProvider'

function useAccess(permission: string) {
  const { can, refreshSession } = useAdminAuth(), allowed = can(permission)
  const [error, setError] = useState(''), [denied, setDenied] = useState(false)
  const fail = useCallback((reason: unknown) => {
    if (reason instanceof AdminAuthError && reason.status === 401) {
      setDenied(true); setError('Session expired. Please sign in again.'); void refreshSession().catch(() => {})
    } else if (reason instanceof AdminAuthError && reason.status === 403) {
      setDenied(true); setError('You do not have permission to access this module.')
    } else setError(reason instanceof AdminAuthError && reason.status === 409 ? 'This record changed or already exists. Reload before saving again.' : 'This request could not be completed. Please check your information and try again.')
  }, [refreshSession])
  return { allowed: allowed && !denied, error, setError, fail, can }
}
function useList<T>(load: (f: Filters) => Promise<Page<T>>, allowed: boolean, fail: (reason: unknown) => void) {
  const [filters, setFilters] = useState<Filters>({ page: 1, pageSize: 20 }), [draft, setDraft] = useState('')
  const [data, setData] = useState<Page<T> | null>(null), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!allowed) return
    let active = true
    setLoading(true); setData(null)
    load(filters).then(result => { if (active) setData(result) }).catch(reason => { if (active) fail(reason) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load, allowed, filters, revision, fail])
  return { data, loading, filters, setFilters, draft, setDraft, reload: () => setRevision(value => value + 1) }
}
type ListControls = { loading: boolean; filters: Filters; setFilters: (f: Filters) => void; draft: string; setDraft: (v: string) => void; data: { total: number } | null }
function Controls({ list }: { list: ListControls }) {
  return <><form className="flex gap-3" onSubmit={event => { event.preventDefault(); list.setFilters({ ...list.filters, page: 1, search: list.draft }) }}>
    <label className="grid gap-1">Search<input className="rounded-lg border p-3" maxLength={80} value={list.draft} onChange={event => list.setDraft(event.target.value)} /></label><Button className="self-end" type="submit">Search</Button>
  </form><div className="flex flex-wrap items-center gap-3 text-sm"><span>{list.data?.total ?? 0} records · Page {list.filters.page}</span>
    <Button variant="outline" disabled={list.loading || list.filters.page === 1} onClick={() => list.setFilters({ ...list.filters, page: list.filters.page - 1 })}>Previous</Button>
    <Button variant="outline" disabled={list.loading || !list.data || list.filters.page * list.filters.pageSize >= list.data.total} onClick={() => list.setFilters({ ...list.filters, page: list.filters.page + 1 })}>Next</Button></div></>
}
const box = 'rounded-lg border border-champagne/30 bg-ivory p-5'
function ErrorMessage({ error }: { error: string }) { return error ? <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-800">{error}</p> : null }
function PermissionDenied() { return <p role="alert">You do not have permission to access this module.</p> }

export function AdminCustomersPage() {
  const access = useAccess('customers.read'), list = useList<Customer>(adminCustomersApi.list, access.allowed, access.fail)
  const [id, setId] = useState<string | null>(null), [detail, setDetail] = useState<CustomerDetail | null>(null)
  const [orders, setOrders] = useState<Page<CustomerOrder> | null>(null), [orderPage, setOrderPage] = useState(1), [detailLoading, setDetailLoading] = useState(false)
  const ordersAllowed = access.can('orders.read')
  const { allowed, fail } = access
  useEffect(() => {
    setDetail(null); setOrders(null)
    if (!id || !allowed) return
    let active = true
    setDetailLoading(true)
    adminCustomersApi.detail(id).then(data => { if (active) setDetail(data) }).catch(reason => { if (active) fail(reason) }).finally(() => { if (active) setDetailLoading(false) })
    return () => { active = false }
  }, [id, allowed, fail])
  useEffect(() => {
    if (!id || !allowed || !ordersAllowed) return
    let active = true
    setOrders(null)
    adminCustomersApi.orders(id, orderPage).then(data => { if (active) setOrders(data) }).catch(reason => { if (active) fail(reason) })
    return () => { active = false }
  }, [id, orderPage, allowed, ordersAllowed, fail])
  if (!access.allowed) return <PermissionDenied />
  return <section className="space-y-5"><h1 className="font-serif text-3xl text-burgundy">Customers</h1><p>Read customer profiles, addresses and linked order summaries.</p><ErrorMessage error={access.error} />
    <Controls list={list} />{list.loading ? <p role="status">Loading customers…</p> : list.data?.items.length ? list.data.items.map(item => <article className={box} key={item.id}><h2>{item.name || 'Unnamed customer'}</h2><p>{item.email} · {item.phone} · {item.status}</p><Button variant="outline" onClick={() => { setId(item.id); setOrderPage(1) }}>View customer {item.name || item.id}</Button></article>) : <p>No customers match this search.</p>}
    {access.error && <Button onClick={() => { access.setError(''); list.reload() }} variant="outline">Retry loading</Button>}
    {id && <section className={box} aria-label="Customer details">{detailLoading ? <p role="status">Loading customer…</p> : detail && <><h2 className="font-serif text-2xl">{detail.name}</h2><p>{detail.email} · {detail.phone} · {detail.status}</p><h3 className="mt-4 font-semibold">Addresses</h3>{detail.addresses.length ? detail.addresses.map(address => <p key={address.id}>{address.label}{address.is_default ? ' (default)' : ''} · {address.recipient_name} · {address.phone} · {address.address_line_1} {address.address_line_2}, {address.city}, {address.province} {address.postal_code} · {address.country_code}</p>) : <p>No saved addresses.</p>}{detail.addressesTruncated && <p>Only the first 50 addresses are shown.</p>}</>}
      {ordersAllowed && <div className="mt-4"><h3 className="font-semibold">Order history</h3>{!orders ? <p role="status">Loading order history…</p> : !orders.items.length ? <p>No linked orders.</p> : orders.items.map(order => <p key={order.id}><Link className="underline" to={`/admin/orders/${order.id}`}>{order.orderNumber}</Link> · {order.status} · {order.paymentStatus} · {order.currency} {order.total}</p>)}<div className="mt-3 flex gap-3"><Button variant="outline" disabled={!orders || orderPage <= 1} onClick={() => setOrderPage(v => v - 1)}>Previous orders</Button><Button variant="outline" disabled={!orders || orderPage * 10 >= orders.total} onClick={() => setOrderPage(v => v + 1)}>Next orders</Button></div></div>}
      <Button className="mt-4" variant="outline" onClick={() => setId(null)}>Close customer</Button></section>}
  </section>
}
const freshCoupon: CouponConfig = { discountValue: 10, minimumOrderAmount: 0, maxDiscountAmount: null, description: '', startDate: null, endDate: null, usageLimit: 0, perCustomerUsageLimit: 0, status: 'Inactive' }
function CouponRestrictions({ label, modern, historical }: { label: string; modern?: readonly string[] | null; historical?: readonly string[] | null }) {
  const { source, modernIds, historicalIds } = couponRestrictionSources(modern, historical)
  return <div><p>{label} restrictions: {source}</p>
    {modernIds.length > 0 && <p>Modern {label.toLowerCase()} IDs: {modernIds.join(', ')}</p>}
    {historicalIds.length > 0 && <p>Historical {label.toLowerCase()} IDs (preserved): {historicalIds.join(', ')}</p>}
  </div>
}
export function AdminCouponsPage() {
  const access = useAccess('coupons.manage'), list = useList<Coupon>(adminCouponsApi.list, access.allowed, access.fail)
  const [selected, setSelected] = useState<Coupon | null>(null), [detail, setDetail] = useState<CouponDetail | null>(null), [editing, setEditing] = useState(false)
  const [config, setConfig] = useState<CouponConfig>(freshCoupon), [code, setCode] = useState(''), [type, setType] = useState<Coupon['type']>('Percentage')
  const [saving, setSaving] = useState(false), [feedback, setFeedback] = useState(''), busy = useRef(false)
  const { allowed, fail } = access
  useEffect(() => {
    setDetail(null)
    if (!selected || !allowed) return
    let active = true
    adminCouponsApi.detail(selected.id).then(data => { if (active) setDetail(data) }).catch(reason => { if (active) fail(reason) })
    return () => { active = false }
  }, [selected, allowed, fail])
  const edit = (row: Coupon | null) => {
    setSelected(row); setConfig(row ? { discountValue: row.discountValue, minimumOrderAmount: row.minimumOrderAmount, maxDiscountAmount: row.maxDiscountAmount, description: row.description, startDate: row.startDate, endDate: row.endDate, usageLimit: row.usageLimit, perCustomerUsageLimit: row.perCustomerUsageLimit, status: row.status } : freshCoupon)
    setCode(row?.code ?? ''); setType(row?.type ?? 'Percentage'); setEditing(true); setFeedback(''); access.setError('')
  }
  const save = async () => {
    if (busy.current) return
    busy.current = true; setSaving(true); access.setError(''); setFeedback('')
    try {
      if (selected) await adminCouponsApi.update(selected.id, { ...config, expectedUpdatedAt: selected.updatedAt })
      else await adminCouponsApi.create({ ...config, code, type:'Percentage' })
      setEditing(false); setSelected(null); setFeedback('Coupon saved.'); list.reload()
    } catch (reason) { access.fail(reason) } finally { busy.current = false; setSaving(false) }
  }
  if (!access.allowed) return <PermissionDenied />
  const number = (key: 'discountValue' | 'minimumOrderAmount' | 'usageLimit' | 'perCustomerUsageLimit', value: string) => setConfig(v => ({ ...v, [key]: Number(value) }))
  return <section className="space-y-5"><h1 className="font-serif text-3xl text-burgundy">Coupons &amp; Offers</h1><ErrorMessage error={access.error} />{feedback && <p role="status">{feedback}</p>}<p>New percentage coupons compare regular-price discounts with active sale prices. Checkout selects the lower merchandise total.</p><Controls list={list} /><Button disabled={saving} onClick={() => edit(null)}>Add Coupon</Button>
    {list.loading ? <p role="status">Loading coupons…</p> : list.data?.items.length ? list.data.items.map(item => <article className={box} key={item.id}><h2>{item.code}</h2><p>{item.type} · {item.status} · Used {item.usedCount}{item.usageLimit ? ` / ${item.usageLimit}` : ''}</p><Button variant="outline" disabled={saving} onClick={() => { setSelected(item); setEditing(false); setFeedback('') }}>View coupon {item.code}</Button><Button className="ml-3" variant="outline" disabled={saving} onClick={() => edit(item)}>Edit coupon {item.code}</Button></article>) : <p>No coupons match this search.</p>}
    {access.error && <Button variant="outline" onClick={() => { access.setError(''); list.reload() }}>Retry loading</Button>}
    {selected && !editing && <section className={box} aria-label="Coupon details">{!detail ? <p role="status">Loading coupon…</p> : <><h2>{detail.code}</h2><p>{detail.pricingPolicy === 'GLOBAL_PERCENTAGE_V1' ? 'Global percentage comparison' : 'Legacy coupon — existing terms preserved'}</p><p>{detail.description}</p><p>Discount: {detail.discountValue} · Minimum: {detail.minimumOrderAmount} · Cap: {detail.maxDiscountAmount ?? 'None'}</p><p>Dates: {detail.startDate ?? 'Any'} to {detail.endDate ?? 'Any'} · Per-customer limit: {detail.perCustomerUsageLimit || 'Unlimited'}</p>
      <CouponRestrictions label="Product" modern={detail.productIds} historical={detail.legacyProductIds} />
      <CouponRestrictions label="Category" modern={detail.categoryIds} historical={detail.legacyCategoryIds} />
      <p>Restriction sources are shown for review. Checkout determines eligibility; restriction editing is unavailable.</p>
      {detail.restrictionsTruncated && <p>Only the first 100 restrictions of each type are shown.</p>}<p>{detail.redemptionCount} redemptions; latest 20 shown.</p>{detail.redemptions.map(r => <p key={r.id}>{r.created_at} · Discount {r.discount_amount}</p>)}</>}<Button variant="outline" onClick={() => setSelected(null)}>Close coupon</Button></section>}
    {editing && <form className={`${box} grid gap-3 md:grid-cols-2`} aria-label="Coupon configuration" onSubmit={event => { event.preventDefault(); void save() }}>
      <label>Coupon code<input className="block w-full rounded-lg border p-3" required maxLength={40} value={code} disabled={saving || !!selected} onChange={e => setCode(e.target.value)} /></label><label>Coupon type<select aria-label="Coupon type" className="block w-full rounded-lg border p-3" value={type} disabled={saving || !!selected} onChange={e => { const next = e.target.value as Coupon['type']; setType(next); if (next === 'Free Shipping') setConfig(v => ({ ...v, discountValue: 0, maxDiscountAmount: null })) }}><option>Percentage</option>{selected && <><option>Fixed Amount</option><option>Free Shipping</option></>}</select></label>
      {(['discountValue', 'minimumOrderAmount', 'usageLimit', 'perCustomerUsageLimit'] as const).map(key => <label key={key}>{({ discountValue: 'Discount value', minimumOrderAmount: 'Minimum order amount', usageLimit: 'Usage limit', perCustomerUsageLimit: 'Per-customer usage limit' })[key]}<input className="block w-full rounded-lg border p-3" type="number" required min={key === 'discountValue' && type === 'Percentage' ? 0.01 : 0} max={key === 'discountValue' && type === 'Percentage' ? 100 : undefined} step={key.includes('Limit') ? 1 : 0.01} value={config[key]} disabled={saving || (key === 'discountValue' && type === 'Free Shipping')} onChange={e => number(key, e.target.value)} /></label>)}
      <label>Maximum discount amount<input className="block w-full rounded-lg border p-3" type="number" min={0} step="0.01" value={config.maxDiscountAmount ?? ''} disabled={saving || type === 'Free Shipping'} onChange={e => setConfig(v => ({ ...v, maxDiscountAmount: e.target.value === '' ? null : Number(e.target.value) }))} /></label>
      {(['startDate', 'endDate'] as const).map(key => <label key={key}>{key === 'startDate' ? 'Start date' : 'End date'}<input className="block w-full rounded-lg border p-3" type="date" value={config[key] ?? ''} disabled={saving} onChange={e => setConfig(v => ({ ...v, [key]: e.target.value || null }))} /></label>)}
      <label>Status<select aria-label="Status" className="block w-full rounded-lg border p-3" value={config.status} disabled={saving} onChange={e => setConfig(v => ({ ...v, status: e.target.value as CouponConfig['status'] }))}><option>Inactive</option><option>Active</option></select></label><label>Description<textarea className="block w-full rounded-lg border p-3" maxLength={500} value={config.description} disabled={saving} onChange={e => setConfig(v => ({ ...v, description: e.target.value }))} /></label>
      <p className="md:col-span-2">New coupons are unrestricted percentages. Minimum spend uses regular merchandise prices; the optional cap applies once to the total discount. Existing legacy terms and restrictions are preserved.</p><Button disabled={saving} type="submit">{saving ? 'Saving…' : 'Save Coupon'}</Button><Button disabled={saving} variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
    </form>}
  </section>
}
const emptySeo: SeoInput = { title: '', description: '', canonicalUrl: '', ogTitle: '', ogDescription: '', ogImage: '', expectedUpdatedAt: null }
export function AdminSeoSettingsPage() {
  const access = useAccess('seo.manage'), [rows, setRows] = useState<SeoSetting[]>([]), [key, setKey] = useState<SeoKey>('home')
  const [draft, setDraft] = useState<SeoInput>(emptySeo), [loading, setLoading] = useState(true), [loaded, setLoaded] = useState(false), [saving, setSaving] = useState(false), [feedback, setFeedback] = useState(''), [revision, setRevision] = useState(0), busy = useRef(false)
  const { allowed, fail } = access
  useEffect(() => {
    if (!allowed) return
    let active = true
    setLoading(true); setLoaded(false)
    adminSeoApi.list().then(data => { if (active) { setRows(data); setLoaded(true) } }).catch(reason => { if (active) fail(reason) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [allowed, fail, revision])
  useEffect(() => {
    const row = rows.find(item => item.routePath === seoPages[key])
    setDraft(row ? { title: row.title, description: row.description, canonicalUrl: row.canonicalUrl, ogTitle: row.ogTitle, ogDescription: row.ogDescription, ogImage: row.ogImage, expectedUpdatedAt: row.updatedAt } : emptySeo)
  }, [key, rows])
  if (!access.allowed) return <PermissionDenied />
  const save = async () => {
    if (busy.current) return
    busy.current = true; setSaving(true); access.setError(''); setFeedback('')
    try {
      const saved = await adminSeoApi.save(key, draft)
      setRows(value => [...value.filter(row => row.routePath !== saved.routePath), saved])
      setDraft(v => ({ ...v, expectedUpdatedAt: saved.updatedAt })); setFeedback('SEO settings saved.')
    } catch (reason) { access.fail(reason) } finally { busy.current = false; setSaving(false) }
  }
  const current = rows.find(row => row.routePath === seoPages[key])
  return <section className="space-y-5"><h1 className="font-serif text-3xl text-burgundy">SEO Settings</h1><ErrorMessage error={access.error} />{feedback && <p role="status">{feedback}</p>}<p>Static storefront metadata only. Product, category and collection SEO stays in the catalog; editorial SEO stays in Sanity. Crawlable HTML and social previews require a separately approved rendering/deployment decision.</p>
    {loading ? <p role="status">Loading SEO settings…</p> : !loaded ? <p>SEO settings could not be loaded.</p> : <form className={`${box} grid gap-3 md:grid-cols-2`} onSubmit={event => { event.preventDefault(); void save() }}><label>Storefront page<select aria-label="Storefront page" className="block rounded-lg border p-3" value={key} disabled={saving} onChange={e => { setKey(e.target.value as SeoKey); setFeedback('') }}>{Object.entries(seoPages).map(([name, path]) => <option key={name} value={name}>{name} ({path})</option>)}</select></label><p>Robots: {current?.robots ?? 'index,follow'} · {current?.active === false ? 'Inactive' : 'Active'} (preserved)</p>
      {(['title', 'description', 'canonicalUrl', 'ogTitle', 'ogDescription', 'ogImage'] as const).map(field => <label key={field}>{({ title: 'SEO title', description: 'Meta description', canonicalUrl: 'Canonical URL', ogTitle: 'Open Graph title', ogDescription: 'Open Graph description', ogImage: 'Open Graph image URL' })[field]}<input className="block w-full rounded-lg border p-3" disabled={saving} maxLength={field.includes('Url') || field === 'ogImage' ? 2048 : field.toLowerCase().includes('description') ? 160 : 70} type={field === 'canonicalUrl' || field === 'ogImage' ? 'url' : 'text'} value={draft[field]} onChange={e => setDraft(v => ({ ...v, [field]: e.target.value }))} /></label>)}<Button disabled={saving} type="submit">{saving ? 'Saving…' : 'Save SEO Settings'}</Button></form>}
    <Button variant="outline" disabled={saving || loading} onClick={() => { access.setError(''); setRevision(v => v + 1) }}>Reload SEO Settings</Button>
  </section>
}
