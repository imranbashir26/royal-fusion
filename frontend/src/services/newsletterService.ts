import { API_BASE_URL } from './apiClient'
import { parseNewsletterResponse } from './newsletterResponse'

export const newsletterService = {
  async subscribe(email: string) {
    const response = await fetch(`${API_BASE_URL}/v1/public/newsletter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    })
    const body = await response.json().catch(() => null)
    return parseNewsletterResponse(response.ok, body)
  },
}
