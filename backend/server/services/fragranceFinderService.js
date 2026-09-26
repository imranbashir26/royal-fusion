export class FinderApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

const columns = 'id,key,label,descriptors,copy,icon_key,product_id,active,display_order,created_at,updated_at'
const publicColumns = 'key,label,descriptors,copy,icon_key,product_id,display_order'

export class FragranceFinderService {
  constructor(client, logger = console) {
    this.client = client
    this.logger = logger
  }

  requireClient() {
    if (!this.client) throw new FinderApiError(503, 'FINDER_SERVICE_UNAVAILABLE', 'Finder service is unavailable.')
    return this.client
  }

  async listAdmin() {
    const { data, error } = await this.requireClient().from('fragrance_finder_preferences')
      .select(columns).order('display_order', { ascending: true })
    if (error) throw databaseError()
    return (data ?? []).map(adminDto)
  }

  async eligibleProducts() {
    const { data, error } = await this.requireClient().from('products')
      .select('id,name').eq('status', 'Published').eq('active', true).order('name', { ascending: true })
    if (error) throw databaseError()
    return (data ?? []).map((product) => ({ id: product.id, name: product.name }))
  }

  async update(key, input, actor) {
    const client = this.requireClient()
    const { data: existing, error: readError } = await client.from('fragrance_finder_preferences')
      .select(columns).eq('key', key).maybeSingle()
    if (readError) throw databaseError()
    if (!existing) throw new FinderApiError(404, 'FINDER_PREFERENCE_NOT_FOUND', 'Finder preference does not exist.')

    if (input.productId) {
      const { data: product, error: productError } = await client.from('products')
        .select('id,status,active').eq('id', input.productId).maybeSingle()
      if (productError) throw databaseError()
      if (!product || product.status !== 'Published' || product.active !== true) {
        throw new FinderApiError(400, 'INVALID_FINDER_PRODUCT', 'Choose a published, active product.')
      }
    }

    const { data, error } = await client.from('fragrance_finder_preferences')
      .update({ product_id: input.productId, active: input.active })
      .eq('key', key).select(columns).maybeSingle()
    if (error) throw databaseError()
    if (!data) throw new FinderApiError(404, 'FINDER_PREFERENCE_NOT_FOUND', 'Finder preference does not exist.')
    await this.audit(data.id, key, input.productId, actor)
    return adminDto(data)
  }

  async listPublic() {
    const client = this.requireClient()
    const { data, error } = await client.from('fragrance_finder_preferences')
      .select(publicColumns).eq('active', true).order('display_order', { ascending: true })
    if (error) throw databaseError()
    const rows = data ?? []
    const ids = [...new Set(rows.map((row) => row.product_id).filter(Boolean))]
    let validIds = new Set()
    if (ids.length > 0) {
      const { data: products, error: productsError } = await client.from('products')
        .select('id').in('id', ids).eq('status', 'Published').eq('active', true)
      if (productsError) throw databaseError()
      validIds = new Set((products ?? []).map((product) => product.id))
    }
    return rows.map((row) => ({
      key: row.key,
      label: row.label,
      descriptors: row.descriptors,
      copy: row.copy,
      iconKey: row.icon_key,
      productId: validIds.has(row.product_id) ? row.product_id : null,
      displayOrder: row.display_order,
    }))
  }

  async audit(id, key, productId, actor) {
    try {
      const { error } = await this.requireClient().from('admin_audit_logs').insert({
        admin_id: actor.userId,
        action: 'fragrance_finder.update',
        resource: 'fragrance_finder_preferences',
        resource_id: id,
        permission_key: 'homepage.manage',
        request_id: actor.requestId,
        metadata: { key, productId },
      })
      if (error) throw error
    } catch {
      this.logger.warn?.({ event: 'finder.audit_failed', key, requestId: actor.requestId })
    }
  }
}

function adminDto(row) {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    descriptors: row.descriptors,
    copy: row.copy,
    iconKey: row.icon_key,
    productId: row.product_id,
    active: row.active,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function databaseError() {
  return new FinderApiError(500, 'FINDER_SERVICE_ERROR', 'Finder request could not be completed.')
}
