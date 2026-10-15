import assert from 'node:assert/strict'
import test from 'node:test'
import {createCheckoutClient,CheckoutClientError,isCheckedQuote} from '../src/services/checkoutClient.ts'
import {quoteAcceptanceKey,isDefinitiveQuoteRejection} from '../src/services/checkoutConfirmation.ts'
import {createCheckoutIntentStore} from '../src/store/checkoutIntentStore.ts'
import {validIntent} from '../src/store/checkoutAttempt.ts'
const variant='b35b3be7-a7dd-4c70-9c14-d1a9394d4711',product='45852db8-8b83-425e-8d1f-4112958ed505',token='70000000-0000-4000-8000-000000000001'
const body=()=>({items:[{variantId:variant,quantity:1}],contact:{name:'Fixture',email:'fixture@example.invalid',phone:'00000000000'},shipping:{address:'Fixture address',city:'Karachi',province:'Sindh',notes:''},paymentMethod:'Cash on Delivery',couponCode:'',quoteFingerprint:'1'.repeat(64)})
const lines=[{lineId:JSON.stringify([product,variant]),entryId:'71000000-0000-4000-8000-000000000001',variantId:variant,quantity:1}]
const quoted=()=>({idempotencyKey:token,subtotal:2900,discount:0,shippingFee:250,total:3150,currency:'PKR',shippingMethodId:'60000000-0000-4000-8000-000000000001',paymentMethods:['Cash on Delivery','Bank Transfer'],orderingEnabled:true,quoteFingerprint:'1'.repeat(64)})
const disk=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}}
test('acceptance binds quoted inputs, selected payment and authoritative amounts',()=>{
 const q=quoted(),key=quoteAcceptanceKey('request',q,'Cash on Delivery');assert.ok(key)
 for(const [signature,quote,payment] of [['changed request',q,'Cash on Delivery'],['request',q,'Bank Transfer'],['request',{...q,quoteFingerprint:'2'.repeat(64)},'Cash on Delivery'],['request',{...q,shippingFee:300,total:3200},'Cash on Delivery']])assert.notEqual(quoteAcceptanceKey(signature,quote,payment),key)
 assert.equal(isCheckedQuote({...q,quoteFingerprint:undefined}),false);assert.equal(quoteAcceptanceKey('request',{...q,quoteFingerprint:undefined},'Cash on Delivery'),null)
 for(const idempotencyKey of [undefined,'bad'])assert.equal(isCheckedQuote({...q,idempotencyKey}),false)
})
test('only known HTTP 409 no-effect quotation rejection permits reconfirmation',()=>{
 for(const code of ['QUOTE_CHANGED','QUOTE_REQUIRED'])assert.equal(isDefinitiveQuoteRejection(new CheckoutClientError(code,'Changed',409,false)),true)
 for(const error of [new CheckoutClientError('NETWORK_ERROR','Unknown',0,true),new CheckoutClientError('QUOTE_CHANGED','Unknown',500,true),new CheckoutClientError('CHECKOUT_FAILED','Unknown',503,true),new Error('QUOTE_CHANGED')])assert.equal(isDefinitiveQuoteRejection(error),false)
})
test('fingerprint is frozen, persisted and restored with the exact token',()=>{
 const storage=disk(),store=createCheckoutIntentStore(storage,()=>assert.fail('New checked attempts use the issued token')),frozen=store.getState().freeze(body(),lines,quoted().idempotencyKey)
 assert.equal(validIntent(frozen),true);assert.equal(frozen.request.quoteFingerprint,'1'.repeat(64));assert.ok(Object.isFrozen(frozen.request))
 assert.equal(store.getState().freeze({...body(),quoteFingerprint:'2'.repeat(64)},lines,'70000000-0000-4000-8000-000000000002'),frozen)
 assert.deepEqual(createCheckoutIntentStore(storage).getState().intent,frozen)
 const legacy=structuredClone(frozen);delete legacy.request.quoteFingerprint;assert.equal(validIntent(legacy),true)
 assert.equal(validIntent({...frozen,request:{...frozen.request,quoteFingerprint:'invalid'}}),false)
})
test('definitive rejection clears only the matching attempt and creates no automatic replacement',()=>{
 let generated=0;const store=createCheckoutIntentStore(disk(),()=>{generated++;return token});store.getState().freeze(body(),lines)
 assert.throws(()=>store.getState().rejectQuote('70000000-0000-4000-8000-000000000002'))
 store.getState().rejectQuote(token);assert.equal(store.getState().intent,null);assert.equal(generated,1)
})
test('unknown network outcome retains byte-equivalent fingerprint and token on retry',async()=>{
 const requests=[],client=createCheckoutClient(async(url,options)=>{
  if(String(url).endsWith('/auth/session'))return {ok:true,json:async()=>({data:{csrfToken:'fixture'}})}
  requests.push(JSON.parse(options.body));throw Error('Lost response')
 }),store=createCheckoutIntentStore(disk(),()=>token),frozen=store.getState().freeze(body(),lines)
 for(let i=0;i<2;i++)await assert.rejects(()=>client.createOrder(frozen.request),e=>e.unknownOutcome===true)
 assert.deepEqual(requests[0],requests[1]);assert.equal(requests[0].quoteFingerprint,'1'.repeat(64));assert.equal(requests[0].idempotencyKey,token);assert.equal(store.getState().intent,frozen)
})
test('definitive transport rejection remains distinguishable and client totals are stripped',async()=>{
 let sent;const client=createCheckoutClient(async(url,options)=>String(url).endsWith('/auth/session')?{ok:true,json:async()=>({data:{csrfToken:'fixture'}})}:{ok:false,status:409,json:async()=>{sent=JSON.parse(options.body);return {error:{code:'QUOTE_CHANGED',message:'Changed'}}}})
 await assert.rejects(()=>client.createOrder({...body(),idempotencyKey:token,total:1,discount:999}),isDefinitiveQuoteRejection)
 assert.equal(sent.total,undefined);assert.equal(sent.discount,undefined);assert.equal(sent.quoteFingerprint,'1'.repeat(64))
})

