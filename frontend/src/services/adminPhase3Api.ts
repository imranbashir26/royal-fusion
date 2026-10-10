import { adminAuthClient } from './adminAuthClient'

export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }
export interface Filters { page: number; pageSize: number; search?: string }
export interface Customer { id: string; name: string; email: string; phone: string; status: string; createdAt: string }
export interface Address { id: string; label: string; recipient_name: string; phone: string; address_line_1: string; address_line_2: string; city: string; province: string; postal_code: string; country_code: string; is_default: boolean }
export interface CustomerDetail extends Customer { addresses: Address[]; addressesTruncated: boolean }
export interface CustomerOrder { id: string; orderNumber: string; status: string; paymentStatus: string; total: number; currency: string; createdAt: string }
export interface CouponConfig { discountValue: number; minimumOrderAmount: number; maxDiscountAmount: number | null; description: string; startDate: string | null; endDate: string | null; usageLimit: number; perCustomerUsageLimit: number; status: 'Active' | 'Inactive' }
export interface Coupon extends CouponConfig { id: string; code: string; type: 'Percentage' | 'Fixed Amount' | 'Free Shipping'; usedCount: number; updatedAt: string }
export interface CouponDetail extends Coupon { productIds: string[]; categoryIds: string[]; legacyProductIds: string[]; legacyCategoryIds: string[]; restrictionsTruncated: boolean; redemptionCount: number; redemptions: Array<{ id: string; discount_amount: number; created_at: string }> }
// Display provenance only. Checkout remains the authority for coupon eligibility.
export function couponRestrictionSources(modern: readonly string[] | null | undefined, historical: readonly string[] | null | undefined) {
  const modernIds = modern ?? [], historicalIds = historical ?? []
  const source = modernIds.length ? historicalIds.length ? 'Mixed sources' : 'Modern restrictions'
    : historicalIds.length ? 'Historical restrictions' : 'Unrestricted'
  return { source, modernIds, historicalIds }
}
export interface SeoSetting { id: string; pageKey: string; routePath: string; title: string; description: string; canonicalUrl: string; ogTitle: string; ogDescription: string; ogImage: string; robots: string; active: boolean; updatedAt: string }
export const seoPages = { home: '/', shop: '/shop', collections: '/collections', attars: '/attars', about: '/about', contact: '/contact' } as const
export type SeoKey = keyof typeof seoPages
export type SeoInput = Pick<SeoSetting, 'title' | 'description' | 'canonicalUrl' | 'ogTitle' | 'ogDescription' | 'ogImage'> & { expectedUpdatedAt: string | null }
const query = (f: Filters) => new URLSearchParams({ page: String(f.page), pageSize: String(f.pageSize), ...(f.search ? { search: f.search } : {}) })
const customerBase = '/v1/admin/customers', couponBase = '/v1/admin/coupons'
export const adminCustomersApi = {
  list: (f: Filters) => adminAuthClient.protectedRequest<Page<Customer>>(`${customerBase}?${query(f)}`),
  detail: (id: string) => adminAuthClient.protectedRequest<CustomerDetail>(`${customerBase}/${encodeURIComponent(id)}`),
  orders: (id: string, page: number) => adminAuthClient.protectedRequest<Page<CustomerOrder>>(`${customerBase}/${encodeURIComponent(id)}/orders?${query({ page, pageSize: 10 })}`),
}
export const adminCouponsApi = {
  list: (f: Filters) => adminAuthClient.protectedRequest<Page<Coupon>>(`${couponBase}?${query(f)}`),
  detail: (id: string) => adminAuthClient.protectedRequest<CouponDetail>(`${couponBase}/${encodeURIComponent(id)}`),
  create: (input: CouponConfig & Pick<Coupon, 'code' | 'type'>) => adminAuthClient.protectedRequest<Coupon>(couponBase, { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: CouponConfig & { expectedUpdatedAt: string }) => adminAuthClient.protectedRequest<Coupon>(`${couponBase}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
}
export const adminSeoApi = {
  list: () => adminAuthClient.protectedRequest<SeoSetting[]>('/v1/admin/seo'),
  save: (key: SeoKey, input: SeoInput) => adminAuthClient.protectedRequest<SeoSetting>(`/v1/admin/seo/${key}`, { method: 'PUT', body: JSON.stringify(input) }),
}
