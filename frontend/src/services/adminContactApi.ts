import { adminAuthClient } from './adminAuthClient'

export type ContactStatus = 'Read' | 'Unread'
export interface ContactSummary {
  id: string; name: string; email: string; phone: string; subject: string
  status: ContactStatus; createdAt: string
}
export interface ContactMessage extends ContactSummary { message: string }
export interface ContactFilters { page: number; pageSize: number; status?: ContactStatus }
export interface ContactPage { items: ContactSummary[]; total: number; page: number; pageSize: number }
const base = '/v1/admin/contact-messages'
export const adminContactApi = {
  list(filters: ContactFilters) {
    const query = new URLSearchParams({ page: String(filters.page), pageSize: String(filters.pageSize) })
    if (filters.status) query.set('status', filters.status)
    return adminAuthClient.protectedRequest<ContactPage>(`${base}?${query}`)
  },
  get(id: string) { return adminAuthClient.protectedRequest<ContactMessage>(`${base}/${encodeURIComponent(id)}`) },
  setStatus(id: string, status: ContactStatus) {
    return adminAuthClient.protectedRequest<ContactMessage>(`${base}/${encodeURIComponent(id)}/status`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    })
  },
}
