import {useEffect, useMemo, useSyncExternalStore} from 'react'
import {adminProductsApi} from '../services/adminProductsApi'
import {testerPacksApi} from '../services/testerPacksApi'
import {readSaleSchedulingCapability} from '../services/saleSchedulingCapability'
import {prepareBulkSalePlan, reviewFixedPackDetail, reviewProductDetail} from '../services/bulkSaleContract'
import type {BulkSaleIdentity, BulkSalePlan, BulkSaleSelection, SaleEdit, SalePricingSnapshot} from '../services/bulkSaleContract'
import {createBulkSaleController} from '../services/bulkSaleController'
import type {BulkSaleState} from '../services/bulkSaleController'
import {saleTimestampMicros} from '../services/saleSchedule'
import {formatCheckoutCurrency as money} from '../utils/checkoutMoney'
import {useAdminAuth} from './AdminAuthProvider'
import {Button} from '../components/common/Button'

type Scope = 'products' | 'packs'
type Source = {id?: string; name?: string; mode?: unknown}
type Row = {key: string; name: string; reference: string; identity: BulkSaleIdentity; before: SalePricingSnapshot; edit: SaleEdit; revision: string; definitionRevision?: string; expires: number; expired?: boolean}
type Choice = {detail: unknown; rows: Row[]}
type Controller = ReturnType<typeof createBulkSaleController>
interface Draft {
  open: boolean; rows: Row[]; details: Map<string, unknown>; choice?: Choice; busy: boolean
  error: string; capability: boolean; plan?: BulkSalePlan; controller?: Controller; state?: BulkSaleState
  version: number; listeners: Set<() => void>; authorized: boolean
}
// Memory only, partitioned by authenticated actor and selection source. Route unmounts
// detach the UI, not its recovery record. Nothing is persisted to browser storage.
const drafts = new Map<string, Draft>()
const changed = (d: Draft) => {d.version++; d.listeners.forEach(fn => fn())}
const hasWork = (d: Draft) => d.rows.length > 0
const unresolved = (d: Draft) => d.state?.groups.some(g => g.state === 'uncertain' && g.reconciliation?.kind !== 'matches')
const needsReconciliation = (d: Draft) => d.state?.groups.some(g => g.state === 'uncertain' && !['matches', 'review-required'].includes(g.reconciliation?.kind ?? ''))
// Remains active on other app routes too: route navigation retains memory, a
// full document unload cannot. No draft contents or credentials enter storage.
if (typeof window !== 'undefined') window.addEventListener('beforeunload', event => {
  if ([...drafts.values()].some(hasWork)) {event.preventDefault(); event.returnValue = ''}
})
const message = (error: unknown) => error instanceof Error ? error.message : 'Unable to load authoritative catalog details.'
const field = 'w-full min-w-0 rounded border border-champagne/50 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-burgundy'
const stateLabels = {pending: 'Not attempted', saving: 'Saving', saved: 'Saved', rejected: 'Rejected', stale: 'Stale revision', uncertain: 'Uncertain'}

