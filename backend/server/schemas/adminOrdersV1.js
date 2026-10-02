import { z } from 'zod';
export const orderStatuses = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned', 'Refunded'];
const text = (max) => z.string().trim().max(max);
export const orderIdSchema = z.uuid().transform((v) => v.toLowerCase());
export const listAdminOrdersSchema = z.strictObject({
    page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), search: text(120).default(''), status: z.enum(orderStatuses).optional(), paymentStatus: z.enum(['Unpaid', 'Pending', 'Paid', 'Failed', 'Refunded']).optional(), paymentMethod: z.enum(['Cash on Delivery', 'Bank Transfer']).optional(), from: z.iso.datetime({
        offset: true
    }).optional(), to: z.iso.datetime({
        offset: true
    }).optional()
}).refine(v => !v.from || !v.to || Date.parse(v.from) <= Date.parse(v.to));
const command = {
    mutationId: orderIdSchema, expectedRevision: z.string().regex(/^(0|[1-9][0-9]{0,18})$/)
};
export const adminOrderActions = {
    status: z.strictObject({
        ...command, status: z.enum(['Confirmed', 'Processing', 'Shipped', 'Delivered']), courier: text(100).min(1).optional(), trackingNumber: text(120).min(1).optional(), reason: text(1000).default('')
    }),
    fulfillment: z.strictObject({
        ...command, courier: text(100).min(1), trackingNumber: text(120).min(1), reason: text(1000).default('')
    }),
    payment: z.strictObject({
        ...command, reference: text(120).default(''), reason: text(1000).min(1)
    }), cancel: z.strictObject({
        ...command, reason: text(1000).min(1)
    }), note: z.strictObject({
        ...command, text: text(2000).min(1)
    }),
};
