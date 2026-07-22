import {
  BadgePercent,
  Boxes,
  FileText,
  Image,
  Mail,
  MessageSquare,
  Package,
  Quote,
  Search,
  ShoppingBag,
  Star,
  Tags,
  Users,
} from 'lucide-react'

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'tags'
  | 'date'
  | 'images'
  | 'json'

export interface AdminField {
  name: string
  label: string
  type?: FieldType
  options?: string[]
  required?: boolean
  help?: string
}

export interface AdminResourceConfig {
  label: string
  singular: string
  endpoint: string
  permission: string
  icon: typeof Package
  columns: string[]
  fields: AdminField[]
  readOnly?: boolean
}

export const adminNav = [
  { label: 'Dashboard', to: '/admin/dashboard', icon: Boxes, permission: 'dashboard:read' },
  { label: 'Products', to: '/admin/products', icon: Package, permission: 'products:manage' },
  { label: 'Categories', to: '/admin/categories', icon: Tags, permission: 'categories:manage' },
  { label: 'Orders', to: '/admin/orders', icon: ShoppingBag, permission: 'orders:manage' },
  { label: 'Customers', to: '/admin/customers', icon: Users, permission: 'customers:read' },
  { label: 'Coupons', to: '/admin/coupons', icon: BadgePercent, permission: 'coupons:manage' },
  { label: 'Banners', to: '/admin/banners', icon: Image, permission: 'banners:manage' },
  { label: 'Blogs', to: '/admin/blogs', icon: FileText, permission: 'blogs:manage' },
  { label: 'Testimonials', to: '/admin/testimonials', icon: Quote, permission: 'testimonials:manage' },
  { label: 'Reviews', to: '/admin/reviews', icon: Star, permission: 'reviews:manage' },
  { label: 'Newsletter', to: '/admin/newsletter', icon: Mail, permission: 'newsletter:manage' },
  { label: 'Messages', to: '/admin/contact-messages', icon: MessageSquare, permission: 'contactMessages:manage' },
  { label: 'Settings', to: '/admin/settings', icon: Boxes, permission: 'settings:manage' },
  { label: 'SEO', to: '/admin/seo', icon: Search, permission: 'seo:manage' },
  { label: 'Users', to: '/admin/users', icon: Users, permission: 'users:manage' },
]

const statusOptions = ['Published', 'Draft', 'Unpublished', 'Archived']

