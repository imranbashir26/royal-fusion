import { toCategoryColumns, toCategoryDto } from '../mappers/categoryAdminMapper.js'

export class CategoryApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export class CategoryAdminService {
  constructor(client, logger = console) {
    this.client = client
    this.logger = logger
  }

  requireClient() {
    if (!this.client) throw new CategoryApiError(503, 'CATEGORY_SERVICE_UNAVAILABLE', 'Category service is unavailable.')
    return this.client
  }

  async list({ search, status, active } = {}) {
    const client = this.requireClient()
    let query = client.from('categories').select('*', { count: 'exact' })
    if (status && status !== 'All') query = query.eq('status', status)
    if (active !== undefined && active !== 'all') {
      const activeBool = typeof active === 'boolean' ? active : active === 'true'
      query = query.eq('active', activeBool)
    }
    if (search) {
      if (!/^[\p{L}\p{N} _-]+$/u.test(search)) {
        throw new CategoryApiError(400, 'INVALID_REQUEST', 'Search contains unsupported characters.')
      }
      query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%`)
    }
    const { data, count, error } = await query
      .order('display_order', { ascending: true })
      .order('name', { ascending: true })
    if (error) throw databaseError(error)
    const items = (data ?? []).map(toCategoryDto)
    return { items, total: count ?? items.length }
  }

  async get(id) {
    const { data, error } = await this.requireClient().from('categories').select('*').eq('id', id).maybeSingle()
    if (error) throw databaseError(error)
    if (!data) throw notFound()
    return toCategoryDto(data)
  }

  async create(input, actor) {
    const client = this.requireClient()
    const columns = toCategoryColumns(input)
    const { data, error } = await client.from('categories').insert(columns).select('*').single()
    if (error) throw databaseError(error)
    await this.audit('category.create', data.id, actor)
    return toCategoryDto(data)
  }

  async update(id, input, actor) {
    const client = this.requireClient()
    const existing = await this.get(id)
    const columns = toCategoryColumns(input)
    if (input.status === 'Archived') {
      columns.active = false
    } else if (input.status === 'Published' && columns.active === undefined && !existing.active) {
      columns.active = true
    }
    const { data, error } = await client.from('categories').update(columns).eq('id', id).select('*').maybeSingle()
    if (error) throw databaseError(error)
    if (!data) throw notFound()

    if (input.name && input.name !== existing.name) {
      try {
        const isAttar = /^\s*attars?\s*$/i.test(input.name)
        await client.from('products').update({
          category_name: input.name,
          is_attar: isAttar,
        }).eq('category_id', id)
      } catch (err) {
        this.logger.warn?.({ event: 'category.sync_products_failed', categoryId: id, error: err })
      }
    }

    const action = input.status === 'Archived' ? 'category.archive' : 'category.update'
    await this.audit(action, id, actor)
    return toCategoryDto(data)
  }

  async archive(id, actor) {
    const client = this.requireClient()
    await this.get(id)
    const { data, error } = await client.from('categories')
      .update({ status: 'Archived', active: false }).eq('id', id).select('*').maybeSingle()
    if (error) throw databaseError(error)
    if (!data) throw notFound()
    await this.audit('category.archive', id, actor)
    return toCategoryDto(data)
  }

  async delete(id, actor) {
    const client = this.requireClient()
    await this.get(id)

    const { count, error: countErr } = await client
      .from('products')
      .select('id', { count: 'exact' })
      .eq('category_id', id)
    if (countErr) throw databaseError(countErr)

    if (count && count > 0) {
      const { data, error: updateErr } = await client
        .from('categories')
        .update({ status: 'Archived', active: false })
        .eq('id', id)
        .select('*')
        .maybeSingle()
      if (updateErr) throw databaseError(updateErr)
      await this.audit('category.archive', id, actor)
      return {
        id,
        archived: true,
        deleted: false,
        category: toCategoryDto(data),
        message: 'Category is referenced by existing products and has been archived instead of deleted.',
      }
    }

    const { error } = await client.from('categories').delete().eq('id', id)
    if (error) throw databaseError(error)
    await this.audit('category.delete', id, actor)
    return { id, archived: false, deleted: true }
  }

  async audit(action, id, actor) {
    try {
      const { error } = await this.requireClient().from('admin_audit_logs').insert({
        admin_id: actor.userId,
        action,
        resource: 'categories',
        resource_id: id,
        permission_key: 'categories.manage',
        request_id: actor.requestId,
        metadata: {},
      })
      if (error) throw error
    } catch {
      this.logger.warn?.({ event: 'category.audit_failed', action, resourceId: id, requestId: actor.requestId })
    }
  }
}

function notFound() {
  return new CategoryApiError(404, 'CATEGORY_NOT_FOUND', 'Category not found.')
}

function databaseError(error) {
  if (error.code === '23505') return new CategoryApiError(409, 'CATEGORY_CONFLICT', 'Category slug already exists.')
  if (error.code === '23503') return new CategoryApiError(400, 'INVALID_REFERENCE', 'Referenced entity does not exist.')
  if (error.code === '23514' || error.code === '22P02') {
    return new CategoryApiError(400, 'INVALID_REQUEST', 'Category data violates a database constraint.')
  }
  return new CategoryApiError(500, 'CATEGORY_SERVICE_ERROR', 'The category request could not be completed.')
}
