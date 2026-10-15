import {randomUUID} from 'node:crypto'
import {phase3SqlClient} from './phase3Database.js'
import {checkedFixture} from './checkedV1Database.js'
import {clientV2,quoteV2,quoteRequest} from './checkoutV2Database.js'
import {savePack,productPatch} from './testerCatalogDatabase.js'
// Use the full guarded owned PG17 baseline for both current quotation engines.
export async function phase3CheckoutDatabase(t){
 const f=await checkedFixture(t),{db}=f
 f.client={...phase3SqlClient(db),rpc:clientV2(db).rpc};f.actor=f.admin
 f.component=f.tester.product.id;f.variant=f.tester.tester.variant_id
 f.parentCategory=randomUUID();f.componentCategory=randomUUID()
 for(const [id,name] of [[f.parentCategory,'Parent'],[f.componentCategory,'Component']])await db.query('insert into categories(id,name,slug) values($1,$2,$3)',[id,name,id])
 await db.query('update products set category_id=$2 where id=$1',[f.component,f.componentCategory])
 await db.query('insert into product_categories(product_id,category_id) values($1,$2)',[f.component,f.componentCategory])
 const patch=productPatch({category_id:f.parentCategory});delete patch.price
 const fixed=await savePack(db,f.admin,null,patch,{mode:'fixed',fixedRegularPrice:450,components:[{testerVariantId:f.variant,quantityPerPack:2,displayOrder:0}]})
 f.parent=fixed.product.id
 f.quote=async(code,lines=[{kind:'fixed_tester_pack',packId:f.parent,definitionRevision:'1',quantity:1}])=>({...await quoteV2(db,{...quoteRequest(lines),couponCode:code}),orderingEnabled:false})
 return f
}
