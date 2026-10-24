import assert from 'node:assert/strict'
import test from 'node:test'
import {randomUUID} from 'node:crypto'
import {fixtureV2,normalLine,fixedLine,configuredLine,quoteRequest,quoteV2,requestV2,orderV2,applyV2} from './support/checkoutV2Database.js'
import {orderV2Schema,quoteV2Schema,parseV2} from '../schemas/ordersV2.js'
const canonical=async(db,request,order=false)=>(await db.query('select public.checkout_v2_canonical($1::jsonb,null,$2) c',[JSON.stringify(request),order])).rows[0].c

test('line/selection limits, raw duplicate caps, positive integer and revision validation agree in schema and SQL',async t=>{
 const f=await fixtureV2();t.after(()=>f.db.close());const {db}=f
 const hundred=Array.from({length:100},()=>normalLine(randomUUID()))
 assert.equal((await canonical(db,quoteRequest(hundred)))[1].length,100)
 for(const lines of [[...hundred,normalLine(randomUUID())],[configuredLine(f,Array.from({length:101},()=>({variantId:f.tester.tester.variant_id,quantityPerPack:1})))],
  [fixedLine(f,0)],[fixedLine(f,2147483648)],[{...fixedLine(f),definitionRevision:'01'}],[{...fixedLine(f),definitionRevision:'9223372036854775808'}],
  [configuredLine(f,[{variantId:f.tester.tester.variant_id,quantityPerPack:2147483647},{variantId:f.tester.tester.variant_id,quantityPerPack:1}])]]) {
  const q=quoteRequest(lines);assert.throws(()=>parseV2(quoteV2Schema,q));await assert.rejects(()=>canonical(db,q),/V2_INVALID_REQUEST|V2_LIMIT_EXCEEDED/)
 }
 const duplicates=configuredLine(f,Array.from({length:100},()=>({variantId:f.tester.tester.variant_id,quantityPerPack:1})))
 const c=await canonical(db,quoteRequest([duplicates]));assert.equal(c[1][0].selections.length,1);assert.equal(c[1][0].selections[0].quantityPerPack,100)
 await assert.rejects(()=>quoteV2(db,quoteRequest([fixedLine(f,2147483647)])),/V2_LIMIT_EXCEEDED/)
 await db.query('update public.product_variants set regular_price=9999999999.99 where id=$1',[f.tester.tester.variant_id])
 await assert.rejects(()=>quoteV2(db,quoteRequest([configuredLine(f)])),/V2_LIMIT_EXCEEDED/)
})

test('canonical UTF-8 request accepts exactly 32768 bytes and rejects 32769 including multibyte text',async t=>{
 const f=await fixtureV2();t.after(()=>f.db.close());const {db}=f
 const selections=Array.from({length:100},()=>({variantId:randomUUID(),quantityPerPack:1}))
 const base={contractVersion:2,idempotencyKey:randomUUID(),lines:[],contact:{name:'Fixture Customer',email:'fixture@example.invalid',phone:'00000000000'},shipping:{address:'Fictional Address',city:'Karachi',province:'Sindh',notes:''},paymentMethod:'Cash on Delivery',couponCode:'',quoteFingerprint:'0'.repeat(64)}
 let boundary
 for(let n=0;n<=50;n++) {
  base.lines=[{...configuredLine(f,selections),packId:randomUUID()},{...configuredLine(f,selections),packId:randomUUID()},...Array.from({length:n},()=>normalLine(randomUUID()))]
  let c;try{c=await canonical(db,base,true)}catch{break}
  const bytes=(await db.query('select octet_length(public.checkout_v2_compact($1::jsonb)) n',[JSON.stringify(c)])).rows[0].n
  if(32768-bytes>=0&&32768-bytes<=1000){boundary=structuredClone(base);boundary.shipping.notes='A'.repeat(32768-bytes);break}
 }
 assert.ok(boundary,'fixture can reach exact boundary within legitimate field lengths')
 const c=await canonical(db,boundary,true);assert.equal((await db.query('select octet_length(public.checkout_v2_compact($1::jsonb)) n',[JSON.stringify(c)])).rows[0].n,32768)
 assert.doesNotThrow(()=>parseV2(orderV2Schema,boundary))
 boundary.shipping.notes+='A';await assert.rejects(()=>canonical(db,boundary,true),/V2_LIMIT_EXCEEDED/)
 boundary.shipping.notes=boundary.shipping.notes.slice(0,-3)+'é';assert.equal((await canonical(db,boundary,true))[4][3].endsWith('é'),true)
 boundary.shipping.notes+='é';await assert.rejects(()=>canonical(db,boundary,true),/V2_LIMIT_EXCEEDED/)
})

