import { Router } from 'express'
import { nanoid } from 'nanoid'
import { RESOURCE_PERMISSIONS } from '../config/roles.js'
import { requireAdmin, requirePermission } from '../middleware/auth.js'
import { getResource, isSingularResource, nowIso, readDb, updateDb } from '../utils/database.js'
import { sanitizeValue } from '../utils/sanitize.js'
import {
  bannerSchema,
  blogSchema,
  categorySchema,
  contactMessageAdminSchema,
  couponSchema,
  editablePageSchema,
  genericSchema,
  productSchema,
  reviewSchema,
  seoSchema,
  subscriberSchema,
  testimonialSchema
} from '../utils/schemas.js'

export const adminRouter = Router()

const RESOURCE_ALIASES = {
  newsletter: 'newsletterSubscribers',
  'contact-messages': 'contactMessages',
  'editable-pages': 'editablePages',
  homepage: 'homepage',
  shipping: 'shipping',
  payments: 'payments'
}

const schemaByResource = {
  products: productSchema,
  categories: categorySchema,
  coupons: couponSchema,
  banners: bannerSchema,
  blogs: blogSchema,
  testimonials: testimonialSchema,
  reviews: reviewSchema,
  newsletterSubscribers: subscriberSchema,
  contactMessages: contactMessageAdminSchema,
  seo: seoSchema,
  editablePages: editablePageSchema
}

adminRouter.use(requireAdmin)

adminRouter.get('/dashboard', requirePermission('dashboard:read'), async (_req, res) => {
  const db = await readDb()
  const totalSales = db.orders.reduce((total, order) => total + Number(order.total || 0), 0)
  const pendingOrders = db.orders.filter((order) => order.status === 'Pending').length
  const lowStockProducts = db.products.filter((product) => Number(product.stock || 0) <= 5)

  res.json({
    cards: {
      totalOrders: db.orders.length,
      totalSales,
      pendingOrders,
      lowStockProducts: lowStockProducts.length,
      totalProducts: db.products.length,
      totalCustomers: db.customers.length,
      newsletterSubscribers: db.newsletterSubscribers.length
    },
    recentOrders: db.orders.slice(0, 6),
    lowStockProducts: lowStockProducts.slice(0, 8),
    bestSellingProducts: db.products
      .filter((product) => product.isBestSeller)
      .slice(0, 8)
      .map((product) => ({
        id: product.id,
        name: product.name,
        stock: product.stock,
        price: product.price
      }))
  })
})

