import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {stripTypeScriptTypes} from 'node:module'
// Stage 2E.6: fixed SHA-256 checkpoints from reviewed HEAD f2e4b6b42eea85351ab02ef4e8612ee5873922dc.
// All 41 working-tree texts were independently verified equal to those Git blobs
// after CRLF -> LF only. LF, CRLF and mixed line endings are equivalent here.
// Preserve every other UTF-8 byte: no trimming, BOM removal, lone-CR conversion,
// whitespace normalization or final-newline changes. These are text-only checks;
// do not apply this fingerprint to binary files or derive expectations at runtime.
// Stage 2F.5: only checkoutAttempt.ts and checkoutIntentStore.ts were reconciled
// against HEAD 0b7e5c863a1be4bb9f1d3837b5f39b0838d84542 plus reviewed Stage 2F.3
// changes: optional strictly validated confirmation, immutable fingerprint/token
// persistence, and exact-attempt clearing only after a definitive no-effect conflict.
// The other 39 fixed checkpoints and the CRLF -> LF-only algorithm are unchanged.
// Provenance: royal-fusion-stage2f5-1791984528529/before.json and verification-summary.json.
// Stage 2F.12: independently reviewed the Release 008 issued-token candidate.
// Only checkoutIntentStore.ts advances here: validated issued-token selection,
// immutable saved identity, and durable-rejection recovery guards. The other 40
// fixed fingerprints and CRLF -> LF-only canonicalization remain unchanged.
// Provenance: royal-fusion-stage2f12-1792001661741/before.json and protected-before.js.
const expectedLF={
  "backend/.env.example": "27F22E6BA512857624AF4EBFD72C0CA9A6DA9C59278AEABF874ED31B48C45F91",
  "backend/server/auth/config.js": "24378615C55D7FE64E2F8A0687C8E5C2F5DA4BB2A0C470E04F55091BC87DE1F2",
  "backend/server/auth/contracts.js": "1043A53E649E0A3066E924B73B253DE249162603F92061AD813AFEA967973606",
  "backend/server/auth/cookies.js": "40F9BBCDC7CBB197228002513C7190A1D52B43648511A9CA31268CD6BEF96C78",
  "backend/server/auth/runtime.js": "59C1FF13CA4A58B26AA73FA3D49F27CE5739997E0D3EA6AB2D82B7B6A7357A36",
  "backend/server/auth/schemas.js": "5A193AF2C26D149CB9CDB88C858365B8B9B744BA78647110A8207A1776CCD098",
  "backend/supabase/migrations/001_initial_schema.sql": "72AA073348B4AA973C8395E7CA9848B4818D5382F05A7E2BA432F076F0708F6C",
  "backend/supabase/migrations/002_launch_schema_foundation.sql": "FF217B7C652B573A588DD511130F051FF1816EF087F0C3936F413CE16FA17865",
  "backend/supabase/migrations/003_auth_schema_hardening.sql": "F7ACAB61AD085CF6F4C8AA0B2FF86CAB2BA9B92DAB3F4A7DD968F30C0E056A74",
  "backend/supabase/migrations/004_auth_session_refresh_lease.sql": "C9771DE251057345F2B6BD057CDA08596058897342E34FFD3F0C0AD5A111EC34",
  "backend/supabase/migrations/005_product_card_presentation.sql": "8064D4CA7F7B8BA12EEF40157FC57F8233CCE949A04C0DED7A2A65E3D6ACB599",
  "backend/supabase/migrations/006_fragrance_finder_preferences.sql": "2FED31CC8557411FFD3D8C0E47ADBE1390BEAE36CEEC1405AB9BF9FDFF65144F",
  "backend/supabase/migrations/007_reviews_public_api_boundary.sql": "C40B6676B54FF7A1F14AE4C3F2132A332632BAFD49D9DE2AA2E23225DA204E5E",
  "backend/supabase/migrations/008_settings_projection_rpc.sql": "8DF3EF3142FAA890B12101DFE298E10BCFB69DC0EB4325AF4D6AE79FBFCF820D",
  "backend/supabase/migrations/009_catalog_product_variants.sql": "322D532F38AA8A124752E9BBEA5654C9D434382998D70DFA984AFD912A69C615",
  "backend/supabase/migrations/010_checkout_product_locking.sql": "F950950185937BC49D2EC958C46457A09266DA13D9DAF84C3A9D44D045F21ABF",
  "backend/supabase/migrations/011_admin_order_fulfillment.sql": "DD84DB6447E4471C58FC53FDC5FB3B35E35475707D4D3A92DEC2A6E86F482BD7",
  "backend/supabase/migrations/012_tester_catalog_foundation.sql": "49C38CDE19D59C3D16BE28C1453FC90B926016DBBC5CAF320DB450E4E9D86F71",
  "backend/supabase/release-migrations/001_single_admin_expansion.sql": "2EBAD76AA80C1F63583173A314D696FADFAC543007611398D99D75F5CCE9B300",
  "backend/supabase/release-migrations/002_single_admin_fulfillment.sql": "05CABE7CA3ADDE772073F1B9FB22A51B9635F232C598436EF331B29D3C41667A",
  "backend/supabase/release-migrations/003_single_admin_retirement.sql": "CB17DFF3D9FF041EF6071B9084AD7E4EE75C8FA17B3F984CA3CBC37957C32737",
  "frontend/.env.example": "2AFFA64AE8FD7488AB86E7D7757E9D4664394CF2EBDE6049CBE784BBEBD592DE",
  "frontend/src/store/cartPersistence.ts": "BC6B1061E1A37FDF62FDCF3DA478990B3A26D2EA7A2EBE9768A9D3083B9E9E40",
  "frontend/src/store/cartStore.ts": "7B340C2053083B31D61B03AE6FD1896703C541A40A16CBFA5BAB121FC5F36916",
  "frontend/src/store/checkoutAttempt.ts": "7015807478B8F9A6CE21A5A9FFA63C0DD562FB1EB303141620ABDAB0FD92C925",
  "frontend/src/store/checkoutIntentStore.ts": "A694C3EF1189E07BEE14CBBD2F21C4F584A62ABB10C4A6177620DED63542070C",
  "frontend/src/store/customerAuthStore.ts": "9084A928447C33D2DE292B567848BE69F3F1DB5D166A25BDA5629A0EFC701FC3",
  "frontend/src/store/wishlistStore.ts": "04E959CFBF7A7DF0ACBE0FC16A0AFA65E230F56B95BDCA125750FF587FDF21A3",
  "frontend/tests/checkoutIntegration.test.mjs": "811F54D2D493C58A4C2B233913519FD51CEB458196A4C443D2D5299E6F990778",
  "sanity/.env.example": "FA776BBCEEA229AE0ECCA47EFEF7775C8A2EB348DB5EDB05D59DBE3362896B0C",
  "sanity/README.md": "580160C05A97C1DD27B59D00B9CDB9024EA6179AB89318CD12A7F24BE472815F",
  "sanity/queries.md": "611FD987D26FF992B363EBC46E55A7F158FDA1B3F8653BD3EC0E8AAB910B9862",
  "sanity/schemas/author.ts": "9FEBB2403217E5AD766726C7DC9BFC31BA6763C349ADCA50584294C9450463C6",
  "sanity/schemas/banner.ts": "A46ECB6E1F744C9796DF5004677E899EE9632885A80EA4DF877873B49150BB60",
  "sanity/schemas/blogCategory.ts": "805AA7C03BDFE4EADDB9E8F3B82D4CBF78CE179696243116D0E6ABA289510872",
  "sanity/schemas/blogPost.ts": "C26326779B9AB9FC5D169A9A3B50DBA851815C8CB4402326C35706CD1BA48766",
  "sanity/schemas/faq.ts": "4A5AAE373C2BD318BEA2012D05E596BDD9F3C19B43930090988AD2D25308BDD7",
  "sanity/schemas/fragranceGuide.ts": "AC0ECCB2EE9BAEA825DF5BF348353F47B2ACA56EC655721C330B36B1CA6F5B57",
  "sanity/schemas/homepage.ts": "60DF77A47DC068E0FB775444130E77099AD3456140A6830A7D590C24B449AF16",
  "sanity/schemas/index.ts": "3B66E9C320812C23693DF0C0222355A78FF08972EB6728D508F926EDAB1ECAAE",
  "sanity/schemas/policyPage.ts": "3E49A9BC9BC9104BAB36118F7561299F3D5C07A6E29E3F16850441CCF9E496EF"
}
function canonicalProtectedText(source) {
 const text=source.toString('utf8')
 assert.ok(Buffer.from(text,'utf8').equals(source),'Protected text must be valid UTF-8.')
 assert.ok(!source.includes(0),'Protected text must not contain NUL bytes.')
 return text.replaceAll('\r\n','\n')
}
function verifyProtectedText(path,source) {
 assert.equal(createHash('sha256').update(canonicalProtectedText(source),'utf8').digest('hex').toUpperCase(),expectedLF[path],path)
}
function textRepresentations(lf) {
 let line=0
 return [lf,lf.replaceAll('\n','\r\n'),lf.replace(/\n/g,()=>line++%2?'\r\n':'\n')]
}
test('protected migration/auth/cart/config and reviewed Studio text matches fixed LF checkpoints',async()=>{
 for(const path of Object.keys(expectedLF))verifyProtectedText(path,await readFile(new URL('../../../'+path,import.meta.url)))
})
test('all 41 fixed checkpoints accept equivalent LF, CRLF and mixed text',async()=>{
 for(const path of Object.keys(expectedLF)){
  const lf=canonicalProtectedText(await readFile(new URL('../../../'+path,import.meta.url)))
  for(const text of textRepresentations(lf))verifyProtectedText(path,Buffer.from(text,'utf8'))
 }
})
test('fingerprints reject substantive changes even when hidden among changed line endings',async()=>{
 for(const path of Object.keys(expectedLF)){
  const lf=canonicalProtectedText(await readFile(new URL('../../../'+path,import.meta.url)))
  for(const text of textRepresentations(lf+'\nUnauthorized protected-content change.')){
   assert.throws(()=>verifyProtectedText(path,Buffer.from(text,'utf8')),assert.AssertionError)
  }
 }
 for(const [path,from,to] of [
  ['backend/server/auth/config.js','if (!secureCookies)','if (false)'],
  ['backend/server/auth/contracts.js',"PERMISSION_DENIED: [403,","PERMISSION_DENIED: [200,"],
  ['backend/server/auth/cookies.js',"sameSite: 'lax'","sameSite: 'none'"],
  ['frontend/src/store/checkoutAttempt.ts','Number(item.quantity) > 99','Number(item.quantity) > 999'],
  ['frontend/tests/checkoutIntegration.test.mjs',"assert.equal('total' in sent, false)","assert.equal('total' in sent, true)"],
  ['frontend/src/store/checkoutAttempt.ts',"typeof request.quoteFingerprint !== 'string'",'false'],
  ['frontend/src/store/checkoutIntentStore.ts','idempotencyKey: issuedToken ?? uuid()','idempotencyKey: uuid()'],
  ['frontend/src/store/checkoutIntentStore.ts','if (get().intent) return get().intent!','if (false) return get().intent!'],
  ['frontend/src/store/checkoutIntentStore.ts','const frozen = immutable(intent)','const frozen = intent'],
  ['frontend/src/store/checkoutIntentStore.ts','? immutable(raw.intent) : null','? raw.intent : null'],
  ['frontend/src/store/checkoutIntentStore.ts','get().intent!.request.idempotencyKey !== attemptId','false'],
  ['frontend/src/store/checkoutIntentStore.ts','|| get().pendingReceipt || get().recovery',''],
 ]){
  const lf=canonicalProtectedText(await readFile(new URL('../../../'+path,import.meta.url)))
  assert.ok(lf.includes(from),'Mutation target missing: '+path)
  const changed=lf.replace(from,to);assert.notEqual(changed,lf,'Mutation must change source: '+path)
  for(const text of textRepresentations(changed)){
   assert.throws(()=>verifyProtectedText(path,Buffer.from(text,'utf8')),assert.AssertionError)
  }
 }
})

