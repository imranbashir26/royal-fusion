import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
import {prepareBulkSalePlan, reviewProductDetail, reviewFixedPackDetail, parseFixedSaleAmount, reconcileSaleGroup} from '../src/services/bulkSaleContract.ts'
import {createBulkSaleController} from '../src/services/bulkSaleController.ts'
import {updateProductSchema} from '../../backend/server/schemas/productAdmin.js'
import {updatePackSchema} from '../../backend/server/schemas/testerCatalog.js'
import {createSaleSchedulingPolicy} from '../../backend/server/services/saleSchedulingPolicy.js'

const id = n => `${n.toString(16).padStart(8,'0')}-0000-4000-8000-000000000000`
const start='2099-01-01T05:00:00.123456+05:00', end='2099-02-01T00:00:00.654321Z'
const snapshot=(regularPrice=2900)=>({regularPrice,salePrice:null,saleStartsAt:null,saleEndsAt:null,effectivePrice:regularPrice,saleActive:false,pricingAt:'2026-10-15T00:00:00Z',validUntil:null})
function product(n=1,{kind='standard',count=1,revision='7'}={}) {
 return {id:id(n*10),commerceKind:kind,catalogRevision:revision,price:2900,stockQuantity:12,status:'Draft',active:false,description:'Do not replay metadata',testerAvailable:false,
  variants:Array.from({length:count},(_,i)=>({...snapshot(2900+i*600),id:id(n*10+i+1),productId:id(n*10),optionName:'Size',optionValue:kind==='tester'?'5 ml':`${50*(i+1)} ml`,sku:`RF-${n}-${i}`,stockQuantity:i?0:12,active:!i,available:false,standardManualAvailable:false,displayOrder:i}))}
}
function pack(n=1) {return {...snapshot(450),id:id(1000+n),commerceKind:'tester_pack',mode:'fixed',catalogRevision:'8',definitionRevision:'9',fixedRegularPrice:450,fixedSalePrice:null,fixedSaleStartsAt:null,fixedSaleEndsAt:null,manualAvailable:false,components:[{testerVariantId:id(8000),quantityPerPack:2}],allowedVariants:[]}}
const row=(p,i=0,edit={salePrice:'2450.25'})=>({kind:'variant',commerceKind:p.commerceKind,productId:p.id,variantId:p.variants[i].id,edit})
const packRow=(p,edit={salePrice:'390.25'})=>({kind:'fixed-pack',commerceKind:'tester_pack',packId:p.id,edit})
const clone=value=>structuredClone(value)
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const flush=()=>new Promise(resolve=>setImmediate(resolve))
const httpError=(status,code='INVALID_REQUEST')=>Object.assign(new Error('private server diagnostics must not leak'),{status,code})