adminRouter.get('/resources/:resource/export', authorizeResource('read'), async (req, res) => {
  const db = await readDb()
  const resource = normalizeResource(req.params.resource)
  const collection = getResource(db, resource)
  if (!Array.isArray(collection)) {
    return res.status(400).json({ message: 'Only list resources can be exported.' })
  }
  const csv = toCsv(collection)
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename="${resource}.csv"`)
  res.send(csv)
})

adminRouter.get('/resources/:resource', authorizeResource('read'), async (req, res) => {
  const db = await readDb()
  const resource = normalizeResource(req.params.resource)
  const data = getResource(db, resource)
  if (Array.isArray(data)) {
    const search = String(req.query.search ?? '').toLowerCase()
    const filtered = search
      ? data.filter((item) => JSON.stringify(item).toLowerCase().includes(search))
      : data
    return res.json(filtered)
  }
  res.json(data)
})

adminRouter.get('/resources/:resource/:id', authorizeResource('read'), async (req, res) => {
  const db = await readDb()
  const resource = normalizeResource(req.params.resource)
  const data = getResource(db, resource)
  if (!Array.isArray(data)) return res.json(data)
  const item = data.find((candidate) => candidate.id === req.params.id)
  if (!item) return res.status(404).json({ message: `${resource} item not found.` })
  res.json(item)
})

adminRouter.post('/resources/:resource', authorizeResource('write'), async (req, res) => {
  const resource = normalizeResource(req.params.resource)
  if (isSingularResource(resource)) {
    return res.status(400).json({ message: 'Use PUT for this settings resource.' })
  }

  const payload = validateResourcePayload(resource, req.body)
  if (req.blogWriterDraftOnly) payload.status = 'Draft'
  const item = await updateDb((db) => {
    const collection = getResource(db, resource)
    if (!Array.isArray(collection)) {
      throw Object.assign(new Error('Resource is not a list.'), { status: 400 })
    }

    const next = {
      id: payload.id || createResourceId(resource),
      ...payload,
      createdAt: payload.createdAt || nowIso(),
      updatedAt: nowIso()
    }
    collection.unshift(next)
    return next
  })

  res.status(201).json(item)
})

adminRouter.put('/resources/:resource', authorizeResource('write'), async (req, res) => {
  const resource = normalizeResource(req.params.resource)
  if (!isSingularResource(resource)) {
    return res.status(400).json({ message: 'Use /:id when updating list resources.' })
  }
  const payload = sanitizeValue(req.body)
  const result = await updateDb((db) => {
    getResource(db, resource)
    db[resource] = {
      ...db[resource],
      ...payload,
      updatedAt: nowIso()
    }
    return db[resource]
  })
  res.json(result)
})

adminRouter.put('/resources/:resource/:id', authorizeResource('write'), async (req, res) => {
  const resource = normalizeResource(req.params.resource)
  const payload = validateResourcePayload(resource, req.body, true)
  if (req.blogWriterDraftOnly) payload.status = 'Draft'
  const updated = await updateDb((db) => {
    const collection = getResource(db, resource)
    if (!Array.isArray(collection)) {
      throw Object.assign(new Error('Resource is not a list.'), { status: 400 })
    }
    const index = collection.findIndex((item) => item.id === req.params.id)
    if (index === -1) {
      throw Object.assign(new Error(`${resource} item not found.`), { status: 404 })
    }
    collection[index] = {
      ...collection[index],
      ...payload,
      id: collection[index].id,
      updatedAt: nowIso()
    }
    return collection[index]
  })
  res.json(updated)
})

adminRouter.delete('/resources/:resource/:id', authorizeResource('write'), async (req, res) => {
  const resource = normalizeResource(req.params.resource)
  await updateDb((db) => {
    const collection = getResource(db, resource)
    if (!Array.isArray(collection)) {
      throw Object.assign(new Error('Resource is not a list.'), { status: 400 })
    }
    db[resource] = collection.filter((item) => item.id !== req.params.id)
  })
  res.status(204).end()
})

adminRouter.post('/orders/:id/status', requirePermission('orders:manage'), async (req, res) => {
  const allowedStatuses = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned', 'Refunded']
  if (!allowedStatuses.includes(req.body.status)) {
    return res.status(400).json({ message: 'Invalid order status.' })
  }
  const order = await updateDb((db) => {
    const match = db.orders.find((candidate) => candidate.id === req.params.id)
    if (!match) throw Object.assign(new Error('Order not found.'), { status: 404 })
    match.status = req.body.status
    match.updatedAt = nowIso()
    return match
  })
  res.json(order)
})

adminRouter.post('/orders/:id/notes', requirePermission('orders:manage'), async (req, res) => {
  const order = await updateDb((db) => {
    const match = db.orders.find((candidate) => candidate.id === req.params.id)
    if (!match) throw Object.assign(new Error('Order not found.'), { status: 404 })
    match.internalNotes = match.internalNotes || []
    match.internalNotes.unshift({
      id: `note-${nanoid(8)}`,
      text: sanitizeValue(String(req.body.text ?? '')),
      author: req.admin.name,
      createdAt: nowIso()
    })
    match.updatedAt = nowIso()
    return match
  })
  res.json(order)
})

adminRouter.post('/orders/:id/tracking', requirePermission('orders:manage'), async (req, res) => {
  const order = await updateDb((db) => {
    const match = db.orders.find((candidate) => candidate.id === req.params.id)
    if (!match) throw Object.assign(new Error('Order not found.'), { status: 404 })
    match.courierName = sanitizeValue(String(req.body.courierName ?? ''))
    match.trackingNumber = sanitizeValue(String(req.body.trackingNumber ?? ''))
    match.updatedAt = nowIso()
    return match
  })
  res.json(order)
})

function authorizeResource(mode) {
  return (req, res, next) => {
    const resource = normalizeResource(req.params.resource)
    if (resource === 'users') {
      return res.status(400).json({ message: 'Use secure admin user endpoints.' })
    }
    const permission = RESOURCE_PERMISSIONS[resource]
    if (!permission) return res.status(404).json({ message: 'Unknown admin resource.' })

    if (mode === 'read' && req.admin.role === 'Blog Writer' && resource === 'blogs') {
      return next()
    }

    if (mode === 'write' && req.admin.role === 'Blog Writer' && resource === 'blogs') {
      req.blogWriterDraftOnly = true
      return next()
    }

    return requirePermission(permission)(req, res, next)
  }
}

function normalizeResource(resource) {
  return RESOURCE_ALIASES[resource] ?? resource
}

function validateResourcePayload(resource, body, partial = false) {
  const schema = schemaByResource[resource] ?? genericSchema
  const result = (partial ? schema.partial?.() ?? schema : schema).safeParse(sanitizeValue(body))
  if (!result.success) {
    throw Object.assign(
      new Error(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ')),
      { status: 400 }
    )
  }
  if (resource === 'products' && !hasProductImage(result.data)) {
    throw Object.assign(new Error('At least one product image is required.'), { status: 400 })
  }
  return result.data
}

function hasProductImage(product) {
  return Boolean(
    String(product.image ?? '').trim() ||
    String(product.mainImage ?? '').trim() ||
    (Array.isArray(product.gallery) && product.gallery.length > 0)
  )
}

function createResourceId(resource) {
  const prefix = resource.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/s$/, '')
  return `${prefix}-${nanoid(8)}`
}

function toCsv(rows) {
  if (!rows.length) return ''
  const keys = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key))
    return set
  }, new Set()))
  const escape = (value) => {
    const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')
    return `"${serialized.replace(/"/g, '""')}"`
  }
  return [keys.join(','), ...rows.map((row) => keys.map((key) => escape(row[key])).join(','))].join('\n')
}
