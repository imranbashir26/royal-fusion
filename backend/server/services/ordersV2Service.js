import {createHash} from 'node:crypto'
import {cents,unavailable} from './checkoutQuoteService.js'
import {CheckoutQuoteV2Service} from './checkoutQuoteV2Service.js'
import {checkoutExecutionPolicy} from './checkoutExecutionPolicy.js'
import {parseV2,orderV2Schema} from '../schemas/ordersV2.js'
export class OrdersV2Service {
 constructor(client,{environment='production',allowNonProductionOrders=false,logger=console}={}){
  this.client=client;this.policy=checkoutExecutionPolicy({environment,allowNonProductionOrders});this.logger=logger
 }
 async create(raw,customerId=null,requestId=''){
  const input=parseV2(orderV2Schema,raw)
  if(!this.policy.orderingEnabled)throw unavailable()
  const diagnostics=new CheckoutQuoteV2Service(this.client,{logger:this.logger,requestId})
  let result
  try{result=await this.client?.rpc('create_order_transaction_v2',{p_request:input,p_customer_id:customerId})}
  catch{throw diagnostics.failure(null,'create_order_transaction_v2')}
  if(!result||result.error)throw diagnostics.failure(result?.error,'create_order_transaction_v2')
  try{return receipt(result.data,input)}catch{throw diagnostics.failure({code:'INVALID_RECEIPT'},'create_order_transaction_v2')}
 }
}
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v)
const integer=v=>Number.isInteger(v)&&v>0&&v<=2147483647
const must=v=>{if(!v)throw unavailable()}
const amount=(v,positive=false)=>{const n=cents(v);must(n<=999999999999n&&(!positive||n>0n));return Number(n)/100}
function requestedLines(input){
 const grouped=new Map()
 for(const l of input.lines){
  const selections=new Map()
  for(const s of l.selections??[])selections.set(s.variantId,(selections.get(s.variantId)??0)+s.quantityPerPack)
  const selected=[...selections].sort(([a],[b])=>a<b?-1:a>b?1:0)
  const identity=l.kind==='normal_variant'?[l.kind,l.variantId]:l.kind==='fixed_tester_pack'?[l.kind,l.packId,l.definitionRevision]:[l.kind,l.packId,l.definitionRevision,selected]
  const key=JSON.stringify(identity),old=grouped.get(key)
  grouped.set(key,{identity,quantity:(old?.quantity??0)+l.quantity})
 }
 return [...grouped].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,v])=>v)
}
function receipt(r,input){
 must(r&&typeof r==='object'&&!Array.isArray(r)&&r.contractVersion===2&&r.snapshotVersion===2&&uuid(r.id)
  &&r.idempotencyKey===input.idempotencyKey&&typeof r.idempotent==='boolean'&&r.paymentMethod===input.paymentMethod&&r.currency==='PKR'
  &&['Pending','Confirmed','Processing','Shipped','Delivered','Cancelled','Returned','Refunded'].includes(r.status)
  &&['Unpaid','Pending','Paid','Failed','Refunded'].includes(r.paymentStatus)&&typeof r.orderNumber==='string'&&r.orderNumber.length>0
  &&hash(r.requestFingerprint)&&r.quoteFingerprint===input.quoteFingerprint&&Array.isArray(r.lines))
 const expected=requestedLines(input);must(r.lines.length===expected.length&&r.lines.length<=100)
 let componentCount=0
 const ids=new Set(),lines=r.lines.map((l,position)=>{
  const e=expected[position]
  must(uuid(l.id)&&!ids.has(l.id)&&uuid(l.productId)&&l.position===position&&integer(l.quantity)&&l.quantity===e.quantity
   &&JSON.stringify(l.identity)===JSON.stringify(e.identity)&&l.identityHash===createHash('sha256').update(JSON.stringify(e.identity)).digest('hex')
   &&l.kind===e.identity[0]&&typeof l.name==='string'&&l.name.length>0&&typeof l.sku==='string'&&typeof l.size==='string'&&Array.isArray(l.components))
  ids.add(l.id)
  const unitPrice=amount(l.unitPrice,true),lineTotal=amount(l.lineTotal,true);must(cents(lineTotal)===cents(unitPrice)*BigInt(l.quantity))
  const seen=new Set(),components=l.components.map((c,index)=>{
   must(uuid(c.id)&&!ids.has(c.id)&&uuid(c.testerVariantId)&&uuid(c.testerProductId)&&!seen.has(c.testerVariantId)
    &&c.position===index&&c.size==='5 ml'&&c.volumeMl===5&&integer(c.quantityPerPack)&&integer(c.totalPhysicalQuantity)
    &&BigInt(c.totalPhysicalQuantity)===BigInt(l.quantity)*BigInt(c.quantityPerPack)&&typeof c.testerName==='string'&&c.testerName.length>0&&typeof c.sku==='string')
   seen.add(c.testerVariantId);ids.add(c.id);componentCount++
   return {id:c.id,testerVariantId:c.testerVariantId,testerProductId:c.testerProductId,testerName:c.testerName,sku:c.sku,size:'5 ml',volumeMl:5,
    quantityPerPack:c.quantityPerPack,totalPhysicalQuantity:c.totalPhysicalQuantity,referenceUnitPrice:amount(c.referenceUnitPrice,true),position:index}
  })
  const line={id:l.id,kind:l.kind,productId:l.productId,name:l.name,sku:l.sku,size:l.size,quantity:l.quantity,unitPrice,lineTotal,
   position,identity:e.identity,identityHash:l.identityHash,components}
  if(l.kind==='normal_variant'){must(uuid(l.variantId)&&l.variantId===e.identity[1]&&l.components.length===0);return {...line,variantId:l.variantId}}
  must(l.packId===e.identity[1]&&l.productId===l.packId&&l.definitionRevision===e.identity[2]&&hash(l.definitionFingerprint)&&components.length>=1&&components.length<=100)
  if(l.kind==='configurable_tester_pack')must(JSON.stringify(components.map(c=>[c.testerVariantId,c.quantityPerPack]).sort(([a],[b])=>a<b?-1:a>b?1:0))===JSON.stringify(e.identity[3]))
  return {...line,packId:l.packId,definitionRevision:l.definitionRevision,definitionFingerprint:l.definitionFingerprint,
   ...(l.kind==='configurable_tester_pack'?{selections:e.identity[3].map(([variantId,quantityPerPack])=>({variantId,quantityPerPack}))}:{})}
 })
 must(componentCount<=2000)
 const subtotal=amount(r.subtotal,true),discount=amount(r.discount),shippingFee=amount(r.shippingFee),total=amount(r.total)
 must(cents(subtotal)===lines.reduce((n,l)=>n+cents(l.lineTotal),0n)&&cents(discount)<=cents(subtotal)&&cents(total)===cents(subtotal)-cents(discount)+cents(shippingFee))
 return {contractVersion:2,snapshotVersion:2,id:r.id,idempotencyKey:r.idempotencyKey,orderNumber:r.orderNumber,status:r.status,paymentStatus:r.paymentStatus,
  paymentMethod:r.paymentMethod,subtotal,discount,shippingFee,total,currency:'PKR',idempotent:r.idempotent,requestFingerprint:r.requestFingerprint,quoteFingerprint:r.quoteFingerprint,lines}
}
