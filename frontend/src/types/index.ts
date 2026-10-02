export type Gender = 'Men' | 'Women' | 'Unisex'

export type ScentFamily =
  | 'Oriental'
  | 'Floral'
  | 'Citrus'
  | 'Woody'
  | 'Oud'
  | 'Fresh'
  | 'Spicy'
  | 'Sweet'

export interface FragranceNotes {
  top: string[]
  middle: string[]
  base: string[]
}

export interface SizeOption {
  label: string
  value: string
  price: number
}

export interface ProductVariant {
  id: string
  productId: string
  optionName: string
  optionValue: string
  sku: string
  regularPrice: number
  salePrice: number | null
  stockQuantity: number
  active: boolean
  available: boolean
  displayOrder: number
}

export interface Product {
  id: string
  slug: string
  name: string
  category: string
  collection: string
  gender: Gender
  price: number
  oldPrice?: number
  rating: number | null
  reviewCount: number
  image: string
  gallery: string[]
  badge: string
  description: string
  shortDescription: string
  notes: FragranceNotes
  scentFamily: ScentFamily
  longevity: string
  sillage: string
  occasion: string[]
  sizeOptions: SizeOption[]
  /** Undefined for legacy display-only catalogs. Never synthesize variant UUIDs. */
  variants?: ProductVariant[]
  /** Only a complete identity snapshot can prove uniqueness of a legacy label. */
  variantIdentityScope?: 'complete' | 'public'
  stock: number
  isBestSeller: boolean
  isFeatured: boolean
  isAttar: boolean
  isNewArrival?: boolean
  isPremium?: boolean
  cardImage?: string
  cardHoverImage?: string
  cardBackgroundColor?: string
}

export interface Category {
  id: string
  name: string
  slug: string
  description: string
  icon: string
}

export interface Collection {
  id: string
  name: string
  slug: string
  description: string
  heroCopy?: string
  featuredProductSlug?: string
  bannerImage?: string
  displayOrder?: number
  featured?: boolean
  active?: boolean
  productIds?: string[]
}

export type FinderPreferenceKey = 'fresh' | 'sweet' | 'woody' | 'oud' | 'spicy' | 'floral'

export interface FinderPreference {
  key: FinderPreferenceKey
  label: string
  descriptors: string
  copy: string
  iconKey: string
  productId: string | null
  displayOrder: number
}

export interface ScentNote {
  id: string
  name: ScentFamily
  slug: string
  image: string
  description: string
}

export interface Review {
  id: string
  productId?: string
  name: string
  city: string
  rating: number
  product: string
  text: string
}

export interface BlogPost {
  id: string
  slug: string
  title: string
  excerpt: string
  content: string[]
  category: string
  readTime: string
  publishedAt: string
  image: string
  imageAlt?: string
}

export interface Faq {
  id: string
  question: string
  answer: string
}

export interface CartItem {
  identity?: 'legacy' | 'canonical' | 'corrupt'
  lineId: string
  productId: string
  /** Null for unresolved legacy or corrupted canonical identities. */
  variantId: string | null
  size: string
  quantity: number
}

/** Legacy HTTP contract, independent of canonical cart identity. */
export interface OrderItem {
  productId: string
  size: string
  quantity: number
}

export interface OrderPayload {
  items: OrderItem[]
  contact: {
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
  paymentMethod: string
  couponCode?: string
}

export type CheckoutPaymentMethod = 'Cash on Delivery' | 'Bank Transfer'
export interface CanonicalOrderItemRequest { variantId: string; quantity: number }
export interface CanonicalOrderRequest {
  idempotencyKey: string
  items: CanonicalOrderItemRequest[]
  contact: { name: string; email: string; phone: string }
  shipping: { address: string; city: string; province: string; notes: string }
  paymentMethod: CheckoutPaymentMethod
  couponCode: string
}
export interface CheckoutQuoteRequest {
  items: CanonicalOrderItemRequest[]
  shipping: { city: string; province: string }
  email: string
  couponCode: string
}
export interface CheckoutQuoteResponse {
  subtotal: number; discount: number; shippingFee: number; total: number
  currency: 'PKR'; shippingMethodId: string; paymentMethods: CheckoutPaymentMethod[]
  orderingEnabled: boolean
}
export interface CanonicalOrderReceipt {
  id: string; idempotencyKey: string; orderNumber: string
  status: 'Pending' | 'Confirmed' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled' | 'Returned' | 'Refunded'
  paymentStatus: 'Unpaid' | 'Pending' | 'Paid' | 'Failed' | 'Refunded'
  paymentMethod: CheckoutPaymentMethod
  subtotal: number; discount: number; shippingFee: number; total: number
  currency: 'PKR'; idempotent: boolean
}
