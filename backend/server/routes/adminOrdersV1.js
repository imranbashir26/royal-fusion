import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createAdminIdentity, createOriginGuard, requireAuthenticatedCsrf, sendCode } from '../middleware/authSecurity.js';
import { AUTH_ERROR_CODES } from '../auth/contracts.js';
import { orderIdSchema, listAdminOrdersSchema, adminOrderActions } from '../schemas/adminOrdersV1.js';
import { AdminOrderError, AdminOrdersV1Service } from '../services/adminOrdersV1Service.js';
export function createAdminOrdersV1Router(runtime, { client = runtime.repository.client, logger = console, writeLimit = 60 } = {}) {
    const router = Router(), service = new AdminOrdersV1Service(client, logger);
    router.use((_req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });
    router.use(createAdminIdentity(runtime));
    const permit = key => (req, res, next) => req.administrator.permissions.some(p => p === '*' || p === key) ? next() : sendCode(res, AUTH_ERROR_CODES.PERMISSION_DENIED, req.requestId);
    const limiter = limit => rateLimit({
        windowMs: 60000, limit, standardHeaders: true, legacyHeaders: false, handler: (req, res) => res.status(429).json({
            error: {
                code: 'ADMIN_ORDER_RATE_LIMITED', message: 'Please wait before trying again.', requestId: req.requestId
            }
        })
    });
    router.get('/', permit('orders.read'), limiter(120), route(async (req, res) => res.json({
        data: await service.list(parse(listAdminOrdersSchema, req.query), req.requestId), meta: {
            requestId: req.requestId
        }
    })));
    router.get('/:id', permit('orders.read'), limiter(120), route(async (req, res) => res.json({
        data: await service.detail(parse(orderIdSchema, req.params.id), req.administrator.permissions, req.requestId), meta: {
            requestId: req.requestId
        }
    })));
    for (const [path, action, method] of [['status', 'status', 'patch'], ['fulfillment', 'fulfillment', 'patch'], ['payment', 'payment', 'patch'], ['cancel', 'cancel', 'post'], ['notes', 'note', 'post']])
        router[method](`/:id/${path}`, permit(action === 'payment' ? 'payments.manage' : 'orders.manage'), limiter(writeLimit), createOriginGuard(runtime.config), requireAuthenticatedCsrf(runtime.config), route(async (req, res) => {
            const data = await service.mutate(parse(orderIdSchema, req.params.id), action, parse(adminOrderActions[action], req.body), {
                userId: req.administrator.userId, requestId: req.requestId
            });
            res.json({
                data, meta: {
                    requestId: req.requestId
                }
            });
        }));
    router.use((error, req, res, next) => {
        if (Object.values(AUTH_ERROR_CODES).includes(error.code))
            return next(error);
        const known = error instanceof AdminOrderError;
        logger.warn?.({
            event: 'admin_order.request_failed', requestId: req.requestId, operation: 'request', subsystem: 'admin_orders', category: known ? error.code : 'UNEXPECTED_FAILURE'
        });
        res.status(known ? error.status : 500).json({
            error: {
                code: known ? error.code : 'ADMIN_ORDER_FAILED', message: known ? error.message : 'The order request could not be completed.', requestId: req.requestId
            }
        });
    });
    return router;
}
function parse(schema, value) {
    const r = schema.safeParse(value);
    if (!r.success)
        throw new AdminOrderError('INVALID_ADMIN_ORDER_REQUEST', 400);
    return r.data;
}
const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
