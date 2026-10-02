import { adminAuthClient } from './adminAuthClient';
import type { AdminOrderListResponse, AdminOrderDetail, AdminOrderAction, AdminOrderMutationResult } from '../types/adminOrders';
const base = '/v1/admin/orders';
export const adminOrdersApi = {
    list(filters: Record<string, string | number>) {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(filters))
            if (v !== '' && v !== 'All')
                q.set(k, String(v));
        return adminAuthClient.protectedRequest<AdminOrderListResponse>(`${base}?${q}`);
    },
    get(id: string) {
        return adminAuthClient.protectedRequest<AdminOrderDetail>(`${base}/${encodeURIComponent(id)}`);
    },
    mutate(id: string, action: AdminOrderAction, body: Record<string, string>) {
        return adminAuthClient.protectedRequest<AdminOrderMutationResult>(`${base}/${encodeURIComponent(id)}/${action === 'note' ? 'notes' : action}`, {
            method: ['cancel', 'note'].includes(action) ? 'POST' : 'PATCH', body: JSON.stringify(body)
        });
    },
};
