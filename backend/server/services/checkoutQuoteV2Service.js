import {CheckoutApiError,normalizedCheckoutCategory,unavailable,publicPricingOutcome} from './checkoutQuoteService.js'
import {parseV2,quoteV2Schema} from '../schemas/ordersV2.js'
const errors={
 V2_INVALID_COUPON:[422,'INVALID_COUPON','This coupon cannot be applied to your order.'],
 V2_INVALID_REQUEST:[400,'INVALID_CHECKOUT_REQUEST','Please check your checkout information.'],
 V2_LIMIT_EXCEEDED:[400,'CHECKOUT_LIMIT_EXCEEDED','This checkout exceeds supported limits.'],
 V2_SELECTION_UNAVAILABLE:[409,'SELECTION_UNAVAILABLE','A selected item is unavailable.'],
 V2_INSUFFICIENT_STOCK:[409,'INSUFFICIENT_STOCK','The requested quantity is unavailable.'],
 V2_DEFINITION_STALE:[409,'DEFINITION_STALE','A pack definition changed. Refresh your selection.'],
 V2_RESOLUTION_CHANGED:[409,'CHECKOUT_CHANGED','Checkout changed. Please refresh.'],
 V2_PACK_UNITS_INVALID:[400,'INVALID_PACK_QUANTITY','Check the tester quantity in your pack.'],
 V2_QUOTE_CHANGED:[409,'QUOTE_CHANGED','Checkout changed. Please refresh your quote.'],
 V2_IDEMPOTENCY_CONFLICT:[409,'IDEMPOTENCY_CONFLICT','This checkout token belongs to another request.'],
 V2_IDEMPOTENCY_AMBIGUOUS:[409,'IDEMPOTENCY_AMBIGUOUS','This checkout cannot be matched safely. Contact support before starting another attempt.'],
 V2_CUSTOMER_UNAVAILABLE:[403,'CUSTOMER_UNAVAILABLE','Your customer account is unavailable.'],
}
export class CheckoutQuoteV2Service {
 constructor(client,{logger=console,requestId=''}={}){this.client=client;this.logger=logger;this.requestId=requestId}
 withRequestId(id){return new CheckoutQuoteV2Service(this.client,{logger:this.logger,requestId:id})}
 failure(error,operation){
  this.logger.warn?.({event:'checkout.internal_failure',requestId:this.requestId,operation,subsystem:'checkout_v2',category:errors[error?.message]?error.message:normalizedCheckoutCategory(error,'RELATIONAL_FAILURE')})
  const mapped=errors[error?.message];return mapped?new CheckoutApiError(...mapped):unavailable()
 }
 async invoke(name,input,customerId){
  if(!this.client)throw this.failure(null,name)
  let result
  try{result=await this.client.rpc(name,{p_request:input,p_customer_id:customerId})}catch{throw this.failure(null,name)}
  if(result.error)throw this.failure(result.error,name)
  if(!result.data)throw this.failure(null,name)
  return result.data
 }
 async quote(raw,customerId=null){
  const data=await this.invoke('quote_checkout_v2',parseV2(quoteV2Schema,raw),customerId)
  const {contractVersion,quoteFingerprint,lines,subtotal,discount,shippingFee,total,currency,shippingMethodId,paymentMethods,orderingEnabled}=data
  return {contractVersion,quoteFingerprint,lines:lines.map(publicLine),subtotal,discount,shippingFee,total,currency,shippingMethodId,paymentMethods,orderingEnabled,...publicPricingOutcome(data.pricingOutcome,data,quoteFingerprint)}
 }
}

function publicLine(line){
 const project=(row,keys)=>Object.fromEntries(keys.filter(key=>row[key]!==undefined).map(key=>[key,row[key]]))
 return {...project(line,['kind','variantId','packId','definitionRevision','selections','identity','identityHash','productId','name','sku','size','definitionFingerprint','quantity','unitPrice','lineTotal','position']),
  components:line.components.map(c=>project(c,['testerVariantId','testerProductId','testerName','sku','size','volumeMl','quantityPerPack','totalPhysicalQuantity','referenceUnitPrice','position']))}
}
