import type { StorefrontData } from '../types/admin.ts'

export type CatalogLoad = { status: 'success' } | { status: 'failed'; error: string }
export type StorefrontLoad = StorefrontData & { catalogLoad: CatalogLoad }

/** Content fallbacks are independent of whether the canonical catalog loaded. */
export function applyCatalogRefresh(previous: StorefrontData, next: StorefrontLoad): StorefrontData {
  if (next.catalogLoad.status === 'failed') return { ...next, products: staleCatalog(previous).products }
  return next
}

export function staleCatalog(data: StorefrontData): StorefrontData {
  if (!data.products.some(product => product.variants?.some(variant => variant.pricingAt && !variant.pricingStale))) return data
  return {...data, products: data.products.map(product => ({...product,
    variants: product.variants?.map(variant => variant.pricingAt ? {...variant, pricingStale:true} : variant)}))}
}

export function createCatalogRefreshController(options: {
  load: () => Promise<StorefrontLoad>; accept: (data: StorefrontLoad) => void
  stale: () => void; failed: (error: unknown) => void; busy: (value: boolean) => void
  now?: () => number; timer?: typeof setTimeout; cancel?: typeof clearTimeout
}) {
  const now = options.now ?? (() => performance.now()), timer = options.timer ?? setTimeout, cancel = options.cancel ?? clearTimeout
  let pending: Promise<void> | undefined, disposed = false, retried = false, acceptedDeadline = Infinity
  let expiryHandle: ReturnType<typeof setTimeout> | undefined, retryHandle: ReturnType<typeof setTimeout> | undefined
  let acceptedExpired = false, pendingBoundary = false
  function clearExpiry() { if (expiryHandle !== undefined) cancel(expiryHandle); expiryHandle = undefined }
  function clearRetry() { if (retryHandle !== undefined) cancel(retryHandle); retryHandle = undefined }
  function expireAccepted() {
    const expired = acceptedDeadline <= now()
    if (expired && !acceptedExpired) { acceptedExpired = true; options.stale() }
    return expired
  }
  function schedule(at: number) {
    clearExpiry()
    if (!Number.isFinite(at) || disposed) return
    expiryHandle = timer(() => {
      expiryHandle = undefined
      if (disposed) return
      if (now() < at) { schedule(at); return }
      expireAccepted()
      void refresh(true)
    }, Math.min(2147483647, Math.max(1, at - now())))
  }
  function refresh(boundary = false): Promise<void> {
    if (disposed) return Promise.resolve()
    // A suspended tab can return before its overdue timer is dispatched.
    const expired = expireAccepted()
    if (pending) { pendingBoundary ||= boundary || expired; return pending }
    // A request owns only its retry timer. Accepted-snapshot expiry protection
    // remains armed independently until a fresh response replaces that snapshot.
    clearRetry(); pendingBoundary = boundary || expired; options.busy(true)
    pending = (async () => {
      try {
        const next = await Promise.resolve().then(options.load)
        if (disposed) return
        if (next.catalogLoad.status === 'failed') throw new Error(next.catalogLoad.error)
        const deadline = Math.min(...next.products.flatMap(p => (p.variants ?? []).map(v => v.pricingExpiresAt ?? Infinity)))
        if (deadline <= now()) throw new Error('Pricing needs refresh. Please try again.')
        options.accept(next); acceptedDeadline = deadline; acceptedExpired = false; retried = false; schedule(deadline)
      } catch (error) {
        if (disposed) return
        options.stale(); options.failed(error)
        // One bounded boundary retry covers a conservative early refresh or a
        // transient network error. Further retries require user activity/action.
        if (pendingBoundary && !retried) { retried = true; retryHandle = timer(() => { retryHandle = undefined; void refresh(true) }, 1500) }
      } finally {
        pending = undefined
        if (!disposed) options.busy(false)
      }
    })()
    return pending
  }
  return {refresh, dispose() { disposed = true; clearExpiry(); clearRetry() }}
}

export function bindPricingActivity(doc: Document, win: Window, refresh: () => Promise<void>, now = () => performance.now()) {
  let lastActivity = now()
  const visible = () => { if (doc.visibilityState === 'visible') { lastActivity = now(); void refresh() } }
  const activity = () => { const elapsed = now() - lastActivity; lastActivity = now(); if (elapsed >= 60000) visible() }
  doc.addEventListener('visibilitychange', visible); win.addEventListener('focus', visible)
  win.addEventListener('pointerdown', activity); win.addEventListener('keydown', activity)
  return () => {
    doc.removeEventListener('visibilitychange', visible); win.removeEventListener('focus', visible)
    win.removeEventListener('pointerdown', activity); win.removeEventListener('keydown', activity)
  }
}
