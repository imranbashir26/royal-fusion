import type { CheckoutPricingOutcome } from '../types/index.ts'
import { isVariantId } from './productVariants.ts'

// Integrity validation only; SQL supplies every amount and the winning strategy.
export function moneyCents(value: unknown): bigint | null {
 if(typeof value!=='number'||!Number.isFinite(value))return null
 const match=/^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));if(!match)return null
 const n=BigInt(match[1])*100n+BigInt((match[2]??'').padEnd(2,'0'));return n<=999999999999n?n:null
}
export function validPricingEvidence(row: Record<string, unknown>, receipt=false): boolean {
 const outcome=row.pricingOutcome as CheckoutPricingOutcome|null|undefined
 if(outcome!=null){
  if(typeof outcome!=='object'||Array.isArray(outcome)||outcome.policy!=='GLOBAL_PERCENTAGE_V1'||!['SALE','COUPON'].includes(outcome.strategy)
   ||!['not_requested','applied','sale_better','tie'].includes(outcome.couponOutcome)||typeof outcome.requestedCouponCode!=='string'
   ||!/^[A-Z0-9_-]{0,40}$/.test(outcome.requestedCouponCode)||!/^[0-9a-f]{64}$/.test(outcome.acceptedQuoteFingerprint??'')
   ||(!receipt&&outcome.acceptedQuoteFingerprint!==row.quoteFingerprint))return false
  for(const key of ['regularSubtotal','saleSubtotal','couponDiscount','merchandiseTotal'] as const)if(moneyCents(outcome[key])===null)return false
  if(outcome.couponSubtotal!==null&&moneyCents(outcome.couponSubtotal)===null)return false
  const subtotal=moneyCents(row.subtotal),discount=moneyCents(row.discount);if(subtotal===null||discount===null||moneyCents(outcome.merchandiseTotal)!==subtotal-discount)return false
  if(outcome.strategy==='COUPON'){
   if(outcome.couponOutcome!=='applied'||!isVariantId(outcome.appliedCouponId)||typeof outcome.appliedCouponCode!=='string'||!outcome.appliedCouponCode
    ||moneyCents(outcome.regularSubtotal)!==subtotal||moneyCents(outcome.couponDiscount)!==discount)return false
  }else if(outcome.appliedCouponId!==null||outcome.appliedCouponCode!==null||outcome.couponOutcome==='applied'||discount!==0n||moneyCents(outcome.saleSubtotal)!==subtotal)return false
  if(!Array.isArray(row.lines))return false
 }
 if(row.lines===undefined)return true // Historical receipts/legacy quotation compatibility.
 if(!Array.isArray(row.lines)||!row.lines.length||row.lines.length>100)return false
 const seen=new Set<string>();let sum=0n
 for(const line of row.lines){
  if(!line||typeof line!=='object')return false
  const frozenPack=receipt&&row.contractVersion===2&&['fixed_tester_pack','configurable_tester_pack'].includes(line.kind)&&isVariantId(line.packId)
  if((!isVariantId(line.variantId)&&!(receipt&&line.variantId===null)&&!frozenPack)||!Number.isInteger(line.quantity)||line.quantity<=0||line.quantity>2147483647)return false
  if(receipt&&!isVariantId(line.id))return false
  const key=receipt?line.id:line.variantId.toLowerCase();if(seen.has(key))return false;seen.add(key)
  const unit=moneyCents(line.unitPrice),total=moneyCents(line.lineTotal);if(unit===null||unit<=0n||total===null||total!==unit*BigInt(line.quantity))return false;sum+=total
 }
 return sum===moneyCents(row.subtotal)
}
