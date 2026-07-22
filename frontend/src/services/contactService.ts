import { apiClient } from './apiClient'

export interface ContactPayload {
  name: string
  email: string
  phone: string
  message: string
}

export const contactService = {
  async sendMessage(payload: ContactPayload) {
    try {
      return await apiClient.request<{
        status?: string
        message: string
      }>('/public/contact', {
        method: 'POST',
        body: JSON.stringify({ subject: 'Website inquiry', ...payload }),
      })
    } catch {
      return apiClient.post(
      {
        status: 'sent',
        message: 'Thank you. Our fragrance concierge will contact you shortly.',
      },
      payload,
      )
    }
  },
}
