import type { FinderPreference, FinderPreferenceKey } from '../types'
import { adminAuthClient } from './adminAuthClient'

export interface AdminFinderPreference extends FinderPreference {
  id: string
  active: boolean
  createdAt: string
  updatedAt: string
}

const basePath = '/v1/admin/fragrance-finder'

export const adminFragranceFinderApi = {
  list() {
    return adminAuthClient.protectedRequest<AdminFinderPreference[]>(basePath)
  },
  eligibleProducts() {
    return adminAuthClient.protectedRequest<Array<{ id: string; name: string }>>(`${basePath}/products`)
  },
  update(key: FinderPreferenceKey, productId: string | null, active: boolean) {
    return adminAuthClient.protectedRequest<AdminFinderPreference>(`${basePath}/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ productId, active }),
    })
  },
}
