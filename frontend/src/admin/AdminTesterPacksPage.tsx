import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useAdminAuth } from './AdminAuthProvider'
import { testerPacksApi } from '../services/testerPacksApi'
import { toPackPayload } from '../services/testerPackContract'
import type { PackDraft as Draft } from '../services/testerPackContract'
import type { TesterPack, TesterOption } from '../services/testerPacksApi'
import { productErrorMessage } from '../services/adminProductContract'
import {SaleScheduleFields} from './SaleScheduleFields'
import {formatCheckoutCurrency as formatCurrency} from '../utils/checkoutMoney'
import {useSaleSchedulingCapability} from '../services/saleSchedulingCapability'

const empty=():Draft=>({id:null,name:'',slug:'',sku:'',image:'',gallery:'',description:'',shortDescription:'',scentFamily:'Discovery',categoryId:'',status:'Draft',mode:'fixed',regular:'',sale:'',maximum:'',manualAvailable:true,members:[]})
const inputClass='w-full rounded border border-champagne/40 bg-white px-3 py-2'
export function AdminTesterPacksPage() {
 const {can}=useAdminAuth(), manage=can('products:manage')
 const scheduling=useSaleSchedulingCapability(manage)
 const [packs,setPacks]=useState<TesterPack[]>([]),[options,setOptions]=useState<TesterOption[]>([])
 const [draft,setDraft]=useState<Draft|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[page,setPage]=useState(1),[pages,setPages]=useState(1)
 useEffect(()=>{let alive=true; if(!can('products:read'))return; Promise.all([testerPacksApi.list(page),testerPacksApi.testers()]).then(([list,testers])=>{if(alive){setPacks(list.items);setPages(list.totalPages);setOptions(testers)}}).catch(e=>{if(alive)setError(productErrorMessage(e))});return()=>{alive=false}},[can,page])
 if(!can('products:read')) return <p>Permission required to view tester packs.</p>
 const change=(patch:Partial<Draft>)=>setDraft(d=>d?{...d,...patch}:d)
 const open=async(id:string)=>{setError('');setBusy(true);try {const p=await testerPacksApi.get(id);setDraft({id:p.id,name:p.name,slug:p.slug,sku:p.sku,image:p.image,gallery:p.gallery.join('\n'),description:p.description,shortDescription:p.shortDescription,scentFamily:p.scentFamily,categoryId:p.categoryId??'',status:p.status,mode:p.mode,regular:p.fixedRegularPrice?.toString()??'',sale:p.fixedSalePrice?.toString()??'',maximum:p.maximumUnits?.toString()??'',manualAvailable:p.manualAvailable,members:p.mode==='fixed'?p.components:p.allowedVariants,catalogRevision:p.catalogRevision,definitionRevision:p.definitionRevision,pricing:{regularPrice:p.fixedRegularPrice,salePrice:p.fixedSalePrice,saleStartsAt:p.fixedSaleStartsAt,saleEndsAt:p.fixedSaleEndsAt,effectivePrice:p.effectivePrice,saleActive:p.saleActive,pricingAt:p.pricingAt,validUntil:p.validUntil}})}catch(e){setError(productErrorMessage(e))}finally{setBusy(false)}}
 const refresh=async()=>{const list=await testerPacksApi.list(page);setPacks(list.items);setPages(list.totalPages)}
 const save=async(event:FormEvent)=>{event.preventDefault();if(!draft||!manage)return;setError('');setBusy(true);try{
  await testerPacksApi.save(draft.id,toPackPayload(draft))
  setDraft(null);await refresh()
 }catch(e){setError(productErrorMessage(e))}finally{setBusy(false)}}
 const archive=async(p:TesterPack)=>{if(!manage || !window.confirm(`Archive ${p.name}?`))return;setBusy(true);try{await testerPacksApi.archive(p);await refresh()}catch(e){setError(productErrorMessage(e))}finally{setBusy(false)}}
 return <section className="space-y-5">
  <div className="flex justify-between"><h1 className="font-serif text-3xl">Tester Packs</h1>{manage&&<button className={inputClass+' max-w-40'} disabled={busy} onClick={()=>{setError('');setDraft(empty())}}>Create pack</button>}</div>
  <p>Catalog foundation only. Pack purchasing remains unavailable. Inventory belongs to individual 5 ml testers.</p>
  {error&&<p role="alert" className="text-red-700">{error}</p>}
  <table className="w-full text-left"><thead><tr><th>Name</th><th>Mode</th><th>Status</th><th>Definition</th><th>Availability</th><th>Actions</th></tr></thead><tbody>{packs.map(p=><tr key={p.id}><td>{p.name}</td><td>{p.mode}</td><td>{p.status}</td><td>{p.definitionRevision}</td><td>{p.diagnostics.hiddenOrInactiveCount>0?`${p.diagnostics.hiddenOrInactiveCount} hidden/inactive; `:''}{p.available?'Available':'Unavailable'}{p.availablePackCount!=null?` (${p.availablePackCount})`:''}</td><td><button disabled={busy} onClick={()=>void open(p.id)}>{manage?'Edit':'View'}</button>{manage&&<button className="ml-4" disabled={busy||p.status==='Archived'} onClick={()=>void archive(p)}>Archive</button>}</td></tr>)}</tbody></table>
  <div className="flex gap-3"><button disabled={page<=1||busy} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page} of {Math.max(1,pages)}</span><button disabled={page>=pages||busy} onClick={()=>setPage(p=>p+1)}>Next</button></div>
  {draft&&<form onSubmit={e=>void save(e)} className="space-y-4 rounded border border-champagne/40 p-5">
   <h2 className="font-serif text-2xl">{draft.id?'Edit':'Create'} tester pack</h2>
   <fieldset disabled={!manage||busy} className="grid gap-4 md:grid-cols-2">
    {(['name','slug','sku','image','shortDescription','scentFamily','categoryId'] as const).map(k=><label key={k}>{k==='categoryId'?'Category UUID (optional)':k}<input className={inputClass} required={!['shortDescription','categoryId'].includes(k)} value={draft[k]} onChange={e=>change({[k]:e.target.value})}/></label>)}
    <label>Gallery HTTPS/root-relative URLs, one per line<textarea className={inputClass} value={draft.gallery} onChange={e=>change({gallery:e.target.value})}/></label>
    <label>Description<textarea className={inputClass} value={draft.description} onChange={e=>change({description:e.target.value})}/></label>
    <label>Mode<select className={inputClass} disabled={Boolean(draft.id)} value={draft.mode} onChange={e=>change({mode:e.target.value as Draft['mode'],members:[]})}><option value="fixed">Fixed</option><option value="configurable">Build your own</option></select></label>
    <label>Publication<select className={inputClass} value={draft.status} onChange={e=>change({status:e.target.value})}>{['Draft','Published','Unpublished','Archived'].map(s=><option key={s}>{s}</option>)}</select></label>
    <label><input type="checkbox" checked={draft.manualAvailable} onChange={e=>change({manualAvailable:e.target.checked})}/> Manually available</label>
    {draft.mode==='fixed'?<><label>Regular pack price<input className={inputClass} type="number" step="0.01" min="0.01" required value={draft.regular} onChange={e=>change({regular:e.target.value})}/></label><label>Sale price (optional)<input className={inputClass} type="number" step="0.01" min="0.01" value={draft.sale} onChange={e=>change({sale:e.target.value})}/></label></>:<><p>Minimum: 2 tester units. Prices come from selected tester variants.</p><label>Maximum tester units (blank = no business maximum)<input className={inputClass} type="number" min="2" step="1" value={draft.maximum} onChange={e=>change({maximum:e.target.value})}/></label></>}
   </fieldset>
   {draft.mode==='fixed'&&<SaleScheduleFields sale={draft.pricing??{regularPrice:Number(draft.regular)}} label="Fixed pack" enabled={scheduling&&!busy&&manage} edited={draft.scheduleEdits} onChange={patch=>change({scheduleEdits:{...draft.scheduleEdits,...patch}})}/>}
   <fieldset disabled={!manage||busy} className="space-y-3"><legend>Canonical 5 ml testers ({draft.members.length}/100)</legend><p>Component reference prices come from the database. Fixed pack charges use the independent pack price; configurable prices depend on selected tester quantities at checkout.</p>
    <select className={inputClass} value="" disabled={draft.members.length>=100} onChange={e=>{if(e.target.value)change({members:[...draft.members,{testerVariantId:e.target.value,quantityPerPack:1,active:true,displayOrder:Math.max(-1,...draft.members.map(m=>m.displayOrder))+1}]})}}><option value="">Add tester…</option>{options.filter(o=>!draft.members.some(m=>m.testerVariantId===o.testerVariantId)).map(o=><option key={o.testerVariantId} value={o.testerVariantId}>{o.name} — {o.sku} — {formatCurrency(o.effectivePrice ?? o.price)} — stock {o.stockQuantity}{o.publicEligible?'':' — unavailable'}</option>)}</select>
    {draft.members.map((m,i)=><div key={m.testerVariantId} className="flex flex-wrap items-center gap-3"><span>{options.find(o=>o.testerVariantId===m.testerVariantId)?.name??m.name??m.testerVariantId}</span>{options.find(o=>o.testerVariantId===m.testerVariantId)?.effectivePrice!=null&&<span className="text-sm">Reference unit price {formatCurrency(options.find(o=>o.testerVariantId===m.testerVariantId)!.effectivePrice!)}</span>}{draft.mode==='fixed'?<label>Units per pack<input className={inputClass+' max-w-24'} type="number" min="1" step="1" value={m.quantityPerPack??1} onChange={e=>change({members:draft.members.map((v,n)=>n===i?{...v,quantityPerPack:Number(e.target.value)}:v)})}/></label>:<label><input type="checkbox" checked={m.active??true} onChange={e=>change({members:draft.members.map((v,n)=>n===i?{...v,active:e.target.checked}:v)})}/> Active membership</label>}<button type="button" onClick={()=>change({members:draft.members.filter((_,n)=>n!==i)})}>Remove</button><button type="button" disabled={i===0} onClick={()=>{const members=[...draft.members];[members[i-1],members[i]]=[members[i],members[i-1]];change({members:members.map((m,n)=>({...m,displayOrder:n}))})}}>Move up</button></div>)}
   </fieldset>
   {draft.id&&<p>Catalog revision {draft.catalogRevision}; definition revision {draft.definitionRevision}. Stale edits require reopening.</p>}
   {manage&&<button disabled={busy} className={inputClass+' max-w-40'} type="submit">{busy?'Saving…':'Save pack'}</button>}<button disabled={busy} type="button" onClick={()=>setDraft(null)} className="ml-4">Close</button>
  </form>}
 </section>
}
