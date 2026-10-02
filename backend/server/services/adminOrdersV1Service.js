const messages = {
    ORDER_NOT_FOUND: 'Order not found.', ORDER_STALE: 'This order changed. Refresh before continuing.', INVALID_ADMIN_ORDER_REQUEST: 'Check the order request fields.', INVALID_ORDER_TRANSITION: 'This action is not available in the current state.', MUTATION_CONFLICT: 'This mutation belongs to a different request.', CANCELLATION_NOT_ALLOWED: 'Cancellation is only available before shipping.', PAID_CANCELLATION_BLOCKED: 'Paid cancellation requires a refund workflow.', ORDER_LEDGER_INCONSISTENT: 'The inventory ledger requires review.', PAYMENT_NOT_FOUND: 'The checkout payment is missing.', PAYMENT_INCONSISTENT: 'The checkout payment requires review.', PAYMENT_CONFIRMATION_CONFLICT: 'Payment confirmation conflicts with the recorded result.', FULFILLMENT_REQUIRED: 'Enter courier and tracking before shipping.', INVALID_TRACKING: 'Enter tracking information and a correction reason.', PERMISSION_DENIED: 'You do not have permission for this action.', ADMIN_ORDER_UNAVAILABLE: 'The order service is unavailable.'
};
export class AdminOrderError extends Error {
    constructor(code, status = 409) {
        super(messages[code] ?? 'The order service is unavailable.');
        this.code = code;
        this.status = status;
    }
}
const orderColumns = 'id,order_number,customer_id,customer_name,customer_email,customer_phone,shipping_address,shipping_city,shipping_province,order_notes,status,payment_method,payment_status,subtotal,discount,shipping_fee,total,currency,courier_name,tracking_number,created_at,updated_at,revision,idempotency_key';
export class AdminOrdersV1Service {
    constructor(client, logger = console) {
        this.client = client;
        this.logger = logger;
    }
    requireClient() {
        if (!this.client)
            throw new AdminOrderError('ADMIN_ORDER_UNAVAILABLE', 503);
        return this.client;
    }
    async run(query, requestId, operation) {
        try {
            const result = await query;
            if (result.error)
                throw result.error;
            return result;
        }
        catch (error) {
            this.logger.warn?.({
                event: 'admin_order.internal_failure', requestId, operation, subsystem: 'admin_orders', category: /^[0-9A-Z]{5}$|^PGRST\d{3}$/.test(error?.code ?? '') ? error.code : 'TRANSPORT_FAILURE'
            });
            if (error?.code === '23505')
                throw new AdminOrderError('PAYMENT_CONFIRMATION_CONFLICT', 409);
            if (Object.hasOwn(messages, error?.message))
                throw new AdminOrderError(error.message, error.message === 'PERMISSION_DENIED' ? 403 : error.message === 'ORDER_NOT_FOUND' ? 404 : 409);
            throw new AdminOrderError('ADMIN_ORDER_UNAVAILABLE', 503);
        }
    }
    async rows(table, columns, filters, requestId) {
        const rows = [];
        for (let offset = 0; offset < 10000; offset += 500) {
            let q = this.requireClient().from(table).select(columns);
            for (const [method, ...args] of filters)
                q = q[method](...args);
            const { data } = await this.run(q.order('id', {
                ascending: true
            }).range(offset, offset + 499), requestId, `read_${table}`);
            rows.push(...(data ?? []));
            if (!data || data.length < 500)
                return rows;
        }
        throw new AdminOrderError('ADMIN_ORDER_UNAVAILABLE', 503);
    }
    async list(f, requestId) {
        let q = this.requireClient().from('orders').select(orderColumns, {
            count: 'exact'
        });
        for (const [key, col] of [['status', 'status'], ['paymentStatus', 'payment_status'], ['paymentMethod', 'payment_method']])
            if (f[key])
                q = q.eq(col, f[key]);
        if (f.from)
            q = q.gte('created_at', f.from);
        if (f.to)
            q = q.lte('created_at', f.to);
        if (f.search) {
            const pattern = JSON.stringify(`%${f.search.replace(/[\\%_*]/g, '\\$&')}%`);
            q = q.or(['order_number', 'customer_name', 'customer_email', 'customer_phone'].map(col => `${col}.ilike.${pattern}`).join(','));
        }
        const { data, count } = await this.run(q.order('created_at', {
            ascending: false
        }).order('id', {
            ascending: false
        }).range((f.page - 1) * f.pageSize, f.page * f.pageSize - 1), requestId, 'list');
        const rows = data ?? [];
        const items = rows.length ? await this.rows('order_items', 'order_id,quantity', [['in', 'order_id', rows.map(o => o.id)]], requestId) : [];
        return {
            items: rows.map(o => ({
                ...summary(o), purchasedQuantity: items.filter(i => i.order_id === o.id).reduce((n, i) => n + i.quantity, 0), lineCount: items.filter(i => i.order_id === o.id).length
            })), page: f.page, pageSize: f.pageSize, total: count ?? 0, totalPages: Math.ceil((count ?? 0) / f.pageSize)
        };
    }
    async detail(id, permissions, requestId) {
        const { data: o } = await this.run(this.requireClient().from('orders').select(orderColumns).eq('id', id).maybeSingle(), requestId, 'detail');
        if (!o)
            throw new AdminOrderError('ORDER_NOT_FOUND', 404);
        const paymentRead = permissions.includes('*') || permissions.includes('payments.read');
        const [items, payments, notes, history, inventory, audit, profiles] = await Promise.all([
            this.rows('order_items', 'id,order_id,product_id,variant_id,product_name,size,sku,quantity,unit_price,line_total', [['eq', 'order_id', id]], requestId),
            paymentRead ? this.rows('payments', 'id,provider,provider_reference,amount,currency,status,processed_at,created_at,idempotency_key', [['eq', 'order_id', id]], requestId) : [],
            this.rows('order_notes', 'id,note,created_by,created_at', [['eq', 'order_id', id]], requestId),
            this.rows('order_status_history', 'id,from_status,to_status,note,changed_by,created_at', [['eq', 'order_id', id]], requestId),
            this.rows('inventory_movements', 'id,variant_id,quantity_delta,balance_after,reason,note,created_by,created_at', [['eq', 'reference_type', 'order'], ['eq', 'reference_id', id]], requestId),
            this.rows('admin_audit_logs', 'id,admin_id,action,permission_key,request_id,created_at,metadata', [['eq', 'resource', 'orders'], ['eq', 'resource_id', id]], requestId),
            o.customer_id && (permissions.includes('*') || permissions.includes('customers.read')) ? this.rows('profiles', 'id,status', [['eq', 'id', o.customer_id]], requestId) : [],
        ]);
        const canonical = payments.filter(p => p.idempotency_key === `${o.idempotency_key}:payment`);
        return {
            ...summary(o), purchasedQuantity: items.reduce((n, i) => n + i.quantity, 0), lineCount: items.length, revision: String(o.revision), updatedAt: o.updated_at, subtotal: Number(o.subtotal), discount: Number(o.discount), shippingFee: Number(o.shipping_fee),
            customer: {
                name: o.customer_name, email: o.customer_email ?? '', phone: o.customer_phone ?? '', profileId: o.customer_id, profileStatus: profiles[0]?.status ?? null
            }, shipping: {
                address: o.shipping_address, city: o.shipping_city, province: o.shipping_province, customerNotes: o.order_notes
            },
            items: items.map(i => ({
                id: i.id, productId: i.product_id, variantId: i.variant_id, name: i.product_name, size: i.size, sku: i.sku, quantity: i.quantity, unitPrice: Number(i.unit_price), lineTotal: Number(i.line_total)
            })), paymentsVisible: paymentRead, canonicalPaymentId: canonical.length === 1 ? canonical[0].id : null,
            payments: payments.map(p => ({
                id: p.id, provider: p.provider, reference: p.provider_reference, amount: Number(p.amount), currency: p.currency, status: p.status, processedAt: p.processed_at, createdAt: p.created_at
            })),
            notes: notes.map(n => ({
                id: n.id, text: n.note, actor: n.created_by, createdAt: n.created_at
            })), history: history.map(h => ({
                id: h.id, from: h.from_status, to: h.to_status, text: h.note, actor: h.changed_by, createdAt: h.created_at
            })),
            inventory: inventory.map(m => ({
                id: m.id, variantId: m.variant_id, quantityDelta: m.quantity_delta, balanceAfter: m.balance_after, reason: m.reason, text: m.note, actor: m.created_by, createdAt: m.created_at
            })),
            audit: audit.map(a => ({
                id: a.id, actor: a.admin_id, action: a.action, permission: a.permission_key, requestId: a.request_id, createdAt: a.created_at,
                trackingCorrection: trackingCorrection(a)
            })),
        };
    }
    async mutate(id, action, { mutationId, expectedRevision, ...payload }, actor) {
        const { data } = await this.run(this.requireClient().rpc('apply_admin_order_action', {
            p_order_id: id, p_actor_id: actor.userId, p_action: action, p_mutation_id: mutationId, p_expected_revision: expectedRevision, p_payload: payload, p_request_id: actor.requestId
        }), actor.requestId, action);
        if (!data || data.id !== id || typeof data.revision !== 'string')
            throw new AdminOrderError('ADMIN_ORDER_UNAVAILABLE', 503);
        return data;
    }
}
function trackingCorrection(audit) {
    const correction = audit.metadata?.trackingCorrection;
    if (audit.action !== 'order.fulfillment' || correction?.kind !== 'tracking_correction'
        || typeof correction.reason !== 'string' || !correction.reason.trim() || correction.reason.length > 1000)
        return null;
    const tracking = value => ({
        courier: typeof value?.courier === 'string' ? value.courier.slice(0, 100) : '',
        trackingNumber: typeof value?.trackingNumber === 'string' ? value.trackingNumber.slice(0, 120) : ''
    });
    return { kind: 'tracking_correction', reason: correction.reason, previous: tracking(correction.previous), next: tracking(correction.next) };
}
function summary(o) {
    return {
        id: o.id, orderNumber: o.order_number, customerName: o.customer_name, email: o.customer_email ?? '', phone: o.customer_phone ?? '', createdAt: o.created_at, total: Number(o.total), currency: o.currency, paymentMethod: o.payment_method, paymentStatus: o.payment_status, status: o.status, city: o.shipping_city, province: o.shipping_province, courier: o.courier_name, trackingNumber: o.tracking_number
    };
}
