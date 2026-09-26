import { adminAuthClient } from './adminAuthClient'

export type ReviewStatus = 'Pending' | 'Approved' | 'Rejected'
export interface AdminReview {
  id: string
  productId: string | null
  product: string
  name: string
  city: string
  rating: number
  text: string
  featured: boolean
  status: ReviewStatus
  createdAt: string
  updatedAt: string
}
export interface ReviewFilters {
  page: number
  pageSize: number
  status?: ReviewStatus
  productId?: string
  rating?: number
  search?: string
}
export interface ReviewPage {
  items: AdminReview[]
  total: number
  page: number
  pageSize: number
}

const base = '/v1/admin/reviews'
export const adminReviewsApi = {
  list(filters: ReviewFilters) {
    const query = new URLSearchParams({ page: String(filters.page), pageSize: String(filters.pageSize) })
    if (filters.status) query.set('status', filters.status)
    if (filters.productId) query.set('productId', filters.productId)
    if (filters.rating) query.set('rating', String(filters.rating))
    if (filters.search?.trim()) query.set('search', filters.search.trim())
    return adminAuthClient.protectedRequest<ReviewPage>(`${base}?${query}`)
  },
  products() { return adminAuthClient.protectedRequest<Array<{ id: string; name: string }>>(`${base}/products`) },
  get(id: string) { return adminAuthClient.protectedRequest<AdminReview>(`${base}/${id}`) },
  update(id: string, status: ReviewStatus, featured: boolean) {
    return adminAuthClient.protectedRequest<AdminReview>(`${base}/${id}`, {
      method: 'PUT', body: JSON.stringify({ status, featured }),
    })
  },
  remove(id: string) { return adminAuthClient.protectedRequest<{ id: string; removed: boolean }>(`${base}/${id}`, { method: 'DELETE' }) },
}
