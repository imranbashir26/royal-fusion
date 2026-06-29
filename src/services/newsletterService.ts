import { apiClient } from './apiClient'

export const newsletterService = {
  subscribe: (email: string) =>
    apiClient.post(
      {
        status: 'subscribed',
        message: 'You are now on the Royal Fusion list.',
      },
      { email },
    ),
}
