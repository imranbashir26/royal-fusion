/* eslint-disable react/only-export-components */
import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { fallbackStorefrontData, storefrontService } from '../services/storefrontService'
import type { StorefrontData } from '../types/admin'

interface StorefrontContextValue extends StorefrontData {
  isLoading: boolean
  refresh: () => Promise<void>
}

const StorefrontContext = createContext<StorefrontContextValue | null>(null)

export function StorefrontProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<StorefrontData>(fallbackStorefrontData)
  const [isLoading, setIsLoading] = useState(true)

  const refresh = async () => {
    setIsLoading(true)
    const nextData = await storefrontService.getStorefrontData()
    setData(nextData)
    setIsLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const value = useMemo(
    () => ({
      ...data,
      isLoading,
      refresh,
    }),
    [data, isLoading],
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
