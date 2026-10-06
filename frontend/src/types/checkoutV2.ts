import type {CheckoutPaymentMethod,CanonicalOrderReceipt} from './index.ts'
// Contract types only. No purchasing UI, persistence or production submission path.
export type PurchaseLineV2 =
 | {kind:'normal_variant';variantId:string;quantity:number}
 | {kind:'fixed_tester_pack';packId:string;definitionRevision:string;quantity:number}
 | {kind:'configurable_tester_pack';packId:string;definitionRevision:string;quantity:number;selections:{variantId:string;quantityPerPack:number}[]}
export type LineIdentityV2 = ['normal_variant',string] | ['fixed_tester_pack',string,string]
 | ['configurable_tester_pack',string,string,[string,number][]]
export interface ComponentSnapshotV2 {
 id?:string;testerVariantId:string;testerProductId:string;testerName:string;sku:string;size:'5 ml';volumeMl:5
 quantityPerPack:number;totalPhysicalQuantity:number;referenceUnitPrice:number;position:number
}
export type QuotedLineV2 = PurchaseLineV2 & {
 identity:LineIdentityV2;identityHash:string;productId:string;name:string;sku:string;size:string
 definitionFingerprint?:string;unitPrice:number;lineTotal:number;position:number;components:ComponentSnapshotV2[]
}
export interface QuoteRequestV2 {
 contractVersion:2;lines:PurchaseLineV2[];shipping:{city:string;province:string};email:string;couponCode:string
}
export interface QuoteResponseV2 {
 contractVersion:2;quoteFingerprint:string;lines:QuotedLineV2[];subtotal:number;discount:number;shippingFee:number;total:number
 currency:'PKR';shippingMethodId:string;paymentMethods:CheckoutPaymentMethod[];orderingEnabled:false
}
export interface OrderRequestV2 {
 contractVersion:2;idempotencyKey:string;lines:PurchaseLineV2[];contact:{name:string;email:string;phone:string}
 shipping:{address:string;city:string;province:string;notes:string};paymentMethod:CheckoutPaymentMethod;couponCode:string;quoteFingerprint:string
}
export interface OrderReceiptV2 extends CanonicalOrderReceipt {
 contractVersion:2;snapshotVersion:2;requestFingerprint:string;quoteFingerprint:string
 lines:(QuotedLineV2 & {id:string;components:(ComponentSnapshotV2 & {id:string})[]})[]
}
