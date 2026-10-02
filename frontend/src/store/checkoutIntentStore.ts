import { create } from 'zustand'
import type { CanonicalOrderReceipt, CanonicalOrderRequest } from '../types/index.ts'
import { isOrderReceipt } from '../services/checkoutClient.ts'
import { isVariantId } from '../services/productVariants.ts'
import { useCartStore } from './cartStore.ts'
import { aggregateRequestItems, validIntent, type CheckoutIntent, type PurchasedLine, type ConsumptionResult } from './checkoutAttempt.ts'
export type { CheckoutIntent, PurchasedLine } from './checkoutAttempt.ts'
interface Completion { intent: CheckoutIntent; receipt: CanonicalOrderReceipt; consumption: Exclude<ConsumptionResult, 'recovery-required'> }
interface Recovery { attemptId: string | null; reason: string }
type HydrationStatus = 'absent' | 'active' | 'completed' | 'reset' | 'recovery_required'
interface IntentState {
  hydrationStatus: HydrationStatus
  intent: CheckoutIntent | null
  receipt: CanonicalOrderReceipt | null
  completion: Completion | null
  pendingReceipt: CanonicalOrderReceipt | null
  recovery: Recovery | null
  freeze: (request: Omit<CanonicalOrderRequest, 'idempotencyKey'>, lines: PurchasedLine[]) => CheckoutIntent
  complete: (receipt: CanonicalOrderReceipt) => Promise<void>
  newAttempt: () => void
}
interface Storage { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }
const key = 'royal-fusion-checkout-intent-v1'
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const exactKeys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every((name) => Object.hasOwn(value, name))
const boundReceipt = (receipt: unknown, intent: CheckoutIntent): receipt is CanonicalOrderReceipt =>
  isOrderReceipt(receipt) && receipt.idempotencyKey === intent.request.idempotencyKey && receipt.paymentMethod === intent.request.paymentMethod
