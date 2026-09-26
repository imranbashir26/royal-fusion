import { API_BASE_URL } from './apiClient'
import { adminAuthClient } from './adminAuthClient'

export interface Subscriber { id: string; email: string; subscribedAt: string }
export interface SubscriberPage { items: Subscriber[]; total: number; page: number; pageSize: number }

const base = '/v1/admin/newsletter'
export const adminNewsletterApi = {
  list(page: number, search: string) {
    const query = new URLSearchParams({ page: String(page), pageSize: '25' })
    if (search.trim()) query.set('search', search.trim())
    return adminAuthClient.protectedRequest<SubscriberPage>(`${base}?${query}`)
  },
  get(id: string) { return adminAuthClient.protectedRequest<Subscriber>(`${base}/${id}`) },
  add(email: string) {
    return adminAuthClient.protectedRequest<Subscriber>(base, { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase() }) })
  },
  remove(id: string) { return adminAuthClient.protectedRequest<{ id: string; removed: boolean }>(`${base}/${id}`, { method: 'DELETE' }) },
  async exportCsv() {
    const response = await fetch(`${API_BASE_URL}${base}/export`, { credentials: 'include' })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null
      throw new Error(body?.error?.message ?? 'Newsletter export could not be completed.')
    }
    return response.blob()
  },
}