// Semantic checks complement byte integrity: a reviewed hash must still protect
// exact replay state and fail closed on recovery or failed persistence.
test('reviewed checkout intent preserves immutable confirmation, strict identity and legacy replay shape',async()=>{
 const {createCheckoutIntentStore}=await import('../../../frontend/src/store/checkoutIntentStore.ts')
 const {validIntent}=await import('../../../frontend/src/store/checkoutAttempt.ts')
 const variantId='b35b3be7-a7dd-4c70-9c14-d1a9394d4711',productId='45852db8-8b83-425e-8d1f-4112958ed505',token='70000000-0000-4000-8000-000000000001'
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}
 let generated=0
 const request={items:[{variantId,quantity:1}],contact:{name:'Fixture',email:'fixture@example.invalid',phone:'00000000000'},shipping:{address:'Fixture address',city:'Karachi',province:'Sindh',notes:''},paymentMethod:'Cash on Delivery',couponCode:'',quoteFingerprint:'1'.repeat(64)}
 const lines=[{lineId:JSON.stringify([productId,variantId]),entryId:'71000000-0000-4000-8000-000000000001',variantId,quantity:1}]
 const store=createCheckoutIntentStore(storage,()=>{generated++;return token})
 assert.throws(()=>store.getState().freeze(request,lines,'invalid'),/Invalid issued checkout token/)
 assert.equal(store.getState().intent,null);assert.equal(generated,0)
 const frozen=store.getState().freeze(request,lines,token)
 assert.equal(frozen.request.idempotencyKey,token)
 assert.equal(validIntent(frozen),true)
 assert.equal(store.getState().freeze({...request,quoteFingerprint:'2'.repeat(64)},lines,'70000000-0000-4000-8000-000000000002'),frozen)
 assert.equal(generated,0)
 for(const change of [()=>frozen.request.idempotencyKey='different',()=>frozen.request.quoteFingerprint='2'.repeat(64),()=>frozen.request.items[0].quantity=2])assert.throws(change,TypeError)
 assert.deepEqual(createCheckoutIntentStore(storage).getState().intent,frozen)
 const legacy=structuredClone(frozen);delete legacy.request.quoteFingerprint;assert.equal(validIntent(legacy),true)
 for(const quoteFingerprint of [null,undefined,123,'invalid','A'.repeat(64)])assert.equal(validIntent({...frozen,request:{...frozen.request,quoteFingerprint}}),false)
 assert.equal(validIntent({...frozen,request:{...frozen.request,total:1}}),false)
 assert.equal(validIntent({...frozen,request:{...frozen.request,idempotencyKey:'invalid'}}),false)
 const original=[...values.values()][0]
 const unchanged=()=>{assert.equal(store.getState().intent,frozen);assert.equal([...values.values()][0],original);assert.equal(generated,0)}
 assert.throws(()=>store.getState().rejectQuote('70000000-0000-4000-8000-000000000002'));unchanged()
 store.setState({pendingReceipt:{idempotencyKey:token}})
 assert.throws(()=>store.getState().rejectQuote(token));unchanged()
 store.setState({pendingReceipt:null,recovery:{attemptId:token,reason:'Fixture recovery'}})
 assert.throws(()=>store.getState().rejectQuote(token));unchanged()
 store.setState({recovery:null})
 const write=storage.setItem;storage.setItem=()=>{throw Error('Fixture storage failure')}
 assert.throws(()=>store.getState().rejectQuote(token));unchanged();storage.setItem=write
 store.getState().rejectQuote(token)
 assert.equal(store.getState().intent,null);assert.equal(generated,0)
 assert.equal(createCheckoutIntentStore(storage).getState().hydrationStatus,'reset')
})

