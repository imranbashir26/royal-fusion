import type { OrderPayload } from '../types'
import { apiClient } from './apiClient'

export interface OrderResponse {
  id: string
  status: 'confirmed'
  message: string
  order: {
    id: string
    orderNumber: string
    status: 'Pending'
  }
}

export const orderService = {
  async createOrder(payload: OrderPayload): Promise<OrderResponse> {
    const response = await apiClient.request<unknown>('/public/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    if (!isConfirmedOrderResponse(response)) {
      throw new Error('The order API returned an invalid confirmation.')
    }

    return response
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

function isConfirmedOrderResponse(response: unknown): response is OrderResponse {
  if (!response || typeof response !== 'object') return false
  const candidate = response as Partial<OrderResponse>
  const order = candidate.order

  return Boolean(
    typeof candidate.id === 'string' &&
    candidate.id.trim() &&
    candidate.status === 'confirmed' &&
    typeof candidate.message === 'string' &&
    candidate.message.trim() &&
    order &&
    order.id === candidate.id &&
    order.orderNumber === candidate.id &&
    order.status === 'Pending',
  )
}
