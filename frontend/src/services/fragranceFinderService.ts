import type { FinderPreference } from '../types'
import { apiClient } from './apiClient'

export async function getPublicFinderPreferences(): Promise<FinderPreference[]> {
  const response = await apiClient.request<{ data: FinderPreference[] }>('/v1/public/fragrance-finder')
  return Array.isArray(response.data) ? response.data : []
}