test('Independent fixed amounts and windows produce one strict canonical PUT per product, not per variant',()=>{
 const a=product(1,{count:3}),b=product(2),before=clone(a)
 const plan=prepareBulkSalePlan([row(b,0,{salePrice:'1800'}),row(a,1,{salePrice:'2950',saleStartsAt:start,saleEndsAt:end}),row(a)], [a,b])
 assert.equal(plan.rowCount,3);assert.equal(plan.groups.length,2)
 const group=plan.groups.find(g=>g.id===a.id)
 assert.equal(group.rows.length,2);assert.equal(group.payload.variants.length,2)
 assert.deepEqual(group.payload.variants.map(v=>v.salePrice),[2450.25,2950])
 assert.equal(group.payload.expectedRevision,'7');assert.equal(updateProductSchema.safeParse(group.payload).success,true)
 assert.deepEqual(a,before);assert.equal(group.payload.variants.some(v=>v.id===a.variants[2].id),false)
 assert.deepEqual(plan.groups.map(g=>g.key),[...plan.groups.map(g=>g.key)].sort())
 assert(Object.isFrozen(plan));assert(Object.isFrozen(group.payload.variants[0]))
})
test('Only selected sale fields change; canonical stock, options, SKU, active/order and manual intent survive',()=>{
 const p=product(1,{count:2}),g=prepareBulkSalePlan([row(p,1)], [p]).groups[0],v=g.payload.variants[0],prior=p.variants[1]
 for(const key of ['id','optionName','optionValue','sku','regularPrice','stockQuantity','active','displayOrder','standardManualAvailable'])assert.equal(v[key],prior[key])
 for(const key of ['available','effectivePrice','pricingAt','saleActive','productId','description','status'])assert.equal(Object.hasOwn(v,key),false)
 assert.deepEqual(Object.keys(g.payload).sort(),['expectedRevision','variants'])
})
test('Standalone testers retain independent canonical identity and manual intent rather than derived availability',()=>{
 const p=product(3,{kind:'tester'});p.testerAvailable=true;p.variants[0].stockQuantity=0;p.variants[0].available=false
 const g=prepareBulkSalePlan([row(p,0,{salePrice:'190'})], [p]).groups[0],v=g.payload.variants[0]
 assert.equal(v.available,true);assert.equal(v.stockQuantity,0);assert.equal(v.optionValue,'5 ml');assert.equal(v.id,p.variants[0].id)
 assert.equal('standardManualAvailable' in v,false);assert.equal(updateProductSchema.safeParse(g.payload).success,true)
})
test('Fixed packs use partial pricing PATCH bodies with both revisions and no membership/regular-price replay',()=>{
 const p=pack(),g=prepareBulkSalePlan([packRow(p,{salePrice:'390.25',saleStartsAt:start})],[],[p]).groups[0]
 assert.deepEqual(g.payload,{product:{},definition:{fixedSalePrice:390.25,fixedSaleStartsAt:start},expectedRevision:'8',expectedDefinitionRevision:'9'})
 assert.equal(updatePackSchema.safeParse(g.payload).success,true);assert.equal(g.requiresScheduling,true)
})
test('Omitted bounds preserve configured microseconds; explicit null and full sale clearing stay distinct',()=>{
 const p=product();Object.assign(p.variants[0],{salePrice:2450.25,saleStartsAt:start,saleEndsAt:end})
 let g=prepareBulkSalePlan([row(p,0,{salePrice:'2300.25'})],[p]).groups[0]
 assert.equal('saleStartsAt' in g.payload.variants[0],false);assert.equal(g.rows[0].intended.saleStartsAt,start);assert.equal(g.requiresScheduling,true)
 g=prepareBulkSalePlan([row(p,0,{saleEndsAt:null})],[p]).groups[0];assert.equal(g.payload.variants[0].saleEndsAt,null);assert.equal(g.rows[0].intended.saleStartsAt,start)
 g=prepareBulkSalePlan([row(p,0,{salePrice:null})],[p]).groups[0]
 assert.deepEqual([g.payload.variants[0].salePrice,g.payload.variants[0].saleStartsAt,g.payload.variants[0].saleEndsAt],[null,null,null]);assert.equal(g.requiresScheduling,false)
 const fixed=pack();Object.assign(fixed,{fixedSalePrice:400,fixedSaleStartsAt:start,fixedSaleEndsAt:end})
 assert.deepEqual(prepareBulkSalePlan([packRow(fixed,{salePrice:null})],[],[fixed]).groups[0].payload.definition,{fixedSalePrice:null,fixedSaleStartsAt:null,fixedSaleEndsAt:null})
})
test('Clearing bounds cannot disguise a price change on a persisted schedule; unchanged echoes need no activation',()=>{
 const p=product();Object.assign(p.variants[0],{salePrice:2450.25,saleStartsAt:start})
 assert.equal(prepareBulkSalePlan([row(p,0,{salePrice:'2300',saleStartsAt:null,saleEndsAt:null})],[p]).groups[0].requiresScheduling,true)
 assert.equal(prepareBulkSalePlan([row(p,0,{salePrice:'2450.25'})],[p]).groups[0].requiresScheduling,false)
 assert.equal(prepareBulkSalePlan([row(p,0,{salePrice:'2450.25',saleStartsAt:start})],[p]).groups[0].requiresScheduling,false)
})
for(const amount of ['0','-1','2450.001','2900','3000','1e3','2E3','10%',' 2000','2000 ','Infinity','NaN','9999999999.991','10000000000',2000,NaN,Infinity,undefined])test('Invalid fixed sale input rejects '+String(amount),()=>{
 const p=product();assert.throws(()=>prepareBulkSalePlan([row(p,0,{salePrice:amount})],[p]))
})
test('Exact monetary bounds retain submitted cents without rounding or deriving percentages',()=>{
 for(const [input,value]of [['0.01',0.01],['2450.25',2450.25],['9999999999.99',9999999999.99]])assert.equal(parseFixedSaleAmount(input),value)
 const p=product();p.variants[0].regularPrice=9999999999.99;p.variants[0].effectivePrice=9999999999.99
 assert.equal(prepareBulkSalePlan([row(p,0,{salePrice:'9999999999.98'})],[p]).groups[0].payload.variants[0].salePrice,9999999999.98)
})
for(const bounds of [{saleStartsAt:'2099-01-01T00:00:00'},{saleStartsAt:'2099-02-30T00:00:00Z'},{saleStartsAt:end,saleEndsAt:start},{saleStartsAt:start,saleEndsAt:start},{saleEndsAt:'2099-01-01T00:00:00.1234567Z'},{saleStartsAt:undefined}])test('Invalid schedule rejects '+JSON.stringify(bounds),()=>{
 const p=product();assert.throws(()=>prepareBulkSalePlan([row(p,0,{salePrice:'2400',...bounds})],[p]))
})
test('Duplicate, foreign, malformed, unknown and new identities reject before dispatch',()=>{
 const p=product(),selected=row(p)
 for(const rows of [[selected,selected],[{...selected,variantId:'bad'}],[{...selected,variantId:id(999)}],[{...selected,productId:id(998)}],[{...selected,commerceKind:'tester'}],[{...selected,variantId:undefined}],[{...selected,edit:{discountPercent:10}}]])assert.throws(()=>prepareBulkSalePlan(rows,[p]))
 assert.throws(()=>prepareBulkSalePlan([{...selected,edit:{}}],[p]));assert.throws(()=>prepareBulkSalePlan([selected],[p,p]))
 assert.throws(()=>prepareBulkSalePlan([selected],[{...p,catalogRevision:'01'}]));assert.throws(()=>prepareBulkSalePlan([selected],[{...p,catalogRevision:'9223372036854775808'}]))
 assert.throws(()=>prepareBulkSalePlan([selected],[{...p,variants:[{...p.variants[0],productId:id(999)}]}]))
})
test('The selection limit is 50 eligible rows and configurable parent prices are excluded',()=>{
 const p=product(1,{count:51}),rows=p.variants.map((_,i)=>row(p,i,{salePrice:'100'}))
 assert.equal(prepareBulkSalePlan(rows.slice(0,50),[p]).rowCount,50);assert.throws(()=>prepareBulkSalePlan(rows,[p]),/50/)
 assert.throws(()=>prepareBulkSalePlan([],[]));const fixed=pack()
 assert.throws(()=>prepareBulkSalePlan([packRow(fixed)],[],[{...fixed,mode:'configurable'}]),/Configurable/)
 assert.throws(()=>prepareBulkSalePlan([packRow(fixed)],[],[]),/Unknown/)
})
test('Reviewed snapshots remain reusable and detached from caller mutations',()=>{
 const p=product(),fixed=pack(),reviewed=reviewProductDetail(p),reviewedPack=reviewFixedPackDetail(fixed)
 p.variants[0].stockQuantity=999;fixed.fixedRegularPrice=999
 const plan=prepareBulkSalePlan([row(reviewed),packRow(reviewedPack)],[reviewed],[reviewedPack])
 assert.equal(plan.groups.find(g=>g.kind==='product').payload.variants[0].stockQuantity,12)
 assert.equal(plan.groups.find(g=>g.kind==='fixed-pack').rows[0].before.regularPrice,450)
})
test('Malformed authoritative monetary, revision and inventory snapshots fail before any request',()=>{
 for(const changes of [{regularPrice:0},{regularPrice:NaN},{regularPrice:99999999999},{regularPrice:2900.001},{salePrice:2900},{stockQuantity:-1},{stockQuantity:2147483648},{active:'true'},{standardManualAvailable:undefined}]){
  const p=product();Object.assign(p.variants[0],changes);assert.throws(()=>prepareBulkSalePlan([row(p)],[p]))
 }
 const p=pack();assert.throws(()=>prepareBulkSalePlan([packRow(p)],[],[{...p,definitionRevision:undefined}]))
 assert.throws(()=>prepareBulkSalePlan([packRow(p)],[],[{...p,fixedRegularPrice:0}]))
})
test('Prepared scheduling sensitivity agrees with the actual disabled backend policy for variants, testers and packs',async()=>{
 const policy=createSaleSchedulingPolicy(null)
 for(const kind of ['standard','tester'])for(const edit of [{salePrice:'2300'},{salePrice:null},{salePrice:'2450.25'},{saleEndsAt:null},{salePrice:'2300',saleStartsAt:null,saleEndsAt:null},{saleEndsAt:end}]){
  const p=product(1,{kind});Object.assign(p.variants[0],{salePrice:2450.25,saleStartsAt:start})
  const group=prepareBulkSalePlan([row(p,0,edit)],[p]).groups[0]
  if(group.requiresScheduling)await assert.rejects(()=>policy.assertAllowed(group.payload,p),{status:409,code:'SALE_SCHEDULING_DISABLED'})
  else await policy.assertAllowed(group.payload,p)
 }
 for(const edit of [{salePrice:'390'},{salePrice:null},{salePrice:'400'},{saleEndsAt:null},{salePrice:'390',saleStartsAt:null,saleEndsAt:null}]){
  const p=pack();Object.assign(p,{fixedSalePrice:400,fixedSaleStartsAt:start});const group=prepareBulkSalePlan([packRow(p,edit)],[],[p]).groups[0]
  if(group.requiresScheduling)await assert.rejects(()=>policy.assertAllowed(group.payload,p),{status:409})
  else await policy.assertAllowed(group.payload,p)
 }
})

