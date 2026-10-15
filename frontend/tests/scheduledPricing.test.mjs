import assert from 'node:assert/strict'
import test from 'node:test'
import {randomUUID} from 'node:crypto'
import {createVariantPriceLoader,applyVariantPrices} from '../src/services/catalogPricing.ts'
import {productPricing,productDisplayPrice,resolveCartItem} from '../src/services/productVariants.ts'
import {mapProduct,mapProductVariant} from '../src/services/productionMappers.ts'
import {createCatalogRefreshController,bindPricingActivity,staleCatalog} from '../src/services/catalogRefresh.ts'
import {saleTimestampMicros,saleSchedulePatch,adminSaleState} from '../src/services/saleSchedule.ts'
import {toProductPayload,productErrorMessage} from '../src/services/adminProductContract.ts'
import {toPackPayload} from '../src/services/testerPackContract.ts'
import {formatCheckoutCurrency as formatCurrency} from '../src/utils/checkoutMoney.ts'
import {productRow,variantRow,productId,variantId,secondVariantId} from './variantFixtures.mjs'

const at='2030-01-01T00:00:00Z',end='2030-01-01T00:01:00Z'
const row=(changes={})=>({variantId,productId,regularPrice:2900,effectivePrice:2900,price:2900,salePrice:null,saleActive:false,pricingAt:at,validUntil:null,...changes})
const body=items=>({data:{currency:'PKR',items},meta:{requestId:'fixture'}})
const base=mapProductVariant(variantRow)
const product=variants=>({...mapProduct(productRow),oldPrice:9999,variants,variantIdentityScope:'public'})
const flush=()=>new Promise(resolve=>setImmediate(resolve))

for(const state of ['regular','active','future','expired'])test('Authoritative '+state+' customer price and selected variant comparison',async()=>{
 const active=state==='active',price=active?2450.25:2900
 const loader=createVariantPriceLoader(async()=>body([row({effectivePrice:price,price,salePrice:active?price:null,saleActive:active,validUntil:state==='future'?end:null})]),()=>100)
 const [v]=applyVariantPrices([base],await loader([variantId]))
 const p=product([v]),display=productPricing(p)
 assert.equal(display.price,price);assert.equal(display.discount,active);assert.equal(display.regular,2900)
 assert.equal(display.percent,active?16:0);assert.equal(v.id,variantId);assert.equal(v.productId,productId)
 assert.equal(v.stockQuantity,variantRow.stock_quantity)
 const selected={...v,id:secondVariantId,regularPrice:5000,effectivePrice:4000.75,salePrice:4000.75,saleActive:true,displayOrder:1}
 assert.equal(productPricing(product([v,selected]),selected).regular,5000)
 assert.equal(productPricing(product([v,selected]),selected).price,4000.75)
 assert.equal(productPricing(p).regular===p.oldPrice,false)
})

test('Effective catalog aliases support matching filtering and sorting with two-decimal PKR',()=>{
 const a=product([{...base,effectivePrice:2900,salePrice:null,saleActive:false}])
 const b={...a,id:productId+'b',price:9999,variants:[{...base,productId:productId+'b',regularPrice:5000,effectivePrice:1800.25,salePrice:1800.25,saleActive:true}]}
 assert.deepEqual([a,b].sort((a,b)=>productDisplayPrice(a)-productDisplayPrice(b)),[b,a])
 assert.deepEqual([a,b].filter(p=>productDisplayPrice(p)<=2000),[b])
 assert.match(formatCurrency(1800.25),/1,800\.25/);assert.match(formatCurrency(2900),/2,900\.00/)
})

test('Public omissions and missing canonical prices never invent a discount or a UUID',async()=>{
 const loader=createVariantPriceLoader(async()=>body([]),()=>0)
 assert.deepEqual(applyVariantPrices([base],await loader([variantId])),[])
 assert.equal(productPricing(product([])).price,null)
 assert.throws(()=>applyVariantPrices([base],new Map([[variantId,row({productId:randomUUID()})]])),/unavailable/)
})

test('Pricing requests deduplicate overlapping identical ID sets, batch at 100 and preserve per-response instants',async()=>{
 const ids=Array.from({length:205},()=>randomUUID()),calls=[]
 let release;const gate=new Promise(r=>release=r)
 const loader=createVariantPriceLoader(async batch=>{calls.push(batch);await gate;return body(batch.map(id=>row({variantId:id,pricingAt:`2030-01-01T00:00:0${calls.length}Z` })))},()=>0)
 const one=loader(ids),two=loader([...ids].reverse());assert.equal(one,two);release()
 const prices=await one
 assert.deepEqual(calls.map(v=>v.length),[100,100,5]);assert.equal(prices.size,205)
 assert.equal(new Set([...prices.values()].map(v=>v.pricingAt)).size,3)
 await loader([ids[0]]);assert.equal(calls.length,4,'No persistent price cache')
})

