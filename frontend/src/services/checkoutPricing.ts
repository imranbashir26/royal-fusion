import type { CheckoutPricingOutcome } from '../types/index.ts'
import { isVariantId } from './productVariants.ts'

// Integrity validation only; SQL supplies every amount and the winning strategy.
export function moneyCents(value: unknown): bigint | null {
 if(typeof value!=='number'||!Number.isFinite(value))return null
 const match=/^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));if(!match)return null
 const n=BigInt(match[1])*100n+BigInt((match[2]??'').padEnd(2,'0'));return n<=999999999999n?n:null
}
function isDefinitionRevision(val: unknown): boolean {
 if(typeof val!=='string'||!/^[1-9][0-9]{0,18}$/.test(val))return false
 try{return BigInt(val)<=9223372036854775807n}catch{return false}
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
  if(!Number.isInteger(line.quantity)||line.quantity<=0||line.quantity>2147483647)return false
  if(receipt&&!isVariantId(line.id))return false
  const kind=line.kind
  let key=''
  if(kind==='fixed_tester_pack'){
   if(row.contractVersion!==2||!isVariantId(line.packId))return false
   if(!receipt&&!isDefinitionRevision(line.definitionRevision))return false
   if(receipt&&line.definitionRevision!==undefined&&!isDefinitionRevision(line.definitionRevision))return false
   if(line.variantId!==undefined&&(!receipt||line.variantId!==null))return false
   key=receipt?line.id:`fixed:${line.packId.toLowerCase()}:${line.definitionRevision}`
  }else if(kind==='configurable_tester_pack'){
   if(row.contractVersion!==2||!isVariantId(line.packId))return false
   if(!receipt&&!isDefinitionRevision(line.definitionRevision))return false
   if(receipt&&line.definitionRevision!==undefined&&!isDefinitionRevision(line.definitionRevision))return false
   if(line.variantId!==undefined&&(!receipt||line.variantId!==null))return false
   let selectionsKey: string | null = null
   if(Array.isArray(line.selections)&&line.selections.length>0&&line.selections.length<=100){
    const list: string[] = []
    for(const s of line.selections){
     if(!s||typeof s!=='object'||!isVariantId(s.variantId)||!Number.isInteger(s.quantityPerPack)||s.quantityPerPack<=0||s.quantityPerPack>2147483647)return false
     list.push(`${s.variantId.toLowerCase()}:${s.quantityPerPack}`)
    }
    selectionsKey=list.sort().join(',')
   }else if(Array.isArray(line.components)&&line.components.length>0&&line.components.length<=100){
    const list: string[] = []
    for(const c of line.components){
     if(!c||typeof c!=='object'||!isVariantId(c.testerVariantId)||!Number.isInteger(c.quantityPerPack)||c.quantityPerPack<=0||c.quantityPerPack>2147483647)return false
     list.push(`${c.testerVariantId.toLowerCase()}:${c.quantityPerPack}`)
    }
    selectionsKey=list.sort().join(',')
   }else if(Array.isArray(line.identity)&&Array.isArray(line.identity[3])&&line.identity[3].length>0){
    const list: string[] = []
    for(const item of line.identity[3]){
     if(!Array.isArray(item)||!isVariantId(item[0])||!Number.isInteger(item[1])||item[1]<=0||item[1]>2147483647)return false
     list.push(`${item[0].toLowerCase()}:${item[1]}`)
    }
    selectionsKey=list.sort().join(',')
   }
   if(!receipt&&selectionsKey===null)return false
   key=receipt?line.id:`configurable:${line.packId.toLowerCase()}:${line.definitionRevision}:${selectionsKey}`
  }else if(kind==='normal_variant'||(kind===undefined&&(row.contractVersion!==2||line.variantId!==undefined))){
   if(!isVariantId(line.variantId))return false
   key=receipt?line.id:`normal:${line.variantId.toLowerCase()}`
  }else return false
  if(seen.has(key))return false;seen.add(key)
  const unit=moneyCents(line.unitPrice),total=moneyCents(line.lineTotal);if(unit===null||unit<=0n||total===null||total!==unit*BigInt(line.quantity))return false;sum+=total
 }
 return sum===moneyCents(row.subtotal)
}
