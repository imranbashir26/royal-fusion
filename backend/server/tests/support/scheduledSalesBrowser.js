import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {getSessionCsrfToken} from '../../auth/cookies.js'

export function scheduledSalesDiagnostics(t){
  const started=performance.now(),active=new Map();let sequence=0
  const category=error=>error?.name==='TimeoutError'?'TIMEOUT':error?.name==='AbortError'?'CANCELLED':'OPERATION_FAILED'
  function record(stage,event,fields={}){
    console.log('RF_SCHEDULED_DIAGNOSTIC '+JSON.stringify({utc:new Date().toISOString(),elapsedMs:Math.round((performance.now()-started)*1000)/1000,stage,event,...fields}))
  }
  function begin(stage){
    const id=++sequence,at=performance.now();active.set(id,stage);record(stage,'begin',{id})
    return (event='complete',fields={})=>{active.delete(id);record(stage,event,{id,durationMs:Math.round((performance.now()-at)*1000)/1000,...fields})}
  }
  async function stage(name,work){
    const end=begin(name)
    try{const value=await work();end();return value}catch(error){end('failed',{category:category(error)});throw error}
  }
  const observed=Object.create(t)
  observed.after=fn=>t.after(function(...args){return stage('database.cleanup',()=>fn.apply(this,args))})
  record('scenario','started',{freeMemoryMiB:Math.round(os.freemem()/1024/1024)})
  t.signal.addEventListener('abort',()=>record('scenario','abort-observed',{activeStages:[...active.values()]}),{once:true})
  return {record,begin,stage,context:observed,category}
}

