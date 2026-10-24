import { API_BASE_URL } from './apiClient'

export interface ContactPayload {
  name: string
  email: string
  phone: string
  message: string
}

export const contactService = {
  async sendMessage(payload: ContactPayload) {
    const response = await fetch(`${API_BASE_URL}/v1/public/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || typeof body?.data?.message !== 'string' || !body.data.message.trim()) {
      throw new Error('Your message could not be sent. Please try again later.')
    }
    return { message: body.data.message as string }
  },
}
