/* eslint-disable react/only-export-components */
import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { fallbackStorefrontData, storefrontService } from '../services/storefrontService'
import type { StorefrontData } from '../types/admin'
import { useCartStore } from '../store/cartStore'
import { applyCatalogRefresh } from '../services/catalogRefresh'

interface StorefrontContextValue extends StorefrontData {
  isLoading: boolean
  catalogError: string | null
  refresh: () => Promise<void>
}

const StorefrontContext = createContext<StorefrontContextValue | null>(null)

export function StorefrontProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<StorefrontData>(fallbackStorefrontData)
  const [isLoading, setIsLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  const refresh = async () => {
    setIsLoading(true)
    const nextData = await storefrontService.getStorefrontData()
    // Reconciliation stays outside React's state updater (which may be replayed).
    if (nextData.catalogLoad.status === 'success') useCartStore.getState().reconcile(nextData.products)
    setData((previous) => applyCatalogRefresh(previous, nextData))
    setCatalogError(nextData.catalogLoad.status === 'failed' ? nextData.catalogLoad.error : null)
    setIsLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const value = useMemo(
    () => ({
      ...data,
      isLoading,
      catalogError,
      refresh,
    }),
    [data, isLoading, catalogError],
  )

  return <StorefrontContext.Provider value={value}>{children}</StorefrontContext.Provider>
}

export function useStorefront() {
  const context = useContext(StorefrontContext)
  if (!context) {
    throw new Error('useStorefront must be used inside StorefrontProvider')
  }
  return context
}
