import assert from 'node:assert/strict'
import test from 'node:test'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import {renderToStaticMarkup} from 'react-dom/server'
import {createElement} from 'react'
import {createCheckoutClient,isQuote,isOrderReceipt} from '../src/services/checkoutClient.ts'
import {quoteAcceptanceKey} from '../src/services/checkoutConfirmation.ts'
const id='b35b3be7-a7dd-4c70-9c14-d1a9394d4711',token='70000000-0000-4000-8000-000000000001',fp='a'.repeat(64),couponId='90000000-0000-4000-8000-000000000001'
const quote=(kind='applied')=>{
 const applied=kind==='applied',none=kind==='not_requested',subtotal=applied?1000:900,discount=applied?200:0
 return {idempotencyKey:token,quoteFingerprint:fp,lines:[{variantId:id,quantity:1,unitPrice:subtotal,lineTotal:subtotal}],subtotal,discount,shippingFee:250,total:subtotal-discount+250,currency:'PKR',shippingMethodId:couponId,paymentMethods:['Cash on Delivery'],orderingEnabled:true,
  pricingOutcome:{policy:'GLOBAL_PERCENTAGE_V1',strategy:applied?'COUPON':'SALE',regularSubtotal:1000,saleSubtotal:900,couponDiscount:none?0:applied?200:kind==='sale_better'?50:100,couponSubtotal:none?null:applied?800:kind==='sale_better'?950:900,merchandiseTotal:subtotal-discount,requestedCouponCode:none?'':'ROYAL10',appliedCouponId:applied?couponId:null,appliedCouponCode:applied?'ROYAL10':null,couponOutcome:kind,acceptedQuoteFingerprint:fp}}
}
const receipt=q=>({id:couponId,idempotencyKey:token,orderNumber:'RF-20261016-1234ABCD',status:'Pending',paymentStatus:'Unpaid',paymentMethod:'Cash on Delivery',subtotal:q.subtotal,discount:q.discount,shippingFee:q.shippingFee,total:q.total,currency:'PKR',idempotent:false,lines:q.lines.map(l=>({...l,id:couponId})),pricingOutcome:{...q.pricingOutcome,acceptedQuoteFingerprint:q.contractVersion===2?q.quoteFingerprint:createHash('sha256').update('rf:v1:capability:008:'+q.quoteFingerprint).digest('hex')}})
for(const kind of ['applied','sale_better','tie','not_requested'])test('V1 '+kind+' quote and frozen receipt accept authoritative evidence',()=>{assert(isQuote(quote(kind)));assert(isOrderReceipt(receipt(quote(kind))))})
test('incorrect selected charges, outcome binding and monetary precision reject',()=>{
 for(const mutate of [q=>q.lines[0].unitPrice=1,q=>q.lines[0].quantity=2,q=>q.pricingOutcome.acceptedQuoteFingerprint='b'.repeat(64),q=>q.pricingOutcome.appliedCouponId=null,q=>q.pricingOutcome.merchandiseTotal=1,q=>q.lines[0].unitPrice=1000.001]){const q=quote();mutate(q);assert.equal(isQuote(q),false)}
})
test('historical receipt without comparison evidence or lines remains valid',()=>{const r=receipt(quote());delete r.pricingOutcome;delete r.lines;assert(isOrderReceipt(r))})
test('coupon changes invalidate acceptance even when amounts and credential match',()=>{const q=quote();assert.notEqual(quoteAcceptanceKey('coupon:A',q,'Cash on Delivery'),quoteAcceptanceKey('coupon:B',q,'Cash on Delivery'));assert.notEqual(quoteAcceptanceKey('coupon:A',q,'Cash on Delivery'),quoteAcceptanceKey('coupon:',q,'Cash on Delivery'))})
test('API client preserves returned charges and strips browser price/strategy authority',async()=>{
 const requests=[],q=quote(),r=receipt(q),client=createCheckoutClient(async(path,options)=>{if(path.endsWith('/session'))return new Response(JSON.stringify({data:{csrfToken:'fixture'}}));requests.push(JSON.parse(options.body));return new Response(JSON.stringify({data:path.endsWith('/quote')?q:r}))},'/fixture')
 const request={items:[{variantId:id,quantity:1,unitPrice:1}],shipping:{city:'Karachi',province:'Sindh',address:'Fixture address',notes:''},email:'fixture@example.invalid',couponCode:'ROYAL10'}
 assert.deepEqual(await client.quote(request),q)
 assert.notEqual(r.pricingOutcome.acceptedQuoteFingerprint,q.quoteFingerprint)
 assert.equal(q.pricingOutcome.acceptedQuoteFingerprint,q.quoteFingerprint)
 assert.deepEqual(await client.createOrder({...request,idempotencyKey:token,contact:{name:'Fixture',email:request.email,phone:'00000000000'},paymentMethod:'Cash on Delivery',quoteFingerprint:fp,total:1,strategy:'SALE'}),r)
 for(const row of requests){assert(!('total'in row));assert(!('strategy'in row));assert(!('unitPrice'in row.items[0]))}
})
test('raw capabilities, invalid verifiers and tampered receipts preserve unknown-outcome recovery',async()=>{
 const valid=receipt(quote()),evidence=value=>({...valid,pricingOutcome:{...valid.pricingOutcome,acceptedQuoteFingerprint:value}})
 for(const [name,r] of [
  ['raw capability',evidence(fp)],
  ['mismatched verifier',evidence('b'.repeat(64))],
  ['wrong-domain verifier',evidence(createHash('sha256').update(fp).digest('hex'))],
  ['malformed verifier',evidence('invalid')],
  ['missing verifier',evidence(undefined)],
  ['tampered charges',{...valid,total:1}],
  ['malformed receipt',null],
 ]){
 const client=createCheckoutClient(async path=>new Response(JSON.stringify({data:path.endsWith('/session')?{csrfToken:'fixture'}:r})),'/fixture')
 await assert.rejects(()=>client.createOrder({idempotencyKey:token,items:[{variantId:id,quantity:1}],contact:{name:'Fixture',email:'fixture@example.invalid',phone:'00000000000'},shipping:{address:'Fixture address',city:'Karachi',province:'Sindh',notes:''},paymentMethod:'Cash on Delivery',couponCode:'ROYAL10',quoteFingerprint:fp}),e=>e.code==='INVALID_RESPONSE'&&e.unknownOutcome===true,name)
 }
})
test('actual React components display authoritative V1/V2 charges and outcome explanations',async t=>{
 const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),envDir:false,server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true}});t.after(()=>server.close())
 const {CheckoutPricingDetails,SelectedCheckoutCharges}=await server.ssrLoadModule('/src/components/common/CheckoutPricingDetails.tsx')
 for(const [kind,message]of [['applied','Coupon applied to regular prices.'],['sale_better','Existing sale prices provide a lower merchandise total; coupon not used.'],['tie','Totals are equal; sale pricing retained and coupon not used.']]){
  const html=renderToStaticMarkup(createElement(CheckoutPricingDetails,{outcome:quote(kind).pricingOutcome}));assert(html.includes(message));assert(html.includes('Requested coupon:'));assert.equal(html.includes('Applied coupon:'),kind==='applied')
 }
 assert.equal(renderToStaticMarkup(createElement(CheckoutPricingDetails,{})),'')
 for(const name of ['Standard fragrance','Fixed tester pack','Configurable tester pack']){const html=renderToStaticMarkup(createElement(SelectedCheckoutCharges,{label:'Quoted charges',lines:[{name,quantity:3,unitPrice:1000.05,lineTotal:3000.15}]}));assert(html.includes(name));assert.match(html,/1,000.05/);assert.match(html,/3,000.15/)}
})


test('V2 frozen pack receipts retain their existing pack identity and component snapshot',()=>{
 const r=receipt({...quote(),contractVersion:2});r.contractVersion=2;r.snapshotVersion=2
 const l=r.lines[0];delete l.variantId;l.kind='fixed_tester_pack';l.packId=id;l.components=[{testerVariantId:id,totalPhysicalQuantity:2,referenceUnitPrice:500}]
 const frozen=structuredClone(r);assert(isOrderReceipt(r));assert.deepEqual(r,frozen)
 const invalid=structuredClone(r);invalid.lines[0].packId='not-a-uuid';assert.equal(isOrderReceipt(invalid),false)
})