function fixture({products=[product(1),product(2)],packs=[],selections,save,capability=async()=>true,timing={}}={}) {
 const plan=prepareBulkSalePlan(selections??products.map(p=>row(p)),products,packs),calls=[],stored=new Map([...products,...packs].map(p=>[p.id,clone(p)]))
 let attempt=0
 function apply(group){
  const data=stored.get(group.id);data.catalogRevision=(BigInt(data.catalogRevision)+1n).toString()
  if(group.kind==='product')for(const input of group.payload.variants){const v=data.variants.find(v=>v.id===input.id);Object.assign(v,input);if(input.salePrice===null){v.saleStartsAt=null;v.saleEndsAt=null}v.effectivePrice=v.salePrice??v.regularPrice;v.saleActive=v.salePrice!==null}
  else {const d=group.payload.definition;data.fixedSalePrice=d.fixedSalePrice;if(Object.hasOwn(d,'fixedSaleStartsAt'))data.fixedSaleStartsAt=d.fixedSaleStartsAt;if(Object.hasOwn(d,'fixedSaleEndsAt'))data.fixedSaleEndsAt=d.fixedSaleEndsAt;data.definitionRevision=(BigInt(data.definitionRevision)+1n).toString();data.effectivePrice=data.fixedSalePrice??data.fixedRegularPrice;data.saleActive=data.fixedSalePrice!==null}
  return clone(data)
 }
 const transport={readCapability:capability,
  saveProduct:dispatch,savePack:dispatch,getProduct:async id=>clone(stored.get(id)),getPack:async id=>clone(stored.get(id))}
 async function dispatch(id,body,request){const group=plan.groups.find(g=>g.id===id);calls.push({id,body:clone(body),request,group});return save?save({group,apply,request,attempt:++attempt}):apply(group)}
 const controller=createBulkSaleController(plan,transport,{requestId:()=>`bulk_fixture_${++attempt}`,...timing})
 return {plan,calls,stored,apply,transport,controller}
}
test('Serial deterministic execution sends one request per product group and records selected-row successes',async()=>{
 const a=product(1,{count:2}),b=product(2),gate=deferred()
 const f=fixture({products:[b,a],selections:[row(a,1),row(b),row(a)],save:async({group,apply})=>{if(group.id===a.id)await gate.promise;return apply(group)}})
 const run=f.controller.submit();assert.equal(f.controller.submit(),run);await flush();assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.variants.length,2)
 gate.resolve();const result=await run
 assert.equal(result.success,true);assert.equal(result.running,false);assert.deepEqual(result.rows.map(r=>r.state),['saved','saved','saved']);assert.equal(f.calls.length,2)
 await f.controller.submit();assert.equal(f.calls.length,2,'Repeated submit cannot replay completed groups')
})
for(const at of [0,1])test('Definite rejection at group '+at+' preserves independent successes and never reports overall success',async()=>{
 let n=0;const f=fixture({save:async({group,apply})=>{if(n++===at)throw httpError(400);return apply(group)}})
 const state=await f.controller.submit();assert.equal(state.success,false);assert.deepEqual(state.groups.map(g=>g.state),at===0?['rejected','saved']:['saved','rejected']);assert.equal(f.calls.length,2)
 assert.doesNotMatch(JSON.stringify(state),/private server diagnostics/)
})
test('A stale product group marks all its selected rows stale; other products retain independent outcomes',async()=>{
 const p=product(1,{count:2});let n=0
 const f=fixture({products:[p,product(2)],selections:[row(p),row(p,1),row(product(2))],save:async({group,apply})=>{if(!n++)throw httpError(409,'CATALOG_STALE');return apply(group)}})
 const state=await f.controller.submit();assert.deepEqual(state.rows.map(r=>r.state),['stale','stale','saved']);assert.equal(state.success,false)
 await assert.rejects(()=>f.controller.retry(f.plan.groups[0].key));assert.equal(f.calls.length,2)
})
for(const [status,code]of [[401,'AUTH_REQUIRED'],[403,'PERMISSION_DENIED'],[429,'LIMIT'],[409,'SALE_SCHEDULING_DISABLED'],[503,'SALE_SCHEDULING_UNAVAILABLE']])test('Server '+status+'/'+code+' pauses pending writes without replaying earlier successes',async()=>{
 let n=0;const f=fixture({products:[product(1),product(2),product(3)],save:async({group,apply})=>{if(n++===1)throw httpError(status,code);return apply(group)}})
 const s=await f.controller.submit();assert.deepEqual(s.groups.map(g=>g.state),['saved','rejected','pending']);assert.equal(s.paused,true);assert.equal(s.success,false);assert.equal(f.calls.length,2)
})
test('Capability is re-read for each scheduling group and failed/missing/malformed results fail closed',async()=>{
 for(const value of [false,undefined,null,'true',{scheduledSaleWrites:true},new Error('private')]){
  const p=product(),f=fixture({products:[p],selections:[row(p,0,{salePrice:'2400',saleStartsAt:start})],capability:async()=>{if(value instanceof Error)throw value;return value}})
  const s=await f.controller.submit();assert.equal(s.groups[0].state,'rejected');assert.equal(f.calls.length,0);assert.equal(s.success,false)
 }
 const a=product(),b=product(2);let reads=0
 const f=fixture({products:[a,b],selections:[row(a,0,{salePrice:'2400',saleStartsAt:start}),row(b,0,{salePrice:'2300',saleStartsAt:start})],capability:async()=>++reads===1})
 const s=await f.controller.submit();assert.equal(reads,2);assert.deepEqual(s.groups.map(g=>g.state),['saved','rejected']);assert.equal(f.calls.length,1)
})
test('Disabled capability allows immediate sales and approved clearing but cannot change an existing scheduled amount',async()=>{
 const p=product();Object.assign(p.variants[0],{salePrice:2450.25,saleStartsAt:start})
 let f=fixture({products:[p],selections:[row(p,0,{salePrice:'2300',saleStartsAt:null,saleEndsAt:null})],capability:async()=>false})
 assert.equal((await f.controller.submit()).groups[0].state,'rejected');assert.equal(f.calls.length,0)
 f=fixture({products:[p],selections:[row(p,0,{salePrice:null})],capability:async()=>false});assert.equal((await f.controller.submit()).success,true)
 f=fixture({capability:async()=>{throw Error('Must not need capability for unscheduled editing')}});assert.equal((await f.controller.submit()).success,true)
})
test('Transport errors and generic post-write server failures are uncertain, with later groups untouched',async()=>{
 for(const error of [Error('connection lost'),httpError(500),httpError(503,'TESTER_SERVICE_UNAVAILABLE')]){
  const f=fixture({save:async()=>{throw error}}),s=await f.controller.submit()
  assert.deepEqual(s.groups.map(g=>g.state),['uncertain','pending']);assert.equal(s.success,false);assert.equal(f.calls.length,1)
  await assert.rejects(()=>f.controller.resume());await assert.rejects(()=>f.controller.retry(f.plan.groups[0].key));assert.equal(f.calls.length,1)
 }
})
test('Lost response after commit reconciles as matching state without claiming execution or replaying the write',async()=>{
 const f=fixture({save:async({group,apply})=>{apply(group);throw Error('response lost')}}),key=f.plan.groups[0].key
 await f.controller.submit();const state=await f.controller.reconcile(key)
 assert.equal(state.groups[0].state,'uncertain');assert.deepEqual(state.groups[0].reconciliation,{kind:'matches',message:'Current state matches; original response unconfirmed.'});assert.equal(state.success,false)
 await assert.rejects(()=>f.controller.retry(key));assert.equal(f.calls.length,1)
})
test('Fixed-pack post-write detail failure uses PATCH intent and both revisions during reconciliation',async()=>{
 const p=pack(),f=fixture({products:[],packs:[p],selections:[packRow(p)],save:async({group,apply})=>{apply(group);throw httpError(503,'TESTER_SERVICE_UNAVAILABLE')}})
 await f.controller.submit();const s=await f.controller.reconcile(f.plan.groups[0].key)
 assert.equal(s.groups[0].reconciliation.kind,'matches');assert.equal(s.groups[0].state,'uncertain');assert.equal(f.calls[0].body.expectedDefinitionRevision,'9');assert.equal('components' in f.calls[0].body.definition,false)
})
test('Explicit repeated retries retain the exact original payload/revision and require fresh reconciliation each time',async()=>{
 let n=0;const f=fixture({products:[product()],save:async({group,apply})=>{if(n++<2)throw Error('no response');return apply(group)}}),key=f.plan.groups[0].key
 await f.controller.submit();await f.controller.reconcile(key);assert.equal(f.controller.getState().groups[0].reconciliation.kind,'retry-allowed')
 await f.controller.retry(key);await assert.rejects(()=>f.controller.retry(key));await f.controller.reconcile(key);const s=await f.controller.retry(key)
 assert.equal(s.success,true);assert.equal(f.calls.length,3);assert(f.calls.every(c=>c.body.expectedRevision==='7'));assert.deepEqual(f.calls[0].body,f.calls[2].body)
})
test('Changed revisions with conflicting configuration require new review, never automatic revision replacement',async()=>{
 const f=fixture({save:async()=>{throw Error('lost')}}),key=f.plan.groups[0].key
 await f.controller.submit();f.stored.get(f.plan.groups[0].id).catalogRevision='99'
 const s=await f.controller.reconcile(key);assert.equal(s.groups[0].reconciliation.kind,'review-required');assert.equal(s.groups[0].capturedRevision,'7')
 await assert.rejects(()=>f.controller.retry(key));assert.equal(f.calls.length,1)
})
test('Both fixed-pack revision tokens must remain unchanged before an explicit retry is permitted',()=>{
 const p=pack(),g=prepareBulkSalePlan([packRow(p)],[],[p]).groups[0]
 assert.equal(reconcileSaleGroup(g,p).kind,'retry-allowed')
 assert.equal(reconcileSaleGroup(g,{...p,definitionRevision:'10'}).kind,'review-required')
 assert.equal(reconcileSaleGroup(g,{...p,catalogRevision:'10'}).kind,'review-required')
})
test('Reconciliation compares timestamp instants without dropping microseconds or confusing offset formatting',()=>{
 const p=product(),g=prepareBulkSalePlan([row(p,0,{salePrice:'2400',saleStartsAt:start})],[p]).groups[0]
 const current=clone(p);Object.assign(current.variants[0],{salePrice:2400,saleStartsAt:'2099-01-01T00:00:00.123456Z'})
 assert.equal(reconcileSaleGroup(g,current).kind,'matches')
 current.catalogRevision='8';current.variants[0].saleStartsAt='2099-01-01T00:00:00.123457Z'
 assert.equal(reconcileSaleGroup(g,current).kind,'review-required')
})
test('Read failures leave uncertain state unretryable and never trigger compensation',async()=>{
 const f=fixture({save:async()=>{throw Error('lost')}}),key=f.plan.groups[0].key
 await f.controller.submit();f.transport.getProduct=async()=>{throw Error('private read failure')}
 const s=await f.controller.reconcile(key);assert.equal(s.groups[0].reconciliation.kind,'unavailable');await assert.rejects(()=>f.controller.retry(key));assert.equal(f.calls.length,1)
})
test('A deterministic timeout ignores a late old success after an explicit reconciled retry',async()=>{
 const timers=new Map();let handle=0,n=0;const old=deferred()
 const f=fixture({products:[product()],timing:{schedule:fn=>{timers.set(++handle,fn);return handle},clear:key=>timers.delete(key)},save:async({group,apply})=>n++===0?old.promise:apply(group)})
 const pending=f.controller.submit();await flush();assert.equal(f.calls.length,1);[...timers.values()][0]();await pending
 assert.equal(f.controller.getState().groups[0].state,'uncertain');assert.equal(timers.size,0)
 const key=f.plan.groups[0].key;await f.controller.reconcile(key);await f.controller.retry(key);const saved=f.controller.getState()
 old.resolve({id:id(999),catalogRevision:'100',variants:[]});await flush();assert.deepEqual(f.controller.getState(),saved);assert.equal(f.calls.length,2)
})
test('Cancellation leaves an outstanding mutation uncertain and ignores its later response',async()=>{
 const gate=deferred(),f=fixture({save:async()=>gate.promise}),pending=f.controller.submit();await flush()
 f.controller.cancel();const s=await pending;assert.deepEqual(s.groups.map(g=>g.state),['uncertain','pending']);assert.equal(s.success,false)
 gate.resolve(f.apply(f.plan.groups[0]));await flush();assert.equal(f.controller.getState().groups[0].state,'uncertain');assert.equal(f.calls.length,1)
})
test('Cancellation before the first microtask sends nothing and allows an explicit resume',async()=>{
 const f=fixture(),pending=f.controller.submit();f.controller.cancel();const state=await pending
 assert.equal(f.calls.length,0);assert.equal(state.paused,true);assert(state.groups.every(g=>g.state==='pending'))
 assert.equal((await f.controller.resume()).success,true);assert.equal(f.calls.length,2)
})
test('Disposal can be passed unbound as an observer cleanup and cannot start another write',async()=>{
 const f=fixture(),{dispose}=f.controller;dispose();await assert.rejects(()=>f.controller.submit());assert.equal(f.calls.length,0);assert.equal(f.controller.getState().disposed,true)
})
test('A delayed cancelled reconciliation cannot replace a newer authoritative conflict result',async()=>{
 const f=fixture({save:async()=>{throw Error('lost')}}),key=f.plan.groups[0].key,old=deferred()
 await f.controller.submit();f.transport.getProduct=async()=>old.promise
 const waiting=f.controller.reconcile(key);await flush();f.controller.cancel();await waiting
 f.stored.get(f.plan.groups[0].id).catalogRevision='99';f.transport.getProduct=async id=>clone(f.stored.get(id))
 await f.controller.reconcile(key);const current=f.controller.getState();assert.equal(current.groups[0].reconciliation.kind,'review-required')
 old.resolve({...product(),catalogRevision:'7'});await flush();assert.deepEqual(f.controller.getState(),current)
})
test('A missing selected identity requires review even if a malformed source leaves the revision unchanged',()=>{
 const p=product(1,{count:2}),group=prepareBulkSalePlan([row(p)],[p]).groups[0]
 assert.equal(reconcileSaleGroup(group,{...p,variants:[p.variants[1]]}).kind,'review-required')
})
test('Observer unsubscription does not cancel a database write, while disposal cannot pretend rollback',async()=>{
 const gate=deferred(),f=fixture({products:[product()],save:async({group,apply})=>{await gate.promise;return apply(group)}})
 let observed=0;const off=f.controller.subscribe(()=>observed++),pending=f.controller.submit();await flush();off();const count=observed;gate.resolve();assert.equal((await pending).success,true);assert.equal(observed,count)
 const later=deferred(),other=fixture({save:async()=>later.promise}),work=other.controller.submit();await flush();other.controller.dispose();const s=await work
 assert.equal(s.disposed,true);assert.equal(s.groups[0].state,'uncertain');later.resolve({});await flush();assert.equal(other.controller.getState().success,false)
})
test('Partial successes remain recorded when later response loss is reconciled and pending groups explicitly resume',async()=>{
 let n=0;const f=fixture({products:[product(1),product(2),product(3)],save:async({group,apply})=>{const result=apply(group);if(++n===2)throw Error('lost');return result}})
 await f.controller.submit();assert.deepEqual(f.controller.getState().groups.map(g=>g.state),['saved','uncertain','pending'])
 await f.controller.reconcile(f.plan.groups[1].key);const s=await f.controller.resume()
 assert.deepEqual(s.groups.map(g=>g.state),['saved','uncertain','saved']);assert.equal(s.success,false);assert.equal(f.calls.length,3)
})
test('Malformed success acknowledgements become uncertain rather than false successes',async()=>{
 const f=fixture({save:async()=>({id:id(999),catalogRevision:'8'})}),s=await f.controller.submit()
 assert.equal(s.groups[0].state,'uncertain');assert.equal(s.groups[1].state,'pending');assert.equal(s.success,false)
})

