import assert from 'node:assert/strict'
import test from 'node:test'
import {pageFixture,storedCart,origin} from './support/variantBrowserHarness.mjs'
import {productId,variantId,productRow,variantRow,secondVariantId} from './variantFixtures.mjs'

test('Rendered selected-variant sales retain exact PKR prices and correct comparisons in detail, cart and wishlist', {timeout:90000},async t=>{
 const second={...variantRow,id:secondVariantId,option_value:'100 ml',regular_price:4900,sale_price:4000.75,display_order:1}
 const {page,catalog}=await pageFixture(t,{wishlist:true,products:[{...productRow,old_price:9999}],variants:[{...variantRow,sale_price:2450.25},second]})
 await page.setViewportSize({width:390,height:844})
 await page.goto(`${origin}/product/baraan`)
 await page.getByRole('button',{name:'50 ml',exact:true}).waitFor()
 assert.match(await page.locator('main').innerText(),/2,450\.25/)
 assert.match(await page.locator('main').innerText(),/16% off/)
 assert.doesNotMatch(await page.locator('main del').first().innerText(),/9,999/)
 await page.getByRole('button',{name:'100 ml',exact:true}).click()
 assert.match(await page.locator('main').innerText(),/4,000\.75/)
 assert.match(await page.locator('main del').first().innerText(),/4,900\.00/)
 await page.getByRole('button',{name:'Add to Cart',exact:true}).first().click()
 assert.equal((await storedCart(page)).state.items[0].variantId,secondVariantId)
 await page.getByRole('button',{name:'Close cart',exact:true}).click()
 await page.goto(`${origin}/cart`)
  await page.getByText(/Rs\s*4,000\.75/).first().waitFor()
 assert.match(await page.locator('main').innerText(),/4,000\.75/)
 await page.goto(`${origin}/wishlist`)
 await page.getByRole('button',{name:'Move',exact:true}).waitFor()
 assert.match(await page.locator('main').innerText(),/2,450\.25/)
 assert(catalog.priceReads.length>0)
 assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth),true)
})

test('A server boundary hides an unconfirmed discount on failure, then focus refresh accepts actual server pricing despite wall-clock skew', {timeout:90000},async t=>{
 const {page,catalog}=await pageFixture(t,{products:[productRow],variants:[{...variantRow,sale_price:2450.25}]})
 await page.addInitScript(()=>{Date.now=()=>4102444800000})
 const pricingAt=new Date().toISOString(),validUntil=new Date(Date.parse(pricingAt)+5000).toISOString()
 catalog.priceOverrides[variantId]={pricingAt,validUntil}
 await page.goto(`${origin}/__phase2/product/baraan`)
 await page.getByRole('button',{name:'50 ml',exact:true}).waitFor()
 assert.match(await page.locator('main').innerText(),/2,450\.25/)
 catalog.priceError=true
 await page.getByText('Pricing needs refresh',{exact:true}).waitFor({timeout:15000})
 assert.equal(await page.locator('main del').count(),0)
 assert.equal(await page.getByRole('button',{name:'Add to Cart',exact:true}).first().isDisabled(),true)
 catalog.priceError=false;catalog.priceOverrides[variantId]={effectivePrice:2900,price:2900,salePrice:null,saleActive:false,pricingAt:new Date().toISOString(),validUntil:null}
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
 await page.getByText(/Rs\s*2,900\.00/).first().waitFor()
 assert.equal(await page.locator('main del').count(),0)
 assert.equal(await page.getByRole('button',{name:'Add to Cart',exact:true}).first().isEnabled(),true)
 assert(catalog.priceReads.length<=5,'No unbounded refresh loop')
})

