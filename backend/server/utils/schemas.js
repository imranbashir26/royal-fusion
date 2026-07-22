import { z } from 'zod'

const optionalString = z.string().max(5000).optional().default('')
const stringList = z.array(z.string().max(200)).default([])
const statusString = z.string().max(80).optional().default('Draft')

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
})

export const contactSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(7).max(40),
  subject: z.string().min(2).max(160).default('Website inquiry'),
  message: z.string().min(5).max(5000)
})

export const newsletterSchema = z.object({
  email: z.string().email()
})

export const couponValidationSchema = z.object({
  code: z.string().min(2).max(40),
  subtotal: z.number().nonnegative(),
  productIds: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  city: z.string().optional().default(''),
  province: z.string().optional().default('')
})

export const orderSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string().min(1),
      size: z.string().min(1),
      quantity: z.number().int().min(1).max(99)
    })
  ).min(1),
  contact: z.object({
    name: z.string().min(2).max(120),
    email: z.string().email(),
    phone: z.string().min(7).max(40)
  }),
  shipping: z.object({
    address: z.string().min(4).max(500),
    city: z.string().min(2).max(100),
    province: z.string().min(2).max(100).default(''),
    notes: z.string().max(1000).optional().default('')
  }),
  paymentMethod: z.string().min(2).max(120),
  couponCode: z.string().max(40).optional().default('')
})

export const userSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).optional().default(''),
  role: z.enum(['Owner/Admin', 'Shop Manager', 'Order Manager', 'Content Editor', 'Blog Writer']),
  status: z.enum(['Active', 'Inactive']).default('Active')
})

export const productSchema = z.object({
  name: z.string().min(2).max(180),
  slug: z.string().min(2).max(180),
  sku: z.string().min(1).max(80),
  shortDescription: optionalString,
  description: optionalString,
  price: z.coerce.number().nonnegative(),
  salePrice: z.coerce.number().nonnegative().optional().default(0),
  oldPrice: z.coerce.number().nonnegative().optional().default(0),
  stock: z.coerce.number().int().nonnegative(),
  stockStatus: z.string().default('In Stock'),
  category: z.string().min(1),
  tags: stringList,
  gender: z.enum(['Men', 'Women', 'Unisex']),
  scentFamily: z.string().min(1),
  notes: z.object({
    top: stringList,
    middle: stringList,
    base: stringList
  }),
  bottleSize: optionalString,
  concentration: optionalString,
  longevity: optionalString,
  sillage: optionalString,
  occasion: stringList,
  inspiredBy: optionalString,
  image: optionalString,
  mainImage: optionalString,
  gallery: z.array(z.string().min(1)).default([]),
  sizeOptions: z.array(z.object({
    label: z.string(),
    value: z.string(),
    price: z.coerce.number().nonnegative()
  })).default([]),
  variations: z.array(z.object({
    id: z.string().optional(),
    name: z.string(),
    price: z.coerce.number().nonnegative(),
    salePrice: z.coerce.number().nonnegative().optional().default(0),
    sku: z.string(),
    stock: z.coerce.number().int().nonnegative(),
    image: z.string().optional().default(''),
    active: z.boolean().default(true)
  })).default([]),
  badge: optionalString,
  isFeatured: z.boolean().default(false),
  isBestSeller: z.boolean().default(false),
  isNewArrival: z.boolean().default(false),
  isPremium: z.boolean().default(false),
  isAttar: z.boolean().default(false),
  status: z.enum(['Published', 'Draft', 'Archived', 'Unpublished']).default('Draft'),
  seoTitle: optionalString,
  seoDescription: optionalString,
  imageAlt: optionalString
})

export const categorySchema = z.object({
  name: z.string().min(2).max(160),
  slug: z.string().min(2).max(180),
  description: optionalString,
  image: optionalString,
  displayOrder: z.coerce.number().int().default(0),
  showOnHomepage: z.boolean().default(false),
  status: z.enum(['Published', 'Draft', 'Unpublished']).default('Published'),
  seoTitle: optionalString,
  seoDescription: optionalString,
  icon: optionalString
})

