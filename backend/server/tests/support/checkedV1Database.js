import {readFile} from 'node:fs/promises'
import {nativeFixture} from './release005NativeFixture.js'
import {applyV2,clientV2} from './checkoutV2Database.js'
import {apply014} from './fulfillmentV2Database.js'
import {apply005} from './post014DefaultAclHardening.js'
import {testerFixture} from './testerCatalogDatabase.js'
import {CheckoutQuoteService} from '../../services/checkoutQuoteService.js'

async function release(db,name){
 try{await db.exec(await readFile(new URL('../../../supabase/release-migrations/'+name,import.meta.url),'utf8'))}
 catch(error){await db.exec('rollback');throw error}
}
export async function installCheckedV1(db,{pre013=false}={}){
 if(pre013){await applyV2(db);await apply014(db)}
 await apply005(db)
 await release(db,'006_standard_variant_availability.sql')
 // Exact PG17 schema, defaults and ACL guards remain enabled and unmodified.
 await release(db,'007_checked_v1_checkout.sql')
 await release(db,'008_durable_checkout_attempts.sql')
}
export async function checkedFixture(t,{historical=false}={}){
 const db=await nativeFixture(t,{pre013:historical})
 const admin=(await db.query('select user_id from public.user_roles limit 1')).rows[0].user_id
 const f={db,admin,normal:{product:'45852db8-8b83-425e-8d1f-4112958ed505',variant:'b35b3be7-a7dd-4c70-9c14-d1a9394d4711'}}
 if(historical)return f
 await installCheckedV1(db)
 await db.exec("insert into public.shipping_methods(code,name,base_fee) values('checked-fixture','Fixture',250)")
 await db.exec(`insert into public.site_settings(id,payments) values('site','[{"name":"Cash on Delivery","active":true},{"name":"Bank Transfer","active":true}]') on conflict(id) do update set payments=excluded.payments`)
 f.tester=await testerFixture(db,admin)
 return f
}
export async function confirmV1(db,input,customer=null){
 const quoted=await new CheckoutQuoteService(clientV2(db),{logger:{warn(){}}}).quote({items:input.items,
  shipping:{city:input.shipping.city,province:input.shipping.province},email:input.contact.email,couponCode:input.couponCode},customer)
 return {...input,idempotencyKey:quoted.idempotencyKey,quoteFingerprint:quoted.quoteFingerprint}
}
