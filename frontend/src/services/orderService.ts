import type { OrderPayload } from '../types'
import { apiClient } from './apiClient'

export const orderService = {
  async createOrder(payload: OrderPayload) {
    try {
      return await apiClient.request<{
        id: string
        status: string
        message: string
      }>('/public/orders', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    } catch {
      return apiClient.post(
      {
        id: `RF-${Date.now()}`,
        status: 'confirmed',
        message: 'Your Royal Fusion order has been received.',
      },
      payload,
      )
    }
  },
  validateCoupon: (payload: {
    code: string
    subtotal: number
    productIds: string[]
    categories: string[]
    city?: string
    province?: string
  }) =>
    apiClient.request<{
      valid: boolean
      discount: number
      shippingFee: number
      coupon: unknown
    }>('/public/coupons/validate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
}
