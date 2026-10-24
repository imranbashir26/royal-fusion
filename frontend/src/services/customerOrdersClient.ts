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
  productId: string | null
  variantId: string | null
  packId: string | null
  kind: 'normal_variant' | 'fixed_tester_pack' | 'configurable_tester_pack' | string
  name: string
  size: string
  sku: string
  quantity: number
  unitPrice: number
  lineTotal: number
  position: number | null
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

export const isCustomerSessionError = (error: unknown) => error instanceof CustomerOrderApiError
  && (error.status === 401 || error.status === 403)
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const text = (value: unknown) => typeof value === 'string'
const optionalText = (value: unknown) => value === null || text(value)
const money = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0
function validHeader(value: unknown): value is Record<string, unknown> {
  return object(value) && ['id','orderNumber','createdAt','status','paymentStatus','paymentMethod','currency'].every(key => text(value[key]))
    && Number.isFinite(Date.parse(value.createdAt as string)) && /^[A-Z]{3}$/.test(value.currency as string)
    && money(value.total) && optionalText(value.courier) && optionalText(value.trackingNumber)
}
function validList(value: unknown): value is CustomerOrderListResult {
  return object(value) && Array.isArray(value.items) && value.items.length <= 50
    && value.items.every(item => validHeader(item) && integer(item.itemCount))
    && ['page','pageSize','total','totalPages'].every(key => integer(value[key]))
    && Number(value.page) >= 1 && Number(value.pageSize) >= 1 && Number(value.pageSize) <= 50
    && value.items.length <= Number(value.pageSize) && value.totalPages === Math.ceil(Number(value.total) / Number(value.pageSize))
}
function validDetail(value: unknown): value is CustomerOrderDetail {
  const shipping = object(value) ? value.shipping : null
  return validHeader(value) && ['subtotal','discount','shippingFee'].every(key => money(value[key]))
    && object(shipping) && ['name','address','city','province','orderNotes'].every(key => text(shipping[key]))
    && Array.isArray(value.items) && value.items.length <= 10000 && value.items.every(item => object(item)
      && ['id','name','size','sku','kind'].every(key => text(item[key])) && optionalText(item.productId)
      && optionalText(item.variantId) && optionalText(item.packId) && integer(item.quantity) && Number(item.quantity) > 0
      && money(item.unitPrice) && money(item.lineTotal) && (item.position === null || integer(item.position))
      && Array.isArray(item.components) && item.components.length <= 10000 && item.components.every(component => object(component)
        && ['id','name','size','sku'].every(key => text(component[key])) && money(component.volumeMl) && money(component.referenceUnitPrice)
        && integer(component.quantityPerPack) && Number(component.quantityPerPack) > 0
        && integer(component.totalPhysicalQuantity) && Number(component.totalPhysicalQuantity) > 0 && integer(component.position)))
}

export function createCustomerOrdersClient(
  fetcher: typeof fetch = fetch,
  baseUrl = import.meta.env?.VITE_API_URL || '/api'
) {
  async function request<T>(path: string, validate: (value: unknown) => value is T, signal?: AbortSignal): Promise<T> {
    let response: Response
    try { response = await fetcher(`${baseUrl}${path}`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal,
    }) } catch (error) {
      if (signal?.aborted) throw error
      throw new CustomerOrderApiError('NETWORK_ERROR', 'Unable to connect to your order history. Please retry.', 0)
    }

    const envelope = await response.json().catch(() => null)
    if (!response.ok) {
      throw new CustomerOrderApiError(
        envelope?.error?.code ?? 'ORDER_SERVICE_UNAVAILABLE',
        envelope?.error?.message ?? 'Customer orders are temporarily unavailable.',
        response.status
      )
    }

    if (!validate(envelope?.data)) {
      throw new CustomerOrderApiError('INVALID_RESPONSE', 'Invalid order response received.', response.status)
    }

    return envelope.data as T
  }

  return {
    async listOrders(page = 1, pageSize = 10, options?: { signal?: AbortSignal }): Promise<CustomerOrderListResult> {
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) {
        throw new CustomerOrderApiError('INVALID_PAGINATION', 'Invalid pagination parameters.')
      }
      return request(`/v1/customer/orders?page=${page}&pageSize=${pageSize}`,
        (value): value is CustomerOrderListResult => validList(value) && value.page === page && value.pageSize === pageSize, options?.signal)
    },

    async getOrder(id: string, options?: { signal?: AbortSignal }): Promise<CustomerOrderDetail> {
      return request(`/v1/customer/orders/${encodeURIComponent(id)}`,
        (value): value is CustomerOrderDetail => validDetail(value) && value.id === id, options?.signal)
    },
  }
}

export const customerOrdersClient = createCustomerOrdersClient()
