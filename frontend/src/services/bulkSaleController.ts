import {assertSaleAcknowledgement, immutable, reconcileSaleGroup} from './bulkSaleContract.ts'
import type {BulkSaleGroup, BulkSalePlan, CatalogRevision, DefinitionRevision, FixedPackId, FixedPackSalePayload, ProductId, ProductSalePayload, SaleReconciliation} from './bulkSaleContract.ts'

export interface SaleRequest {readonly requestId: string; readonly signal: AbortSignal}
export interface BulkSaleTransport {
  // Production composition uses readSaleSchedulingCapability, never a UI flag.
  readCapability(signal: AbortSignal): Promise<boolean>
  saveProduct(id: ProductId, body: ProductSalePayload, request: SaleRequest): Promise<unknown>
  savePack(id: FixedPackId, body: FixedPackSalePayload, request: SaleRequest): Promise<unknown>
  getProduct(id: ProductId, signal: AbortSignal): Promise<unknown>
  getPack(id: FixedPackId, signal: AbortSignal): Promise<unknown>
}
export type SaleOutcome = 'pending' | 'saving' | 'saved' | 'rejected' | 'stale' | 'uncertain'
export interface GroupOutcome {
  readonly key: string
  readonly state: SaleOutcome
  readonly attempts: number
  readonly capturedRevision: CatalogRevision
  readonly capturedDefinitionRevision?: DefinitionRevision
  readonly requestId?: string
  readonly httpStatus?: number
  readonly code?: string
  readonly message?: string
  readonly reconciliation?: SaleReconciliation | {readonly kind: 'unavailable'; readonly message: string}
}
export interface BulkSaleState {
  readonly groups: readonly GroupOutcome[]
  readonly rows: readonly {readonly key: string; readonly groupKey: string; readonly state: SaleOutcome}[]
  readonly running: boolean
  readonly paused: boolean
  readonly disposed: boolean
  readonly success: boolean
}
export interface BulkSaleTiming {
  readonly timeoutMs?: number
  readonly requestId?: () => string
  readonly schedule?: (callback: () => void, milliseconds: number) => unknown
  readonly clear?: (handle: unknown) => void
}
class Interrupted extends Error {}
function failure(error: unknown): {state: SaleOutcome; stop: boolean; httpStatus?: number; code: string; message: string} {
  const e = error !== null && typeof error === 'object' ? error as {status?: unknown; code?: unknown} : {}
  const status = typeof e.status === 'number' ? e.status : 0
  if (status === 409 && e.code === 'CATALOG_STALE') return {state: 'stale', stop: false, httpStatus: status, code: 'CATALOG_STALE', message: 'Catalog changed. Refresh, review and reconfirm this group.'}
  if ([401,403,429].includes(status)) return {state: 'rejected', stop: true, httpStatus: status, code: status === 429 ? 'RATE_LIMITED' : 'AUTHORIZATION_REQUIRED', message: 'Submissions paused. Restore authorization or wait for the rate limit before continuing.'}
  if ((status === 409 && e.code === 'SALE_SCHEDULING_DISABLED') || (status === 503 && e.code === 'SALE_SCHEDULING_UNAVAILABLE')) return {
    state: 'rejected', stop: true, httpStatus: status, code: String(e.code), message: 'Scheduling is unavailable. Remaining groups were not submitted.'}
  if ([400,404,409,413,422].includes(status)) return {state: 'rejected', stop: false, httpStatus: status, code: 'REQUEST_REJECTED', message: 'This group was rejected. Review its rows before preparing another operation.'}
  return {state: 'uncertain', stop: true, ...(status ? {httpStatus: status} : {}), code: 'OUTCOME_UNCERTAIN', message: 'The write may have committed. Reconcile authoritative state before any retry.'}
}

