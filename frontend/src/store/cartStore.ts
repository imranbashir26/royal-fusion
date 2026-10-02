import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import type { CartItem, Product } from '../types/index.ts'
import { validPurchasedLines, type PurchasedLine, type ConsumptionResult } from './checkoutAttempt.ts'
import { isVariantEligible, isVariantId, resolveCartItem } from '../services/productVariants.ts'
import { CART_VERSION, getCartLineId, reconcileCartState, restoreCartState, sameCartState, type PersistedCartState } from './cartPersistence.ts'
export { getCartLineId } from './cartPersistence.ts'
const cartKey = 'royal-fusion-cart'
const completionKey = (attemptId: string) => `royal-fusion-consumption-v1:${attemptId}`
const claimKey = (attemptId: string) => `${completionKey(attemptId)}:claim`
const unitsKey = (entryId: string) => `royal-fusion-consumed-units-v1:${entryId}`
let queue: Promise<unknown> = Promise.resolve()
export const checkoutCompletionAvailable = () => typeof window === 'undefined'
  || typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function'
async function withConsumptionLock<T>(action: () => T): Promise<T> {
  // Use real browser locks in the storefront; Node fixtures use a shared queue.
  if (typeof window !== 'undefined') {
    if (checkoutCompletionAvailable()) return navigator.locks.request('royal-fusion-cart-consumption-v1', action)
    throw new Error('Safe cart recovery is unavailable in this browser.')
  }
  const result = queue.then(action); queue = result.catch(() => {}); return result
}
interface CartState extends PersistedCartState {
  lineInstances: Record<string, string>
  lineAppliedUnits: Record<string, number>
  isCartOpen: boolean
  openCart: () => void
  closeCart: () => void
  addItem: (product: Product, variantId: string, quantity?: number) => boolean
  removeItem: (lineId: string) => void
  removeItems: (lineIds: string[]) => void
  capturePurchase: (lines: Omit<PurchasedLine, 'entryId'>[]) => PurchasedLine[]
  consumePurchased: (attemptId: string, orderId: string, lines: PurchasedLine[]) => Promise<ConsumptionResult>
  syncFromStorage: () => void
  updateQuantity: (lineId: string, quantity: number, products: Product[]) => boolean
  reconcile: (products: Product[]) => void
  toggleItemSelection: (lineId: string) => void
  setAllItemsSelected: (selected: boolean) => void
  clearCart: () => void
  getItemCount: () => number
}
function instances(items: CartItem[], raw: unknown, fallback: Record<string, string> = {}) {
  const saved = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return Object.fromEntries(items.map((item) => [item.lineId, isVariantId(saved[item.lineId]) ? saved[item.lineId] : fallback[item.lineId] ?? crypto.randomUUID()])) as Record<string, string>
}
export function createCartStore(storage?: StateStorage) {
  const disk = () => storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
  const consumedUnits = (entryId: string): number => {
    const serialized = disk()?.getItem(unitsKey(entryId))
    if (serialized instanceof Promise) throw new Error('Synchronous cart storage is required.')
    if (!serialized) return 0
    const record = JSON.parse(serialized) as { version: number; entryId: string; quantity: number }
    if (record.version !== 1 || record.entryId !== entryId || !Number.isSafeInteger(record.quantity) || record.quantity < 0) throw new Error('Cart consumption history requires recovery.')
    return record.quantity
  }
  const project = (persisted: unknown, version: number, current: Partial<CartState>) => {
    const restored = restoreCartState(persisted, version), raw = persisted as Partial<CartState> | null
    const savedInstances = { ...raw?.lineInstances }, safeFallback: Record<string, string> = {}
    for (const [id, instance] of Object.entries(current.lineInstances ?? {})) if (consumedUnits(instance) === 0) safeFallback[id] = instance
    for (const item of restored.items) {
      const entry = savedInstances[item.lineId]
      // A writer missing journal metadata cannot establish the old cart incarnation.
      if (isVariantId(entry) && consumedUnits(entry) > 0 && raw?.lineAppliedUnits?.[item.lineId] === undefined) delete savedInstances[item.lineId]
    }
    const lineInstances = instances(restored.items, savedInstances, safeFallback)
    const lineAppliedUnits: Record<string, number> = {}
    const items = restored.items.flatMap((item) => {
      const total = consumedUnits(lineInstances[item.lineId]), applied = raw?.lineAppliedUnits?.[item.lineId] ?? 0
      if (!Number.isSafeInteger(applied) || applied < 0 || applied > total) throw new Error('Saved cart requires recovery.')
      const quantity = item.quantity - (total - applied)
      if (quantity <= 0) { delete lineInstances[item.lineId]; return [] }
      lineAppliedUnits[item.lineId] = total
      return [{ ...item, quantity }]
    })
    return { items, selectedLineIds: restored.selectedLineIds.filter((id) => items.some((item) => item.lineId === id)), lineInstances, lineAppliedUnits }
  }
  const appliedFor = (items: CartItem[], state: CartState) => Object.fromEntries(items.map((item) => [item.lineId, state.lineAppliedUnits[item.lineId] ?? 0]))
  let sync = () => {}
  const store = create<CartState>()(persist((set, get) => ({
    items: [], selectedLineIds: [], lineInstances: {}, lineAppliedUnits: {}, isCartOpen: false,
    syncFromStorage: () => sync(),
    capturePurchase: (lines) => {
      sync()
      const state = get()
      const purchased = lines.map((line) => {
        const item = state.items.find((item) => item.lineId === line.lineId && item.variantId === line.variantId && item.identity === 'canonical')
        if (!item || item.quantity !== line.quantity) throw new Error('Your cart changed. Review it before ordering.')
        return { ...line, entryId: state.lineInstances[line.lineId] }
      })
      if (!validPurchasedLines(purchased) || !disk()) throw new Error('Your cart could not be saved.')
      // Persist instance identities before persisting or sending the frozen request.
      set({ lineInstances: state.lineInstances })
      return purchased
    },
    consumePurchased: async (attemptId, orderId, lines) => {
      if (!isVariantId(attemptId) || !isVariantId(orderId) || !validPurchasedLines(lines)) throw new Error('Invalid purchased snapshot.')
      return withConsumptionLock(() => {
        const target = disk()
        if (!target) throw new Error('Your cart could not be saved.')
        const record = JSON.stringify({ version: 1, attemptId, orderId, lines: [...lines].sort((a, b) => a.lineId.localeCompare(b.lineId)) })
        const completed = target.getItem(completionKey(attemptId))
        const claim = target.getItem(claimKey(attemptId))
        if (completed instanceof Promise || claim instanceof Promise) throw new Error('Synchronous cart storage is required.')
        if (completed) return completed === record ? 'already-consumed' : 'recovery-required'
        // A crash or failed cart write after claiming is never replayed against a later cart.
        if (claim) return 'recovery-required'
        sync()
        const state = get()
        const serialized = target.getItem(cartKey)
        if (serialized instanceof Promise) throw new Error('Synchronous cart storage is required.')
        const persisted = serialized ? JSON.parse(serialized) as { state?: Partial<CartState> } : null
        // Missing metadata (for example an older client write) is never proof of an old entry.
        const matching = lines.filter((line) => persisted?.state?.lineInstances?.[line.lineId] === line.entryId
          && state.lineInstances[line.lineId] === line.entryId
          && state.items.some((item) => item.lineId === line.lineId && item.variantId === line.variantId))
        const result = matching.length ? 'consumed' : 'cart-replaced'
        // Per-attempt records are never pruned or overwritten by ordinary cart updates.
        const claimed = target.setItem(claimKey(attemptId), record)
        if (claimed instanceof Promise) throw new Error('Synchronous cart storage is required.')
        // Completion never writes a whole-cart snapshot. Durable entry deltas are
        // projected onto whichever cart is current, and never onto a new entry UUID.
        for (const line of matching) {
          const quantity = consumedUnits(line.entryId) + line.quantity
          const written = target.setItem(unitsKey(line.entryId), JSON.stringify({ version: 1, entryId: line.entryId, quantity }))
          if (written instanceof Promise) throw new Error('Synchronous cart storage is required.')
        }
        const finished = target.setItem(completionKey(attemptId), record)
        if (finished instanceof Promise) throw new Error('Synchronous cart storage is required.')
        sync()
        return result
      })
    },
    openCart: () => { sync(); set({ isCartOpen: true }) },
    closeCart: () => { sync(); set({ isCartOpen: false }) },
    addItem: (product, variantId, quantity = 1) => {
      sync()
      const variant = product.variants?.find((candidate) => candidate.id === variantId && candidate.productId === product.id)
      if (!isVariantEligible(variant, quantity)) return false
      const reconciled = reconcileCartState(get(), [product])
      const lineId = getCartLineId(product.id, variantId)
      const existing = reconciled.items.find((item) => item.lineId === lineId)
      const total = (existing?.quantity ?? 0) + quantity
      if (!isVariantEligible(variant, total)) return false
      const item: CartItem = { lineId, productId: product.id, variantId, identity: 'canonical', size: variant.optionValue, quantity: total }
      const items = existing ? reconciled.items.map((current) => current.lineId === lineId ? item : current) : [...reconciled.items, item]
      set({ ...reconciled, isCartOpen: true, items, lineInstances: instances(items, get().lineInstances), lineAppliedUnits: appliedFor(items, get()),
        selectedLineIds: [...new Set([...reconciled.selectedLineIds, lineId])],
      })
      return true
    },
    removeItem: (lineId) => get().removeItems([lineId]),
    removeItems: (lineIds) => {
      sync(); const removed = new Set(lineIds), state = get(), items = state.items.filter((item) => !removed.has(item.lineId))
      set({ items, lineInstances: instances(items, state.lineInstances), lineAppliedUnits: appliedFor(items, state), selectedLineIds: state.selectedLineIds.filter((id) => !removed.has(id)) })
    },
    updateQuantity: (lineId, quantity, products) => {
      sync(); const item = get().items.find((candidate) => candidate.lineId === lineId)
      if (!item || !resolveCartItem({ ...item, quantity }, products).eligible) return false
      set((state) => ({ items: state.items.map((current) => current.lineId === lineId ? { ...current, quantity } : current) }))
      return true
    },
    reconcile: (products) => {
      sync(); const current = get(), next = reconcileCartState(current, products)
      if (!sameCartState(current, next)) set({ ...next, lineInstances: instances(next.items, current.lineInstances), lineAppliedUnits: appliedFor(next.items, current) })
    },
    toggleItemSelection: (lineId) => {
      sync(); set((state) => ({ selectedLineIds: state.selectedLineIds.includes(lineId)
        ? state.selectedLineIds.filter((id) => id !== lineId) : [...state.selectedLineIds, lineId] }))
    },
    setAllItemsSelected: (selected) => { sync(); set((state) => ({ selectedLineIds: selected ? state.items.map((item) => item.lineId) : [] })) },
    clearCart: () => { sync(); set({ items: [], selectedLineIds: [], lineInstances: {}, lineAppliedUnits: {} }) },
    getItemCount: () => get().items.reduce((total, item) => total + item.quantity, 0),
  }), {
    name: cartKey, version: CART_VERSION,
    storage: createJSONStorage(() => disk()!),
    partialize: (state) => ({ items: state.items, selectedLineIds: state.selectedLineIds, lineInstances: state.lineInstances, lineAppliedUnits: state.lineAppliedUnits }),
    migrate: (state, version) => restoreCartState(state, version),
    merge: (persisted, current) => {
      return { ...current, ...project(persisted, CART_VERSION, current) }
    },
  }))
  sync = () => {
    const saved = disk()?.getItem(cartKey)
    if (!saved || saved instanceof Promise) return
    let parsed: { state?: Partial<CartState>; version?: number }
    try { parsed = JSON.parse(saved) } catch { throw new Error('Saved cart requires recovery.') }
    const current = store.getState(), restored = project(parsed.state, parsed.version ?? 1, current)
    // Middleware hydration uses its underlying setter without writing back. Writing
    // during a storage event can race another tab and resurrect an older snapshot.
    if (!sameCartState(current, restored) || JSON.stringify(current.lineInstances) !== JSON.stringify(restored.lineInstances)
      || JSON.stringify(current.lineAppliedUnits) !== JSON.stringify(restored.lineAppliedUnits)) store.persist.rehydrate()
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', (event) => { if (event.key === cartKey || event.key?.startsWith('royal-fusion-consumed-units-v1:')) { try { sync() } catch { /* Checkout capture fails closed. */ } } })
  return store
}
export const useCartStore = createCartStore()