test('Monotonic DATABASE intervals account for latency without consulting the local wall clock',async()=>{
 let clock=100
 const loader=createVariantPriceLoader(async()=>{clock=250;return body([row({validUntil:end})])},()=>clock)
 const result=await loader([variantId]);assert.equal(result.get(variantId).pricingExpiresAt,60100)
 let delayed=0
 const expired=createVariantPriceLoader(async()=>{delayed=61000;return body([row({validUntil:end})])},()=>delayed)
 await assert.rejects(()=>expired([variantId]),/unavailable/)
})

test('Invalid prices, mismatched aliases, malformed schedules and forged IDs fail closed',async()=>{
 for(const change of [{effectivePrice:NaN},{effectivePrice:0},{regularPrice:1.001},{saleActive:true},{salePrice:2000},{price:1},{pricingAt:'bad'},{validUntil:undefined},{variantId:randomUUID()},{productId:'bad'}]){
  await assert.rejects(()=>createVariantPriceLoader(async()=>body([row(change)]),()=>0)([variantId]),/unavailable/)
 }
 await assert.rejects(()=>createVariantPriceLoader(async()=>({data:{currency:'USD',items:[]}}))([variantId]),/unavailable/)
})

function controllerFixture(load) {
 let clock=0,id=0;const timers=new Map(),accepted=[],events=[]
 const controller=createCatalogRefreshController({load,accept:v=>accepted.push(v),stale:()=>events.push('stale'),failed:()=>events.push('failed'),busy:()=>{},now:()=>clock,
  timer:(fn,ms)=>{timers.set(++id,{fn,at:clock+ms});return id},cancel:key=>timers.delete(key)})
 return {controller,timers,accepted,events,async advance(ms){clock+=ms;for(const [key,t]of [...timers])if(t.at<=clock){timers.delete(key);t.fn()}await flush()}}
}
const catalog=deadline=>({catalogLoad:{status:'success'},products:[product([{...base,effectivePrice:2450.25,salePrice:2450.25,saleActive:true,pricingAt:at,validUntil:end,pricingExpiresAt:deadline}])]})

test('Boundary refresh marks prices uncertain and accepts only actual new server data; timers clean up',async()=>{
 let reads=0
 const f=controllerFixture(async()=>catalog(++reads===1?100:Infinity))
 await f.controller.refresh();assert.equal(f.timers.size,1)
 await f.advance(100);assert.equal(reads,2);assert.deepEqual(f.events,['stale']);assert.equal(f.accepted.length,2)
 f.controller.dispose();assert.equal(f.timers.size,0)
})

test('Failed boundary refresh is stale and retries only once without an unbounded loop',async()=>{
 let reads=0
 const f=controllerFixture(async()=>{if(++reads===1)return catalog(100);throw Error('offline')})
 await f.controller.refresh();await f.advance(100);await f.advance(1500);await f.advance(999999)
 assert.equal(reads,3);assert.equal(f.timers.size,0);assert.equal(f.accepted.length,1)
 assert.equal(f.events.filter(v=>v==='failed').length,2);f.controller.dispose()
 const old=catalog(100),stale=staleCatalog(old),v=stale.products[0].variants[0]
 assert.equal(old.products[0].variants[0].pricingStale,undefined);assert.equal(productPricing(stale.products[0]).price,null)
 assert.equal(productPricing(stale.products[0]).discount,false)
 assert.equal(resolveCartItem({productId,variantId,identity:'canonical',quantity:1},stale.products).eligible,false)
 assert.equal(v.salePrice,2450.25,'Do not fabricate a regular-price replacement on expiry')
})

test('Concurrent full refreshes deduplicate, and late disposed-provider responses cannot replace newer data',async()=>{
 let resolveOld,resolveNew
 const old=controllerFixture(()=>new Promise(r=>resolveOld=r)),fresh=controllerFixture(()=>new Promise(r=>resolveNew=r))
 const one=old.controller.refresh(),two=old.controller.refresh();assert.equal(one,two);await flush()
 old.controller.dispose();const newer=fresh.controller.refresh();await flush();resolveNew(catalog(Infinity));await newer
 resolveOld(catalog(Infinity));await one
 assert.equal(old.accepted.length,0);assert.equal(fresh.accepted.length,1);fresh.controller.dispose()
})