// Execute the actual API-client modules after type erasure, replacing only their
// transport/import locations. Assertions inspect the real serialized requests.
const dataModule=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64')
async function clientModule(name) {
 let source=await readFile(new URL('../src/services/'+name+'.ts',import.meta.url),'utf8')
 const client=dataModule('export const adminAuthClient={protectedRequest:(...args)=>globalThis.__bulkSaleClient(...args)}')
 const react=dataModule('export const useEffect=()=>{};export const useState=()=>{throw Error("No hook mounted")};')
 source=source.replaceAll("'./adminAuthClient'",JSON.stringify(client)).replaceAll("'./adminProductContract'",JSON.stringify(new URL('../src/services/adminProductContract.ts',import.meta.url).href))
  .replaceAll("'./bulkSaleContract.ts'",JSON.stringify(new URL('../src/services/bulkSaleContract.ts',import.meta.url).href)).replaceAll("'react'",JSON.stringify(react))
 return import(dataModule(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText))
}
test('Actual narrow API clients send existing PUT/PATCH paths, correlation, cancellation and exact canonical/pricing bodies',async()=>{
 const calls=[];globalThis.__bulkSaleClient=async(path,options)=>{calls.push({path,options});return {}}
 const {adminProductsApi}=await clientModule('adminProductsApi'),{testerPacksApi}=await clientModule('testerPacksApi'),signal=new AbortController().signal
 const p=product(1,{count:2}),fixed=pack(),plan=prepareBulkSalePlan([row(p),row(p,1),packRow(fixed)], [p], [fixed])
 for(const group of plan.groups){
  if(group.kind==='product')await adminProductsApi.updateSaleVariants(group.id,{...group.payload,description:'must not be sent'},{requestId:'bulk_actual_request',signal})
  else await testerPacksApi.updateSalePricing(group.id,{...group.payload,product:{name:'must not be sent'},definition:{...group.payload.definition,components:fixed.components,fixedRegularPrice:1}},{requestId:'bulk_actual_request',signal})
 }
 assert.equal(calls.length,2)
 for(const call of calls){const body=JSON.parse(call.options.body);assert.equal(call.options.headers['X-Request-ID'],'bulk_actual_request');assert.equal(call.options.signal,signal)
  if(call.path.includes('/products/')){assert.equal(call.options.method,'PUT');assert.equal(body.variants.length,2);assert.equal(updateProductSchema.safeParse(body).success,true);assert.equal('description' in body,false)}
  else {assert.equal(call.options.method,'PATCH');assert.equal(call.path,'/v2/admin/tester-packs/'+fixed.id);assert.deepEqual(body.product,{});assert.equal('components' in body.definition,false);assert.equal('fixedRegularPrice' in body.definition,false);assert.equal(updatePackSchema.safeParse(body).success,true)}
 }
 await adminProductsApi.update(p.id,{price:3300,sku:'INDIVIDUAL',stockQuantity:5});assert.equal(JSON.parse(calls.at(-1).options.body).price,3300)
 await testerPacksApi.save(fixed.id,{product:{name:'Individual'},definition:{manualAvailable:true},expectedRevision:'8',expectedDefinitionRevision:'9'});assert.equal(JSON.parse(calls.at(-1).options.body).product.name,'Individual')
 await adminProductsApi.get(p.id,{signal});assert.equal(calls.at(-1).path,'/v1/admin/products/'+p.id);assert.equal(calls.at(-1).options.signal,signal)
 await testerPacksApi.get(fixed.id,{signal});assert.equal(calls.at(-1).path,'/v2/admin/tester-packs/'+fixed.id);assert.equal(calls.at(-1).options.signal,signal)
 const count=calls.length;assert.throws(()=>adminProductsApi.updateSaleVariants(p.id,plan.groups.find(g=>g.kind==='product').payload,{requestId:'bad'}));assert.equal(calls.length,count)
})
test('The shared fresh capability reader accepts only exact true and fails closed on malformed responses and errors',async()=>{
 const {readSaleSchedulingCapability}=await clientModule('saleSchedulingCapability'),paths=[]
 for(const value of [{scheduledSaleWrites:true},{scheduledSaleWrites:false},{scheduledSaleWrites:'true'},null,{},Error('private')]){
  globalThis.__bulkSaleClient=async(path,options)=>{paths.push({path,options});if(value instanceof Error)throw value;return value}
  assert.equal(await readSaleSchedulingCapability(),value?.scheduledSaleWrites===true)
 }
 assert(paths.every(p=>p.path==='/v1/admin/products/sale-capabilities'))
})
test('Controller composition executes real product/pack client serializers and the shared capability reader',async()=>{
 const {adminProductsApi}=await clientModule('adminProductsApi'),{testerPacksApi}=await clientModule('testerPacksApi'),{readSaleSchedulingCapability}=await clientModule('saleSchedulingCapability')
 const p=product(1,{count:2}),fixed=pack(),f=fixture({products:[p],packs:[fixed],selections:[row(p,0,{salePrice:'2400',saleStartsAt:start}),row(p,1,{salePrice:'2950'}),packRow(fixed,{salePrice:'390',saleStartsAt:start})]})
 const actual=[]
 globalThis.__bulkSaleClient=async(path,options={})=>{
  actual.push({path,options})
  if(path.endsWith('/sale-capabilities'))return {scheduledSaleWrites:true}
  const group=f.plan.groups.find(group=>path.endsWith('/'+group.id));assert(group)
  if(options.method){assert.deepEqual(JSON.parse(options.body),group.payload);return f.apply(group)}
  return clone(f.stored.get(group.id))
 }
 const controller=createBulkSaleController(f.plan,{
  readCapability:readSaleSchedulingCapability,
  saveProduct:(id,body,request)=>adminProductsApi.updateSaleVariants(id,body,request),
  savePack:(id,body,request)=>testerPacksApi.updateSalePricing(id,body,request),
  getProduct:(id,signal)=>adminProductsApi.get(id,{signal}),getPack:(id,signal)=>testerPacksApi.get(id,{signal}),
 },{requestId:()=> 'bulk_composed_request'})
 const result=await controller.submit();assert.equal(result.success,true)
 assert.deepEqual(actual.filter(c=>c.options.method).map(c=>c.options.method),['PATCH','PUT'])
 assert.equal(actual.filter(c=>c.path.endsWith('/sale-capabilities')).length,2)
 assert.equal(actual.find(c=>c.options.method==='PUT').options.headers['X-Request-ID'],'bulk_composed_request')
})
test.after(()=>{delete globalThis.__bulkSaleClient})