test('issued tokens never fall back to local generation and invalid issuance leaves no attempt',()=>{
 const storage=disk(),store=createCheckoutIntentStore(storage,()=>assert.fail('Issued-token fallback is forbidden'))
 assert.throws(()=>store.getState().freeze(body(),lines,'bad'));assert.equal(store.getState().intent,null)
 const frozen=store.getState().freeze(body(),lines,quoted().idempotencyKey)
 assert.equal(frozen.request.idempotencyKey,quoted().idempotencyKey)
 assert.deepEqual(createCheckoutIntentStore(storage).getState().intent,frozen)
})

test('legacy uncommitted recovery failures retain the original saved token without reconfirmation',async()=>{
 const request=body();delete request.quoteFingerprint
 const storage=disk(),store=createCheckoutIntentStore(storage,()=>token),frozen=store.getState().freeze(request,lines)
 const sent=[],client=createCheckoutClient(async(url,options)=>String(url).endsWith('/auth/session')?{ok:true,json:async()=>({data:{csrfToken:'fixture'}})}:{ok:false,status:400,json:async()=>{sent.push(JSON.parse(options.body));return {error:{code:'INVALID_CHECKOUT_REQUEST',message:'Saved attempt requires recovery.'}}}})
 await assert.rejects(()=>client.createOrder(frozen.request),error=>!isDefinitiveQuoteRejection(error))
 assert.equal(store.getState().intent,frozen);assert.equal(sent[0].idempotencyKey,token);assert.equal('quoteFingerprint' in sent[0],false)
 assert.deepEqual(createCheckoutIntentStore(storage).getState().intent,frozen)
})