test('real resolver/order boundary: 100 normal lines and 2000 frozen component rows, 2001 rejected',async t=>{
 const f=await fixtureV2();t.after(()=>f.db.close());const {db}=f
 // Owner-only synthetic catalog setup, atomic and validated by the unchanged 012 triggers.
 await db.exec(`begin;
 insert into public.products(id,name,slug,sku,price,scent_family,main_image_url,status,active,commerce_kind,bottle_size)
 select md5('limit-product-'||n)::uuid,'Limit tester '||n,'limit-tester-'||n,'LT-'||n,250,'Woody','/fixture.webp','Published',true,'tester','5 ml' from generate_series(1,100) n;
 insert into public.product_variants(id,product_id,option_name,option_value,sku,regular_price,stock_quantity)
 select md5('limit-variant-'||n)::uuid,md5('limit-product-'||n)::uuid,'Size','5 ml','LTV-'||n,250,100 from generate_series(1,100) n;
 insert into public.tester_variants(variant_id,tester_product_id) select md5('limit-variant-'||n)::uuid,md5('limit-product-'||n)::uuid from generate_series(1,100) n;
 insert into public.products(id,name,slug,sku,price,scent_family,main_image_url,status,active,commerce_kind)
 select md5('limit-pack-'||n)::uuid,'Limit pack '||n,'limit-pack-'||n,'LP-'||n,null,'Woody','/fixture.webp','Published',true,'tester_pack' from generate_series(1,21) n;
 insert into public.tester_packs(product_id,mode,fixed_regular_price,definition_fingerprint)
 select md5('limit-pack-'||n)::uuid,'fixed',500,repeat('0',64) from generate_series(1,21) n;
 insert into public.tester_pack_components(pack_id,tester_variant_id,quantity_per_pack,display_order)
 select md5('limit-pack-'||p)::uuid,md5('limit-variant-'||v)::uuid,1,v-1 from generate_series(1,21) p cross join generate_series(1,100) v;
 update public.tester_packs set definition_fingerprint=public.tester_pack_definition_hash(product_id) where product_id in(select md5('limit-pack-'||n)::uuid from generate_series(1,21) n);
 commit;`)
 const variants=(await db.query("select id from public.product_variants where sku like 'LTV-%' order by id")).rows.map(v=>v.id)
 const hundred=variants.map(v=>normalLine(v));assert.equal((await quoteV2(db,quoteRequest(hundred))).lines.length,100)
 const normals=await orderV2(db,await requestV2(db,hundred));assert.equal(normals.lines.length,100)
 const packs=(await db.query("select product_id,definition_revision::text from public.tester_packs where product_id in(select md5('limit-pack-'||n)::uuid from generate_series(1,21) n) order by product_id")).rows
 const line=p=>({kind:'fixed_tester_pack',packId:p.product_id,definitionRevision:p.definition_revision,quantity:1})
 const lines=packs.slice(0,20).map(line),q=await quoteV2(db,quoteRequest(lines))
 assert.equal(q.lines.reduce((n,l)=>n+l.components.length,0),2000)
 const receipt=await orderV2(db,await requestV2(db,lines));assert.equal((await db.query('select count(*)::int n from public.order_item_components where order_id=$1',[receipt.id])).rows[0].n,2000)
 // The 21st pack is reduced to one component through a valid definition edit,
 // yielding precisely 2001 rows instead of merely testing a much larger excess.
 const extra=packs[20]
 await db.exec('begin')
 await db.query('delete from public.tester_pack_components where pack_id=$1 and tester_variant_id<>$2',[extra.product_id,variants[0]])
 await db.query('update public.tester_packs set definition_revision=definition_revision+1,definition_fingerprint=public.tester_pack_definition_hash(product_id) where product_id=$1',[extra.product_id])
 await db.exec('commit');extra.definition_revision=String(BigInt(extra.definition_revision)+1n)
 await assert.rejects(()=>quoteV2(db,quoteRequest([...lines,line(extra)])),/V2_LIMIT_EXCEEDED/)
 await applyV2(db,'CRLF')
})
