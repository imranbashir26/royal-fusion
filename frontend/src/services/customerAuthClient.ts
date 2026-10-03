import { isVariantId } from './productVariants.ts'

export interface CustomerProfile {
  id: string; name: string; email: string; phone: string; address: string; city: string; province: string
}
export type CustomerProfileUpdate = Pick<CustomerProfile, 'name' | 'phone'>
export class CustomerAuthError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}
type Session = { authenticated: boolean; csrfToken: string; administrator?: unknown;
  identity?: { id: string; emailVerified: boolean } }
export function createCustomerAuthClient(fetcher: typeof fetch = fetch, baseUrl = import.meta.env?.VITE_API_URL || '/api') {
  async function request<T>(path: string, method = 'GET', body?: unknown, csrf = ''): Promise<T> {
    const response = await fetcher(`${baseUrl}${path}`, { method, credentials: 'include',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-RF-CSRF': csrf } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) })
    if (response.status === 204 && response.ok) return undefined as T
    const envelope = await response.json().catch(() => null)
    if (!response.ok) throw new CustomerAuthError(envelope?.error?.code ?? 'AUTH_SERVICE_UNAVAILABLE', envelope?.error?.message ?? 'Account access is temporarily unavailable.')
    if (!envelope?.data) throw new CustomerAuthError('INVALID_RESPONSE', 'Account access is temporarily unavailable.')
    return envelope.data as T
  }
  async function session() {
    const value = await request<Session>('/v1/auth/session')
    if (typeof value.authenticated !== 'boolean' || typeof value.csrfToken !== 'string') throw new CustomerAuthError('INVALID_RESPONSE', 'Account session is unavailable.')
    if (value.authenticated && (value.administrator || !isVariantId(value.identity?.id) || !value.identity?.emailVerified))
      throw new CustomerAuthError('PERMISSION_DENIED', 'A verified customer session is required.')
    return value
  }
  async function profile(s: Session) {
    const value = await request<CustomerProfile>('/v1/customer/profile')
    if (value.id !== s.identity?.id || !isVariantId(value.id) || !['name','email','phone','address','city','province'].every(k => typeof value[k as keyof CustomerProfile] === 'string'))
      throw new CustomerAuthError('INVALID_RESPONSE', 'Account profile is unavailable.')
    return value
  }
  return {
    async restore() { const s = await session(); return s.authenticated ? profile(s) : null },
    async signIn({ identifier, password }: { identifier: string; password: string }) {
      const s = await session()
      await request('/v1/auth/signin', 'POST', { email: identifier.trim(), password }, s.csrfToken)
      const signed = await session()
      if (!signed.authenticated) throw new CustomerAuthError('AUTH_REQUIRED', 'Please sign in.')
      return profile(signed)
    },
    async signUp({ name, email, phone, password }: { name: string; email: string; phone: string; password: string }) {
      const s = await session()
      await request('/v1/auth/signup', 'POST', { fullName: name.trim(), email: email.trim(), phone: phone.trim(), password }, s.csrfToken)
    },
    async updateProfile(value: CustomerProfileUpdate) {
      const s = await session()
      if (!s.authenticated) throw new CustomerAuthError('AUTH_REQUIRED', 'Please sign in.')
      await request('/v1/customer/profile', 'PATCH', { name: value.name, phone: value.phone }, s.csrfToken)
      return profile(s)
    },
    async logout() { const s = await session(); if (s.authenticated) await request('/v1/auth/signout', 'POST', undefined, s.csrfToken) },
  }
}
export const customerAuthClient = createCustomerAuthClient()