/** Serial, per-group writes. No campaign transaction, automatic retry or compensation. */
export function createBulkSaleController(prepared: BulkSalePlan, transport: BulkSaleTransport, timing: BulkSaleTiming = {}) {
  const plan = immutable(structuredClone(prepared))
  const timeoutMs = timing.timeoutMs ?? 30000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('A positive bounded request timeout is required.')
  const schedule = timing.schedule ?? ((fn, ms) => setTimeout(fn, ms))
  const clear = timing.clear ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const requestId = timing.requestId ?? (() => 'bulk_' + crypto.randomUUID())
  const outcomes = new Map<string, GroupOutcome>(plan.groups.map(group => [group.key, {key: group.key, state: 'pending', attempts: 0, capturedRevision: group.payload.expectedRevision,
    ...(group.kind === 'fixed-pack' ? {capturedDefinitionRevision: group.payload.expectedDefinitionRevision} : {})}]))
  const listeners = new Set<(state: BulkSaleState) => void>()
  let active: Promise<BulkSaleState> | null = null, activeKind = '', generation = 0, started = false, paused = false, disposed = false
  let activeAbort: AbortController | null = null
  function state(): BulkSaleState {
    const groups = plan.groups.map(group => ({...outcomes.get(group.key)!}))
    return immutable(structuredClone({groups, rows: plan.groups.flatMap(group => group.rows.map(row => ({key: row.key, groupKey: group.key, state: outcomes.get(group.key)!.state}))),
      running: active !== null, paused, disposed, success: groups.length > 0 && groups.every(group => group.state === 'saved')}))
  }
  function emit() {for (const listener of listeners) {try {listener(state())} catch {/* Observers cannot change the submission outcome. */}}}
  function update(group: BulkSaleGroup, patch: Partial<GroupOutcome>) {outcomes.set(group.key, {...outcomes.get(group.key)!, ...patch}); emit()}
  const current = (token: number) => !disposed && token === generation
  async function io<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const abort = new AbortController(); activeAbort = abort
    let handle: unknown, onAbort: () => void = () => {}
    const interrupted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new Interrupted('Interrupted or timed out; no rollback is implied.'))
      abort.signal.addEventListener('abort', onAbort, {once: true})
      handle = schedule(() => abort.abort(), timeoutMs)
    })
    try {
      return await Promise.race([Promise.resolve().then(() => {
        if (abort.signal.aborted) throw new Interrupted('Request interrupted before dispatch.')
        return work(abort.signal)
      }), interrupted])
    } finally {clear(handle); abort.signal.removeEventListener('abort', onAbort); if (activeAbort === abort) activeAbort = null}
  }
  function task(kind: string, work: (token: number) => Promise<void>): Promise<BulkSaleState> {
    if (disposed) return Promise.reject(new Error('This controller is disposed; its outstanding writes have not been rolled back.'))
    if (active) return activeKind === kind ? active : Promise.reject(new Error('Wait for the active operation before changing submission state.'))
    const token = ++generation; activeKind = kind
    const promise = Promise.resolve().then(() => current(token) ? work(token) : undefined).then(() => state()).finally(() => {
      if (active === promise) {active = null; activeKind = ''; emit()}
    }).then(() => state())
    active = promise
    emit()
    return promise
  }
  async function send(group: BulkSaleGroup, token: number): Promise<boolean> {
    if (group.requiresScheduling) {
      let capability = false
      try {capability = await io(signal => transport.readCapability(signal)) === true} catch {/* Missing/failed capability stays disabled. */}
      if (!current(token)) return false
      if (!capability) {
        update(group, {state: 'rejected', code: 'SALE_SCHEDULING_DISABLED', message: 'Server scheduling capability is unavailable; no write was sent.'})
        paused = true; emit(); return false
      }
    }
    if (!current(token)) return false
    const id = requestId()
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) throw new Error('Invalid request correlation identifier.')
    update(group, {state: 'saving', attempts: outcomes.get(group.key)!.attempts + 1, requestId: id,
      httpStatus: undefined, code: undefined, message: undefined, reconciliation: undefined})
    if (!current(token)) return false
    try {
      const response = await io(signal => group.kind === 'product' ? transport.saveProduct(group.id, group.payload, {requestId: id, signal}) : transport.savePack(group.id, group.payload, {requestId: id, signal}))
      if (!current(token)) return false
      assertSaleAcknowledgement(group, response)
      update(group, {state: 'saved', message: 'The server confirmed this group was saved.'})
      return true
    } catch (error) {
      if (!current(token)) return false
      const {stop, ...result} = failure(error)
      update(group, result)
      if (stop) {paused = true; emit()}
      return !stop
    }
  }
  function unresolved() {
    return [...outcomes.values()].some(outcome => outcome.state === 'uncertain' && outcome.reconciliation?.kind !== 'matches')
  }
  async function remaining(token: number) {
    if (!current(token)) return
    paused = false
    for (const group of plan.groups) {
      if (!current(token)) return
      if (outcomes.get(group.key)!.state === 'pending' && !await send(group, token)) return
    }
  }
  function cancel() {
    generation++; paused = true
    for (const group of plan.groups) if (outcomes.get(group.key)!.state === 'saving') update(group, {state: 'uncertain', code: 'OUTCOME_UNCERTAIN', message: 'Stopped waiting. The outstanding write may still commit; reconcile it.'})
    activeAbort?.abort(); emit()
  }
  return {
    getState: state,
    subscribe(listener: (snapshot: BulkSaleState) => void) {
      if (disposed) throw new Error('This controller is disposed.')
      listeners.add(listener); try {listener(state())} catch {/* Subscription is observational. */}
      return () => {listeners.delete(listener)}
    },
    submit() {
      if (active && activeKind === 'submit') return active
      if (started) return Promise.resolve(state()) // Explicit resume/retry only; never replay saved groups.
      started = true
      return task('submit', remaining)
    },
    resume() {
      if (!started || !paused || unresolved()) return Promise.reject(new Error('Reconcile uncertain groups before explicitly resuming pending groups.'))
      return task('resume', remaining)
    },
    reconcile(key: string) {
      const group = plan.groups.find(group => group.key === key), outcome = outcomes.get(key)
      if (!group || !outcome || !['uncertain','stale'].includes(outcome.state)) return Promise.reject(new Error('Only uncertain or stale groups need reconciliation.'))
      return task('reconcile:' + key, async token => {
        try {
          const detail = await io(signal => group.kind === 'product' ? transport.getProduct(group.id, signal) : transport.getPack(group.id, signal))
          if (current(token)) update(group, {reconciliation: reconcileSaleGroup(group, detail)})
        } catch {
          if (current(token)) update(group, {reconciliation: {kind: 'unavailable', message: 'Authoritative state is unavailable. Do not retry this write.'}})
        }
      })
    },
    retry(key: string) {
      const group = plan.groups.find(group => group.key === key), outcome = outcomes.get(key)
      if (!group || outcome?.state !== 'uncertain' || outcome.reconciliation?.kind !== 'retry-allowed') return Promise.reject(new Error('An explicit retry requires unchanged captured revisions established by reconciliation.'))
      return task('retry:' + key, async token => {
        paused = false
        await send(group, token)
        if (current(token) && plan.groups.some(group => outcomes.get(group.key)!.state === 'pending')) {paused = true; emit()}
      })
    },
    cancel,
    dispose() {
      cancel(); disposed = true; listeners.clear()
    },
  }
}
