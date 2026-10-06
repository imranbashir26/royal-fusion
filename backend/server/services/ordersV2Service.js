import {unavailable} from './checkoutQuoteService.js'
import {parseV2,orderV2Schema} from '../schemas/ordersV2.js'
// No production-facing service can invoke the owner-only order RPC before 014.
// Disposable SQL tests exercise the transactional function directly as its owner.
export class OrdersV2Service {
 async create(raw){parseV2(orderV2Schema,raw);throw unavailable()}
}
