export const ROLE_PERMISSIONS = {
  'Owner/Admin': ['*'],
  'Shop Manager': [
    'dashboard:read',
    'products:manage',
    'categories:manage',
    'orders:manage',
    'coupons:manage',
    'shipping:manage'
  ],
  'Order Manager': ['dashboard:read', 'orders:manage', 'customers:read'],
  'Content Editor': [
    'dashboard:read',
    'blogs:manage',
    'banners:manage',
    'testimonials:manage',
    'reviews:manage',
    'homepage:manage',
    'seo:manage',
    'editablePages:manage',
    'settings:read'
  ],
  'Blog Writer': ['dashboard:read', 'blogs:drafts']
}

export const RESOURCE_PERMISSIONS = {
  products: 'products:manage',
  categories: 'categories:manage',
  orders: 'orders:manage',
  customers: 'customers:read',
  coupons: 'coupons:manage',
  banners: 'banners:manage',
  blogs: 'blogs:manage',
  testimonials: 'testimonials:manage',
  reviews: 'reviews:manage',
  newsletterSubscribers: 'newsletter:manage',
  contactMessages: 'contactMessages:manage',
  settings: 'settings:manage',
  homepage: 'homepage:manage',
  shipping: 'shipping:manage',
  payments: 'payments:manage',
  seo: 'seo:manage',
  editablePages: 'editablePages:manage',
  users: 'users:manage'
}

export function getPermissions(role) {
  return ROLE_PERMISSIONS[role] ?? []
}

export function hasPermission(role, permission) {
  const permissions = getPermissions(role)
  return permissions.includes('*') || permissions.includes(permission)
}
