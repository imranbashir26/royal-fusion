import assert from 'node:assert/strict'
import test from 'node:test'
import {formatCheckoutCurrency} from '../src/utils/checkoutMoney.ts'
import {formatCurrency} from '../src/utils/format.ts'
import {createCheckoutClient,isCheckedQuote} from '../src/services/checkoutClient.ts'
import {quoteAcceptanceKey} from '../src/services/checkoutConfirmation.ts'
import {variantPrice} from '../src/services/productVariants.ts'

const display=value=>formatCheckoutCurrency(value).replaceAll('\u00a0',' ')
for(const [name,value,expected] of [
 ['whole regular price',2900,'Rs 2,900.00'],
 ['fractional payable total',3150.49,'Rs 3,150.49'],
 ['one paisa',0.01,'Rs 0.01'],
 ['binary representation boundary',0.29,'Rs 0.29'],
 ['one paisa below',3150.48,'Rs 3,150.48'],
 ['half rupee normalized value',3150.50,'Rs 3,150.50'],
 ['one paisa above',3150.51,'Rs 3,150.51'],
 ['maximum numeric(12,2) amount',9999999999.99,'Rs 9,999,999,999.99'],
 ['percentage discount already rounded by SQL',350.06,'Rs 350.06'],
 ['fixed coupon discount',100.49,'Rs 100.49'],
 ['fractional shipping',47.91,'Rs 47.91'],
 ['free shipping / zero discount',0,'Rs 0.00'],
 ['negative adjustment',-350.06,'-Rs 350.06'],
 ['standalone tester',250.49,'Rs 250.49'],
 ['fixed tester pack',425.49,'Rs 425.49'],
 ['configurable tester pack',975.39,'Rs 975.39'],
])test(name+' retains both PKR fractional digits',()=>assert.equal(display(value),expected))

test('standard and tester regular/sale estimates use the same precision without changing selection',()=>{
 for(const [regularPrice,salePrice,expected] of [[3600.99,null,'Rs 3,600.99'],[3600.99,3500.55,'Rs 3,500.55'],[250.49,null,'Rs 250.49'],[250.49,225.09,'Rs 225.09']]){
  const variant=Object.freeze({regularPrice,salePrice}),before=JSON.stringify(variant)
  assert.equal(display(variantPrice(variant)),expected);assert.equal(JSON.stringify(variant),before)
 }
 assert.equal(formatCurrency(3150.49).replaceAll('\u00a0',' '),'Rs 3,150')
})

test('pack display consumes quoted monetary snapshots without deriving component prices',()=>{
 // V2 remains a contract foundation; these are normalized quote snapshots,
 // not database evidence or a newly enabled pack purchasing interface.
 const fixed=Object.freeze({kind:'fixed_tester_pack',unitPrice:425.49,lineTotal:425.49,components:Object.freeze([{referenceUnitPrice:250.13,quantityPerPack:4}])})
 const configurable=Object.freeze({kind:'configurable_tester_pack',unitPrice:975.39,lineTotal:975.39,components:Object.freeze([{referenceUnitPrice:250.13,quantityPerPack:1},{referenceUnitPrice:362.63,quantityPerPack:2}])})
 for(const [line,expected] of [[fixed,'Rs 425.49'],[configurable,'Rs 975.39']]){
  const before=JSON.stringify(line)
  assert.equal(display(line.unitPrice),expected);assert.equal(display(line.lineTotal),expected);assert.equal(JSON.stringify(line),before)
 }
})

test('serialized fractional quotation retains exact accepted values and confirmation identity',async()=>{
 const quote=Object.freeze({idempotencyKey:'70000000-0000-4000-8000-000000000001',quoteFingerprint:'1'.repeat(64),subtotal:3500.55,discount:350.06,shippingFee:0,total:3150.49,currency:'PKR',shippingMethodId:'60000000-0000-4000-8000-000000000001',paymentMethods:['Cash on Delivery'],orderingEnabled:true})
 const expectedKey=JSON.stringify(['inputs',quote.quoteFingerprint,'Cash on Delivery',3500.55,350.06,0,3150.49,'PKR'])
 const client=createCheckoutClient(async url=>String(url).endsWith('/auth/session')?{ok:true,json:async()=>({data:{csrfToken:'fixture'}})}:{ok:true,json:async()=>JSON.parse(JSON.stringify({data:quote}))})
 const received=await client.quote({items:[{variantId:'b35b3be7-a7dd-4c70-9c14-d1a9394d4711',quantity:1}],shipping:{city:'Lahore',province:'Punjab'},email:'fixture@example.invalid',couponCode:'DISPLAY10'})
 assert.equal(isCheckedQuote(received),true);assert.deepEqual(received,quote)
 const before=JSON.stringify(received);assert.equal(quoteAcceptanceKey('inputs',received,'Cash on Delivery'),expectedKey)
 assert.deepEqual(['subtotal','discount','shippingFee','total'].map(key=>display(received[key])),['Rs 3,500.55','Rs 350.06','Rs 0.00','Rs 3,150.49'])
 assert.equal(JSON.stringify(received),before);assert.equal(quoteAcceptanceKey('inputs',received,'Cash on Delivery'),expectedKey)
})
