export class CustomerOrderError extends Error {
  constructor(code, status = 400, message) {
    super(message ?? (code === 'ORDER_NOT_FOUND' ? 'Order not found.' : 'Customer order service unavailable.'))
    this.name = 'CustomerOrderError'
    this.code = code
    this.status = status
  }
}

const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

export class CustomerOrdersService {
  constructor(client, { logger = console } = {}) {
    this.client = client
    this.logger = logger
  }

  requireClient() {
    if (!this.client) {
      throw new CustomerOrderError('CUSTOMER_ORDER_UNAVAILABLE', 503)
    }
    return this.client
  }

  async list(customerId, { page = 1, pageSize = 10 } = {}, requestId = '') {
    if (!isUuid(customerId)) {
      throw new CustomerOrderError('CUSTOMER_ORDER_UNAVAILABLE', 503)
    }

    const p = Math.max(1, Math.floor(page))
    const ps = Math.min(50, Math.max(1, Math.floor(pageSize)))
    const offset = (p - 1) * ps

    const client = this.requireClient()
    const { data: rows, count, error } = await client
      .from('orders')
      .select('id,order_number,status,payment_status,payment_method,total,currency,courier_name,tracking_number,created_at,checkout_version', { count: 'exact' })
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + ps - 1)

    if (error) {
      this.logger.warn?.({
        event: 'customer_orders.query_failed',
        operation: 'list',
        requestId,
        code: error.code ?? 'UNKNOWN'
      })
      throw new CustomerOrderError('CUSTOMER_ORDER_UNAVAILABLE', 503)
    }

    const orderRows = rows ?? []
    if (orderRows.length === 0) {
      return {
        items: [],
        page: p,
        pageSize: ps,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / ps)
      }
    }

    const orderIds = orderRows.map(r => r.id)
    const { data: items, error: itemsError } = await client
      .from('order_items')
      .select('order_id,quantity')
      .in('order_id', orderIds)

    if (itemsError) {
      this.logger.warn?.({
        event: 'customer_orders.query_failed',
        operation: 'list_items',
        requestId,
        code: itemsError.code ?? 'UNKNOWN'
      })
      throw new CustomerOrderError('CUSTOMER_ORDER_UNAVAILABLE', 503)
    }

    const itemsByOrder = new Map()
    for (const item of (items ?? [])) {
      itemsByOrder.set(item.order_id, (itemsByOrder.get(item.order_id) ?? 0) + (item.quantity ?? 0))
    }

    const mapped = orderRows.map(r => ({
      id: r.id,
      orderNumber: r.order_number,
      createdAt: r.created_at,
      status: r.status,
      paymentStatus: r.payment_status,
      paymentMethod: r.payment_method,
      total: Number(r.total),
      currency: r.currency || 'PKR',
      itemCount: itemsByOrder.get(r.id) ?? 0,
      courier: r.courier_name?.trim() ? r.courier_name.trim() : null,
      trackingNumber: r.tracking_number?.trim() ? r.tracking_number.trim() : null
    }))

    return {
      items: mapped,
      page: p,
      pageSize: ps,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / ps)
    }
  }

  async detail(orderId, customerId, requestId = '') {
    if (!isUuid(orderId) || !isUuid(customerId)) {
      throw new CustomerOrderError('ORDER_NOT_FOUND', 404, 'Order not found.')
    }

    const client = this.requireClient()
    const { data: o, error } = await client
      .from('orders')
      .select('id,order_number,customer_id,customer_name,shipping_address,shipping_city,shipping_province,order_notes,status,payment_method,payment_status,subtotal,discount,shipping_fee,total,currency,courier_name,tracking_number,checkout_version,snapshot_version,quote_snapshot,created_at')
      .eq('id', orderId)
      .eq('customer_id', customerId)
      .maybeSingle()

    if (error) {
      this.logger.warn?.({
        event: 'customer_orders.query_failed',
        operation: 'detail',
        requestId,
        code: error.code ?? 'UNKNOWN'
      })
      throw new CustomerOrderError('CUSTOMER_ORDER_UNAVAILABLE', 503)
    }

    if (!o || o.customer_id !== customerId) {
      throw new CustomerOrderError('ORDER_NOT_FOUND', 404, 'Order not found.')
    }

    const { data: items, error: itemsError } = await client
      .from('order_items')
      .select('id,order_id,product_id,variant_id,product_name,size,sku,quantity,unit_price,line_total,snapshot_version,line_kind,position,pack_id,pack_definition_revision')
      .eq('order_id', orderId)
      .order('position', { ascending: true })

    if (itemsError || !items) {
      this.logger.warn?.({
        event: 'customer_orders.query_failed',
        operation: 'detail_items',
        requestId,
        code: itemsError?.code ?? 'UNKNOWN'
      })
      throw new CustomerOrderError('CUSTOMER_ORDER_UNAVAILABLE', 503)
    }

    let mappedItems = []
    if (o.checkout_version === 2) {
      const { data: components, error: componentsError } = await client
        .from('order_item_components')
        .select('id,order_id,order_item_id,tester_variant_id,tester_product_id,tester_name,sku,size,volume_ml,quantity_per_pack,total_physical_quantity,reference_unit_price,position')
        .eq('order_id', orderId)
        .order('position', { ascending: true })

      if (componentsError || !components) {
        this.logger.warn?.({
          event: 'customer_orders.query_failed',
          operation: 'detail_components',
          requestId,
          code: componentsError?.code ?? 'UNKNOWN'
        })
        throw new CustomerOrderError('CUSTOMER_ORDER_UNAVAILABLE', 503)
      }

      mappedItems = items.map((item, index) => {
        const lineComponents = components
          .filter(c => c.order_item_id === item.id)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map(c => ({
            id: c.id,
            name: c.tester_name,
            sku: c.sku,
            size: c.size,
            volumeMl: Number(c.volume_ml),
            quantityPerPack: c.quantity_per_pack,
            totalPhysicalQuantity: c.total_physical_quantity,
            referenceUnitPrice: Number(c.reference_unit_price),
            position: c.position
          }))

        return {
          id: item.id,
          productId: item.product_id,
          variantId: item.variant_id ?? null,
          packId: item.pack_id ?? null,
          kind: item.line_kind || 'normal_variant',
          name: item.product_name,
          size: item.size,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: Number(item.unit_price),
          lineTotal: Number(item.line_total),
          position: item.position ?? index,
          components: lineComponents
        }
      })
    } else {
      mappedItems = items.map((item, index) => ({
        id: item.id,
        productId: item.product_id,
        variantId: item.variant_id ?? null,
        packId: null,
        kind: 'normal_variant',
        name: item.product_name,
        size: item.size,
        sku: item.sku,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
        lineTotal: Number(item.line_total),
        position: item.position ?? index,
        components: []
      }))
    }

    return {
      id: o.id,
      orderNumber: o.order_number,
      createdAt: o.created_at,
      status: o.status,
      paymentStatus: o.payment_status,
      paymentMethod: o.payment_method,
      subtotal: Number(o.subtotal),
      discount: Number(o.discount),
      shippingFee: Number(o.shipping_fee),
      total: Number(o.total),
      currency: o.currency || 'PKR',
      courier: o.courier_name?.trim() ? o.courier_name.trim() : null,
      trackingNumber: o.tracking_number?.trim() ? o.tracking_number.trim() : null,
      shipping: {
        name: o.customer_name,
        address: o.shipping_address,
        city: o.shipping_city,
        province: o.shipping_province,
        orderNotes: o.order_notes || ''
      },
      items: mappedItems
    }
  }
}
