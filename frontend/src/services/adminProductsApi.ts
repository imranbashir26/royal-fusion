import { adminAuthClient } from './adminAuthClient'
import { toProductPayload } from './adminProductContract'
export { productErrorMessage } from './adminProductContract'

export interface AdminProduct extends Record<string, unknown> {
  id: string
  name: string
  categoryId: string | null
  category: string
  image: string
  status: 'Draft' | 'Published' | 'Unpublished' | 'Archived'
  cardImage: string
  cardHoverImage: string
  cardBackgroundColor: string
}

export interface AdminProductPage {
  items: AdminProduct[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface ProductListOptions {
  page: number
  pageSize: number
  search: string
  status: string
}

const basePath = '/v1/admin/products'

export const adminProductsApi = {
  list({ page, pageSize, search, status }: ProductListOptions) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (search.trim()) params.set('search', search.trim())
    if (status !== 'All') params.set('status', status)
    return adminAuthClient.protectedRequest<AdminProductPage>(`${basePath}?${params}`)
  },
  get(id: string) {
    return adminAuthClient.protectedRequest<AdminProduct>(`${basePath}/${encodeURIComponent(id)}`)
  },
  create(form: Record<string, unknown>) {
    return adminAuthClient.protectedRequest<AdminProduct>(basePath, {
      method: 'POST', body: JSON.stringify(toProductPayload(form)),
    })
  },
  update(id: string, form: Record<string, unknown>) {
    return adminAuthClient.protectedRequest<AdminProduct>(`${basePath}/${encodeURIComponent(id)}`, {
      method: 'PUT', body: JSON.stringify(toProductPayload(form)),
    })
  },
  archive(id: string) {
    return adminAuthClient.protectedRequest<AdminProduct>(`${basePath}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },
}
