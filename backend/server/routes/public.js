import { Router } from 'express'
import { nanoid } from 'nanoid'
import { validate } from '../middleware/validate.js'
import { readDb, updateDb, nowIso } from '../utils/database.js'
import { calculateDiscount, calculateShipping, validateCoupon } from '../utils/calculations.js'
import { contactSchema, couponValidationSchema, newsletterSchema, orderSchema } from '../utils/schemas.js'

export const publicRouter = Router()

publicRouter.get('/storefront', async (_req, res) => {
  const db = await readDb()
  res.json({
    products: db.products.filter((product) => product.status === 'Published'),
    categories: db.categories
      .filter((category) => category.status === 'Published')
      .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0)),
    blogs: db.blogs.filter((blog) => blog.status === 'Published'),
    reviews: db.reviews.filter((review) => review.status === 'Approved'),
    testimonials: db.testimonials.filter((testimonial) => testimonial.status === 'Approved'),
    banners: db.banners.filter((banner) => banner.enabled),
    settings: db.settings,
    homepage: db.homepage,
    shipping: db.shipping,
    payments: db.payments.filter((payment) => payment.active).sort((a, b) => a.displayOrder - b.displayOrder),
    seo: db.seo,
    editablePages: db.editablePages.filter((page) => page.status === 'Published')
  })
})

publicRouter.get('/products', async (_req, res) => {
  const db = await readDb()
  res.json(db.products.filter((product) => product.status === 'Published'))
})

publicRouter.get('/products/:slug', async (req, res) => {
  const db = await readDb()
  const product = db.products.find((item) => item.slug === req.params.slug && item.status === 'Published')
  if (!product) return res.status(404).json({ message: 'Product not found.' })
  res.json(product)
})

publicRouter.get('/blogs', async (_req, res) => {
  const db = await readDb()
  res.json(db.blogs.filter((blog) => blog.status === 'Published'))
})

publicRouter.get('/blogs/:slug', async (req, res) => {
  const db = await readDb()
  const blog = db.blogs.find((item) => item.slug === req.params.slug && item.status === 'Published')
  if (!blog) return res.status(404).json({ message: 'Blog not found.' })
  res.json(blog)
})

publicRouter.post('/newsletter', validate(newsletterSchema), async (req, res) => {
  const subscriber = await updateDb((db) => {
    const exists = db.newsletterSubscribers.some(
      (item) => item.email.toLowerCase() === req.body.email.toLowerCase()
    )
    if (exists) {
      throw Object.assign(new Error('This email is already subscribed.'), { status: 409 })
    }
    const next = {
      id: `sub-${nanoid(8)}`,
      email: req.body.email,
      subscribedAt: nowIso()
    }
    db.newsletterSubscribers.push(next)
    return next
  })
  res.status(201).json({ message: 'You are now on the Royal Fusion list.', subscriber })
})

publicRouter.post('/contact', validate(contactSchema), async (req, res) => {
  const message = await updateDb((db) => {
    const next = {
      id: `msg-${nanoid(8)}`,
      ...req.body,
      status: 'Unread',
      createdAt: nowIso()
    }
    db.contactMessages.push(next)
    return next
  })
  res.status(201).json({
    message: 'Thank you. Our fragrance concierge will contact you shortly.',
    contactMessage: message
  })
})

publicRouter.post('/coupons/validate', validate(couponValidationSchema), async (req, res) => {
  const db = await readDb()
  const coupon = db.coupons.find((item) => item.code.toLowerCase() === req.body.code.toLowerCase())
  const validation = validateCoupon(coupon, req.body)
  if (!validation.valid) return res.status(400).json(validation)
  const discount = calculateDiscount(coupon, req.body.subtotal)
  const shippingFee = coupon.type === 'Free Shipping'
    ? 0
    : calculateShipping(db.shipping, req.body.city, req.body.province, req.body.subtotal - discount)
  res.json({
    valid: true,
    coupon,
    discount,
    shippingFee
  })
})