export const resourceConfigs: Record<string, AdminResourceConfig> = {
  products: {
    label: 'Products',
    singular: 'Product',
    endpoint: 'products',
    permission: 'products:manage',
    icon: Package,
    columns: ['name', 'sku', 'category', 'price', 'stock', 'status'],
    fields: [
      { name: 'name', label: 'Product name', required: true },
      { name: 'slug', label: 'Slug', required: true },
      { name: 'sku', label: 'SKU', required: true },
      { name: 'shortDescription', label: 'Short description', type: 'textarea' },
      { name: 'description', label: 'Full description', type: 'textarea' },
      { name: 'price', label: 'Price', type: 'number', required: true },
      { name: 'salePrice', label: 'Sale price', type: 'number' },
      { name: 'oldPrice', label: 'Old price', type: 'number' },
      { name: 'stock', label: 'Stock quantity', type: 'number', required: true },
      { name: 'stockStatus', label: 'Stock status', type: 'select', options: ['In Stock', 'Low Stock', 'Out of Stock'] },
      { name: 'category', label: 'Category', required: true },
      { name: 'tags', label: 'Tags', type: 'tags' },
      { name: 'gender', label: 'Gender', type: 'select', options: ['Men', 'Women', 'Unisex'] },
      { name: 'scentFamily', label: 'Fragrance family', required: true },
      { name: 'notes.top', label: 'Top notes', type: 'tags' },
      { name: 'notes.middle', label: 'Middle notes', type: 'tags' },
      { name: 'notes.base', label: 'Base notes', type: 'tags' },
      { name: 'bottleSize', label: 'Bottle size' },
      { name: 'concentration', label: 'Concentration' },
      { name: 'longevity', label: 'Longevity' },
      { name: 'occasion', label: 'Occasion', type: 'tags' },
      { name: 'inspiredBy', label: 'Inspired By / Impression Of' },
      { name: 'gallery', label: 'Product images', type: 'images', required: true, help: 'Upload at least one image, preview it, choose main image, and reorder by dragging text order if needed.' },
      { name: 'mainImage', label: 'Main image URL or bottle tone' },
      { name: 'image', label: 'Card image URL or bottle tone' },
      { name: 'badge', label: 'Badge' },
      { name: 'variations', label: 'Variations', type: 'json', help: 'JSON array with name, price, salePrice, SKU, stock, image, active.' },
      { name: 'isFeatured', label: 'Featured product', type: 'checkbox' },
      { name: 'isBestSeller', label: 'Best seller', type: 'checkbox' },
      { name: 'isNewArrival', label: 'New arrival', type: 'checkbox' },
      { name: 'isPremium', label: 'Luxury/premium', type: 'checkbox' },
      { name: 'isAttar', label: 'Attar', type: 'checkbox' },
      { name: 'status', label: 'Publishing status', type: 'select', options: statusOptions },
      { name: 'seoTitle', label: 'SEO title' },
      { name: 'seoDescription', label: 'SEO meta description', type: 'textarea' },
      { name: 'imageAlt', label: 'Image alt text' },
    ],
  },
  categories: {
    label: 'Categories',
    singular: 'Category',
    endpoint: 'categories',
    permission: 'categories:manage',
    icon: Tags,
    columns: ['name', 'slug', 'displayOrder', 'showOnHomepage', 'status'],
    fields: [
      { name: 'name', label: 'Category name', required: true },
      { name: 'slug', label: 'Slug', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'image', label: 'Category image', type: 'images' },
      { name: 'displayOrder', label: 'Display order', type: 'number' },
      { name: 'showOnHomepage', label: 'Homepage visibility', type: 'checkbox' },
      { name: 'status', label: 'Status', type: 'select', options: ['Published', 'Draft', 'Unpublished'] },
      { name: 'seoTitle', label: 'SEO title' },
      { name: 'seoDescription', label: 'SEO description', type: 'textarea' },
    ],
  },
  coupons: {
    label: 'Coupons & Offers',
    singular: 'Coupon',
    endpoint: 'coupons',
    permission: 'coupons:manage',
    icon: BadgePercent,
    columns: ['code', 'type', 'discountValue', 'minimumOrderAmount', 'status'],
    fields: [
      { name: 'code', label: 'Coupon code', required: true },
      { name: 'type', label: 'Coupon type', type: 'select', options: ['Percentage', 'Fixed Amount', 'Free Shipping'] },
      { name: 'discountValue', label: 'Discount value', type: 'number' },
      { name: 'minimumOrderAmount', label: 'Minimum order amount', type: 'number' },
      { name: 'applicableProducts', label: 'Applicable products', type: 'tags' },
      { name: 'applicableCategories', label: 'Applicable categories', type: 'tags' },
      { name: 'startDate', label: 'Start date', type: 'date' },
      { name: 'endDate', label: 'End date', type: 'date' },
      { name: 'usageLimit', label: 'Usage limit', type: 'number' },
      { name: 'perCustomerUsageLimit', label: 'Per-customer usage limit', type: 'number' },
      { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'] },
    ],
  },
  banners: {
    label: 'Banners & Campaigns',
    singular: 'Banner',
    endpoint: 'banners',
    permission: 'banners:manage',
    icon: Image,
    columns: ['title', 'position', 'enabled', 'startDate', 'endDate'],
    fields: [
      { name: 'title', label: 'Title', required: true },
      { name: 'subtitle', label: 'Subtitle', type: 'textarea' },
      { name: 'image', label: 'Banner image', type: 'images' },
      { name: 'ctaText', label: 'CTA text' },
      { name: 'ctaLink', label: 'CTA link' },
      { name: 'position', label: 'Banner position', type: 'select', options: ['Top announcement bar', 'Homepage hero', 'Homepage campaign section', 'Shop page banner', 'Product page banner', 'Checkout banner'] },
      { name: 'enabled', label: 'Enabled', type: 'checkbox' },
      { name: 'startDate', label: 'Start date', type: 'date' },
      { name: 'endDate', label: 'End date', type: 'date' },
    ],
  },
  blogs: {
    label: 'Blogs',
    singular: 'Blog',
    endpoint: 'blogs',
    permission: 'blogs:manage',
    icon: FileText,
    columns: ['title', 'category', 'author', 'status', 'publishedAt'],
    fields: [
      { name: 'title', label: 'Title', required: true },
      { name: 'slug', label: 'Slug', required: true },
      { name: 'excerpt', label: 'Excerpt', type: 'textarea' },
      { name: 'content', label: 'Content paragraphs', type: 'tags' },
      { name: 'image', label: 'Featured image', type: 'images' },
      { name: 'category', label: 'Category' },
      { name: 'tags', label: 'Tags', type: 'tags' },
      { name: 'author', label: 'Author' },
      { name: 'publishedAt', label: 'Publish date', type: 'date' },
      { name: 'status', label: 'Status', type: 'select', options: ['Draft', 'Published', 'Unpublished'] },
      { name: 'seoTitle', label: 'SEO title' },
      { name: 'seoDescription', label: 'SEO meta description', type: 'textarea' },
    ],
  },
  testimonials: {
    label: 'Testimonials',
    singular: 'Testimonial',
    endpoint: 'testimonials',
    permission: 'testimonials:manage',
    icon: Quote,
    columns: ['name', 'city', 'rating', 'featured', 'status'],
    fields: [
      { name: 'name', label: 'Customer name', required: true },
      { name: 'city', label: 'Customer city/label' },
      { name: 'rating', label: 'Rating', type: 'number' },
      { name: 'product', label: 'Product purchased' },
      { name: 'text', label: 'Review text', type: 'textarea' },
      { name: 'avatar', label: 'Avatar/image', type: 'images' },
      { name: 'featured', label: 'Featured testimonial', type: 'checkbox' },
      { name: 'status', label: 'Status', type: 'select', options: ['Approved', 'Pending', 'Rejected'] },
    ],
  },
  reviews: {
    label: 'Reviews',
    singular: 'Review',
    endpoint: 'reviews',
    permission: 'reviews:manage',
    icon: Star,
    columns: ['name', 'product', 'rating', 'featured', 'status'],
    fields: [
      { name: 'productId', label: 'Product ID' },
      { name: 'name', label: 'Customer name', required: true },
      { name: 'city', label: 'Customer city/label' },
      { name: 'rating', label: 'Rating', type: 'number' },
      { name: 'product', label: 'Product purchased' },
      { name: 'text', label: 'Review text', type: 'textarea' },
      { name: 'featured', label: 'Featured review', type: 'checkbox' },
      { name: 'status', label: 'Status', type: 'select', options: ['Approved', 'Pending', 'Rejected'] },
    ],
  },
  customers: {
    label: 'Customers',
    singular: 'Customer',
    endpoint: 'customers',
    permission: 'customers:read',
    icon: Users,
    columns: ['name', 'email', 'phone', 'totalOrders', 'totalSpending', 'lastOrderDate'],
    readOnly: true,
    fields: [],
  },
  newsletter: {
    label: 'Newsletter Subscribers',
    singular: 'Subscriber',
    endpoint: 'newsletter',
    permission: 'newsletter:manage',
    icon: Mail,
    columns: ['email', 'subscribedAt'],
    fields: [{ name: 'email', label: 'Email', required: true }],
  },
  'contact-messages': {
    label: 'Contact Messages',
    singular: 'Message',
    endpoint: 'contact-messages',
    permission: 'contactMessages:manage',
    icon: MessageSquare,
    columns: ['name', 'email', 'phone', 'subject', 'status', 'createdAt'],
    fields: [
      { name: 'name', label: 'Name' },
      { name: 'email', label: 'Email' },
      { name: 'phone', label: 'Phone' },
      { name: 'subject', label: 'Subject' },
      { name: 'message', label: 'Message', type: 'textarea' },
      { name: 'status', label: 'Status', type: 'select', options: ['Read', 'Unread'] },
    ],
  },
  seo: {
    label: 'SEO Settings',
    singular: 'SEO Entry',
    endpoint: 'seo',
    permission: 'seo:manage',
    icon: Search,
    columns: ['page', 'slug', 'seoTitle', 'metaDescription'],
    fields: [
      { name: 'page', label: 'Page', required: true },
      { name: 'slug', label: 'Slug', required: true },
      { name: 'seoTitle', label: 'SEO title' },
      { name: 'metaDescription', label: 'Meta description', type: 'textarea' },
      { name: 'ogTitle', label: 'Open Graph title' },
      { name: 'ogDescription', label: 'Open Graph description', type: 'textarea' },
      { name: 'ogImage', label: 'Open Graph image', type: 'images' },
      { name: 'imageAlt', label: 'Image alt text' },
    ],
  },
  'editable-pages': {
    label: 'Editable Pages',
    singular: 'Page',
    endpoint: 'editable-pages',
    permission: 'editablePages:manage',
    icon: FileText,
    columns: ['title', 'slug', 'status', 'seoTitle'],
    fields: [
      { name: 'title', label: 'Page title', required: true },
      { name: 'slug', label: 'Slug', required: true },
      { name: 'content', label: 'Page content', type: 'textarea' },
      { name: 'status', label: 'Status', type: 'select', options: ['Published', 'Draft', 'Unpublished'] },
      { name: 'seoTitle', label: 'SEO title' },
      { name: 'seoDescription', label: 'SEO description', type: 'textarea' },
    ],
  },
}
