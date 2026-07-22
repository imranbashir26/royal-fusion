import type { AdminDashboardData, AdminSession } from '../types/admin'
import { API_BASE_URL, apiClient } from './apiClient'

const ADMIN_TOKEN_KEY = 'royal-fusion-admin-token'

export const adminToken = {
  get: () => window.localStorage.getItem(ADMIN_TOKEN_KEY),
  set: (token: string) => window.localStorage.setItem(ADMIN_TOKEN_KEY, token),
  clear: () => window.localStorage.removeItem(ADMIN_TOKEN_KEY),
}

function authHeaders(): Record<string, string> {
  const token = adminToken.get()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export const adminApi = {
  login: (payload: { email: string; password: string }) =>
    apiClient.request<AdminSession>('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  me: () =>
    apiClient.request<Omit<AdminSession, 'token'>>('/admin/auth/me', {
      headers: authHeaders(),
    }),
  dashboard: () =>
    apiClient.request<AdminDashboardData>('/admin/dashboard', {
      headers: authHeaders(),
    }),
  list: <T>(resource: string, search = '') =>
    apiClient.request<T[]>(`/admin/resources/${resource}${search ? `?search=${encodeURIComponent(search)}` : ''}`, {
      headers: authHeaders(),
    }),
  getSettings: <T>(resource: string) =>
    apiClient.request<T>(`/admin/resources/${resource}`, {
      headers: authHeaders(),
    }),
  create: <T>(resource: string, payload: unknown) =>
    apiClient.request<T>(`/admin/resources/${resource}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    }),
  update: <T>(resource: string, id: string, payload: unknown) =>
    apiClient.request<T>(`/admin/resources/${resource}/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    }),
  updateSettings: <T>(resource: string, payload: unknown) =>
    apiClient.request<T>(`/admin/resources/${resource}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    }),
  remove: (resource: string, id: string) =>
    apiClient.request<void>(`/admin/resources/${resource}/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    }),
  updateOrderStatus: (id: string, status: string) =>
    apiClient.request(`/admin/orders/${id}/status`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ status }),
    }),
  addOrderNote: (id: string, text: string) =>
    apiClient.request(`/admin/orders/${id}/notes`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ text }),
    }),
  updateTracking: (id: string, courierName: string, trackingNumber: string) =>
    apiClient.request(`/admin/orders/${id}/tracking`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ courierName, trackingNumber }),
    }),
  users: <T>() =>
    apiClient.request<T[]>('/admin/auth/users', {
      headers: authHeaders(),
    }),
  createUser: <T>(payload: unknown) =>
    apiClient.request<T>('/admin/auth/users', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    }),
  updateUser: <T>(id: string, payload: unknown) =>
    apiClient.request<T>(`/admin/auth/users/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    }),
  deleteUser: (id: string) =>
    apiClient.request<void>(`/admin/auth/users/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    }),
  async exportResource(resource: string) {
    const response = await fetch(`${API_BASE_URL}/admin/resources/${resource}/export`, {
      headers: authHeaders(),
    })
    if (!response.ok) throw new Error('Export failed.')
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${resource}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  },
  uploadImages: (files: File[], altText = '') => {
    const token = adminToken.get()
    const formData = new FormData()
    files.forEach((file) => formData.append('images', file))
    formData.append('altText', altText)

    return fetch(`${API_BASE_URL}/admin/media`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    }).then(async (response) => {
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ message: 'Upload failed.' }))
        throw new Error(payload.message)
      }
      return response.json() as Promise<{ files: Array<{ url: string; altText: string }> }>
    })
  },
}