test('quote rejection classification never treats uncertain results as authority to replace an attempt',async()=>{
 const {CheckoutClientError}=await import('../../../frontend/src/services/checkoutClient.ts')
 const {isDefinitiveQuoteRejection,quoteAcceptanceKey}=await import('../../../frontend/src/services/checkoutConfirmation.ts')
 for(const code of ['QUOTE_CHANGED','QUOTE_REQUIRED']){
  assert.equal(isDefinitiveQuoteRejection(new CheckoutClientError(code,'Fixture conflict',409,false)),true)
  assert.equal(isDefinitiveQuoteRejection(new CheckoutClientError(code,'Fixture uncertainty',409,true)),false)
 }
 for(const error of [new CheckoutClientError('NETWORK_ERROR','Fixture',0,true),new CheckoutClientError('QUOTE_CHANGED','Fixture',503,true),new CheckoutClientError('IDEMPOTENCY_CONFLICT','Fixture',409,false)])assert.equal(isDefinitiveQuoteRejection(error),false)
 const quote=await issuedQuoteFixture()
 const accepted=quoteAcceptanceKey('original-inputs',quote,'Cash on Delivery')
 assert.ok(accepted)
 for(const [signature,data,payment] of [['changed-inputs',quote,'Cash on Delivery'],['original-inputs',quote,'Bank Transfer'],['original-inputs',{...quote,quoteFingerprint:'2'.repeat(64)},'Cash on Delivery'],['original-inputs',{...quote,shippingFee:300,total:3200},'Cash on Delivery']])assert.notEqual(quoteAcceptanceKey(signature,data,payment),accepted)
 assert.equal(quoteAcceptanceKey('original-inputs',{...quote,quoteFingerprint:undefined},'Cash on Delivery'),null)
 for(const idempotencyKey of [undefined,'invalid'])assert.equal(quoteAcceptanceKey('original-inputs',{...quote,idempotencyKey},'Cash on Delivery'),null)
 for(const quoteFingerprint of [undefined,'invalid','A'.repeat(64)])assert.equal(quoteAcceptanceKey('original-inputs',{...quote,quoteFingerprint},'Cash on Delivery'),null)
})

