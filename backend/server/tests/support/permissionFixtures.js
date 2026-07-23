export const OWNER_CAPABILITIES = Object.freeze([
  'users', 'roles', 'sessions', 'products', 'variants', 'categories', 'collections',
  'inventory', 'commerce-media', 'homepage', 'testimonials', 'blogs', 'journals',
  'orders', 'customers', 'refunds', 'tax', 'payments', 'shipping', 'protected-settings',
  'reports', 'audit-logs', 'deployment',
])

export const OWNER_PERMISSIONS = Object.freeze(['*'])

export const MANAGER_CAPABILITIES = Object.freeze([
  'products', 'variants', 'categories', 'collections', 'inventory', 'commerce-media',
  'homepage', 'announcement-bar', 'hero-slides', 'promotional-banners',
  'featured-products', 'best-sellers', 'new-arrivals', 'testimonials', 'blogs',
  'journals', 'content-seo',
])

export const MANAGER_PERMISSIONS = Object.freeze([
  'dashboard.read',
  'catalog.read',
  'catalog.manage',
  'categories.manage',
  'collections.manage',
  'inventory.read',
  'inventory.adjust',
  'media.commerce.manage',
  'media.delete',
  'homepage.manage',
  'seo.content.manage',
])

export const MANAGER_FORBIDDEN_CAPABILITIES = Object.freeze([
  'users', 'roles', 'orders', 'customers', 'refund-authorization', 'tax-configuration',
  'payment-configuration', 'shipping-configuration', 'protected-settings',
  'provider-secrets', 'audit-log-deletion', 'deployment',
])

export const MANAGER_FORBIDDEN_PERMISSIONS = Object.freeze([
  'access.manage',
  'roles.manage',
  'orders.read',
  'orders.manage',
  'customers.read',
  'customers.manage',
  'refunds.authorize',
  'tax.configure',
  'payments.configure',
  'shipping.manage',
  'settings.private.manage',
  'audit.delete',
  'deployment.manage',
])

export const CUSTOMER_PERMISSIONS = Object.freeze([])
