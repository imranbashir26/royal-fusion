import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartItem, Product } from '../types'

interface CartState {
  items: CartItem[]
  isCartOpen: boolean
  openCart: () => void
  closeCart: () => void
  addItem: (product: Product, size?: string, quantity?: number) => void
  removeItem: (productId: string, size: string) => void
  updateQuantity: (productId: string, size: string, quantity: number) => void
  clearCart: () => void
  getItemCount: () => number
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isCartOpen: false,
      openCart: () => set({ isCartOpen: true }),
      closeCart: () => set({ isCartOpen: false }),
      addItem: (product, size = product.sizeOptions[0]?.value ?? 'Default', quantity = 1) =>
        set((state) => {
          const existing = state.items.find(
            (item) => item.productId === product.id && item.size === size,
          )

          if (existing) {
            return {
              isCartOpen: true,
              items: state.items.map((item) =>
                item.productId === product.id && item.size === size
                  ? { ...item, quantity: item.quantity + quantity }
                  : item,
              ),
            }
          }

          return {
            isCartOpen: true,
            items: [...state.items, { productId: product.id, size, quantity }],
          }
        }),
      removeItem: (productId, size) =>
        set((state) => ({
          items: state.items.filter(
            (item) => !(item.productId === productId && item.size === size),
          ),
        })),
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
      clearCart: () => set({ items: [] }),
      getItemCount: () => get().items.reduce((total, item) => total + item.quantity, 0),
    }),
    {
      name: 'royal-fusion-cart',
      partialize: (state) => ({ items: state.items }),
    },
  ),
)
