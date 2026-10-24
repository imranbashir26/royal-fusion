/* eslint-disable react/only-export-components */
import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { fallbackStorefrontData, storefrontService } from '../services/storefrontService'
import type { StorefrontData } from '../types/admin'
import { useCartStore } from '../store/cartStore'
import { applyCatalogRefresh, bindPricingActivity, createCatalogRefreshController, staleCatalog } from '../services/catalogRefresh'

interface StorefrontContextValue extends StorefrontData {
  isLoading: boolean
  catalogError: string | null
  refresh: () => Promise<void>
}

const StorefrontContext = createContext<StorefrontContextValue | null>(null)

export function StorefrontProvider({ children, legacyBlogs = true }: { children: ReactNode; legacyBlogs?: boolean }) {
  const [data, setData] = useState<StorefrontData>(fallbackStorefrontData)
  const [isLoading, setIsLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  const controllerRef = useRef<ReturnType<typeof createCatalogRefreshController> | null>(null)
  const refresh = useCallback(() => controllerRef.current?.refresh() ?? Promise.resolve(), [])

  useEffect(() => {
    const controller = createCatalogRefreshController({
      load: () => storefrontService.getStorefrontData({legacyBlogs}), busy: setIsLoading,
      accept(nextData) {
        // Reconciliation stays outside React's replayable state updater.
        useCartStore.getState().reconcile(nextData.products)
        setData(previous => applyCatalogRefresh(previous, nextData)); setCatalogError(null)
      },
      stale: () => setData(previous => staleCatalog(previous)),
      failed: error => setCatalogError(error instanceof Error ? error.message : 'Pricing needs refresh.'),
    })
    controllerRef.current = controller
    const unbind = bindPricingActivity(document, window, refresh)
    void controller.refresh()
    return () => { controller.dispose(); unbind(); if (controllerRef.current === controller) controllerRef.current = null }
  }, [legacyBlogs, refresh])

  const value = useMemo(
    () => ({
      ...data,
      isLoading,
      catalogError,
      refresh,
    }),
    [data, isLoading, catalogError],
  )

  return <StorefrontContext.Provider value={value}>
    {catalogError && <div role="status" className="bg-soft-cream p-3 text-center text-sm">{catalogError} <button type="button" disabled={isLoading} onClick={() => void refresh()} className="underline">Refresh pricing</button></div>}
    {children}
  </StorefrontContext.Provider>
}

export function useStorefront() {
  const context = useContext(StorefrontContext)
  if (!context) {
    throw new Error('useStorefront must be used inside StorefrontProvider')
  }
  return context
}