async function acceptedExpiryFixture(t, initialDeadline=100) {
 let clock=0,id=0,reads=0,state,loading=false
 const timers=new Map(),requests=[],accepted=[],staleAt=[],failures=[]
 const controller=createCatalogRefreshController({
  load(){reads++;if(reads===1)return Promise.resolve(catalog(initialDeadline));return new Promise((resolve,reject)=>requests.push({resolve,reject}))},
  accept(next){state=next;accepted.push(next)},stale(){state=staleCatalog(state);staleAt.push(clock)},
  failed(error){failures.push(error)},busy(value){loading=value},now:()=>clock,
  timer(fn,ms){timers.set(++id,{fn,at:clock+ms});return id},cancel(key){timers.delete(key)},
 })
 t.after(()=>controller.dispose())
 await controller.refresh()
 return {controller,timers,requests,accepted,staleAt,failures,get state(){return state},get reads(){return reads},get loading(){return loading},
  async at(to,fire=true){clock=to;if(fire)for(const [key,timer]of [...timers])if(timer.at<=clock){timers.delete(key);timer.fn()}await flush()}}
}

test('Accepted expiry without a manual refresh marks stale before starting a boundary request',async t=>{
 const f=await acceptedExpiryFixture(t)
 await f.at(100)
 assert.deepEqual(f.staleAt,[100]);assert.equal(f.reads,2);assert.equal(f.loading,true)
 assert.equal(productPricing(f.state.products[0]).discount,false)
 assert.equal(f.state.products[0].variants[0].salePrice,2450.25)
})

test('Original 50/100/150 ms reproduction expires accepted prices while a pre-deadline request is pending',async t=>{
 const f=await acceptedExpiryFixture(t)
 await f.at(50);const pending=f.controller.refresh();await flush()
 assert.equal(f.timers.size,1,'Starting a request must retain accepted-price expiry')
 await f.at(100);assert.deepEqual(f.staleAt,[100])
 await f.at(150)
 assert.equal(f.reads,2);assert.equal(f.requests.length,1);assert.equal(f.loading,true)
 assert.equal(f.state.products[0].variants[0].pricingStale,true)
 assert.equal(productPricing(f.state.products[0]).price,null)
 assert.equal(productPricing(f.state.products[0]).discount,false)
 assert.equal(f.controller.refresh(),pending,'Deduplicate after evaluating expiry')
 assert.deepEqual([f.state.products[0].id,f.state.products[0].variants[0].id],[productId,variantId])
 console.log('Corrected 50/100/150 state: '+JSON.stringify({deadline:100,refreshAt:50,observedAt:150,staleAt:f.staleAt,reads:f.reads,loading:f.loading,pricingStale:true,displayedPrice:null,discountDisplayed:false}))
})

test('Delayed authoritative success after expiry restores fresh pricing without locally switching stored prices',async t=>{
 const f=await acceptedExpiryFixture(t)
 await f.at(50);const pending=f.controller.refresh();await flush();await f.at(150)
 assert.equal(f.state.products[0].variants[0].effectivePrice,2450.25)
 const next=catalog(500),v=next.products[0].variants[0]
 Object.assign(v,{regularPrice:2900,effectivePrice:2900,salePrice:null,saleActive:false,pricingAt:'2030-01-01T00:00:01Z'})
 f.requests[0].resolve(next);await pending
 assert.equal(f.accepted.length,2);assert.equal(f.loading,false)
 assert.equal(productPricing(f.state.products[0]).price,2900);assert.equal(productPricing(f.state.products[0]).discount,false)
 assert.equal(f.state.products[0].variants[0].pricingStale,undefined)
 assert.equal([...f.timers.values()][0].at,500)
})

test('Delayed failed refresh and its one retry never extend accepted validity or create a retry loop',async t=>{
 const f=await acceptedExpiryFixture(t)
 await f.at(50);const pending=f.controller.refresh();await flush();await f.at(150)
 f.requests[0].reject(Error('offline'));await pending
 assert.equal(f.accepted.length,1);assert.equal(f.loading,false);assert.equal(f.failures.length,1)
 assert.equal(productPricing(f.state.products[0]).price,null)
 await f.at(1650);assert.equal(f.reads,3)
 f.requests[1].reject(Error('still offline'));await flush()
 await f.at(999999)
 assert.equal(f.reads,3);assert.equal(f.timers.size,0);assert.equal(f.failures.length,2)
 assert.equal(f.state.products[0].variants[0].pricingExpiresAt,100)
})

