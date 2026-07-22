/* eslint-disable react/only-export-components */
import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { adminApi, adminToken } from '../services/adminApi'
import type { AdminUser } from '../types/admin'

interface AdminAuthContextValue {
  user: AdminUser | null
  permissions: string[]
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  can: (permission: string) => boolean
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null)

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(Boolean(adminToken.get()))

  useEffect(() => {
    const token = adminToken.get()
    if (!token) return

    adminApi
      .me()
      .then((session) => {
        setUser(session.user)
        setPermissions(session.permissions)
      })
      .catch(() => {
        adminToken.clear()
      })
      .finally(() => setIsLoading(false))
  }, [])

  const login = async (email: string, password: string) => {
    const session = await adminApi.login({ email, password })
    adminToken.set(session.token)
    setUser(session.user)
    setPermissions(session.permissions)
  }

  const logout = () => {
    adminToken.clear()
    setUser(null)
    setPermissions([])
  }

  const value = useMemo(
    () => ({
      user,
      permissions,
      isLoading,
      isAuthenticated: Boolean(user),
      login,
      logout,
      can: (permission: string) =>
        permissions.includes('*') || permissions.includes(permission),
    }),
    [isLoading, permissions, user],
  )

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext)
  if (!context) {
    throw new Error('useAdminAuth must be used inside AdminAuthProvider')
  }
  return context
}
