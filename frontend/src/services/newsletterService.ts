import { apiClient } from './apiClient'

export const newsletterService = {
  async subscribe(email: string) {
    try {
      return await apiClient.request<{
        status?: string
        message: string
      }>('/public/newsletter', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('already')) {
        throw error
      }
      return apiClient.post(
      {
        status: 'subscribed',
        message: 'You are now on the Royal Fusion list.',
      },
      { email },
      )
    }
  },
}