test('Never-resolving refresh cannot keep a discount current or spawn concurrent requests after expiry',async t=>{
 const f=await acceptedExpiryFixture(t)
 await f.at(50);const pending=f.controller.refresh();await flush();await f.at(150);await f.at(999999)
 for(let n=0;n<20;n++)assert.equal(f.controller.refresh(),pending)
 assert.equal(f.reads,2);assert.equal(f.timers.size,0);assert.deepEqual(f.staleAt,[150])
 assert.equal(productPricing(f.state.products[0]).price,null)
})

test('Exactly-at-deadline refresh expires a snapshot even if its timer callback is throttled',async t=>{
 const f=await acceptedExpiryFixture(t)
 await f.at(100,false);const pending=f.controller.refresh();await flush()
 assert.deepEqual(f.staleAt,[100]);assert.equal(productPricing(f.state.products[0]).price,null)
 await f.at(150);assert.equal(f.controller.refresh(),pending);assert.deepEqual(f.staleAt,[100]);assert.equal(f.reads,2)
})

test('Focus, visibility and repeated manual refreshes evaluate overdue expiry before pending-request deduplication',async t=>{
 const f=await acceptedExpiryFixture(t),doc=new EventTarget(),win=new EventTarget();doc.visibilityState='visible'
 const unbind=bindPricingActivity(doc,win,()=>f.controller.refresh(),()=>0);t.after(unbind)
 await f.at(50);const pending=f.controller.refresh();await flush();await f.at(150,false)
 win.dispatchEvent(new Event('focus'));assert.deepEqual(f.staleAt,[150])
 doc.dispatchEvent(new Event('visibilitychange'))
 for(let n=0;n<10;n++)assert.equal(f.controller.refresh(),pending)
 assert.equal(f.reads,2);assert.equal(productPricing(f.state.products[0]).discount,false)
 unbind();f.controller.dispose()
 win.dispatchEvent(new Event('focus'));doc.dispatchEvent(new Event('visibilitychange'))
 assert.equal(f.timers.size,0);assert.equal(f.reads,2);assert.deepEqual(f.staleAt,[150])
})

for(const deadline of [100,150])test('Already-expired response at '+deadline+' cannot restore confirmed freshness',async t=>{
 const f=await acceptedExpiryFixture(t)
 await f.at(50);const pending=f.controller.refresh();await flush();await f.at(150)
 f.requests[0].resolve(catalog(deadline));await pending
 assert.equal(f.accepted.length,1);assert.equal(f.failures.length,1)
 assert.equal(productPricing(f.state.products[0]).price,null)
 assert.equal(f.state.products[0].variants[0].pricingExpiresAt,100)
})

test('Disposal cancels independent expiry and retry timers and ignores queued callbacks and late responses',async t=>{
 const f=await acceptedExpiryFixture(t)
 await f.at(150,false);const pending=f.controller.refresh();await flush()
 f.requests[0].reject(Error('offline'));await pending
 assert.equal(f.timers.size,2,'An overdue expiry and a future retry have independent ownership')
 const callbacks=[...f.timers.values()].map(timer=>timer.fn),staleCount=f.staleAt.length
 f.controller.dispose();assert.equal(f.timers.size,0)
 for(const callback of callbacks)callback()
 await f.at(999999)
 assert.equal(f.staleAt.length,staleCount);assert.equal(f.reads,2);assert.equal(f.timers.size,0)
 const late=await acceptedExpiryFixture(t)
 await late.at(50);const request=late.controller.refresh();await flush();late.controller.dispose()
 late.requests[0].resolve(catalog(500));await request
 assert.equal(late.accepted.length,1);assert.deepEqual(late.staleAt,[]);assert.equal(late.timers.size,0)
})

test('Unscheduled indefinite sale stays compatible without inventing a validity deadline',async t=>{
 const f=await acceptedExpiryFixture(t,Infinity)
 assert.equal(f.timers.size,0);await f.at(999999)
 assert.equal(productPricing(f.state.products[0]).price,2450.25)
 assert.equal(productPricing(f.state.products[0]).discount,true);assert.deepEqual(f.staleAt,[])
})