function snapshotDeadline(sale: SalePricingSnapshot, started: number) {
  // Only schedules a server refresh; never decides which price applies locally.
  return sale.validUntil === null ? Infinity : started + Math.max(0, Number(saleTimestampMicros(sale.validUntil) - saleTimestampMicros(sale.pricingAt)) / 1000)
}
function choices(detail: unknown, scope: Scope, started: number): Choice {
  const name = String((detail as Source).name ?? 'Catalog item')
  if (scope === 'packs') {
    const p = reviewFixedPackDetail(detail)
    return {detail, rows: [{key: `fixed-pack:${p.id}`, name, reference: `Fixed pack ${p.id}`, identity: {kind: 'fixed-pack', packId: p.id, commerceKind: 'tester_pack'}, before: p, edit: {}, revision: p.catalogRevision, definitionRevision: p.definitionRevision, expires: snapshotDeadline(p, started)}]}
  }
  const p = reviewProductDetail(detail)
  return {detail, rows: p.variants.map(v => ({key: `variant:${v.id}`, name, reference: `${v.optionName}: ${v.optionValue} · SKU ${v.sku} · Variant ${v.id} · Product ${p.id}`, identity: {kind: 'variant', productId: p.id, variantId: v.id, commerceKind: p.commerceKind}, before: v, edit: {}, revision: p.catalogRevision, expires: snapshotDeadline(v, started)}))}
}
async function readChoice(id: string, scope: Scope) {
  const started = performance.now()
  const result = choices(await (scope === 'products' ? adminProductsApi.get(id) : testerPacksApi.get(id)), scope, started)
  if (result.rows.some(row => ownerId(row) !== id.toLowerCase())) throw new Error('Authoritative detail identity does not match the selected parent.')
  return result
}
const ownerId = (row: Row) => row.identity.kind === 'variant' ? row.identity.productId : row.identity.packId
function prepare(d: Draft, rows = d.rows) {
  const selected = rows.map(r => ({...r.identity, edit: r.edit}) as BulkSaleSelection)
  const products = [...d.details.values()].filter(p => (p as {commerceKind: string}).commerceKind !== 'tester_pack')
  const packs = [...d.details.values()].filter(p => (p as {commerceKind: string}).commerceKind === 'tester_pack')
  return prepareBulkSalePlan(selected, products, packs)
}
function getDraft(key: string) {
  let d = drafts.get(key)
  if (!d) {d = {open: false, rows: [], details: new Map(), busy: false, error: '', capability: false, version: 0, listeners: new Set(), authorized: false}; drafts.set(key, d)}
  return d
}

