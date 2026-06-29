import type { OrderPayload } from '../types'
import { apiClient } from './apiClient'

export const orderService = {
  createOrder: (payload: OrderPayload) =>
    apiClient.post(
      {
        id: `RF-${Date.now()}`,
        status: 'confirmed',
        message: 'Your Royal Fusion order has been received.',
      },
      payload,
    ),
}