// This deterministic RPC-response fixture models a single server-issued quote.
// Exercise the production SQL adapter and checked-quote validator; the client
// neither generates a token/credential nor derives a price fingerprint here.
async function issuedQuoteFixture(){
 const {CheckoutQuoteService}=await import('../services/checkoutQuoteService.js')
 const request={items:[{variantId:'b35b3be7-a7dd-4c70-9c14-d1a9394d4711',quantity:1}],shipping:{city:'Karachi',province:'Sindh'},email:'fixture@example.invalid',couponCode:''}
 const response={idempotencyKey:'70000000-0000-4000-8000-000000000001',quoteFingerprint:'1'.repeat(64),subtotal:2900,discount:0,shippingFee:250,total:3150,currency:'PKR',shippingMethodId:'60000000-0000-4000-8000-000000000001',paymentMethods:['Cash on Delivery','Bank Transfer']}
 const service=new CheckoutQuoteService({rpc:async(name,args)=>{
  assert.equal(name,'quote_checkout_v1_checked');assert.deepEqual(args,{p_request:request,p_customer_id:null})
  return {data:structuredClone(response),error:null}
 }})
 return {...await service.quote(request),orderingEnabled:true}
}

// Execute whole candidate modules in memory with their actual dependencies.
// The only transformation besides TS erasure is resolving imports relative to
// the original file. No application file or installed dependency is written.
async function checkoutCandidate(path,from,to,form=0){
 const url=new URL('../../../'+path,import.meta.url)
 let source=canonicalProtectedText(await readFile(url))
 if(from!==undefined){
  assert.equal(source.split(from).length,2,'Executable mutation must target exactly one source site: '+path)
  const changed=source.replace(from,to);assert.notEqual(changed,source,'Executable mutation must change source: '+path)
  source=changed
 }
 source=textRepresentations(source)[form]
 if(path.endsWith('.ts'))source=stripTypeScriptTypes(source)
 source=source.replace(/(\bfrom\s+)(['"])([^'"]+)\2/g,(_match,prefix,quote,specifier)=>
  prefix+quote+(specifier.startsWith('.')?new URL(specifier,url).href:import.meta.resolve(specifier))+quote)
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
}
function attemptFixture(){
 const token='70000000-0000-4000-8000-000000000001',other='70000000-0000-4000-8000-000000000002'
 const variantId='b35b3be7-a7dd-4c70-9c14-d1a9394d4711',productId='45852db8-8b83-425e-8d1f-4112958ed505'
 const request={items:[{variantId,quantity:1}],contact:{name:'Fixture',email:'fixture@example.invalid',phone:'00000000000'},shipping:{address:'Fixture address',city:'Karachi',province:'Sindh',notes:''},paymentMethod:'Cash on Delivery',couponCode:'',quoteFingerprint:'1'.repeat(64)}
 const lines=[{lineId:JSON.stringify([productId,variantId]),entryId:'71000000-0000-4000-8000-000000000001',variantId,quantity:1}]
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}
 return {token,other,request,lines,storage}
}
function verifyStoreBoundary(factory,boundary){
 const f=attemptFixture(),store=factory(f.storage,()=>f.other),frozen=store.getState().freeze(f.request,f.lines,f.token)
 if(boundary==='issuance')assert.equal(frozen.request.idempotencyKey,f.token,'Issued token must be preserved')
 if(boundary==='retry')assert.equal(store.getState().freeze({...f.request,quoteFingerprint:'2'.repeat(64)},f.lines,f.other),frozen,'Retry must preserve the original frozen attempt')
 if(boundary==='freeze')assert.throws(()=>{frozen.request.quoteFingerprint='2'.repeat(64)},TypeError,'Frozen request must be immutable')
 if(boundary==='hydrate')assert.throws(()=>{factory(f.storage).getState().intent.request.idempotencyKey=f.other},TypeError,'Hydrated request must be immutable')
 if(boundary==='identity')assert.throws(()=>store.getState().rejectQuote(f.other),/requires recovery/,'Retirement must match the frozen token')
 if(boundary==='receipt'){
  store.setState({pendingReceipt:{idempotencyKey:f.token}})
  assert.throws(()=>store.getState().rejectQuote(f.token),/requires recovery/,'Retirement must preserve pending receipt recovery')
 }
 if(boundary==='recovery'){
  store.setState({recovery:{attemptId:f.token,reason:'Fixture'}})
  assert.throws(()=>store.getState().rejectQuote(f.token),/requires recovery/,'Retirement must preserve unresolved recovery')
 }
}
test('executed store mutations cannot replace issuance, frozen retry identity or recovery protections',async t=>{
 const path='frontend/src/store/checkoutIntentStore.ts',control=await checkoutCandidate(path)
 const cases=[
  ['issuance','idempotencyKey: issuedToken ?? uuid()','idempotencyKey: uuid()','Issued token must be preserved'],
  ['retry','if (get().intent) return get().intent!','if (false) return get().intent!','Retry must preserve'],
  ['freeze','const frozen = immutable(intent)','const frozen = intent','Frozen request must be immutable'],
  ['hydrate','? immutable(raw.intent) : null','? raw.intent : null','Hydrated request must be immutable'],
  ['identity','get().intent!.request.idempotencyKey !== attemptId','false','Retirement must match'],
  ['receipt','|| get().pendingReceipt || get().recovery','|| get().recovery','Retirement must preserve pending'],
  ['recovery','|| get().pendingReceipt || get().recovery','|| get().pendingReceipt','Retirement must preserve unresolved'],
 ]
 await t.test('reviewed store satisfies every boundary',()=>{for(const [boundary] of cases)verifyStoreBoundary(control.createCheckoutIntentStore,boundary)})
 for(const [boundary,from,to,reason] of cases)await t.test(boundary+' mutation is rejected for its semantic violation',async()=>{
  for(let form=0;form<3;form++){
   const mutant=await checkoutCandidate(path,from,to,form)
   assert.throws(()=>verifyStoreBoundary(mutant.createCheckoutIntentStore,boundary),error=>error instanceof assert.AssertionError&&error.message.includes(reason))
  }
 })
})
async function verifyRetirementBoundary(Service,boundary){
 const f=attemptFixture(),input={...f.request,idempotencyKey:f.token}
 const result=boundary==='sql'?{data:null,error:{code:'P0001',message:'V1_QUOTE_CHANGED'}}:
  {data:{outcome:'retired',code:'QUOTE_CHANGED',idempotencyKey:boundary==='identity'?f.other:f.token,...(boundary==='envelope'?{extra:true}:{})},error:null}
 const service=new Service({rpc:async()=>{if(boundary==='transport')throw Error('Lost committed outcome');return result}},{logger:{warn(){}}})
 await assert.rejects(()=>service.create(input),error=>error.status===503&&error.code==='CHECKOUT_UNAVAILABLE','Unproven retirement must not authorize replacement')
}
test('executed backend mutations cannot turn unproven outcomes into retirement authority',async t=>{
 const path='backend/server/services/ordersV1Service.js',control=await checkoutCandidate(path)
 const cases=[
  ['sql',"if (['V1_QUOTE_CHANGED', 'V1_QUOTE_REQUIRED', 'V1_ATTEMPT_UNAVAILABLE'].includes(error.message)) return unavailable()","if (['V1_QUOTE_CHANGED', 'V1_QUOTE_REQUIRED', 'V1_ATTEMPT_UNAVAILABLE'].includes(error.message)) return new CheckoutApiError(409, 'QUOTE_CHANGED', 'Unsafe mutation')"],
  ['identity','&& data.idempotencyKey === input.idempotencyKey','&& true'],
  ['envelope','Object.keys(data).length === 3','true'],
  ['transport',"catch { scopedQuote.diagnostic('rpc', 'create_order_transaction_v1_checked', 'TRANSPORT_FAILURE'); throw unavailable() }","catch { scopedQuote.diagnostic('rpc', 'create_order_transaction_v1_checked', 'TRANSPORT_FAILURE'); throw new CheckoutApiError(409, 'QUOTE_CHANGED', 'Unsafe mutation') }"],
 ]
 await t.test('reviewed service rejects every unproven outcome',async()=>{for(const [boundary] of cases)await verifyRetirementBoundary(control.OrdersV1Service,boundary)})
 for(const [boundary,from,to] of cases)await t.test(boundary+' mutation is rejected for unauthorized retirement',async()=>{
  for(let form=0;form<3;form++){
   const mutant=await checkoutCandidate(path,from,to,form)
   await assert.rejects(()=>verifyRetirementBoundary(mutant.OrdersV1Service,boundary),error=>error instanceof assert.AssertionError&&error.message.includes('Unproven retirement'))
  }
 })
})
async function verifyConfirmationBoundary(helper,boundary){
 const {CheckoutClientError}=await import('../../../frontend/src/services/checkoutClient.ts')
 if(boundary==='credential'){
  const quote=await issuedQuoteFixture()
  assert.equal(helper.quoteAcceptanceKey('inputs',{...quote,quoteFingerprint:undefined},'Cash on Delivery'),null,'Acceptance must validate the issued credential')
 }else{
  const code=boundary==='identity'?'IDEMPOTENCY_CONFLICT':'QUOTE_CHANGED',status=boundary==='status'?503:409
  assert.equal(helper.isDefinitiveQuoteRejection(new CheckoutClientError(code,'Fixture',status,boundary==='uncertain')),false,'Uncertain or nonterminal rejection must preserve the attempt')
 }
}
test('executed confirmation mutations cannot bypass credential or uncertain-retry checks',async t=>{
 const path='frontend/src/services/checkoutConfirmation.ts',control=await checkoutCandidate(path)
 const cases=[
  ['credential','!isCheckedQuote(quote)','!quote'],
  ['uncertain','!error.unknownOutcome','true'],
  ['status','error.status === 409','true'],
  ['identity',"['QUOTE_CHANGED', 'QUOTE_REQUIRED']","['QUOTE_CHANGED', 'QUOTE_REQUIRED', 'IDEMPOTENCY_CONFLICT']"],
 ]
 await t.test('reviewed helper rejects every invalid acceptance/replacement',async()=>{for(const [boundary] of cases)await verifyConfirmationBoundary(control,boundary)})
 for(const [boundary,from,to] of cases)await t.test(boundary+' mutation is rejected for its semantic violation',async()=>{
  for(let form=0;form<3;form++){
   const mutant=await checkoutCandidate(path,from,to,form)
   await assert.rejects(()=>verifyConfirmationBoundary(mutant,boundary),error=>error instanceof assert.AssertionError&&/Acceptance must validate|must preserve the attempt/.test(error.message))
  }
 })
})
test('canonicalization preserves non-line-ending bytes and rejects invalid or binary text',()=>{
 const sample=Buffer.from('A\r\nB\nC\r','utf8')
 assert.equal(canonicalProtectedText(sample),'A\nB\nC\r')
 for(const changed of [' A\nB\nC\r','A\nB\nC','A\nB\nC\r\n','\uFEFFA\nB\nC\r']){
  assert.notEqual(canonicalProtectedText(Buffer.from(changed,'utf8')),canonicalProtectedText(sample))
 }
 assert.throws(()=>canonicalProtectedText(Buffer.from([0xff])),assert.AssertionError)
 assert.throws(()=>canonicalProtectedText(Buffer.from([0])),assert.AssertionError)
})

// 408f039 intentionally added blog HTML/sitemap rewrites after the old CRLF hash
// checkpoint. Pin the complete reviewed configuration semantically: formatting
// and LF/CRLF may vary; destinations, route order and security headers may not.
// Local routing evidence: royal-fusion-blog-routing-20261011/verification-report.md.
// This protects preparation only. Deployment still needs approved backend flags,
// frontend document navigation, frontend project root and actual edge verification.
const backendOrigin='https://royal-fusion-3fd8.onbelmo.uk'
const blogScopes=['/blogs','/blogs/:path*','/blog-sitemap.xml']
const approvedFrontendRouting={
 rewrites:[
  {source:'/api/:path*',destination:backendOrigin+'/api/:path*'},
  ...blogScopes.map(source=>({source,destination:backendOrigin+source})),
  {source:'/(.*)',destination:'/'},
 ],
 headers:blogScopes.map(source=>({source,headers:[{key:'x-vercel-enable-rewrite-caching',value:'0'}]})),
}
const approvedLegacyRoot={rewrites:[{source:'/(.*)',destination:'/index.html'}]}
function verifyFrontendRouting(text){assert.deepEqual(JSON.parse(text),approvedFrontendRouting)}
function verifyRootRouting(text){if(text!==null)assert.deepEqual(JSON.parse(text),approvedLegacyRoot)}

test('committed frontend routing and local LF/CRLF forms preserve the exact reviewed routing contract',async()=>{
 const text=await readFile(new URL('../../../frontend/vercel.json',import.meta.url),'utf8')
 verifyFrontendRouting(text)
 const lf=text.replaceAll('\r\n','\n')
 verifyFrontendRouting(lf);verifyFrontendRouting(lf.replaceAll('\n','\r\n'))
})

test('routing guard rejects unsafe destinations, route precedence changes, public scope expansion and cache/security overrides',()=>{
 for(const change of [
  c=>c.rewrites[0].destination='https://untrusted.example.invalid/api/:path*',
  c=>c.rewrites[0].destination=backendOrigin+'/:path*',
  c=>c.rewrites[1].destination='http://royal-fusion-3fd8.onbelmo.uk/blogs',
  c=>c.rewrites[2].destination='https://royal-fusion-3fd8.onbelmo.uk@untrusted.example.invalid/blogs/:path*',
  c=>c.rewrites.unshift(c.rewrites.pop()),
  c=>c.rewrites[2].source='/blogs/:slug',
  c=>c.rewrites.splice(1,0,{source:'/admin/:path*',destination:backendOrigin+'/admin/:path*'}),
  c=>c.headers[0].headers[0].value='1',
  c=>c.headers.pop(),
  c=>c.headers.push({source:'/api/:path*',headers:[{key:'Cache-Control',value:'public, max-age=3600'}]}),
  c=>c.headers[1].headers.push({key:'Content-Security-Policy',value:"default-src * 'unsafe-inline'"}),
 ]){
  const changed=structuredClone(approvedFrontendRouting);change(changed)
  assert.throws(()=>verifyFrontendRouting(JSON.stringify(changed)),assert.AssertionError)
 }
})

test('tracked legacy root config or intentional local absence is accepted; altered root routing is rejected',async()=>{
 // HEAD still tracks this legacy SPA file. Accepting its exact semantics does not
 // approve its removal from Git or a repository-root production deployment.
 let text=null
 try{text=await readFile(new URL('../../../vercel.json',import.meta.url),'utf8')}
 catch(error){assert.equal(error.code,'ENOENT')}
 verifyRootRouting(text)
 const committedForm=JSON.stringify(approvedLegacyRoot,null,2)+'\n'
 verifyRootRouting(committedForm);verifyRootRouting(committedForm.replaceAll('\n','\r\n'));verifyRootRouting(null)
 assert.throws(()=>verifyRootRouting(JSON.stringify({rewrites:[{source:'/(.*)',destination:'https://untrusted.example.invalid'}]})),assert.AssertionError)
})
