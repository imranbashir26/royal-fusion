export class ReviewApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

const adminColumns = 'id,product_id,customer_id,name,city,rating,product,text,featured,status,created_at,updated_at'
const publicColumns = 'id,product_id,name,city,rating,text,created_at'

export class ReviewsV1Service {
  constructor(client, logger = console) {
    this.client = client
    this.logger = logger
  }

  requireClient() {
    if (!this.client) throw new ReviewApiError(503, 'REVIEWS_UNAVAILABLE', 'Reviews are unavailable.')
    return this.client
  }

  async validProduct(id) {
    const { data, error } = await this.requireClient().from('products')
      .select('id,name,slug,status,active').eq('id', id).maybeSingle()
    if (error) throw dbError()
    return data?.status === 'Published' && data.active === true ? data : null
  }

  async submit(input) {
    const product = await this.validProduct(input.productId)
    if (!product) throw new ReviewApiError(400, 'INVALID_REVIEW_PRODUCT', 'Choose an available product.')
    const { error } = await this.requireClient().from('reviews').insert({
      product_id: product.id,
      customer_id: null,
      name: input.name,
      city: input.city,
      rating: input.rating,
      product: product.name,
      text: input.text,
      featured: false,
      status: 'Pending',
    })
    if (error) throw dbError()
    return { message: 'Thank you. Your review has been submitted for moderation.' }
  }

  async publicList() {
    const { data, error } = await this.requireClient().from('reviews')
      .select(publicColumns).eq('status', 'Approved').not('product_id', 'is', null)
      .order('created_at', { ascending: false })
    if (error) throw dbError()
    const rows = data ?? []
    const products = await this.productsById(rows.map((row) => row.product_id), true)
    return rows.filter((row) => products.has(row.product_id)).map((row) => ({
      id: row.id,
      productId: row.product_id,
      product: products.get(row.product_id).name,
      name: row.name,
      city: row.city,
      rating: row.rating,
      text: row.text,
      createdAt: row.created_at,
    }))
  }

  async productsById(ids, publicOnly = false) {
    const unique = [...new Set(ids.filter(Boolean))]
    if (!unique.length) return new Map()
    let query = this.requireClient().from('products').select('id,name,status,active').in('id', unique)
    if (publicOnly) query = query.eq('status', 'Published').eq('active', true)
    const { data, error } = await query
    if (error) throw dbError()
    return new Map((data ?? []).map((row) => [row.id, row]))
  }

  async filterProducts() {
    const { data, error } = await this.requireClient().from('products').select('id,name').order('name', { ascending: true })
    if (error) throw dbError()
    return (data ?? []).map((row) => ({ id: row.id, name: row.name }))
  }

  async list(filters) {
    let query = this.requireClient().from('reviews').select(adminColumns, { count: 'exact' })
    if (filters.status) query = query.eq('status', filters.status)
    if (filters.productId) query = query.eq('product_id', filters.productId)
    if (filters.rating) query = query.eq('rating', filters.rating)
    if (filters.search) {
      const term = filters.search.replace(/[%,.()]/g, '').trim()
      if (term) query = query.or(`name.ilike.%${term}%,text.ilike.%${term}%`)
    }
    const from = (filters.page - 1) * filters.pageSize
    const { data, count, error } = await query.order('created_at', { ascending: false })
      .range(from, from + filters.pageSize - 1)
    if (error) throw dbError()
    const products = await this.productsById((data ?? []).map((row) => row.product_id))
    return { items: (data ?? []).map((row) => adminDto(row, products)), total: count ?? 0, page: filters.page, pageSize: filters.pageSize }
  }

  async get(id) {
    const { data, error } = await this.requireClient().from('reviews').select(adminColumns).eq('id', id).maybeSingle()
    if (error) throw dbError()
    if (!data) throw notFound()
    return adminDto(data, await this.productsById([data.product_id]))
  }

  async update(id, input, actor) {
    const existing = await this.get(id)
    const { data, error } = await this.requireClient().from('reviews')
      .update({ status: input.status, featured: input.featured })
      .eq('id', id).select(adminColumns).maybeSingle()
    if (error) throw dbError()
    if (!data) throw notFound()
    const action = input.status !== existing.status
      ? input.status === 'Approved' ? 'review.approve' : input.status === 'Rejected' ? 'review.reject' : 'review.update'
      : 'review.update'
    await this.audit(action, id, actor)
    return adminDto(data, await this.productsById([data.product_id]))
  }

  async remove(id, actor) {
    await this.get(id)
    const { error } = await this.requireClient().from('reviews').delete().eq('id', id)
    if (error) throw dbError()
    await this.audit('review.delete', id, actor)
    return { id, removed: true }
  }

  async audit(action, id, actor) {
    try {
      const { error } = await this.requireClient().from('admin_audit_logs').insert({
        admin_id: actor.userId,
        action,
        resource: 'reviews',
        resource_id: id,
        permission_key: 'reviews.manage',
        request_id: actor.requestId,
        metadata: {},
      })
      if (error) throw error
    } catch {
      this.logger.warn?.({ event: 'reviews.audit_failed', reviewId: id, requestId: actor.requestId })
    }
  }
}

function adminDto(row, products) {
  return {
    id: row.id,
    productId: row.product_id,
    product: products.get(row.product_id)?.name ?? row.product,
    name: row.name,
    city: row.city,
    rating: row.rating,
    text: row.text,
    featured: row.featured,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function dbError() { return new ReviewApiError(500, 'REVIEWS_ERROR', 'Review request could not be completed.') }
function notFound() { return new ReviewApiError(404, 'REVIEW_NOT_FOUND', 'Review not found.') }
