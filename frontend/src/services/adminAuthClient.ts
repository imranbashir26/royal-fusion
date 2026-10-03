import { API_BASE_URL } from './apiClient'

export interface AuthIdentity {
  id: string
  email: string
  emailVerified: boolean
}

export interface Administrator {
  userId: string
  name: string
  role: string
  roleKey: 'admin'
  permissions: string[]
}

export interface AuthSession {
  authenticated: boolean
  identity?: AuthIdentity
  administrator?: Administrator | null
  csrfToken: string
}

export class AdminAuthError extends Error {
  code: string
  status: number

  constructor(message: string, code: string, status = 0) {
    super(message)
    this.code = code
    this.status = status
  }
}

let csrfToken = ''

async function request(path: string, options: RequestInit = {}): Promise<AuthSession> {
  const response = await fetch(`${API_BASE_URL}/v1/auth${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.method && options.method !== 'GET' ? { 'X-RF-CSRF': csrfToken || csrfCookie() } : {}),
      ...options.headers,
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new AdminAuthError(
      body?.error?.message || 'Authentication is temporarily unavailable.',
      body?.error?.code || 'AUTH_SERVICE_UNAVAILABLE',
      response.status,
    )
  }
  if (response.status === 204) {
    csrfToken = ''
    return { authenticated: false, csrfToken: '' }
  }
  const body = await response.json() as { data: AuthSession }
  csrfToken = body.data.csrfToken
  return body.data
}

function csrfCookie() {
  const name = window.location.protocol === 'https:' ? '__Host-rf-csrf' : 'rf-dev-csrf'
  return document.cookie.split('; ').find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || ''
}

export const adminAuthClient = {
  session: () => request('/session'),
  async signIn(email: string, password: string, verificationCode?: string) {
    try {
      await request('/session')
    } catch (error) {
      if (!(error instanceof AdminAuthError) || ![
        'INVALID_CREDENTIALS', 'SESSION_EXPIRED', 'SESSION_REVOKED', 'PERMISSION_DENIED',
      ].includes(error.code)) throw error
      // The server cleared stale cookies; obtain one fresh pre-auth CSRF token.
      await request('/session')
    }
    return request('/admin/signin', {
      method: 'POST',
      body: JSON.stringify({ email, password, ...(verificationCode ? { verificationCode } : {}) }),
    })
  },
  refresh: () => request('/refresh', { method: 'POST' }),
  signOut: () => request('/signout', { method: 'POST' }),
  async protectedRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
    const method = options.method ?? 'GET'
    if (method !== 'GET' && !csrfCookie() && !csrfToken) await request('/session')
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-RF-CSRF': csrfCookie() || csrfToken } : {}),
        ...options.headers,
      },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new AdminAuthError(
        body?.error?.message || 'The product request could not be completed.',
        body?.error?.code || 'PRODUCT_SERVICE_ERROR',
        response.status,
      )
    }
    return (await response.json() as { data: T }).data
  },
}
