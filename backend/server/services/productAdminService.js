import { toProductColumns, toProductDto } from '../mappers/productAdminMapper.js'
import { toCatalogVariants } from '../schemas/catalogVariants.js'

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
    const { data: variants, error: variantError } = await this.requireClient().from('product_variants')
      .select('*').eq('product_id', id).order('display_order', { ascending: true }).order('id', { ascending: true })
    if (variantError) throw databaseError(variantError)
    return catalogDto({ product: data, variants: variants ?? [] })
  }

  async create(input, actor) {
    const client = this.requireClient()
    let operation = 'product.map'
    try {
      const columns = toProductColumns(input)
      operation = 'category.resolve'
      await this.assignCategory(columns, input.categoryId, null, actor)
      if (input.status === 'Published') columns.published_at = new Date().toISOString()
      operation = 'catalog.save'
      const { data, error } = await client.rpc('save_catalog_product', {
        p_product_id: null, p_patch: columns, p_variants: normalizedVariants(input),
      })
      if (error) {
        const mapped = databaseError(error)
        if (mapped.status >= 500) this.logCreateDatabaseFailure(operation, error, actor)
        throw mapped
      }
      operation = 'product.audit'
      await this.audit('product.create', data.product.id, actor)
      operation = 'product.response'
      return catalogDto(data)
    } catch (error) {
      if (!(error instanceof ProductApiError)) {
        this.logger.error?.({
          event: 'product.create.failed',
          operation,
          code: diagnosticCode(error?.code ?? error?.name),
          requestId: actor?.requestId,
        })
      }
      throw error
    }
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
    const { data, error } = await client.rpc('save_catalog_product', {
      p_product_id: id, p_patch: columns, p_variants: normalizedVariants(input),
      p_expected_revision: input.expectedRevision ?? null,
    })
    if (error) throw databaseError(error)
    if (!data) throw notFound()
    await this.audit(input.status === 'Archived' ? 'product.archive' : 'product.update', id, actor)
    return catalogDto(data)
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

  async assignCategory(columns, categoryId, currentCategoryId = null, createActor = null) {
    if (categoryId == null) {
      columns.category_id = null
      columns.category_name = ''
      columns.is_attar = false
      return
    }
    const { data, error } = await this.requireClient().from('categories')
      .select('id,name,status,active').eq('id', categoryId).maybeSingle()
    if (error) {
      const mapped = databaseError(error)
      if (createActor && mapped.status >= 500) this.logCreateDatabaseFailure('category.resolve', error, createActor)
      throw mapped
    }
    if (!data || (categoryId !== currentCategoryId && (!data.active || data.status !== 'Published'))) {
      throw new ProductApiError(400, 'INVALID_CATEGORY', 'Category does not exist or is unavailable.')
    }
    columns.category_id = data.id
    columns.category_name = data.name
    columns.is_attar = isAttarCategory(data.name)
  }

  logCreateDatabaseFailure(operation, error, actor) {
    this.logger.error?.({
      event: 'product.database.failed',
      operation,
      resource: operation === 'category.resolve' ? 'categories' : 'products',
      code: diagnosticCode(error?.code),
      ...(safeIdentifier(error?.constraint) ? { constraint: error.constraint } : {}),
      requestId: actor?.requestId,
    })
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

function normalizedVariants(input) {
  try { return toCatalogVariants(input) } catch {
    throw new ProductApiError(400, 'INVALID_REQUEST', 'Variant configuration is invalid.')
  }
}

function catalogDto(data) {
  return { ...toProductDto(data.product), variants: data.variants.map((row) => ({
    id: row.id, optionName: row.option_name, optionValue: row.option_value,
    sku: row.sku, regularPrice: Number(row.regular_price),
    salePrice: row.sale_price == null ? null : Number(row.sale_price),
    stockQuantity: row.stock_quantity, active: row.active, available: row.available,
    displayOrder: row.display_order,
  })) }
}

function databaseError(error) {
  if (error.message === 'CATALOG_STALE') return new ProductApiError(409, 'CATALOG_STALE', 'Catalog changed. Reload the product before saving stock.')
  if (error.code === 'P0002') return notFound()
  if (error.code === '22023') {
    const safeMessages = [
      'Published products require a size or explicit variants.',
      'Published products require an active variant.',
      'Stock requires a size or explicit variants.',
      'Multi-variant inventory requires explicit variants.',
    ]
    return new ProductApiError(400, 'INVALID_REQUEST', safeMessages.includes(error.message)
      ? error.message : 'Catalog variant configuration is invalid.')
  }
  if (error.code === '23505') return new ProductApiError(409, 'PRODUCT_CONFLICT', 'A product slug, SKU, or variant option already exists.')
  if (error.code === '23503') return new ProductApiError(400, 'INVALID_CATEGORY', 'Category reference is invalid.')
  if (error.code === '23514' || error.code === '22P02') {
    return new ProductApiError(400, 'INVALID_REQUEST', 'Product data violates a database constraint.')
  }
  return new ProductApiError(500, 'PRODUCT_SERVICE_ERROR', 'The product request could not be completed.')
}

function isAttarCategory(name) {
  return /^\s*attars?\s*$/i.test(name ?? '')
}

function diagnosticCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : 'unknown'
}

function safeIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)
}