const validCompletion = (value: unknown): value is Completion => {
  if (!object(value) || !exactKeys(value, ['intent', 'receipt', 'consumption'])) return false
  const record = value
  return validIntent(record.intent) && boundReceipt(record.receipt, record.intent)
    && typeof record.consumption === 'string' && ['consumed', 'already-consumed', 'cart-replaced'].includes(record.consumption)
}
function immutable<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value) }
  return value
}
type Saved = Pick<IntentState, 'intent' | 'completion' | 'pendingReceipt' | 'recovery'>
interface Hydration { status: HydrationStatus; saved: Saved }
function hydrate(storage: Storage | undefined): Hydration {
  const empty: Saved = { intent: null, completion: null, pendingReceipt: null, recovery: null }
  const unresolved = (saved = empty): Hydration => ({ status: 'recovery_required', saved: { ...saved, recovery: {
    attemptId: saved.intent?.request.idempotencyKey ?? null,
    reason: 'The saved attempt is unreadable or requires recovery and may already have been submitted. Retry its original request if available; do not silently start another order.',
  } } })
  try {
    if (!storage) return unresolved()
    const serialized = storage.getItem(key)
    // A missing key is the only implicit fresh state. Parsed falsy values are corruption.
    if (serialized === null) return { status: 'absent', saved: empty }
    if (typeof serialized !== 'string') return unresolved()
    const raw: unknown = JSON.parse(serialized)
    if (!object(raw) || raw.version !== 2) return unresolved()
    const intent = validIntent(raw.intent) ? immutable(raw.intent) : null
    const completion = validCompletion(raw.completion) ? immutable(raw.completion) : null
    const pendingReceipt = intent && boundReceipt(raw.pendingReceipt, intent) ? immutable(raw.pendingReceipt) : null
    const saved: Saved = { intent, completion, pendingReceipt, recovery: null }
    const fields = ['version', 'intent', 'completion', 'pendingReceipt', 'recovery']
    // An explicit reset has its own marker; an unexplained empty envelope is not absence.
    if (raw.reset === true && exactKeys(raw, [...fields, 'reset']) && fields.slice(1).every((name) => raw[name] === null)) {
      return { status: 'reset', saved: empty }
    }
    const recoveryValid = raw.recovery === null || object(raw.recovery) && exactKeys(raw.recovery, ['attemptId', 'reason'])
      && (raw.recovery.attemptId === null || isVariantId(raw.recovery.attemptId)) && typeof raw.recovery.reason === 'string'
      && raw.recovery.attemptId === (intent?.request.idempotencyKey ?? null)
    if (!exactKeys(raw, fields) || raw.intent !== null && !intent || raw.completion !== null && !completion
      || raw.pendingReceipt !== null && !pendingReceipt || !recoveryValid
      || intent && completion?.intent.request.idempotencyKey === intent.request.idempotencyKey) return unresolved(saved)
    if (raw.recovery !== null || pendingReceipt) return unresolved(saved)
    if (intent) return { status: 'active', saved }
    if (completion) return { status: 'completed', saved }
    return unresolved(saved)
  } catch {
    // Read/access exceptions never imply that a potentially submitted attempt is absent.
    return unresolved()
  }
}
export function createCheckoutIntentStore(storage?: Storage, uuid = () => crypto.randomUUID(),
  consume = (attemptId: string, orderId: string, lines: PurchasedLine[]) => useCartStore.getState().consumePurchased(attemptId, orderId, lines)) {
  const getStorage = () => storage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage)
  let hydration: Hydration
  try { hydration = hydrate(getStorage()) } catch { hydration = hydrate(undefined) }
  const initial = hydration.saved
  const write = (value: Saved, reset = false) => {
    const target = getStorage()
    if (!target) throw new Error('Your checkout attempt could not be saved.')
    target.setItem(key, JSON.stringify({ version: 2, ...value, ...(reset ? { reset: true } : {}) }))
  }
  return create<IntentState>()((set, get) => ({ ...initial, hydrationStatus: hydration.status, receipt: initial.completion?.receipt ?? null,
    freeze: (request, lines) => {
      if (get().recovery) throw new Error('The saved checkout attempt requires explicit recovery.')
      if (get().intent) return get().intent!
      const grouped = aggregateRequestItems(request.items)
      if (!grouped) throw new Error('Invalid checkout items.')
      const intent = JSON.parse(JSON.stringify({ request: { ...request,
        items: [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([variantId, quantity]) => ({ variantId, quantity })), idempotencyKey: uuid() }, lines })) as CheckoutIntent
      if (!validIntent(intent)) throw new Error('Invalid checkout intent.')
      const frozen = immutable(intent)
      write({ intent: frozen, completion: get().completion, pendingReceipt: null, recovery: null })
      set({ intent: frozen, pendingReceipt: null, recovery: null, hydrationStatus: 'active' }); return frozen
    },
    complete: async (receipt) => {
      const intent = get().intent
      if (!intent) {
        if (get().completion?.receipt.id === receipt.id && get().completion?.receipt.idempotencyKey === receipt.idempotencyKey) return
        throw new Error('No matching checkout attempt.')
      }
      if (!validIntent(intent) || !boundReceipt(receipt, intent)) throw new Error('Invalid checkout receipt or attempt identity.')
      const validated = immutable(structuredClone(receipt))
      write({ intent, completion: get().completion, pendingReceipt: validated, recovery: null })
      set({ pendingReceipt: validated })
      try {
        const result = await consume(intent.request.idempotencyKey, validated.id, intent.lines)
        if (result === 'recovery-required') throw new Error('Cart cleanup requires recovery. Your confirmed order has not been submitted again.')
        if (get().intent !== intent) throw new Error('Checkout attempt changed during completion.')
        const completion = immutable({ intent, receipt: validated, consumption: result })
        write({ intent: null, completion, pendingReceipt: null, recovery: null })
        set({ intent: null, completion, receipt: validated, pendingReceipt: null, recovery: null, hydrationStatus: 'completed' })
      } catch (error) {
        const recovery = { attemptId: intent.request.idempotencyKey, reason: 'Your saved order result requires recovery. Retry the same attempt; do not start another order.' }
        write({ intent, completion: get().completion, pendingReceipt: validated, recovery })
        set({ recovery, hydrationStatus: 'recovery_required' }); throw error
      }
    },
    newAttempt: () => {
      write({ intent: null, completion: get().completion, pendingReceipt: null, recovery: null }, !get().completion)
      set({ intent: null, pendingReceipt: null, recovery: null, hydrationStatus: get().completion ? 'completed' : 'reset' })
    },
  }))
}
export const useCheckoutIntentStore = createCheckoutIntentStore()
