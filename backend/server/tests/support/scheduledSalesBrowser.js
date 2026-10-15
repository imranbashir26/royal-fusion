import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {getSessionCsrfToken} from '../../auth/cookies.js'

// Real controls, capability/API clients and native persistence. Authentication uses
// the same approved native provider fixture as the HTTP security tests, not a
// hosted Supabase login. No successful API response is intercepted or fabricated.
export async function scheduledSalesBrowser(t, f) {
  const require = createRequire(import.meta.url), {createServer} = await import('vite')
  const {chromium} = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  const config = JSON.parse(fs.readFileSync(process.env.RF_RELEASE005_NATIVE_CONFIG, 'utf8'))
  const entry = `import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import{SaleScheduleFields}from'/src/admin/SaleScheduleFields.tsx';import{useSaleSchedulingCapability}from'/src/services/saleSchedulingCapability.ts';import{adminProductsApi}from'/src/services/adminProductsApi.ts';
    const h=React.createElement;const loaded=p=>({...p,variantEditBaseline:Object.fromEntries(['price','salePrice','stockQuantity','sku','bottleSize','variations'].map(k=>[k,p[k]]))});function App(){const enabled=useSaleSchedulingCapability();const[p,setP]=useState(null),[edits,setEdits]=useState({}),[error,setError]=useState('');useEffect(()=>{adminProductsApi.get('${f.normal.product}').then(v=>setP(loaded(v))).catch(e=>setError(e.message))},[]);if(!p)return h('p',null,error||'Loading');return h('form',{onSubmit:async e=>{e.preventDefault();try{await adminProductsApi.update(p.id,{...p,expectedRevision:p.catalogRevision,saleScheduleEdits:{[p.variants[0].id]:edits}});setP(loaded(await adminProductsApi.get(p.id)));setEdits({})}catch(e){setError(e.message)}}},...['price','stockQuantity','sku'].map(k=>h('label',{key:k},k,h('input',{value:p[k]??'',onChange:e=>setP(v=>({...v,[k]:k==='sku'?e.target.value:Number(e.target.value)}))}))),h(SaleScheduleFields,{sale:p.variants[0],label:'Native variant',enabled,edited:edits,onChange:patch=>setEdits(v=>({...v,...patch}))}),h('button',{type:'submit'},'Save verified schedule'),h('p',{role:'alert'},error));}createRoot(document.getElementById('root')).render(h(App));`
  const server = await createServer({root:path.join(root,'frontend'),envFile:false,configFile:false,logLevel:'error',cacheDir:path.join(config.cluster,'..','browser-vite-cache'),
    plugins:[{name:'owned-scheduled-admin',configureServer(v){v.middlewares.use(async(req,res,next)=>{if(!req.url.startsWith('/__scheduled'))return next();res.setHeader('Content-Type','text/html');res.end(await v.transformIndexHtml(req.url,'<div id="root"></div><script type="module" src="/@id/native-scheduled-admin"></script>'))})},resolveId(id){if(id==='native-scheduled-admin')return id},load(id){if(id==='native-scheduled-admin')return entry}}],
    define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:f.root,rewrite:value=>value.replace('/api/v1/admin/products','/products')}}}})
  await server.listen();t.after(()=>server.close())
  const origin='http://127.0.0.1:'+server.httpServer.address().port
  const browser=await chromium.launch({headless:true,channel:'chrome',timeout:15000});t.after(()=>browser.close())
  const context=await browser.newContext();t.after(()=>context.close())
  const csrf=getSessionCsrfToken('synthetic-handle',f.config)
  await context.addCookies(Object.entries({[f.names.access]:f.admin,[f.names.refresh]:'refresh',[f.names.session]:'synthetic-handle',[f.names.csrf]:csrf}).map(([name,value])=>({name,value,url:origin})))
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort())
  const page=await context.newPage();await page.goto(origin+'/__scheduled')
  const start=page.getByLabel('Sale start (ISO timestamp with UTC offset)'),end=page.getByLabel('Sale end (ISO timestamp with UTC offset)')
  await start.waitFor();await page.getByLabel('Scheduled sale price (PKR fixed amount)').waitFor()
  assert.equal(await start.isEnabled(),true)
  const unrelated=(await f.db.query('select to_jsonb(v) value from product_variants v where id<>$1 order by id',[f.normal.variant])).rows
  await page.getByLabel('price',{exact:true}).fill('3300');await page.getByLabel('stockQuantity',{exact:true}).fill('5');await page.getByLabel('sku',{exact:true}).fill('RF-CHANGED')
  await page.getByLabel('Scheduled sale price (PKR fixed amount)').fill('2450.25');await start.fill('2099-01-01T05:00:00.123456+05:00');await end.fill('2099-02-01T00:00:00.654321Z')
  await page.getByRole('button',{name:'Save verified schedule',exact:true}).click();await page.getByText('Scheduled',{exact:true}).waitFor()
  const saved=(await f.http('/products/'+f.normal.product,{actor:f.admin})).body.data
  assert.equal(saved.variants[0].salePrice,2450.25);assert.deepEqual([saved.variants[0].regularPrice,saved.variants[0].stockQuantity,saved.variants[0].sku],[3300,5,'RF-CHANGED'])
  assert.deepEqual((await f.db.query('select to_jsonb(v) value from product_variants v where id<>$1 order by id',[f.normal.variant])).rows,unrelated)
  assert.equal(await start.inputValue(),saved.variants[0].saleStartsAt)
  await page.getByRole('button',{name:'Clear sale and schedule',exact:true}).click();await page.getByRole('button',{name:'Save verified schedule',exact:true}).click();await page.getByText('Inactive',{exact:true}).waitFor()
  const cleared=(await f.http('/products/'+f.normal.product,{actor:f.admin})).body.data.variants[0]
  assert.deepEqual([cleared.salePrice,cleared.saleStartsAt,cleared.saleEndsAt],[null,null,null])
  assert.equal(await page.getByRole('alert').innerText(),'')
}
