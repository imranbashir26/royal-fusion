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

export interface Product {
  id: string
  slug: string
  name: string
  category: string
  collection: string
  gender: Gender
  price: number
  oldPrice?: number
  rating: number
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
  stock: number
  isBestSeller: boolean
  isFeatured: boolean
  isAttar: boolean
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
  heroCopy: string
  featuredProductSlug: string
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
}

export interface Faq {
  id: string
  question: string
  answer: string
}

export interface CartItem {
  productId: string
  size: string
  quantity: number
}

export interface OrderPayload {
  items: CartItem[]
  contact: {
    name: string
    email: string
    phone: string
  }
  shipping: {
    address: string
    city: string
    notes?: string
  }
  paymentMethod: 'Cash on Delivery' | 'Bank Transfer' | 'Card'
}
