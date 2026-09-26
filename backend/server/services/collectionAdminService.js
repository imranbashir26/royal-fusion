import { toCollectionColumns, toCollectionDto } from '../mappers/collectionAdminMapper.js'

export class CollectionApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export class CollectionAdminService {
  constructor(client, logger = console) {
    this.client = client
    this.logger = logger
  }

  requireClient() {
    if (!this.client) {
      throw new CollectionApiError(503, 'COLLECTION_SERVICE_UNAVAILABLE', 'Collection service is unavailable.')
    }
    return this.client
  }

  async list({ search, active, featured, status } = {}) {
    const client = this.requireClient()
    let query = client.from('collections').select('*', { count: 'exact' })

    if (status && status !== 'All') {
      if (status === 'Archived') query = query.eq('active', false)
      else if (status === 'Published') query = query.eq('active', true)
    } else if (active !== undefined && active !== 'all') {
      const activeBool = typeof active === 'boolean' ? active : active === 'true'
      query = query.eq('active', activeBool)
    }

    if (featured !== undefined && featured !== 'all') {
      const featBool = typeof featured === 'boolean' ? featured : featured === 'true'
      query = query.eq('featured', featBool)
    }

    if (search) {
      if (!/^[\p{L}\p{N} _-]+$/u.test(search)) {
        throw new CollectionApiError(400, 'INVALID_REQUEST', 'Search contains unsupported characters.')
      }
      query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%`)
    }

    const { data, count, error } = await query
      .order('display_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) throw databaseError(error)
    const items = (data ?? []).map(toCollectionDto)
    return { items, total: count ?? items.length }
  }

  async get(id) {
    const { data, error } = await this.requireClient()
      .from('collections')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error) throw databaseError(error)
    if (!data) throw notFound()
    return toCollectionDto(data)
  }

  async create(input, actor) {
    const client = this.requireClient()
    const columns = toCollectionColumns(input)
    const { data, error } = await client.from('collections').insert(columns).select('*').single()
    if (error) throw databaseError(error)
    await this.audit('collection.create', data.id, actor)
    return toCollectionDto(data)
  }

  async update(id, input, actor) {
    const client = this.requireClient()
    const existing = await this.get(id)
    const columns = toCollectionColumns(input)

    if (input.status === 'Archived') {
      columns.active = false
    } else if (input.status === 'Published' && columns.active === undefined && !existing.active) {
      columns.active = true
    }

    const { data, error } = await client
      .from('collections')
      .update(columns)
      .eq('id', id)
      .select('*')
      .maybeSingle()

    if (error) throw databaseError(error)
    if (!data) throw notFound()

    const action = columns.active === false ? 'collection.archive' : 'collection.update'
    await this.audit(action, id, actor)
    return toCollectionDto(data)
  }

  async archive(id, actor) {
    const client = this.requireClient()
    await this.get(id)
    const { data, error } = await client
      .from('collections')
      .update({ active: false })
      .eq('id', id)
      .select('*')
      .maybeSingle()

    if (error) throw databaseError(error)
    if (!data) throw notFound()
    await this.audit('collection.archive', id, actor)
    return toCollectionDto(data)
  }

  async delete(id, actor) {
    const client = this.requireClient()
    await this.get(id)

    // Check references in relational table product_collections
    const { count: pcCount, error: pcErr } = await client
      .from('product_collections')
      .select('product_id', { count: 'exact' })
      .eq('collection_id', id)
    if (pcErr) throw databaseError(pcErr)

    const isReferenced = pcCount && pcCount > 0

    if (isReferenced) {
      const { data, error: updateErr } = await client
        .from('collections')
        .update({ active: false })
        .eq('id', id)
        .select('*')
        .maybeSingle()
      if (updateErr) throw databaseError(updateErr)
      await this.audit('collection.archive', id, actor)
      return {
        id,
        archived: true,
        deleted: false,
        collection: toCollectionDto(data),
        message: 'Collection is referenced by existing products and has been archived instead of deleted.',
      }
    }

    const { error } = await client.from('collections').delete().eq('id', id)
    if (error) throw databaseError(error)
    await this.audit('collection.delete', id, actor)
    return { id, archived: false, deleted: true }
  }

  async getProducts(collectionId) {
    const client = this.requireClient()
    await this.get(collectionId)

    const { data, error } = await client
      .from('product_collections')
      .select(`
        collection_id,
        display_order,
        products (
          id,
          name,
          slug,
          price,
          main_image_url,
          active,
          status
        )
      `)
      .eq('collection_id', collectionId)
      .order('display_order', { ascending: true })

    if (error) throw databaseError(error)

    return (data ?? []).map((row) => ({
      collectionId: row.collection_id,
      displayOrder: row.display_order,
      product: row.products ? {
        id: row.products.id,
        name: row.products.name,
        slug: row.products.slug,
        price: row.products.price,
        mainImageUrl: row.products.main_image_url,
        active: row.products.active,
        status: row.products.status,
      } : null,
    }))
  }

  async assignProducts(collectionId, productIds, actor) {
    const client = this.requireClient()
    await this.get(collectionId)

    // Remove existing assignments
    const { error: delError } = await client
      .from('product_collections')
      .delete()
      .eq('collection_id', collectionId)
    if (delError) throw databaseError(delError)

    if (productIds.length > 0) {
      const rows = productIds.map((productId, index) => ({
        collection_id: collectionId,
        product_id: productId,
        display_order: index + 1,
      }))
      const { error: insError } = await client.from('product_collections').insert(rows)
      if (insError) throw databaseError(insError)
    }

    await this.audit('collection.assign_products', collectionId, actor, { count: productIds.length })
    return { success: true, count: productIds.length }
  }

  async audit(action, id, actor, metadata = {}) {
    try {
      const { error } = await this.requireClient().from('admin_audit_logs').insert({
        admin_id: actor.userId,
        action,
        resource: 'collections',
        resource_id: id,
        permission_key: 'collections.manage',
        request_id: actor.requestId,
        metadata,
      })
      if (error) throw error
    } catch {
      this.logger.warn?.({ event: 'collection.audit_failed', action, resourceId: id, requestId: actor.requestId })
    }
  }
}

function notFound() {
  return new CollectionApiError(404, 'COLLECTION_NOT_FOUND', 'Collection not found.')
}

function databaseError(error) {
  if (error.code === '23505') return new CollectionApiError(409, 'COLLECTION_CONFLICT', 'Collection slug already exists.')
  if (error.code === '23503') return new CollectionApiError(400, 'INVALID_REFERENCE', 'Referenced entity does not exist.')
  if (error.code === '23514' || error.code === '22P02') {
    return new CollectionApiError(400, 'INVALID_REQUEST', 'Collection data violates a database constraint.')
  }
  return new CollectionApiError(500, 'COLLECTION_SERVICE_ERROR', 'The collection request could not be completed.')
}
