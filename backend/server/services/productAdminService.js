import { toProductColumns, toProductDto } from '../mappers/productAdminMapper.js'

export class ProductApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export class ProductAdminService {
  constructor(client, logger = console) {
    this.client = client
    this.logger = logger
  }

  requireClient() {
    if (!this.client) throw new ProductApiError(503, 'PRODUCT_SERVICE_UNAVAILABLE', 'Product service is unavailable.')
    return this.client
  }

  async list({ page, pageSize, search, status }) {
    const client = this.requireClient()
    let query = client.from('products').select('*', { count: 'exact' })
    if (status) query = query.eq('status', status)
    if (search) {
      if (!/^[\p{L}\p{N} _-]+$/u.test(search)) {
        throw new ProductApiError(400, 'INVALID_REQUEST', 'Search contains unsupported characters.')
      }
      query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%,sku.ilike.%${search}%`)
    }
    const { data, count, error } = await query
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range((page - 1) * pageSize, page * pageSize - 1)
    if (error) throw databaseError(error)
    const total = count ?? 0
    return { items: (data ?? []).map(toProductDto), page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
  }

  async get(id) {
    const { data, error } = await this.requireClient().from('products').select('*').eq('id', id).maybeSingle()
    if (error) throw databaseError(error)
    if (!data) throw notFound()
    return toProductDto(data)
  }

  async create(input, actor) {
    const client = this.requireClient()
    const columns = toProductColumns(input)
    await this.assignCategory(columns, input.categoryId)
    if (input.stockQuantity !== undefined) columns.stock_status = stockStatus(input.stockQuantity)
    if (input.status === 'Published') columns.published_at = new Date().toISOString()
    const { data, error } = await client.from('products').insert(columns).select('*').single()
    if (error) throw databaseError(error)
    await this.audit('product.create', data.id, actor)
    return toProductDto(data)
  }

  async update(id, input, actor) {
    const client = this.requireClient()
    const existing = await this.get(id)
    const columns = toProductColumns(input)
    if (Object.hasOwn(input, 'categoryId')) {
      await this.assignCategory(columns, input.categoryId, existing.categoryId)
    } else if (Object.hasOwn(input, 'isAttar')) {
      columns.is_attar = existing.category ? isAttarCategory(existing.category) : Boolean(input.isAttar)
    }
    if (input.stockQuantity !== undefined) columns.stock_status = stockStatus(input.stockQuantity)
    if (input.salePrice != null && input.salePrice !== 0 && input.salePrice >= (input.price ?? existing.price)) {
      throw new ProductApiError(400, 'INVALID_REQUEST', 'Sale price must be below price.')
    }
    if (input.price !== undefined && existing.salePrice != null && existing.salePrice !== 0 &&
      (input.salePrice === undefined ? existing.salePrice : input.salePrice) >= input.price) {
      throw new ProductApiError(400, 'INVALID_REQUEST', 'Sale price must be below price.')
    }
    if (input.status === 'Published') {
      columns.active = true
      if (!existing.publishedAt) columns.published_at = new Date().toISOString()
    } else if (input.status === 'Archived') {
      columns.active = false
    }
    const { data, error } = await client.from('products').update(columns).eq('id', id).select('*').maybeSingle()
    if (error) throw databaseError(error)
    if (!data) throw notFound()
    await this.audit(input.status === 'Archived' ? 'product.archive' : 'product.update', id, actor)
    return toProductDto(data)
  }

  async archive(id, actor) {
    const client = this.requireClient()
    await this.get(id)
    const { data, error } = await client.from('products')
      .update({ status: 'Archived', active: false }).eq('id', id).select('*').maybeSingle()
    if (error) throw databaseError(error)
    if (!data) throw notFound()
    await this.audit('product.archive', id, actor)
    return toProductDto(data)
  }

  async assignCategory(columns, categoryId, currentCategoryId = null) {
    if (categoryId == null) {
      columns.category_id = null
      columns.category_name = ''
      columns.is_attar = false
      return
    }
    const { data, error } = await this.requireClient().from('categories')
      .select('id,name,status,active').eq('id', categoryId).maybeSingle()
    if (error) throw databaseError(error)
    if (!data || (categoryId !== currentCategoryId && (!data.active || data.status !== 'Published'))) {
      throw new ProductApiError(400, 'INVALID_CATEGORY', 'Category does not exist or is unavailable.')
    }
    columns.category_id = data.id
    columns.category_name = data.name
    columns.is_attar = isAttarCategory(data.name)
  }

  async audit(action, id, actor) {
    try {
      const { error } = await this.requireClient().from('admin_audit_logs').insert({
        admin_id: actor.userId,
        action,
        resource: 'products',
        resource_id: id,
        permission_key: 'products.manage',
        request_id: actor.requestId,
        metadata: {},
      })
      if (error) throw error
    } catch {
      this.logger.warn?.({ event: 'product.audit_failed', action, resourceId: id, requestId: actor.requestId })
    }
  }
}

function notFound() {
  return new ProductApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found.')
}

function stockStatus(quantity) {
  return quantity === 0 ? 'Out of Stock' : quantity <= 5 ? 'Low Stock' : 'In Stock'
}

function databaseError(error) {
  if (error.code === '23505') return new ProductApiError(409, 'PRODUCT_CONFLICT', 'Product slug or SKU already exists.')
  if (error.code === '23503') return new ProductApiError(400, 'INVALID_CATEGORY', 'Category reference is invalid.')
  if (error.code === '23514' || error.code === '22P02') {
    return new ProductApiError(400, 'INVALID_REQUEST', 'Product data violates a database constraint.')
  }
  return new ProductApiError(500, 'PRODUCT_SERVICE_ERROR', 'The product request could not be completed.')
}

function isAttarCategory(name) {
  return /^\s*attars?\s*$/i.test(name ?? '')
}
