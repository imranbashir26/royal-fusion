import {z} from 'zod'
import {paymentMethods,parseCheckout} from './ordersV1.js'
const text=(min,max)=>z.string().trim().min(min).max(max).refine(s=>!/[<>\u0000]/.test(s))
const uuid=z.uuid().transform(s=>s.toLowerCase())
const positive=z.number().int().min(1).max(2147483647)
const revision=z.string().regex(/^[1-9][0-9]{0,18}$/).refine(s=>BigInt(s)<=9223372036854775807n)
const selection=z.strictObject({variantId:uuid,quantityPerPack:positive})
export const purchaseLineV2Schema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('normal_variant'),variantId:uuid,quantity:positive.max(99)}),
 z.strictObject({kind:z.literal('fixed_tester_pack'),packId:uuid,definitionRevision:revision,quantity:positive}),
 z.strictObject({kind:z.literal('configurable_tester_pack'),packId:uuid,definitionRevision:revision,quantity:positive,selections:z.array(selection).min(1).max(100)}),
])
const lines=z.array(purchaseLineV2Schema).min(1).max(100).superRefine((ls,ctx)=>{
 for(const l of ls) if(l.kind==='configurable_tester_pack') {
  const quantities=new Map()
  for(const s of l.selections) quantities.set(s.variantId,(quantities.get(s.variantId)??0n)+BigInt(s.quantityPerPack))
  if([...quantities.values()].some(q=>q>2147483647n||q*BigInt(l.quantity)>2147483647n))ctx.addIssue({code:'custom',message:'Quantity overflow.'})
 }
 // Fixed expansion is unknown here. SQL checks its snapshot count authoritatively.
 if(ls.reduce((n,l)=>n+(l.kind==='configurable_tester_pack'?new Set(l.selections.map(s=>s.variantId)).size:0),0)>2000)
  ctx.addIssue({code:'custom',message:'Component limit exceeded.'})
})
const email=z.string().trim().toLowerCase().max(254).pipe(z.email())
const couponCode=text(0,40).regex(/^[A-Za-z0-9_-]*$/).transform(s=>s.toUpperCase()).default('')
export const quoteV2Schema=z.strictObject({contractVersion:z.literal(2),lines,shipping:z.strictObject({city:text(2,100),province:text(2,100)}),email:z.union([email,z.literal('')]).default(''),couponCode})
export const orderV2Schema=z.strictObject({contractVersion:z.literal(2),idempotencyKey:uuid,lines,
 contact:z.strictObject({name:text(2,120),email,phone:text(7,40)}),
 shipping:z.strictObject({address:text(4,500),city:text(2,100),province:text(2,100),notes:text(0,1000).default('')}),
 paymentMethod:z.enum(paymentMethods),couponCode,quoteFingerprint:z.string().regex(/^[0-9a-f]{64}$/)})
export function parseV2(schema,body) {
 if(Buffer.byteLength(JSON.stringify(body??{}),'utf8')>32768)throw Object.assign(new Error('Please check your checkout information.'),{status:400,code:'INVALID_CHECKOUT_REQUEST'})
 return parseCheckout(schema,body)
}
