export type OrderStatus = 'Pending' | 'Confirmed' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled' | 'Returned' | 'Refunded';
export type PaymentStatus = 'Unpaid' | 'Pending' | 'Paid' | 'Failed' | 'Refunded';
export interface AdminOrderListItem {
    id: string;
    orderNumber: string;
    customerName: string;
    email: string;
    phone: string;
    createdAt: string;
    total: number;
    currency: string;
    paymentMethod: string;
    paymentStatus: PaymentStatus;
    status: OrderStatus;
    city: string;
    province: string;
    courier: string;
    trackingNumber: string;
    purchasedQuantity: number;
    lineCount: number;
}
export interface AdminOrderListResponse {
    items: AdminOrderListItem[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
}
export interface AdminOrderItem {
    id: string;
    productId: string | null;
    variantId: string | null;
    name: string;
    size: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
}
export interface AdminOrderPayment {
    id: string;
    provider: string;
    reference: string;
    amount: number;
    currency: string;
    status: PaymentStatus;
    processedAt: string | null;
    createdAt: string;
}
export interface AdminOrderNote {
    id: string;
    text: string;
    actor: string | null;
    createdAt: string;
}
export interface AdminOrderHistoryEntry extends AdminOrderNote {
    from: OrderStatus | null;
    to: OrderStatus;
}
export interface AdminOrderInventoryMovement extends AdminOrderNote {
    variantId: string;
    quantityDelta: number;
    balanceAfter: number;
    reason: string;
}
export interface AdminOrderAudit {
    id: string;
    actor: string | null;
    action: string;
    permission: string;
    requestId: string;
    createdAt: string;
    trackingCorrection?: {
        kind: 'tracking_correction';
        reason: string;
        previous: { courier: string; trackingNumber: string };
        next: { courier: string; trackingNumber: string };
    } | null;
}
export interface AdminOrderDetail extends AdminOrderListItem {
    revision: string;
    updatedAt: string;
    subtotal: number;
    discount: number;
    shippingFee: number;
    customer: {
        name: string;
        email: string;
        phone: string;
        profileId: string | null;
        profileStatus: string | null;
    };
    shipping: {
        address: string;
        city: string;
        province: string;
        customerNotes: string;
    };
    items: AdminOrderItem[];
    paymentsVisible: boolean;
    canonicalPaymentId: string | null;
    payments: AdminOrderPayment[];
    notes: AdminOrderNote[];
    history: AdminOrderHistoryEntry[];
    inventory: AdminOrderInventoryMovement[];
    audit: AdminOrderAudit[];
}
export interface AdminOrderMutationResult {
    id: string;
    revision: string;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    changed: boolean;
    replayed: boolean;
    refundRequired: boolean;
}
export type AdminOrderAction = 'status' | 'fulfillment' | 'payment' | 'cancel' | 'note';
export interface AdminOrderError extends Error {
    code?: string;
    status?: number;
}
