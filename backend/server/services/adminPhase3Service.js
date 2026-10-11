import { couponConfigSchema, seoPages } from '../schemas/adminPhase3.js'

export class Phase3Error extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}
const fail = () => new Phase3Error(503, 'ADMIN_RESOURCE_UNAVAILABLE', 'This request could not be completed. Please try again.')
const conflict = () => new Phase3Error(409, 'RESOURCE_CONFLICT', 'This record changed. Reload before saving again.')
const invalid = () => new Phase3Error(400, 'INVALID_ADMIN_REQUEST', 'Please check the supplied information.')
const profileColumns = 'id,full_name,email,phone,status,created_at'
const couponColumns = 'id,code,type,discount_value,minimum_order_amount,max_discount_amount,description,start_date,end_date,usage_limit,used_count,per_customer_usage_limit,status,created_at,updated_at,applicable_product_ids,applicable_category_ids'
const seoColumns = 'id,page_key,route_path,title,description,canonical_url,robots,og_title,og_description,og_image_secure_url,active,updated_at'

class Service {
  constructor(client, logger = console) { this.client = client; this.logger = logger }
  source() { if (!this.client) throw fail(); return this.client }
  async run(query) {
    let result
    try { result = await query } catch { throw fail() }
    if (result.error?.code === '23505') throw new Phase3Error(409, 'DUPLICATE_RECORD', 'This record already exists.')
    if (result.error) throw fail()
    return result
  }
  async getRow(table, columns, id) {
    const { data } = await this.run(this.source().from(table).select(columns).eq('id', id).maybeSingle())
    if (!data) throw new Phase3Error(404, 'RESOURCE_NOT_FOUND', 'Record not found.')
    return data
  }
  async audit(resource, id, permission, action, actor) {
    try {
      const { error } = await this.source().from('admin_audit_logs').insert({
        admin_id: actor.userId, resource, resource_id: id, permission_key: permission,
        action, request_id: actor.requestId, metadata: {},
      })
      if (error) throw error
    } catch { this.logger.warn?.({ event: 'phase3.audit_failed', requestId: actor.requestId }) }
  }
}
export class CustomersService extends Service {
  async adminIds() {
    const { data: roles } = await this.run(this.source().from('roles').select('id').eq('key', 'admin').eq('active', true).range(0, 9))
    if (!roles?.length) return []
    const { data } = await this.run(this.source().from('user_roles').select('user_id').in('role_id', roles.map(r => r.id)).eq('active', true).range(0, 49))
    if (data?.length === 50) throw fail()
    return (data ?? []).map(r => r.user_id)
  }
  async list(f) {
    let query = this.source().from('profiles').select(profileColumns, { count: 'exact' })
    for (const id of await this.adminIds()) query = query.neq('id', id)
    if (f.search) {
      const pattern = JSON.stringify(`%${escapeLike(f.search)}%`)
      query = query.or(['full_name', 'email', 'phone'].map(col => `${col}.ilike.${pattern}`).join(','))
    }
    return page(await this.run(query.order('created_at', { ascending: false }).order('id', { ascending: false })
      .range((f.page - 1) * f.pageSize, f.page * f.pageSize - 1)), f, profile)
  }
  async detail(id) {
    if ((await this.adminIds()).includes(id)) throw new Phase3Error(404, 'RESOURCE_NOT_FOUND', 'Record not found.')
    const row = await this.getRow('profiles', profileColumns, id)
    const { data } = await this.run(this.source().from('customer_addresses')
      .select('id,label,recipient_name,phone,address_line_1,address_line_2,city,province,postal_code,country_code,is_default')
      .eq('customer_id', id).order('id', { ascending: true }).range(0, 49))
    return { ...profile(row), addresses: data ?? [], addressesTruncated: data?.length === 50 }
  }
  async orders(id, f) {
    await this.detail(id)
    const result = await this.run(this.source().from('orders')
      .select('id,order_number,status,payment_status,total,currency,created_at', { count: 'exact' }).eq('customer_id', id)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range((f.page - 1) * f.pageSize, f.page * f.pageSize - 1))
    return page(result, f, o => ({ id: o.id, orderNumber: o.order_number, status: o.status,
      paymentStatus: o.payment_status, total: Number(o.total), currency: o.currency, createdAt: o.created_at }))
  }
}
export class CouponsService extends Service {
  async list(f) {
    let query = this.source().from('coupons').select(couponColumns, { count: 'exact' })
    if (f.search) query = query.ilike('code', `%${escapeLike(f.search)}%`)
    return page(await this.run(query.order('created_at', { ascending: false }).order('id', { ascending: false })
      .range((f.page - 1) * f.pageSize, f.page * f.pageSize - 1)), f, coupon)
  }
  async detail(id) {
    const row = await this.getRow('coupons', couponColumns, id)
    const [products, categories, redemptions] = await Promise.all([
      this.run(this.source().from('coupon_products').select('product_id').eq('coupon_id', id).order('product_id', { ascending: true }).range(0, 99)),
      this.run(this.source().from('coupon_categories').select('category_id').eq('coupon_id', id).order('category_id', { ascending: true }).range(0, 99)),
      this.run(this.source().from('coupon_redemptions').select('id,discount_amount,created_at', { count: 'exact' }).eq('coupon_id', id)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, 19)),
    ])
    return { ...coupon(row), productIds: (products.data ?? []).map(p => p.product_id), categoryIds: (categories.data ?? []).map(c => c.category_id),
      restrictionsTruncated: products.data?.length === 100 || categories.data?.length === 100,
      legacyProductIds: row.applicable_product_ids, legacyCategoryIds: row.applicable_category_ids,
      redemptionCount: redemptions.count ?? 0, redemptions: redemptions.data ?? [] }
  }
  validate(config, type) {
    if (!couponConfigSchema.safeParse(config).success) throw invalid()
    if (config.startDate && config.endDate && config.startDate > config.endDate) throw invalid()
    if (type === 'Percentage' && (config.discountValue <= 0 || config.discountValue > 100)) throw invalid()
    if (type === 'Fixed Amount' && config.discountValue <= 0) throw invalid()
    if (type === 'Free Shipping' && (config.discountValue !== 0 || config.maxDiscountAmount !== null)) throw invalid()
  }
  async create(input, actor) {
    const { code, type, ...config } = input
    this.validate(config, type)
    const { data } = await this.run(this.source().from('coupons').insert({ code, type, ...couponPatch(config) }).select(couponColumns).single())
    if (!data) throw fail()
    await this.audit('coupons', data.id, 'coupons.manage', 'coupon.create', actor)
    return coupon(data)
  }
  async update(id, input, actor) {
    const row = await this.getRow('coupons', couponColumns, id)
    const { expectedUpdatedAt, ...config } = input
    this.validate(config, row.type)
    if (config.usageLimit > 0 && config.usageLimit < row.used_count) throw invalid()
    const { data } = await this.run(this.source().from('coupons').update(couponPatch(config)).eq('id', id)
      .eq('updated_at', expectedUpdatedAt).eq('used_count', row.used_count).select(couponColumns).maybeSingle())
    if (!data) throw conflict()
    await this.audit('coupons', id, 'coupons.manage', 'coupon.update', actor)
    return coupon(data)
  }
}
export class SeoService extends Service {
  async list() {
    const { data } = await this.run(this.source().from('seo_settings').select(seoColumns).in('route_path', Object.values(seoPages)).order('route_path', { ascending: true }).range(0, 19))
    return (data ?? []).map(seo)
  }
  async save(key, input, config, actor) {
    const path = seoPages[key]
    for (const value of [input.canonicalUrl, input.ogImage]) {
      if (!value) continue
      let url
      try { url = new URL(value) } catch { throw invalid() }
      if (url.protocol !== 'https:' || url.username || url.password || /[<>\s]/.test(value)) throw invalid()
      if (value === input.canonicalUrl && (!config.allowedOrigins.includes(url.origin) || url.pathname !== path || url.search || url.hash)) throw invalid()
    }
    const { data: rows } = await this.run(this.source().from('seo_settings').select(seoColumns).eq('route_path', path).range(0, 1))
    if (rows?.length > 1) throw fail()
    const current = rows?.[0]
    const patch = { title: input.title, description: input.description, canonical_url: input.canonicalUrl,
      og_title: input.ogTitle, og_description: input.ogDescription, og_image_secure_url: input.ogImage }
    let query
    if (current) {
      if (!input.expectedUpdatedAt) throw conflict()
      query = this.source().from('seo_settings').update(patch).eq('id', current.id).eq('updated_at', input.expectedUpdatedAt)
    } else {
      if (input.expectedUpdatedAt) throw conflict()
      query = this.source().from('seo_settings').insert({ ...patch, page_key: key, route_path: path })
    }
    const { data } = await this.run(query.select(seoColumns).maybeSingle())
    if (!data) throw conflict()
    await this.audit('seo_settings', data.id, 'seo.manage', 'seo.update', actor)
    return seo(data)
  }
}
function profile(r) { return { id: r.id, name: r.full_name, email: r.email ?? '', phone: r.phone ?? '', status: r.status, createdAt: r.created_at } }
function coupon(r) { return { id: r.id, code: r.code, type: r.type, discountValue: Number(r.discount_value), minimumOrderAmount: Number(r.minimum_order_amount),
  maxDiscountAmount: r.max_discount_amount == null ? null : Number(r.max_discount_amount), description: r.description, startDate: r.start_date, endDate: r.end_date,
  usageLimit: r.usage_limit, usedCount: r.used_count, perCustomerUsageLimit: r.per_customer_usage_limit, status: r.status, updatedAt: r.updated_at } }
function couponPatch(c) { return { discount_value: c.discountValue, minimum_order_amount: c.minimumOrderAmount, max_discount_amount: c.maxDiscountAmount,
  description: c.description, start_date: c.startDate, end_date: c.endDate, usage_limit: c.usageLimit, per_customer_usage_limit: c.perCustomerUsageLimit, status: c.status } }
function seo(r) { return { id: r.id, pageKey: r.page_key, routePath: r.route_path, title: r.title, description: r.description, canonicalUrl: r.canonical_url,
  robots: r.robots, ogTitle: r.og_title, ogDescription: r.og_description, ogImage: r.og_image_secure_url, active: r.active, updatedAt: r.updated_at } }
function page(result, f, map) { return { items: (result.data ?? []).map(map), total: result.count ?? 0, page: f.page, pageSize: f.pageSize } }
function escapeLike(value) { return value.replace(/[\\%_]/g, '\\$&') }