export function AdminBulkSales({scope, items}: {scope: Scope; items: readonly Source[]}) {
  const {identity, can} = useAdminAuth(), allowed = can('products:manage')
  const d = useMemo(() => getDraft(`${identity?.id ?? 'anonymous'}:${scope}`), [identity?.id, scope])
  useSyncExternalStore(fn => {d.listeners.add(fn); return () => {d.listeners.delete(fn)}}, () => d.version)
  useEffect(() => {
    d.authorized = allowed
    let alive = true
    void readSaleSchedulingCapability().then(value => {if (alive) {d.capability = value; changed(d)}})
    return () => {alive = false; d.authorized = false; if (d.controller?.getState().running) d.controller.cancel()}
  }, [d, allowed])
  useEffect(() => {
    const navigate = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.('a[href]')
      if (link && hasWork(d) && !window.confirm('Leave bulk sales? This draft is retained when navigating within this app. Outstanding writes may still commit. Reloading or closing this tab loses the recovery record.')) {event.preventDefault(); event.stopPropagation()}
    }
    document.addEventListener('click', navigate, true)
    return () => {document.removeEventListener('click', navigate, true)}
  }, [d])
  // Expiry hides the old effective price immediately. Refresh uses the same detail
  // endpoints and cannot rebase a submitted plan or its captured revisions.
  useEffect(() => {
    if (!d.open || !d.rows.length) return
    const expire = async () => {
      const due = d.rows.filter(r => !r.expired && r.expires <= performance.now())
      if (!due.length) return
      due.forEach(r => {r.expired = true}); changed(d)
      for (const id of new Set(due.map(ownerId))) {
        try {
          const fresh = await readChoice(id, scope)
          for (const row of d.rows.filter(r => ownerId(r) === id)) {
            const current = fresh.rows.find(r => r.key === row.key)
            if (current && current.revision === row.revision && current.definitionRevision === row.definitionRevision && JSON.stringify([current.before.regularPrice, current.before.salePrice, current.before.saleStartsAt, current.before.saleEndsAt]) === JSON.stringify([row.before.regularPrice, row.before.salePrice, row.before.saleStartsAt, row.before.saleEndsAt])) {
              row.before = current.before; row.expires = current.expires; row.expired = current.expires <= performance.now()
            }
          }
        } catch {/* Keep stale prices hidden; explicit refresh is available. */}
      }
      changed(d)
    }
    const delay = Math.min(...d.rows.filter(r => !r.expired).map(r => r.expires)) - performance.now()
    const timer = Number.isFinite(delay) ? window.setTimeout(() => void expire(), Math.min(2147483647, Math.max(1, delay))) : undefined
    const visible = () => {if (document.visibilityState === 'visible') void expire()}
    window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible)
    return () => {window.clearTimeout(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible)}
  }, [d, d.version, scope])
  if (!allowed) return null
  const locked = Boolean(d.controller), running = Boolean(d.state?.running)
  const invalidate = () => {d.plan = undefined; d.error = ''}
  const act = async (work: () => Promise<unknown>) => {try {d.error = ''; await work()} catch (error) {d.error = message(error)} finally {changed(d)}}
  const loadChoice = async (id: string) => {
    if (locked || d.busy) return
    d.busy = true; changed(d)
    await act(async () => {d.choice = await readChoice(id, scope)})
    d.busy = false; changed(d)
  }
  const add = (row: Row) => {
    if (locked || !d.choice) return
    if (d.rows.some(r => r.key === row.key)) {d.error = 'This canonical identity is already selected.'; changed(d); return}
    if (d.rows.length >= 50) {d.error = 'Maximum 50 rows. Remove a selected row first.'; changed(d); return}
    // Never mix sibling snapshots from different revisions under one parent.
    if (d.rows.some(r => ownerId(r) === ownerId(row) && r.revision !== row.revision)) {d.error = 'This product changed. Remove its selected rows and load it again.'; changed(d); return}
    d.details.set(ownerId(row), d.choice.detail); d.rows.push({...row}); invalidate(); changed(d)
  }
  const edit = (row: Row, patch: SaleEdit) => {if (locked) return; row.edit = {...row.edit, ...patch}; invalidate(); changed(d)}
  const validation = (row: Row) => {try {const plan = prepare(d, [row]); return !d.capability && plan.groups.some(g => g.requiresScheduling) ? 'Scheduling is unavailable. Keep the saved schedule and amount, or clear the sale.' : ''} catch (e) {return message(e)}}
  const invalid = d.rows.filter(r => validation(r))
  const review = async () => {
    d.busy = true; changed(d)
    await act(async () => {
      d.capability = await readSaleSchedulingCapability()
      const plan = prepare(d)
      if (!d.capability && plan.groups.some(g => g.requiresScheduling)) throw new Error('Scheduling is unavailable. Review the protected rows.')
      d.plan = plan
    }); d.busy = false; changed(d)
  }
  const submit = () => {
    if (!d.plan || locked || d.busy) return
    const authorize = () => {if (!d.authorized) throw new Error('Return to the authorized bulk editor before continuing.')}
    const controller = createBulkSaleController(d.plan, {
      readCapability: signal => {authorize(); return readSaleSchedulingCapability(signal)},
      saveProduct: (id, body, request) => {authorize(); return adminProductsApi.updateSaleVariants(id, body, request)},
      savePack: (id, body, request) => {authorize(); return testerPacksApi.updateSalePricing(id, body, request)},
      getProduct: (id, signal) => {authorize(); return adminProductsApi.get(id, {signal})},
      getPack: (id, signal) => {authorize(); return testerPacksApi.get(id, {signal})},
    })
    d.controller = controller
    controller.subscribe(state => {d.state = state; changed(d)})
    void act(() => controller.submit())
  }
  const refresh = async () => {
    if (running || needsReconciliation(d) || d.busy) return
    d.busy = true; changed(d)
    await act(async () => {
      const saved = new Set(d.state?.rows.filter(r => r.state === 'saved' || d.state?.groups.find(g => g.key === r.groupKey)?.reconciliation?.kind === 'matches').map(r => r.key))
      const remaining = d.rows.filter(r => !saved.has(r.key)), details = new Map<string, unknown>(), rows: Row[] = []
      for (const id of new Set(remaining.map(ownerId))) {
        const fresh = await readChoice(id, scope)
        details.set(id, fresh.detail)
        for (const old of remaining.filter(r => ownerId(r) === id)) {
          const row = fresh.rows.find(r => r.key === old.key)
          if (!row) throw new Error('A selected variant no longer exists. Resolve the selection before continuing.')
          rows.push({...row, edit: old.edit})
        }
      }
      d.controller?.dispose(); d.controller = undefined; d.state = undefined; d.rows = rows; d.details = details; d.choice = undefined; invalidate()
    }); d.busy = false; changed(d)
  }
  return <section aria-label="Bulk fixed sale administration" className="min-w-0 space-y-4 rounded-lg border border-champagne/40 bg-ivory p-4">
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" onClick={() => {d.open = !d.open; changed(d)}}>{d.open ? 'Hide bulk sale editor' : 'Bulk fixed sales'}</Button><span role="status">{d.rows.length}/50 selected rows · {scope === 'products' ? 'Products and standalone testers' : 'Fixed tester packs only'}</span></div>
    {d.open && <>
      <h2 className="font-serif text-2xl">Bulk fixed sales</h2>
      <p className="font-bold">Items save independently. An interruption may leave some changes applied.</p>
      <p>Selections persist across list pages and filters. Draft recovery is retained within this app session; do not reload or close the tab while work is unresolved.</p>
      <p role="status">{d.capability ? 'Server scheduling capability enabled.' : 'Scheduling unavailable. Immediate unscheduled sales and clearing remain available. Backend validation is authoritative.'}</p>
      {d.error && <p role="alert" className="text-burgundy">{d.error}</p>}
      <fieldset disabled={locked || d.busy} className="space-y-3"><legend className="font-bold">Choose from the current listing</legend>
        <div className="flex flex-wrap gap-2">{items.map(item => <Button key={item.id} size="sm" variant="outline" disabled={!item.id || scope === 'packs' && item.mode !== 'fixed'} onClick={() => item.id && void loadChoice(item.id)}>Choose {item.name ?? item.id}{scope === 'packs' && item.mode !== 'fixed' ? ' (configurable: ineligible)' : ''}</Button>)}</div>
        {d.choice && <fieldset className="space-y-2"><legend>Explicitly add each canonical row</legend>{d.choice.rows.map(row => <div className="break-words rounded border border-champagne/30 p-3" key={row.key}><p>{row.name} · {row.reference}</p><Button size="sm" variant="outline" onClick={() => add(row)}>Add {row.name} {row.identity.kind === 'variant' ? row.reference.split(' · ')[0] : 'fixed pack'}</Button></div>)}</fieldset>}
      </fieldset>
      <p>Fixed PKR amounts only, up to two decimal places. Asia/Karachi UTC+05:00. Use explicit UTC offsets; start inclusive, end exclusive. Untouched timestamp microseconds are preserved. Blank edited bounds explicitly clear that bound.</p>
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">{d.rows.map(row => {
        const error = validation(row), outcome = d.state?.rows.find(r => r.key === row.key), intended = d.plan?.groups.flatMap(g => g.rows).find(r => r.key === row.key)?.intended
        const scheduled = row.before.saleStartsAt !== null || row.before.saleEndsAt !== null
        return <article key={row.key} aria-label={`Sale row ${row.name} ${row.reference.split(' · ')[0]}`} className="min-w-0 space-y-3 break-words rounded border border-champagne/40 p-3">
          <h3 className="font-bold">{row.name} · {row.identity.commerceKind}</h3><p className="text-xs [overflow-wrap:anywhere]">{row.reference}</p>
          <p>Regular {money(row.before.regularPrice)} · Configured {row.before.salePrice === null ? 'None' : money(row.before.salePrice)}</p>
          <p>Effective at database snapshot: {row.expired || row.expires <= performance.now() ? 'Refresh required' : money(row.before.effectivePrice)} · Database instant {row.before.pricingAt}</p>
          <p>Catalog revision {row.revision}{row.definitionRevision ? ` · Definition revision ${row.definitionRevision}` : ''}</p>
          <fieldset disabled={locked || d.busy} className="space-y-3">
            <label className="block">Fixed sale amount (PKR)<input className={field} type="text" inputMode="decimal" disabled={!d.capability && scheduled} value={Object.hasOwn(row.edit, 'salePrice') ? row.edit.salePrice ?? '' : row.before.salePrice ?? ''} onChange={e => edit(row, {salePrice: e.target.value})}/></label>
            {(['saleStartsAt', 'saleEndsAt'] as const).map((key, i) => <label className="block" key={key}>{i ? 'Sale end (exclusive, ISO offset)' : 'Sale start (inclusive, ISO offset)'}<input className={field} type="text" disabled={!d.capability} value={Object.hasOwn(row.edit, key) ? row.edit[key] ?? '' : row.before[key] ?? ''} onChange={e => edit(row, {[key]: e.target.value === '' ? null : e.target.value})}/></label>)}
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => edit(row, {salePrice: null, saleStartsAt: null, saleEndsAt: null})}>Clear sale</Button><Button size="sm" variant="ghost" onClick={() => {d.rows = d.rows.filter(r => r !== row); if (!d.rows.some(r => ownerId(r) === ownerId(row))) d.details.delete(ownerId(row)); invalidate(); changed(d)}}>Remove row</Button></div>
          </fieldset>
          {!locked && error && <p role="alert">{error}</p>}
          {intended && <div className="rounded bg-marble p-3"><p>Review: {row.before.salePrice === null ? 'None' : money(row.before.salePrice)} → {intended.salePrice === null ? 'Clear sale' : money(intended.salePrice)}</p><p>Start: {row.before.saleStartsAt ?? 'Immediate'} → {intended.saleStartsAt ?? 'Immediate'}</p><p>End: {row.before.saleEndsAt ?? 'Indefinite'} → {intended.saleEndsAt ?? 'Indefinite'}</p></div>}
          {outcome && <p role="status">Row result: {stateLabels[outcome.state]}</p>}
        </article>
      })}</div>
      {!locked && <div className="flex flex-wrap gap-3"><p>{invalid.length} invalid or unresolved rows</p><Button disabled={!d.rows.length || !!invalid.length || d.busy} onClick={() => void review()}>Review changes</Button></div>}
      {d.plan && !locked && <section aria-label="Confirm bulk review" className="space-y-3 rounded border border-burgundy p-4"><h3 className="font-bold">Review required before saving</h3><p>{d.plan.rowCount} rows · {d.plan.groups.filter(g => g.kind === 'product').length} product groups · {d.plan.groups.filter(g => g.kind === 'fixed-pack').length} fixed-pack groups · Captured revisions remain pinned.</p><p>Items save independently. An interruption may leave some changes applied.</p><Button disabled={d.busy || !d.capability && d.plan.groups.some(g => g.requiresScheduling)} onClick={submit}>Confirm and save reviewed changes</Button></section>}
      {d.state && <section aria-label="Bulk submission results" aria-live="polite" className="space-y-3">
        <h3 className="font-bold">{d.state.success ? 'All groups saved' : running ? 'Processing groups serially' : d.state.paused ? 'Submissions paused' : 'Submission finished with individual outcomes'}</h3>
        <p>{d.state.groups.filter(g => g.state === 'saved').length}/{d.state.groups.length} groups confirmed saved</p>
        {d.state.groups.map(group => <div className="break-words rounded border border-champagne/40 p-3 [overflow-wrap:anywhere]" key={group.key}><p>{group.key} · {stateLabels[group.state]} · {group.attempts} attempts</p><p>{group.message}</p>{group.code && <p>{group.code}</p>}{group.reconciliation && <p>{group.reconciliation.message}</p>}
          {['uncertain', 'stale'].includes(group.state) && <Button size="sm" disabled={running} onClick={() => void act(() => d.controller!.reconcile(group.key))}>Reconcile current state</Button>}
          {group.state === 'uncertain' && group.reconciliation?.kind === 'retry-allowed' && <Button size="sm" disabled={running} onClick={() => void act(() => d.controller!.retry(group.key))}>Retry unchanged captured revision</Button>}
        </div>)}
        {running && <Button variant="outline" onClick={() => d.controller?.cancel()}>Stop waiting; reconcile outstanding writes</Button>}
        {d.state.paused && d.state.groups.some(g => g.state === 'pending') && <Button disabled={running || unresolved(d)} onClick={() => void act(() => d.controller!.resume())}>Explicitly resume not-attempted groups</Button>}
      </section>}
      {!!d.rows.length && <Button variant="outline" disabled={running || needsReconciliation(d) || d.busy} onClick={() => void refresh()}>{locked ? 'Refresh remaining rows for a new review' : 'Refresh authoritative snapshots'}</Button>}
      <Button variant="ghost" disabled={running || needsReconciliation(d) || d.busy} onClick={() => {if (hasWork(d) && !window.confirm('Discard this local draft and its completed result record? Saved changes remain applied.')) return; d.controller?.dispose(); d.controller = undefined; d.state = undefined; d.rows = []; d.details.clear(); d.choice = undefined; invalidate(); changed(d)}}>Discard local draft</Button>
    </>}
  </section>
}