for(const outcome of ['success','failure'])test('Accepted discount expires while a manual HTTP refresh is unresolved: delayed '+outcome, {timeout:90000},async t=>{
 const lineId=JSON.stringify([productId,variantId])
 const saved={version:2,state:{items:[{lineId,productId,variantId,identity:'canonical',size:'50 ml',quantity:1}],selectedLineIds:[lineId]}}
 const {page,catalog}=await pageFixture(t,{legacy:saved,products:[productRow],variants:[{...variantRow,sale_price:2450.25}]})
 let release,started,reads=0
 const gate=new Promise(resolve=>release=resolve),pendingStarted=new Promise(resolve=>started=resolve)
 await page.route('**/api/v2/public/catalog/variant-prices?**',async route=>{
  reads++
  if(reads===1){
   const pricingAt=new Date().toISOString()
   catalog.priceOverrides[variantId]={pricingAt,validUntil:new Date(Date.parse(pricingAt)+8000).toISOString()}
   return route.fallback()
  }
  started();await gate
  if(outcome==='failure')return route.fulfill({status:503,json:{error:{code:'CATALOG_PRICING_UNAVAILABLE'}}})
  return route.fulfill({json:{data:{currency:'PKR',items:[{variantId,productId,regularPrice:2900,effectivePrice:2900,price:2900,salePrice:null,saleActive:false,pricingAt:new Date().toISOString(),validUntil:null}]}}})
 })
 try {
  await page.goto(`${origin}/__phase2/product/baraan`)
  await page.getByText(/Rs\s*2,450\.25/).first().waitFor()
  const before=await storedCart(page)
  await page.getByTestId('refresh').click();await pendingStarted
  assert.equal(await page.getByTestId('catalog').innerText(),'loading')
  await page.evaluate(()=>{
   window.dispatchEvent(new Event('focus'))
   Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'})
   document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.getByText('Pricing needs refresh',{exact:true}).waitFor({timeout:15000})
  assert.equal(reads,2,'Expiry and overlapping activity must deduplicate the pending HTTP request')
  assert.equal(await page.getByTestId('catalog').innerText(),'loading','Keep refreshing indication while HTTP is unresolved')
  assert.equal(await page.locator('main del').count(),0)
  assert.equal(await page.getByRole('button',{name:'Add to Cart',exact:true}).first().isDisabled(),true)
  assert.deepEqual(await storedCart(page),before,'Freshness must not mutate canonical saved cart identities or quantities')
  release()
  if(outcome==='success'){
   await page.getByText(/Rs\s*2,900\.00/).first().waitFor()
   assert.equal(await page.getByRole('button',{name:'Add to Cart',exact:true}).first().isEnabled(),true)
   assert.equal(await page.locator('main del').count(),0)
   assert.equal(reads,2)
  }else{
   await page.getByRole('button',{name:'Refresh pricing',exact:true}).waitFor()
   await page.waitForTimeout(3400) // Observe the single 1500 ms retry and a full potential extra interval.
   assert.equal(reads,3,'A delayed failed request permits one bounded retry')
   assert.equal(await page.locator('main del').count(),0)
   assert.equal(await page.getByText('Pricing needs refresh',{exact:true}).isVisible(),true)
  }
  assert.deepEqual(await storedCart(page),before)
 } finally { release() }
})

const adminFixture=()=>({session:{authenticated:true,csrfToken:'fixture-csrf',identity:{id:'actor',email:'admin@example.invalid',emailVerified:true},administrator:{userId:'actor',name:'Operator',role:'Admin',roleKey:'admin',permissions:['*']}}})
const start='2099-01-01T05:00:00.123456+05:00',end='2099-02-01T00:00:00.123456Z'

test('Admin draft detail shows authoritative pricing and disabled exact timestamp previews; immediate editing omits schedule/read-only fields', {timeout:90000},async t=>{
 const {page}=await pageFixture(t,{admin:adminFixture()});const writes=[]
 const dto={id:productId,commerceKind:'standard',name:'Baraan',slug:'baraan',sku:'RF-001',categoryId:null,category:'',image:'/favicon.svg',gallery:['/favicon.svg'],price:2900,salePrice:2450.25,oldPrice:null,stockQuantity:0,status:'Draft',scentFamily:'Woody',bottleSize:'50 ml',catalogRevision:'7',variations:[],notes:{top:[],middle:[],base:[]},variants:[{id:variantId,optionValue:'50 ml',regularPrice:2900,salePrice:2450.25,saleStartsAt:start,saleEndsAt:end,effectivePrice:2900,saleActive:false,pricingAt:'2026-10-15T00:00:00Z',validUntil:start,stockQuantity:0,available:false,active:false}]}
 await page.route('**/api/v1/admin/**',async route=>{
  const req=route.request(),url=new URL(req.url())
  if(url.pathname.includes('/products')){
   if(req.method()==='PUT'){writes.push(req.postDataJSON());return route.fulfill({json:{data:dto}})}
   return route.fulfill({json:{data:url.pathname.endsWith(productId)?dto:{items:[dto],page:1,pageSize:25,total:1,totalPages:1}}})
  }
  return route.fulfill({json:{data:{items:[],totalPages:0}}})
 })
 await page.goto(`${origin}/admin/products`)
 await page.getByRole('button',{name:'Edit',exact:true}).click()
 await page.getByRole('heading',{name:'Edit Product',exact:true}).waitFor()
 assert.equal(await page.getByLabel('Sale start (ISO timestamp with UTC offset)').inputValue(),start)
 assert.equal(await page.getByLabel('Sale end (ISO timestamp with UTC offset)').inputValue(),end)
 assert.equal(await page.getByLabel('Sale start (ISO timestamp with UTC offset)').isDisabled(),true)
 assert.equal(await page.getByText('Scheduled',{exact:true}).isVisible(),true)
 assert.match(await page.getByText('Effective price at database snapshot').locator('..').innerText(),/2,900\.00/)
 await page.getByLabel('Configured sale price (fixed amount)',{exact:true}).fill('2400.75')
 await page.getByRole('button',{name:'Save Record',exact:true}).click()
 await page.getByRole('heading',{name:'Edit Product',exact:true}).waitFor({state:'hidden'})
 assert.equal(writes.length,1);assert.equal(writes[0].salePrice,2400.75);assert.equal(writes[0].expectedRevision,'7')
 for(const field of ['variants','saleStartsAt','saleEndsAt','effectivePrice','pricingAt'])assert.equal(Object.hasOwn(writes[0],field),false)
})

test('Fixed pack administration displays its independent effective price and retains the 409 scheduling error', {timeout:90000},async t=>{
 const {page}=await pageFixture(t,{admin:adminFixture()})
 const pack={id:productId,name:'Discovery',slug:'discovery',sku:'RF-PACK',image:'/favicon.svg',gallery:[],description:'',shortDescription:'',scentFamily:'Woody',categoryId:null,status:'Draft',active:false,mode:'fixed',catalogRevision:'8',definitionRevision:'9',minimumUnits:null,maximumUnits:null,fixedRegularPrice:450,fixedSalePrice:400.25,fixedSaleStartsAt:start,fixedSaleEndsAt:end,effectivePrice:450,saleActive:false,pricingAt:'2026-10-15T00:00:00Z',validUntil:start,manualAvailable:true,available:false,availablePackCount:0,components:[{testerVariantId:variantId,quantityPerPack:2,displayOrder:0}],allowedVariants:[],diagnostics:{structurallyComplete:true,hiddenOrInactiveCount:1}}
 const option={testerVariantId:variantId,productId,name:'Tester',sku:'T1',price:250,effectivePrice:250,regularPrice:250,salePrice:200,saleActive:false,stockQuantity:0,publicEligible:false}
 const writes=[]
 await page.route('**/api/v2/admin/tester-packs**',async route=>{
  const req=route.request(),url=new URL(req.url())
  if(req.method()==='PATCH'){writes.push(req.postDataJSON());return route.fulfill({status:409,json:{error:{code:'SALE_SCHEDULING_DISABLED',message:'Disabled'}}})}
  const data=url.pathname.endsWith('/tester-options')?[option]:url.pathname.endsWith(productId)?pack:{items:[pack],totalPages:1}
  return route.fulfill({json:{data}})
 })
 await page.goto(`${origin}/admin/tester-packs`)
 await page.getByRole('button',{name:'Edit',exact:true}).click()
 assert.equal(await page.getByLabel('Sale start (ISO timestamp with UTC offset)').inputValue(),start)
 assert.match(await page.getByText('Effective price at database snapshot').locator('..').innerText(),/450\.00/)
 assert.equal(await page.getByText(/Reference unit price.*250\.00/).isVisible(),true)
 await page.getByRole('button',{name:'Save pack',exact:true}).click()
 await page.getByRole('alert').filter({hasText:/Scheduled-sale submissions are unavailable/}).waitFor()
 assert.equal(writes.length,1);assert.equal(writes[0].definition.fixedSalePrice,400.25)
 assert.equal('fixedSaleStartsAt' in writes[0].definition,false);assert.equal(writes[0].expectedDefinitionRevision,'9')
})
