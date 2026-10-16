import assert from 'node:assert/strict'
import test from 'node:test'
import {pageFixture,origin} from './support/variantBrowserHarness.mjs'
import {productId,variantId} from './variantFixtures.mjs'
const couponId='90000000-0000-4000-8000-000000000001',lineId=JSON.stringify([productId,variantId])
const cart=()=>({version:2,state:{items:[{lineId,productId,variantId,identity:'canonical',size:'50 ml',quantity:1}],selectedLineIds:[lineId]}})
function fixture(kind){
 const applied=kind==='applied',none=kind==='not_requested',subtotal=applied?1000:900,discount=applied?200:0
 return {amounts:{subtotal,discount,shippingFee:250,total:subtotal-discount+250},selectedLines:[{variantId,quantity:1,unitPrice:subtotal,lineTotal:subtotal}],pricingOutcome:{policy:'GLOBAL_PERCENTAGE_V1',strategy:applied?'COUPON':'SALE',regularSubtotal:1000,saleSubtotal:900,couponDiscount:none?0:applied?200:kind==='sale_better'?50:100,couponSubtotal:none?null:applied?800:kind==='sale_better'?950:900,merchandiseTotal:subtotal-discount,requestedCouponCode:none?'':'ROYAL10',appliedCouponId:applied?couponId:null,appliedCouponCode:applied?'ROYAL10':null,couponOutcome:kind}}
}
async function fill(page){for(const [label,value]of [['Full Name','Fixture Customer'],['Email','fixture@example.invalid'],['Phone','00000000000'],['Address','Fixture address'],['City','Karachi'],['Province / Region','Sindh']])await page.getByLabel(label,{exact:true}).fill(value);await page.waitForFunction(()=>!document.querySelector('main form input[type="checkbox"]')?.disabled)}
for(const [kind,message]of [['applied','Coupon applied to regular prices.'],['sale_better','Existing sale prices provide a lower merchandise total; coupon not used.'],['tie','Totals are equal; sale pricing retained and coupon not used.']])test('HTTP-fixture browser: '+kind+' selected quote and frozen success display',{timeout:60000},async t=>{
 const checkout=fixture(kind),{page,orders}=await pageFixture(t,{legacy:cart(),checkout});await page.goto(origin+'/checkout');await page.getByLabel('Coupon code',{exact:true}).fill('ROYAL10');await fill(page)
 await page.getByText(message,{exact:true}).waitFor();const prices=page.getByRole('list',{name:'Quoted item charges'});await prices.waitFor();assert.match(await prices.innerText(),kind==='applied'?/1,000.00/:/900.00/);assert.doesNotMatch(await page.locator('aside').innerText(),/Catalog estimate/)
 assert.equal(await page.getByText('Applied coupon: ROYAL10',{exact:true}).count(),kind==='applied'?1:0)
 await page.getByRole('checkbox',{name:/I confirm the quoted total/}).check();await page.getByRole('button',{name:'Place Order',exact:true}).click();await page.getByRole('heading',{name:/Thank you/}).waitFor()
 await page.getByRole('list',{name:'Frozen item charges'}).waitFor();await page.getByText(message,{exact:true}).waitFor();assert.equal(orders.length,1);assert(!('total'in orders[0]));assert(!('unitPrice'in orders[0].items[0]))
 const stored=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('royal-fusion-checkout-intent-v1')).completion.receipt);assert.deepEqual(stored.lines.map(({id,...line})=>line),checkout.selectedLines);assert.equal(stored.total,checkout.amounts.total)
 await page.reload();await page.getByRole('list',{name:'Frozen item charges'}).waitFor();assert.equal(orders.length,1)
})
test('HTTP-fixture browser: changing/removing coupon requires new confirmation',{timeout:60000},async t=>{
 const checkout=fixture('applied'),{page}=await pageFixture(t,{legacy:cart(),checkout});await page.goto(origin+'/checkout');await page.getByLabel('Coupon code',{exact:true}).fill('ROYAL10');await fill(page);const box=page.getByRole('checkbox',{name:/I confirm the quoted total/});await box.check();assert(await box.isChecked())
 checkout.pricingOutcome=fixture('not_requested').pricingOutcome;checkout.amounts=fixture('not_requested').amounts;checkout.selectedLines=fixture('not_requested').selectedLines
 await page.getByRole('button',{name:'Remove coupon',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('main form input[type="checkbox"]')?.disabled);assert.equal(await box.isChecked(),false);assert(await page.getByRole('button',{name:'Place Order',exact:true}).isDisabled())
})
test('HTTP-fixture browser: invalid coupon is explicit and removal obtains a valid new quote',{timeout:60000},async t=>{
 const checkout={...fixture('not_requested'),invalidCoupon:true},{page}=await pageFixture(t,{legacy:cart(),checkout});await page.goto(origin+'/checkout');await page.getByLabel('Coupon code',{exact:true}).fill('INVALID');
 for(const [label,value]of [['City','Karachi'],['Province / Region','Sindh']])await page.getByLabel(label,{exact:true}).fill(value)
 await page.getByRole('alert').filter({hasText:'This coupon cannot be applied'}).waitFor();assert.equal(await page.getByText(/Coupon applied to regular prices/).count(),0)
 await page.getByRole('button',{name:'Remove coupon',exact:true}).click();await page.getByRole('list',{name:'Quoted item charges'}).waitFor();assert.equal(await page.getByRole('alert').count(),0)
})
