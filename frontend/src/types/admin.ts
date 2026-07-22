import type { BlogPost, Category, Product, Review } from './index'

export type AdminRole =
  | 'Owner/Admin'
  | 'Shop Manager'
  | 'Order Manager'
  | 'Content Editor'
  | 'Blog Writer'

export interface AdminUser {
  id: string
  name: string
  email: string
  role: AdminRole
  status: 'Active' | 'Inactive'
  createdAt?: string
  updatedAt?: string
  lastLoginAt?: string
}

export interface AdminSession {
  token: string
  user: AdminUser
  permissions: string[]
}

export interface AdminDashboardData {
  cards: {
    totalOrders: number
    totalSales: number
    pendingOrders: number
    lowStockProducts: number
    totalProducts: number
    totalCustomers: number
    newsletterSubscribers: number
  }
  recentOrders: AdminOrder[]
  lowStockProducts: Product[]
  bestSellingProducts: Array<Pick<Product, 'id' | 'name' | 'stock' | 'price'>>
}

export interface AdminOrder {
  id: string
  orderNumber: string
  status: string
  paymentMethod: string
  paymentStatus: string
  customer: {
    id?: string
    name: string
    email: string
    phone: string
  }
  shipping: {
    address: string
    city: string
    province?: string
    notes?: string
  }
  items: Array<{
    productId: string
    name: string
    size: string
    quantity: number
    unitPrice: number
  }>
  subtotal: number
  discount: number
  shippingFee: number
  total: number
  couponCode?: string
  internalNotes?: Array<{ id: string; text: string; author: string; createdAt: string }>
  courierName?: string
  trackingNumber?: string
  createdAt: string
  updatedAt: string
}

export interface Coupon {
  id: string
  code: string
  type: 'Percentage' | 'Fixed Amount' | 'Free Shipping'
  discountValue: number
  minimumOrderAmount: number
  applicableProducts: string[]
  applicableCategories: string[]
  startDate: string
  endDate: string
  usageLimit: number
  usedCount?: number
  perCustomerUsageLimit: number
  status: 'Active' | 'Inactive'
}

export interface Banner {
  id: string
  title: string
  subtitle: string
  image: string
  ctaText: string
  ctaLink: string
  position: string
  enabled: boolean
  startDate: string
  endDate: string
}

export interface Testimonial {
  id: string
  name: string
  city: string
  rating: number
  product: string
  text: string
  avatar?: string
  featured: boolean
  status: 'Approved' | 'Pending' | 'Rejected'
}

export interface Customer {
  id: string
  name: string
  email: string
  phone: string
  address: string
  totalOrders: number
  totalSpending: number
  lastOrderDate: string
}

export interface NewsletterSubscriber {
  id: string
  email: string
  subscribedAt: string
}

export interface ContactMessage {
  id: string
  name: string
  email: string
  phone: string
  subject: string
  message: string
  status: 'Read' | 'Unread'
  createdAt: string
}

export interface WebsiteSettings {
  brandName: string
  logo: string
  favicon: string
  currency: string
  whatsappNumber: string
  phoneNumber: string
  emailAddress: string
  businessAddress: string
  instagramLink: string
  facebookLink: string
  tiktokLink: string
  youtubeLink: string
  footerDescription: string
  copyrightText: string
  contactReceiverEmail: string
  announcementEnabled: boolean
  announcementText: string
}

export interface StorefrontData {
  products: Product[]
  categories: Category[]
  blogs: BlogPost[]
  reviews: Review[]
  testimonials: Testimonial[]
  banners: Banner[]
  settings: WebsiteSettings
  homepage: Record<string, unknown>
  shipping: Record<string, unknown>
  payments: Array<Record<string, unknown>>
  seo: Array<Record<string, unknown>>
  editablePages: Array<Record<string, unknown>>
}