test('Visibility, focus and prolonged inactivity refresh, while cleanup removes all listeners',async()=>{
 const doc=new EventTarget(),win=new EventTarget();doc.visibilityState='hidden'
 let calls=0,clock=0
 const cleanup=bindPricingActivity(doc,win,async()=>{calls++},()=>clock)
 doc.dispatchEvent(new Event('visibilitychange'));assert.equal(calls,0)
 doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));win.dispatchEvent(new Event('focus'))
 assert.equal(calls,2);clock=61000;win.dispatchEvent(new Event('pointerdown'));assert.equal(calls,3)
 win.dispatchEvent(new Event('keydown'));assert.equal(calls,3)
 cleanup();doc.dispatchEvent(new Event('visibilitychange'));win.dispatchEvent(new Event('focus'));assert.equal(calls,3)
})

test('Admin microsecond/offset round trips preserve omission, null, and exact differences',()=>{
 const start='2030-01-01T05:00:00.123456+05:00',end='2030-01-01T00:00:00.123457Z'
 const original={saleStartsAt:start,saleEndsAt:end}
 assert.equal(saleTimestampMicros(end)-saleTimestampMicros(start),1n)
 assert.deepEqual(saleSchedulePatch(original,{...original}),{})
 assert.deepEqual(saleSchedulePatch(original,{}),{})
 assert.deepEqual(saleSchedulePatch(original,{saleStartsAt:null}),{saleStartsAt:null})
 assert.deepEqual(saleSchedulePatch(original,{},true),{saleStartsAt:null,saleEndsAt:null})
 assert.deepEqual(saleSchedulePatch({},original),original)
 assert.throws(()=>saleSchedulePatch({}, {saleStartsAt:end,saleEndsAt:start}),/after/)
 for(const value of ['2030-02-30T00:00:00Z','2030-01-01T00:00','2030-01-01T00:00:00.1234567Z'])assert.throws(()=>saleTimestampMicros(value))
})

test('Admin states use the returned database instant and preserve configured versus effective prices',()=>{
 const sale={salePrice:2450.25,effectivePrice:2900,saleActive:false,pricingAt:at}
 assert.equal(adminSaleState({...sale,saleStartsAt:end}),'Scheduled')
 assert.equal(adminSaleState({...sale,saleEndsAt:at}),'Expired')
 assert.equal(adminSaleState({...sale,saleActive:true,saleEndsAt:end}),'Active')
 assert.equal(adminSaleState({...sale,saleActive:true}),'Active (unscheduled)')
 assert.equal(adminSaleState({...sale,salePrice:null}),'Inactive')
 assert.equal(adminSaleState({salePrice:2450.25}),'Unavailable until refreshed')
 assert.equal(sale.salePrice,2450.25)
})

test('Product serialization excludes read-only pricing and untouched schedules; disabled response is clear',()=>{
 const payload=toProductPayload({price:2900,salePrice:2450.25,variants:[{...base,saleStartsAt:end}],expectedRevision:'7',effectivePrice:2900,pricingAt:at})
 assert.equal(payload.salePrice,2450.25);assert.equal(payload.expectedRevision,'7')
 for(const field of ['variants','effectivePrice','pricingAt','saleStartsAt'])assert.equal(Object.hasOwn(payload,field),false)
 assert.match(productErrorMessage(Object.assign(new Error(),{status:409,code:'SALE_SCHEDULING_DISABLED'})),/Scheduled-sale submissions are unavailable/)
})

test('Fixed pack price ownership, component references, null clearing and configurable membership remain independent',()=>{
 const draft={id:'pack',name:'Pack',slug:'pack',sku:'pack',image:'/pack.webp',gallery:'',description:'',shortDescription:'',scentFamily:'Woody',categoryId:'',status:'Draft',mode:'fixed',regular:'450',sale:'400.25',maximum:'',manualAvailable:true,members:[{testerVariantId:variantId,quantityPerPack:2,displayOrder:4}],catalogRevision:'8',definitionRevision:'9',pricing:{saleStartsAt:end,saleEndsAt:null,effectivePrice:450,salePrice:400.25,saleActive:false,pricingAt:at}}
 const fixed=toPackPayload(draft)
 assert.equal(fixed.definition.fixedSalePrice,400.25);assert.equal(fixed.definition.fixedRegularPrice,450)
 assert.equal('fixedSaleStartsAt' in fixed.definition,false);assert.equal(fixed.expectedDefinitionRevision,'9')
 assert.equal(toPackPayload({...draft,sale:''}).definition.fixedSalePrice,null,'SQL atomically clears bounds with sale')
 const configurable=toPackPayload({...draft,mode:'configurable'})
 assert.equal('fixedSalePrice' in configurable.definition,false);assert.equal(configurable.definition.allowedVariants[0].testerVariantId,variantId)
 assert.equal(configurable.definition.minimumUnits,2)
})
