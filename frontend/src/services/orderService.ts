import { checkoutClient } from './checkoutClient.ts'

// Canonical ordering uses one versioned transport; JSON ordering is not used.
export const orderService = checkoutClient
