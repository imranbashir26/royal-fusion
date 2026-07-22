import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface WishlistState {
  productIds: string[]
  toggle: (productId: string) => void
  add: (productId: string) => void
  remove: (productId: string) => void
  has: (productId: string) => boolean
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      productIds: [],
      toggle: (productId) =>
        set((state) => ({
          productIds: state.productIds.includes(productId)
            ? state.productIds.filter((id) => id !== productId)
            : [...state.productIds, productId],
        })),
      add: (productId) =>
        set((state) => ({
          productIds: state.productIds.includes(productId)
            ? state.productIds
            : [...state.productIds, productId],
        })),
      remove: (productId) =>
        set((state) => ({
          productIds: state.productIds.filter((id) => id !== productId),
        })),
      has: (productId) => get().productIds.includes(productId),
    }),
    {
      name: 'royal-fusion-wishlist',
    },
  ),
)