// Real controls, capability/API clients and native persistence. Authentication uses
// the same approved native provider fixture as the HTTP security tests, not a
// hosted Supabase login. No successful API response is intercepted or fabricated.
export async function scheduledSalesBrowser(t, f, diagnostic) {
  const stage=diagnostic.stage,require=createRequire(import.meta.url)
  const {createServer}=await stage('vite.import',()=>import('vite'))
  const {chromium}=await stage('playwright.import',()=>{
    const playwright=require('playwright')
    if(!fs.existsSync(playwright.chromium.executablePath()))throw Error('Managed Chromium is missing. Run: npm exec --workspace backend --no -- playwright install chromium --no-shell')
    return playwright
  })
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  const config = JSON.parse(fs.readFileSync(process.env.RF_RELEASE005_NATIVE_CONFIG, 'utf8'))
  const entry = `import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import{SaleScheduleFields}from'/src/admin/SaleScheduleFields.tsx';import{useSaleSchedulingCapability}from'/src/services/saleSchedulingCapability.ts';import{adminProductsApi}from'/src/services/adminProductsApi.ts';
    const h=React.createElement;const loaded=p=>({...p,variantEditBaseline:Object.fromEntries(['price','salePrice','stockQuantity','sku','bottleSize','variations'].map(k=>[k,p[k]]))});function App(){const enabled=useSaleSchedulingCapability();const[p,setP]=useState(null),[edits,setEdits]=useState({}),[error,setError]=useState('');useEffect(()=>{adminProductsApi.get('${f.normal.product}').then(v=>setP(loaded(v))).catch(e=>setError(e.message))},[]);if(!p)return h('p',null,error||'Loading');return h('form',{onSubmit:async e=>{e.preventDefault();try{await adminProductsApi.update(p.id,{...p,expectedRevision:p.catalogRevision,saleScheduleEdits:{[p.variants[0].id]:edits}});setP(loaded(await adminProductsApi.get(p.id)));setEdits({})}catch(e){setError(e.message)}}},...['price','stockQuantity','sku'].map(k=>h('label',{key:k},k,h('input',{value:p[k]??'',onChange:e=>setP(v=>({...v,[k]:k==='sku'?e.target.value:Number(e.target.value)}))}))),h(SaleScheduleFields,{sale:p.variants[0],label:'Native variant',enabled,edited:edits,onChange:patch=>setEdits(v=>({...v,...patch}))}),h('button',{type:'submit'},'Save verified schedule'),h('p',{role:'alert'},error));}createRoot(document.getElementById('root')).render(h(App));`
  const server = await stage('vite.create',()=>createServer({root:path.join(root,'frontend'),envFile:false,configFile:false,logLevel:'error',cacheDir:path.join(config.cluster,'..','browser-vite-cache'),
    plugins:[{name:'owned-scheduled-admin',configureServer(v){v.middlewares.use(async(req,res,next)=>{if(!req.url.startsWith('/__scheduled'))return next();res.setHeader('Content-Type','text/html');res.end(await v.transformIndexHtml(req.url,'<div id="root"></div><script type="module" src="/@id/native-scheduled-admin"></script>'))})},resolveId(id){if(id==='native-scheduled-admin')return id},load(id){if(id==='native-scheduled-admin')return entry}}],
    define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:f.root,rewrite:value=>value.replace('/api/v1/admin/products','/products')}}}}))
  await stage('vite.listen',()=>server.listen());t.after(()=>stage('vite.cleanup',()=>server.close()))
  const origin='http://127.0.0.1:'+server.httpServer.address().port
  const browser=await stage('chrome.launch',()=>chromium.launch({headless:true,channel:'chromium',timeout:15000}));t.after(()=>stage('chrome.cleanup',()=>browser.close()))
  diagnostic.record('browser','launched',{channel:'chromium',version:browser.version()})
  browser.on('disconnected',()=>diagnostic.record('chrome','disconnected'))
  const context=await stage('browser.context',()=>browser.newContext());t.after(()=>stage('browser.context.cleanup',()=>context.close()))
  const csrf=getSessionCsrfToken('synthetic-handle',f.config)
  await stage('browser.synthetic-session',()=>context.addCookies(Object.entries({[f.names.access]:f.admin,[f.names.refresh]:'refresh',[f.names.session]:'synthetic-handle',[f.names.csrf]:csrf}).map(([name,value])=>({name,value,url:origin}))))
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort())
  const page=await stage('browser.page',()=>context.newPage())
  const requests=new WeakMap()
  const operation=request=>{const url=new URL(request.url());return url.origin!==origin?'blocked.external':url.pathname==='/__scheduled'?'frontend.document':url.pathname==='/api/v1/admin/products/sale-capabilities'?'api.capability':url.pathname==='/api/v1/admin/products/'+f.normal.product?'api.product':'frontend.asset'}
  page.on('request',request=>{const label=operation(request);if(label==='frontend.asset')return;requests.set(request,{label,at:performance.now()});diagnostic.record(label,'request',{method:['GET','PUT'].includes(request.method())?request.method():'OTHER'})})
  page.on('response',response=>{const request=response.request(),entry=requests.get(request);if(!entry)return;const id=response.headers()['x-request-id'];diagnostic.record(entry.label,'response',{status:response.status(),durationMs:Math.round(performance.now()-entry.at),...(/^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id??'')?{requestId:id}:{})})})
  page.on('requestfailed',request=>{const entry=requests.get(request);if(entry)diagnostic.record(entry.label,'failed',{category:'NETWORK_FAILED',durationMs:Math.round(performance.now()-entry.at)})})
  page.on('pageerror',()=>diagnostic.record('frontend','failed',{category:'PAGE_ERROR'}))
  page.on('crash',()=>diagnostic.record('browser.page','failed',{category:'PAGE_CRASH'}))
  await stage('browser.navigation',()=>page.goto(origin+'/__scheduled'))
  diagnostic.record('frontend.document','available')
  const start=page.getByLabel('Sale start (ISO timestamp with UTC offset)'),end=page.getByLabel('Sale end (ISO timestamp with UTC offset)')
  await stage('controls.start',()=>start.waitFor());await stage('controls.capability',()=>page.getByLabel('Scheduled sale price (PKR fixed amount)').waitFor())
  assert.equal(await start.isEnabled(),true)
  const unrelated=(await stage('database.baseline',()=>f.db.query('select to_jsonb(v) value from product_variants v where id<>$1 order by id',[f.normal.variant]))).rows
  await stage('controls.price',()=>page.getByLabel('price',{exact:true}).fill('3300'));await stage('controls.stock',()=>page.getByLabel('stockQuantity',{exact:true}).fill('5'));await stage('controls.sku',()=>page.getByLabel('sku',{exact:true}).fill('RF-CHANGED'))
  await stage('controls.sale-price',()=>page.getByLabel('Scheduled sale price (PKR fixed amount)').fill('2450.25'));await stage('controls.sale-start',()=>start.fill('2099-01-01T05:00:00.123456+05:00'));await stage('controls.sale-end',()=>end.fill('2099-02-01T00:00:00.654321Z'))
  await stage('schedule.submit',()=>page.getByRole('button',{name:'Save verified schedule',exact:true}).click());await stage('schedule.ui-scheduled',()=>page.getByText('Scheduled',{exact:true}).waitFor())
  const saved=(await stage('database.saved-read',()=>f.http('/products/'+f.normal.product,{actor:f.admin}))).body.data
  const verified=diagnostic.begin('database.saved-verify')
  assert.equal(saved.variants[0].salePrice,2450.25);assert.deepEqual([saved.variants[0].regularPrice,saved.variants[0].stockQuantity,saved.variants[0].sku],[3300,5,'RF-CHANGED'])
  assert.deepEqual((await f.db.query('select to_jsonb(v) value from product_variants v where id<>$1 order by id',[f.normal.variant])).rows,unrelated)
  assert.equal(await start.inputValue(),saved.variants[0].saleStartsAt);verified()
  await stage('schedule.clear',()=>page.getByRole('button',{name:'Clear sale and schedule',exact:true}).click());await stage('schedule.clear-submit',()=>page.getByRole('button',{name:'Save verified schedule',exact:true}).click());await stage('schedule.ui-inactive',()=>page.getByText('Inactive',{exact:true}).waitFor())
  const cleared=(await stage('database.cleared-read',()=>f.http('/products/'+f.normal.product,{actor:f.admin}))).body.data.variants[0]
  const finalVerified=diagnostic.begin('database.cleared-verify')
  assert.deepEqual([cleared.salePrice,cleared.saleStartsAt,cleared.saleEndsAt],[null,null,null])
  assert.equal(await page.getByRole('alert').innerText(),'');finalVerified()
}