publicRouter.post('/orders', validate(orderSchema), async (req, res) => {
  const order = await updateDb((db) => {
    const productIds = req.body.items.map((item) => item.productId)
    const orderItems = req.body.items.map((item) => {
      const product = db.products.find((candidate) => candidate.id === item.productId)
      if (!product || product.status !== 'Published') {
        throw Object.assign(new Error('One or more products are unavailable.'), { status: 400 })
      }
      if (Number(product.stock || 0) < item.quantity) {
        throw Object.assign(new Error(`${product.name} does not have enough stock.`), { status: 400 })
      }
      const size = product.sizeOptions?.find((option) => option.value === item.size)
      return {
        productId: product.id,
        name: product.name,
        size: item.size,
        quantity: item.quantity,
        unitPrice: Number(size?.price ?? product.salePrice ?? product.price),
        category: product.category
      }
    })

    const subtotal = orderItems.reduce((total, item) => total + item.unitPrice * item.quantity, 0)
    const categories = orderItems.map((item) => item.category)
    const coupon = req.body.couponCode
      ? db.coupons.find((item) => item.code.toLowerCase() === req.body.couponCode.toLowerCase())
      : null
    const couponValidation = coupon
      ? validateCoupon(coupon, { subtotal, productIds, categories })
      : { valid: true }
    if (!couponValidation.valid) {
      throw Object.assign(new Error(couponValidation.reason), { status: 400 })
    }

    const discount = coupon ? calculateDiscount(coupon, subtotal) : 0
    const shippingFee = coupon?.type === 'Free Shipping'
      ? 0
      : calculateShipping(db.shipping, req.body.shipping.city, req.body.shipping.province, subtotal - discount)
    const total = Math.max(0, subtotal - discount + shippingFee)
    const orderNumber = `RF-${Date.now().toString().slice(-7)}`
    const customer = upsertCustomer(db, req.body.contact, req.body.shipping, total)

    for (const item of req.body.items) {
      const product = db.products.find((candidate) => candidate.id === item.productId)
      product.stock = Math.max(0, Number(product.stock || 0) - item.quantity)
      product.stockStatus = product.stock === 0 ? 'Out of Stock' : product.stock < 6 ? 'Low Stock' : 'In Stock'
      product.updatedAt = nowIso()
    }

    if (coupon) {
      coupon.usedCount = Number(coupon.usedCount || 0) + 1
    }

    const nextOrder = {
      id: orderNumber,
      orderNumber,
      status: 'Pending',
      paymentMethod: req.body.paymentMethod,
      paymentStatus: req.body.paymentMethod === 'Cash on Delivery' ? 'Unpaid' : 'Pending',
      customer: {
        id: customer.id,
        name: req.body.contact.name,
        email: req.body.contact.email,
        phone: req.body.contact.phone
      },
      shipping: req.body.shipping,
      items: orderItems.map(({ category: _category, ...item }) => item),
      subtotal,
      discount,
      shippingFee,
      total,
      couponCode: coupon?.code ?? '',
      internalNotes: [],
      courierName: '',
      trackingNumber: '',
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
    db.orders.unshift(nextOrder)
    return nextOrder
  })

  res.status(201).json({
    id: order.id,
    status: 'confirmed',
    message: 'Your Royal Fusion order has been received.',
    order
  })
})

function upsertCustomer(db, contact, shipping, total) {
  const existing = db.customers.find(
    (customer) =>
      customer.email.toLowerCase() === contact.email.toLowerCase() ||
      customer.phone === contact.phone
  )
  if (existing) {
    existing.name = contact.name
    existing.email = contact.email
    existing.phone = contact.phone
    existing.address = `${shipping.address}, ${shipping.city}`
    existing.totalOrders = Number(existing.totalOrders || 0) + 1
    existing.totalSpending = Number(existing.totalSpending || 0) + total
    existing.lastOrderDate = nowIso()
    return existing
  }

  const customer = {
    id: `cust-${nanoid(8)}`,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    address: `${shipping.address}, ${shipping.city}`,
    totalOrders: 1,
    totalSpending: total,
    lastOrderDate: nowIso()
  }
  db.customers.push(customer)
  return customer
}
