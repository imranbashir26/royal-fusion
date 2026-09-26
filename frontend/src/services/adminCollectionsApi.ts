import { adminAuthClient } from './adminAuthClient'
import { toCollectionPayload } from './adminCollectionContract'
export { collectionErrorMessage } from './adminCollectionContract'

export interface AdminCollection extends Record<string, unknown> {
  id: string
  name: string
  slug: string
  description: string
  bannerSecureUrl: string
  bannerCloudinaryPublicId?: string
  bannerAltText?: string
  image?: string
  imageUrl?: string
  displayOrder: number
  featured: boolean
  active: boolean
  status: 'Published' | 'Draft' | 'Unpublished' | 'Archived'
  seoTitle?: string
  seoDescription?: string
  createdAt?: string
  updatedAt?: string
}

export interface AdminCollectionListResponse {
  items: AdminCollection[]
  total: number
}

export interface AdminCollectionDeleteResponse {
  id: string
  archived?: boolean
  deleted?: boolean
  collection?: AdminCollection
  message?: string
}

export interface CollectionListOptions {
  search?: string
  status?: string
  active?: 'true' | 'false' | 'all' | boolean
  featured?: 'true' | 'false' | 'all' | boolean
}

const basePath = '/v1/admin/collections'

export const adminCollectionsApi = {
  async list(options: CollectionListOptions = {}) {
    const params = new URLSearchParams()
    if (options.search?.trim()) params.set('search', options.search.trim())
    if (options.status && options.status !== 'All') params.set('status', options.status)
    if (options.active !== undefined) params.set('active', String(options.active))
    if (options.featured !== undefined) params.set('featured', String(options.featured))
    const query = params.toString() ? `?${params}` : ''
    const response = await adminAuthClient.protectedRequest<AdminCollectionListResponse>(`${basePath}${query}`)
    return response.items ?? []
  },
  get(id: string) {
    return adminAuthClient.protectedRequest<AdminCollection>(`${basePath}/${encodeURIComponent(id)}`)
  },
  create(form: Record<string, unknown>) {
    return adminAuthClient.protectedRequest<AdminCollection>(basePath, {
      method: 'POST',
      body: JSON.stringify(toCollectionPayload(form)),
    })
  },
  update(id: string, form: Record<string, unknown>) {
    return adminAuthClient.protectedRequest<AdminCollection>(`${basePath}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(toCollectionPayload(form)),
    })
  },
  delete(id: string) {
    return adminAuthClient.protectedRequest<AdminCollectionDeleteResponse>(`${basePath}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },
  getProducts(id: string) {
    return adminAuthClient.protectedRequest<Array<{ collectionId: string; displayOrder: number; product: Record<string, unknown> }>>(
      `${basePath}/${encodeURIComponent(id)}/products`
    )
  },
  assignProducts(id: string, productIds: string[]) {
    return adminAuthClient.protectedRequest<{ success: boolean; count: number }>(
      `${basePath}/${encodeURIComponent(id)}/products`,
      {
        method: 'PUT',
        body: JSON.stringify({ productIds }),
      }
    )
  },
}
