import { adminAuthClient } from './adminAuthClient'
import { toCategoryPayload } from './adminCategoryContract'
export { categoryErrorMessage } from './adminCategoryContract'

export interface AdminCategory extends Record<string, unknown> {
  id: string
  name: string
  slug: string
  description: string
  image: string
  imageUrl: string
  displayOrder: number
  showOnHomepage: boolean
  status: 'Published' | 'Draft' | 'Unpublished' | 'Archived'
  active: boolean
  seoTitle: string
  seoDescription: string
  createdAt?: string
  updatedAt?: string
}

export interface AdminCategoryListResponse {
  items: AdminCategory[]
  total: number
}

export interface AdminCategoryDeleteResponse {
  id: string
  archived?: boolean
  deleted?: boolean
  category?: AdminCategory
  message?: string
}

export interface CategoryListOptions {
  search?: string
  status?: string
  active?: 'true' | 'false' | 'all' | boolean
}

const basePath = '/v1/admin/categories'

export const adminCategoriesApi = {
  async list(options: CategoryListOptions = {}) {
    const params = new URLSearchParams()
    if (options.search?.trim()) params.set('search', options.search.trim())
    if (options.status && options.status !== 'All') params.set('status', options.status)
    if (options.active !== undefined) params.set('active', String(options.active))
    const query = params.toString() ? `?${params}` : ''
    const response = await adminAuthClient.protectedRequest<AdminCategoryListResponse>(`${basePath}${query}`)
    return response.items ?? []
  },
  get(id: string) {
    return adminAuthClient.protectedRequest<AdminCategory>(`${basePath}/${encodeURIComponent(id)}`)
  },
  create(form: Record<string, unknown>) {
    return adminAuthClient.protectedRequest<AdminCategory>(basePath, {
      method: 'POST',
      body: JSON.stringify(toCategoryPayload(form)),
    })
  },
  update(id: string, form: Record<string, unknown>) {
    return adminAuthClient.protectedRequest<AdminCategory>(`${basePath}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(toCategoryPayload(form)),
    })
  },
  delete(id: string) {
    return adminAuthClient.protectedRequest<AdminCategoryDeleteResponse>(`${basePath}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },
}
