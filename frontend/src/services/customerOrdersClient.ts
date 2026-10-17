export interface CustomerOrderSummary {
  id: string
  orderNumber: string
  createdAt: string
  status: string
  paymentStatus: string
  paymentMethod: string
  total: number
  currency: string
  itemCount: number
  courier: string | null
  trackingNumber: string | null
}

export interface CustomerOrderListResult {
  items: CustomerOrderSummary[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface CustomerOrderComponent {
  id: string
  name: string
  sku: string
  size: string
  volumeMl: number
  quantityPerPack: number
  totalPhysicalQuantity: number
  referenceUnitPrice: number
  position: number
}

export interface CustomerOrderItem {
  id: string
  productId: string
  variantId: string | null
  packId: string | null
  kind: 'normal_variant' | 'fixed_tester_pack' | 'configurable_tester_pack' | string
  name: string
  size: string
  sku: string
  quantity: number
  unitPrice: number
  lineTotal: number
  position: number
  components: CustomerOrderComponent[]
}

export interface CustomerOrderDetail {
  id: string
  orderNumber: string
  createdAt: string
  status: string
  paymentStatus: string
  paymentMethod: string
  subtotal: number
  discount: number
  shippingFee: number
  total: number
  currency: string
  courier: string | null
  trackingNumber: string | null
  shipping: {
    name: string
    address: string
    city: string
    province: string
    orderNotes: string
  }
  items: CustomerOrderItem[]
}

export class CustomerOrderApiError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'CustomerOrderApiError'
    this.code = code
    this.status = status
  }
}

export function createCustomerOrdersClient(
  fetcher: typeof fetch = fetch,
  baseUrl = import.meta.env?.VITE_API_URL || '/api'
) {
  async function request<T>(path: string): Promise<T> {
    const response = await fetcher(`${baseUrl}${path}`, {
      method: 'GET',
      credentials: 'include',
    })

    const envelope = await response.json().catch(() => null)
    if (!response.ok) {
      throw new CustomerOrderApiError(
        envelope?.error?.code ?? 'ORDER_SERVICE_UNAVAILABLE',
        envelope?.error?.message ?? 'Customer orders are temporarily unavailable.',
        response.status
      )
    }

    if (!envelope?.data) {
      throw new CustomerOrderApiError('INVALID_RESPONSE', 'Invalid order response received.', response.status)
    }

    return envelope.data as T
  }

  return {
    async listOrders(page = 1, pageSize = 10): Promise<CustomerOrderListResult> {
      return request<CustomerOrderListResult>(`/v1/customer/orders?page=${page}&pageSize=${pageSize}`)
    },

    async getOrder(id: string): Promise<CustomerOrderDetail> {
      return request<CustomerOrderDetail>(`/v1/customer/orders/${encodeURIComponent(id)}`)
    },
  }
}

export const customerOrdersClient = createCustomerOrdersClient()