export const couponSchema = z.object({
  code: z.string().min(2).max(40),
  type: z.enum(['Percentage', 'Fixed Amount', 'Free Shipping']),
  discountValue: z.coerce.number().nonnegative().default(0),
  minimumOrderAmount: z.coerce.number().nonnegative().default(0),
  applicableProducts: stringList,
  applicableCategories: stringList,
  startDate: z.string().max(40).optional().default(''),
  endDate: z.string().max(40).optional().default(''),
  usageLimit: z.coerce.number().int().nonnegative().default(0),
  perCustomerUsageLimit: z.coerce.number().int().nonnegative().default(0),
  status: z.enum(['Active', 'Inactive']).default('Active')
}).superRefine((value, ctx) => {
  if (value.type !== 'Free Shipping' && value.discountValue <= 0) {
    ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Discount value is required.' })
  }
  if (value.type === 'Percentage' && value.discountValue > 100) {
    ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Percentage discount cannot exceed 100%.' })
  }
  validateDateOrder(value, ctx)
})

export const bannerSchema = z.object({
  title: z.string().min(2).max(180),
  subtitle: optionalString,
  image: z.string().min(1).max(1000),
  ctaText: z.string().max(120).optional().default(''),
  ctaLink: z.string().max(1000).optional().default(''),
  position: z.string().min(2).max(120),
  enabled: z.boolean().default(false),
  startDate: z.string().max(40).optional().default(''),
  endDate: z.string().max(40).optional().default('')
}).superRefine(validateDateOrder)

export const blogSchema = z.object({
  title: z.string().min(2).max(180),
  slug: z.string().min(2).max(180),
  excerpt: optionalString,
  content: stringList,
  image: z.string().min(1).max(1000),
  category: z.string().max(120).optional().default(''),
  tags: stringList,
  author: z.string().max(120).optional().default('Royal Fusion'),
  publishedAt: z.string().max(40).optional().default(''),
  status: z.enum(['Draft', 'Published', 'Unpublished']).default('Draft'),
  seoTitle: optionalString,
  seoDescription: optionalString
})

const reviewLikeSchema = z.object({
  productId: z.string().max(120).optional().default(''),
  name: z.string().min(2).max(120),
  city: z.string().max(120).optional().default(''),
  rating: z.coerce.number().int().min(1).max(5),
  product: z.string().max(180).optional().default(''),
  text: z.string().min(5).max(2000),
  avatar: z.string().max(1000).optional().default(''),
  featured: z.boolean().default(false),
  status: z.enum(['Approved', 'Pending', 'Rejected']).default('Pending')
})

export const testimonialSchema = reviewLikeSchema.omit({ productId: true })
export const reviewSchema = reviewLikeSchema

export const subscriberSchema = z.object({
  email: z.string().email()
})

export const contactMessageAdminSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(7).max(40),
  subject: z.string().min(2).max(160),
  message: z.string().min(5).max(5000),
  status: z.enum(['Read', 'Unread']).default('Unread')
})

export const seoSchema = z.object({
  page: z.string().min(2).max(120),
  slug: z.string().min(1).max(180),
  seoTitle: optionalString,
  metaDescription: optionalString,
  ogTitle: optionalString,
  ogDescription: optionalString,
  ogImage: z.string().max(1000).optional().default(''),
  imageAlt: z.string().max(180).optional().default('')
})

export const editablePageSchema = z.object({
  title: z.string().min(2).max(180),
  slug: z.string().min(1).max(180),
  content: optionalString,
  status: statusString,
  seoTitle: optionalString,
  seoDescription: optionalString
})

export const genericSchema = z.record(z.string(), z.unknown())

function validateDateOrder(value, ctx) {
  if (value.startDate && value.endDate && new Date(value.startDate) > new Date(value.endDate)) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be after start date.' })
  }
}
