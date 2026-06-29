import { apiClient } from './apiClient'

export interface ContactPayload {
  name: string
  email: string
  phone: string
  message: string
}

export const contactService = {
  sendMessage: (payload: ContactPayload) =>
    apiClient.post(
      {
        status: 'sent',
        message: 'Thank you. Our fragrance concierge will contact you shortly.',
      },
      payload,
    ),
}
