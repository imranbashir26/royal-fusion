// Trusted factory options only. No environment flag, request override or production enablement.
export function checkoutExecutionPolicy({environment='production',allowNonProductionOrders=false}={}) {
 return Object.freeze({orderingEnabled:['test','development'].includes(environment)&&allowNonProductionOrders===true})
}
