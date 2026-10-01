import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import type { CartItem, Product } from '../types/index.ts'
import { isVariantEligible, resolveCartItem } from '../services/productVariants.ts'
import { CART_VERSION, getCartLineId, reconcileCartState, restoreCartState, sameCartState, type PersistedCartState } from './cartPersistence.ts'

export { getCartLineId } from './cartPersistence.ts'

interface CartState extends PersistedCartState {
  isCartOpen: boolean
  openCart: () => void
  closeCart: () => void
  addItem: (product: Product, variantId: string, quantity?: number) => boolean
  removeItem: (lineId: string) => void
  removeItems: (lineIds: string[]) => void
  updateQuantity: (lineId: string, quantity: number, products: Product[]) => boolean
  reconcile: (products: Product[]) => void
  toggleItemSelection: (lineId: string) => void
  setAllItemsSelected: (selected: boolean) => void
  clearCart: () => void
  getItemCount: () => number
}

export function createCartStore(storage?: StateStorage) {
  return create<CartState>()(persist((set, get) => ({
    items: [], selectedLineIds: [], isCartOpen: false,
    openCart: () => set({ isCartOpen: true }),
    closeCart: () => set({ isCartOpen: false }),
    addItem: (product, variantId, quantity = 1) => {
      const variant = product.variants?.find((candidate) => candidate.id === variantId && candidate.productId === product.id)
      if (!isVariantEligible(variant, quantity)) return false
      const reconciled = reconcileCartState(get(), [product])
      const lineId = getCartLineId(product.id, variantId)
      const existing = reconciled.items.find((item) => item.lineId === lineId)
      const total = (existing?.quantity ?? 0) + quantity
      if (!isVariantEligible(variant, total)) return false
      const item: CartItem = { lineId, productId: product.id, variantId, identity: 'canonical', size: variant.optionValue, quantity: total }
      set({ ...reconciled, isCartOpen: true,
        items: existing ? reconciled.items.map((current) => current.lineId === lineId ? item : current) : [...reconciled.items, item],
        selectedLineIds: [...new Set([...reconciled.selectedLineIds, lineId])],
      })
      return true
    },
    removeItem: (lineId) => get().removeItems([lineId]),
    removeItems: (lineIds) => {
      const removed = new Set(lineIds)
      set((state) => ({ items: state.items.filter((item) => !removed.has(item.lineId)),
        selectedLineIds: state.selectedLineIds.filter((id) => !removed.has(id)) }))
    },
    updateQuantity: (lineId, quantity, products) => {
      const item = get().items.find((candidate) => candidate.lineId === lineId)
      if (!item || !resolveCartItem({ ...item, quantity }, products).eligible) return false
      set((state) => ({ items: state.items.map((current) => current.lineId === lineId ? { ...current, quantity } : current) }))
      return true
    },
    reconcile: (products) => {
      const current = get()
      const next = reconcileCartState(current, products)
      // Check before set: persist writes even when a Zustand updater returns its input.
      if (!sameCartState(current, next)) set(next)
    },
    toggleItemSelection: (lineId) => set((state) => ({ selectedLineIds: state.selectedLineIds.includes(lineId)
      ? state.selectedLineIds.filter((id) => id !== lineId) : [...state.selectedLineIds, lineId] })),
    setAllItemsSelected: (selected) => set((state) => ({ selectedLineIds: selected ? state.items.map((item) => item.lineId) : [] })),
    clearCart: () => set({ items: [], selectedLineIds: [] }),
    getItemCount: () => get().items.reduce((total, item) => total + item.quantity, 0),
  }), {
    name: 'royal-fusion-cart', version: CART_VERSION,
    storage: createJSONStorage(() => storage ?? localStorage),
    partialize: (state): PersistedCartState => ({ items: state.items, selectedLineIds: state.selectedLineIds }),
    migrate: (state, version) => restoreCartState(state, version),
    merge: (persisted, current) => ({ ...current, ...restoreCartState(persisted, CART_VERSION) }),
  }))
}

export const useCartStore = createCartStore()
