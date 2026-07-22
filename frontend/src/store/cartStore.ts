import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartItem, Product } from '../types'

interface CartState {
  items: CartItem[]
  selectedLineIds: string[]
  isCartOpen: boolean
  openCart: () => void
  closeCart: () => void
  addItem: (product: Product, size?: string, quantity?: number) => void
  removeItem: (productId: string, size: string) => void
  removeItems: (lineIds: string[]) => void
  updateQuantity: (productId: string, size: string, quantity: number) => void
  toggleItemSelection: (lineId: string) => void
  setAllItemsSelected: (selected: boolean) => void
  clearCart: () => void
  getItemCount: () => number
}

interface PersistedCartState {
  items: CartItem[]
  selectedLineIds: string[]
}

export function getCartLineId(productId: string, size: string) {
  return JSON.stringify([productId, size])
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      selectedLineIds: [],
      isCartOpen: false,
      openCart: () => set({ isCartOpen: true }),
      closeCart: () => set({ isCartOpen: false }),
      addItem: (product, size = product.sizeOptions[0]?.value ?? 'Default', quantity = 1) =>
        set((state) => {
          const lineId = getCartLineId(product.id, size)
          const existing = state.items.find(
            (item) => item.lineId === lineId,
          )

          if (existing) {
            return {
              isCartOpen: true,
              selectedLineIds: state.selectedLineIds.includes(lineId)
                ? state.selectedLineIds
                : [...state.selectedLineIds, lineId],
              items: state.items.map((item) =>
                item.lineId === lineId
                  ? { ...item, quantity: item.quantity + quantity }
                  : item,
              ),
            }
          }

          return {
            isCartOpen: true,
            items: [...state.items, { lineId, productId: product.id, size, quantity }],
            selectedLineIds: [...state.selectedLineIds, lineId],
          }
        }),
      removeItem: (productId, size) =>
        set((state) => {
          const lineId = getCartLineId(productId, size)
          return {
            items: state.items.filter((item) => item.lineId !== lineId),
            selectedLineIds: state.selectedLineIds.filter((id) => id !== lineId),
          }
        }),
      removeItems: (lineIds) =>
        set((state) => {
          const removed = new Set(lineIds)
          return {
            items: state.items.filter((item) => !removed.has(item.lineId)),
            selectedLineIds: state.selectedLineIds.filter((id) => !removed.has(id)),
          }
        }),
      updateQuantity: (productId, size, quantity) =>
        set((state) => ({
          items: state.items
            .map((item) =>
              item.productId === productId && item.size === size
                ? { ...item, quantity: Math.max(1, quantity) }
                : item,
            )
            .filter((item) => item.quantity > 0),
        })),
      toggleItemSelection: (lineId) =>
        set((state) => ({
          selectedLineIds: state.selectedLineIds.includes(lineId)
            ? state.selectedLineIds.filter((id) => id !== lineId)
            : [...state.selectedLineIds, lineId],
        })),
      setAllItemsSelected: (selected) =>
        set((state) => ({
          selectedLineIds: selected ? state.items.map((item) => item.lineId) : [],
        })),
      clearCart: () => set({ items: [], selectedLineIds: [] }),
      getItemCount: () => get().items.reduce((total, item) => total + item.quantity, 0),
    }),
    {
      name: 'royal-fusion-cart',
      partialize: (state): PersistedCartState => ({
        items: state.items,
        selectedLineIds: state.selectedLineIds,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<PersistedCartState> & {
          items?: Array<Partial<CartItem> & Pick<CartItem, 'productId' | 'size' | 'quantity'>>
        }
        const items = (persisted.items ?? []).map((item) => ({
          lineId: item.lineId ?? getCartLineId(item.productId, item.size),
          productId: item.productId,
          size: item.size,
          quantity: item.quantity,
        }))
        const validLineIds = new Set(items.map((item) => item.lineId))
        const selectedLineIds = Array.isArray(persisted.selectedLineIds)
          ? persisted.selectedLineIds.filter((lineId) => validLineIds.has(lineId))
          : items.map((item) => item.lineId)

        return { ...currentState, items, selectedLineIds }
      },
    },
  ),
)
