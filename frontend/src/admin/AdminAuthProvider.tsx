/* eslint-disable react/only-export-components */
import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { adminAuthClient, AdminAuthError, type Administrator, type AuthIdentity, type AuthSession } from '../services/adminAuthClient'

interface AdminAuthContextValue {
  user: { name: string; email: string; role: string } | null
  identity: AuthIdentity | null
  administrator: Administrator | null
  permissions: string[]
  isLoading: boolean
  isAuthenticated: boolean
  isAdministrator: boolean
  login: (email: string, password: string, verificationCode?: string) => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
  can: (permission: string) => boolean
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null)
const permissionAliases: Record<string, string> = {
  'banners:manage': 'homepage.manage',
  'testimonials:manage': 'homepage.manage',
  'contactMessages:manage': 'contact_messages.manage',
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    window.localStorage.removeItem('royal-fusion-admin-token')
    adminAuthClient.session()
      .then((next) => { if (active) setSession(next) })
      .catch(() => { if (active) setSession(null) })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => {
      adminAuthClient.session()
        .then(setSession)
        .catch((error) => {
          if (error instanceof AdminAuthError && [
            'INVALID_CREDENTIALS', 'SESSION_EXPIRED', 'SESSION_REVOKED', 'PERMISSION_DENIED',
          ].includes(error.code)) setSession(null)
        })
    }, 60_000)
    return () => window.clearInterval(interval)
  }, [])

  const login = async (email: string, password: string, verificationCode?: string) => {
    const next = await adminAuthClient.signIn(email, password, verificationCode)
    if (!next.administrator) throw new Error('Administrator access is required.')
    setSession(next)
  }

  const logout = async () => {
    try {
      await adminAuthClient.signOut()
      setSession(null)
    } catch (error) {
      if (error instanceof AdminAuthError && [
        'INVALID_CREDENTIALS', 'SESSION_EXPIRED', 'SESSION_REVOKED', 'AUTH_REQUIRED',
      ].includes(error.code)) {
        setSession(null)
        return
      }
      throw error
    }
  }

  const refreshSession = useCallback(async () => {
    try {
      const next = await adminAuthClient.session()
      setSession(next.authenticated ? next : null)
    } catch (error) {
      if (error instanceof AdminAuthError && [
        'AUTH_REQUIRED', 'INVALID_CREDENTIALS', 'SESSION_EXPIRED', 'SESSION_REVOKED',
      ].includes(error.code)) {
        setSession(null)
        return
      }
      throw error
    }
  }, [])

  const identity = session?.identity ?? null
  const administrator = session?.administrator ?? null
  const permissions = useMemo(() => administrator?.permissions ?? [], [administrator])

  const value = useMemo(
    () => ({
      user: administrator && identity
        ? { name: administrator.name || identity.email, email: identity.email, role: administrator.role }
        : null,
      identity,
      administrator,
      permissions,
      isLoading,
      isAuthenticated: Boolean(identity),
      isAdministrator: Boolean(administrator),
      login,
      logout,
      refreshSession,
      can: (permission: string) => {
        const effective = permissionAliases[permission] ?? permission.replace(':', '.')
        return permissions.includes('*') || permissions.includes(effective)
      },
    }),
    [administrator, identity, isLoading, permissions, refreshSession],
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
