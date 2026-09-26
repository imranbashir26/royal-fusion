import { adminAuthClient } from './adminAuthClient'

export type SettingsSection = 'settings' | 'homepage' | 'shipping' | 'payments'
export interface AdminSettingsData {
  settings: Record<string, unknown>
  homepage: Record<string, unknown>
  shipping: Record<string, unknown>
  payments: Array<{ name: 'Cash on Delivery' | 'Bank Transfer'; active: boolean }>
}

export const adminSettingsApi = {
  get() { return adminAuthClient.protectedRequest<AdminSettingsData>('/v1/admin/settings') },
  update(section: SettingsSection, patch: Record<string, unknown> | AdminSettingsData['payments']) {
    return adminAuthClient.protectedRequest<AdminSettingsData>(`/v1/admin/settings/${section}`, {
      method: 'PUT', body: JSON.stringify(patch),
    })
  },
}
