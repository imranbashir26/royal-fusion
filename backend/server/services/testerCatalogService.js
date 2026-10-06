import { toProductColumns } from '../mappers/productAdminMapper.js'
import { ProductApiError, ProductAdminService } from './productAdminService.js'

const tables = ['tester_pack_components','tester_pack_allowed_variants']
export class TesterCatalogService {
  constructor(client,logger=console,{requestId}={}) { this.client=client; this.logger=logger; this.requestId=requestId }
  requireClient() { if(!this.client) throw new ProductApiError(503,'TESTER_SERVICE_UNAVAILABLE','Tester catalog is unavailable.'); return this.client }
  async read(table,filters,columns='*') {
    const large=filters.findIndex(([op,,v])=>op==='in' && v.length>100)
    if(large>=0) {
      const [op,key,values]=filters[large],rows=[]
      for(let offset=0;offset<values.length;offset+=100) {
        const next=[...filters];next[large]=[op,key,values.slice(offset,offset+100)]
        rows.push(...await this.read(table,next,columns))
      }
      return rows
    }
    const order=table==='tester_variants'?['variant_id']:table==='tester_packs'?['product_id']:tables.includes(table)?['pack_id','tester_variant_id']:['id']
    const rows=[]
    for(let offset=0;;offset+=500) {
      let q=this.requireClient().from(table).select(columns)
      for(const [op,k,v] of filters) q=q[op](k,v)
      for(const key of order) q=q.order(key,{ascending:true})
      const {data,error}=await q.range(offset,offset+499)
      if(error) throw this.failure(error,'read',table)
      rows.push(...data ?? [])
      if(!data || data.length<500) return rows
    }
  }
  async list({page=1,pageSize=25}={},isPublic=false) {
    let q=this.requireClient().from('products').select('*',{count:'exact'}).eq('commerce_kind','tester_pack')
    if(isPublic) q=q.eq('status','Published').eq('active',true)
    const {data,count,error}=await q.order('name',{ascending:true}).order('id',{ascending:true}).range((page-1)*pageSize,page*pageSize-1)
    if(error) throw this.failure(error,'list','products')
    const items=await this.hydrate(data ?? [],isPublic)
    return {items,page,pageSize,total:count ?? 0,totalPages:Math.ceil((count ?? 0)/pageSize)}
  }
  async get(id,isPublic=false) {
    const filters=[['eq','id',id],['eq','commerce_kind','tester_pack']]
    if(isPublic) filters.push(['eq','status','Published'],['eq','active',true])
    const rows=await this.read('products',filters)
    if(!rows.length) throw new ProductApiError(404,'TESTER_PACK_NOT_FOUND','Tester pack not found.')
    return (await this.hydrate(rows,isPublic))[0]
  }
  async testers() {
    const registry=await this.read('tester_variants',[])
    const ids=registry.map(r=>r.variant_id), products=registry.map(r=>r.tester_product_id)
    if(!ids.length) return []
    const [vs,ps]=await Promise.all([this.read('product_variants',[['in','id',ids]]),this.read('products',[['in','id',products],['eq','commerce_kind','tester']])])
    return registry.map(r=>option(r,vs.find(v=>v.id===r.variant_id),ps.find(p=>p.id===r.tester_product_id))).filter(Boolean)
  }
  async hydrate(products,isPublic) {
    if(!products.length) return []
    const ids=products.map(p=>p.id)
    const [defs,components,allowed]=await Promise.all([this.read('tester_packs',[['in','product_id',ids]]),...tables.map(t=>this.read(t,[['in','pack_id',ids]]))])
    const variantIds=[...new Set([...components,...allowed].map(m=>m.tester_variant_id))]
    const registry=variantIds.length?await this.read('tester_variants',[['in','variant_id',variantIds]]):[]
    const [vs,ps]=registry.length?await Promise.all([this.read('product_variants',[['in','id',variantIds]]),this.read('products',[['in','id',registry.map(r=>r.tester_product_id)],['eq','commerce_kind','tester']])]):[[],[]]
    const options=new Map(registry.map(r=>[r.variant_id,option(r,vs.find(v=>v.id===r.variant_id),ps.find(p=>p.id===r.tester_product_id))]))
    const [latestProducts,latestDefinitions]=await Promise.all([this.read('products',[['in','id',ids]],'id,catalog_revision,status,active,commerce_kind'),this.read('tester_packs',[['in','product_id',ids]])])
    if(products.some(p=>!latestProducts.some(n=>n.id===p.id && String(n.catalog_revision)===String(p.catalog_revision))) || defs.some(d=>!latestDefinitions.some(n=>n.product_id===d.product_id && n.definition_fingerprint===d.definition_fingerprint && String(n.definition_revision)===String(d.definition_revision)))) throw this.failure(null,'catalog_changed','tester_packs')
    return products.map(p=>{
      const d=defs.find(x=>x.product_id===p.id)
      if(!d) throw this.failure(null,'hydrate','tester_packs')
      const memberships=(d.mode==='fixed'?components:allowed).filter(m=>m.pack_id===p.id).sort((a,b)=>a.display_order-b.display_order || a.tester_variant_id.localeCompare(b.tester_variant_id))
      const complete=d.mode==='fixed' && memberships.length>0 && memberships.every(m=>options.get(m.tester_variant_id)?.publicEligible)
      const eligible=memberships.filter(m=>(d.mode==='fixed'||m.active) && options.get(m.tester_variant_id)?.publicEligible)
      const count=d.mode==='fixed'?(complete?Math.min(...memberships.map(m=>Math.floor(options.get(m.tester_variant_id).stockQuantity/m.quantity_per_pack))):0):null
      const available=Boolean(p.active && p.status==='Published' && d.manual_available && (d.mode==='fixed'?complete && count>0:eligible.some(m=>options.get(m.tester_variant_id).stockQuantity>=d.minimum_units) || eligible.reduce((n,m)=>n+options.get(m.tester_variant_id).stockQuantity,0)>=d.minimum_units))
      const visible=isPublic?(d.mode==='fixed'?(complete?memberships:[]):eligible):memberships
      return {id:p.id,packId:p.id,commerceKind:'tester_pack',name:p.name,slug:p.slug,sku:p.sku,image:p.main_image_url,gallery:p.gallery_urls,
        description:p.description,shortDescription:p.short_description,scentFamily:p.scent_family,categoryId:p.category_id,
        status:p.status,active:p.active,catalogRevision:String(p.catalog_revision),mode:d.mode,definitionRevision:String(d.definition_revision),
        minimumUnits:d.minimum_units,maximumUnits:d.maximum_units,fixedRegularPrice:numberOrNull(d.fixed_regular_price),fixedSalePrice:numberOrNull(d.fixed_sale_price),
        manualAvailable:d.manual_available,available,availablePackCount:count,purchasable:false,
        diagnostics:!isPublic?{structurallyComplete:d.mode==='fixed'?complete:eligible.length>0,hiddenOrInactiveCount:memberships.length-eligible.length}:undefined,
        components:d.mode==='fixed'?visible.map(m=>({...safeOption(options.get(m.tester_variant_id),isPublic),testerVariantId:m.tester_variant_id,quantityPerPack:m.quantity_per_pack,displayOrder:m.display_order})):[],
        allowedVariants:d.mode==='configurable'?visible.map(m=>({...safeOption(options.get(m.tester_variant_id),isPublic),testerVariantId:m.tester_variant_id,active:m.active,displayOrder:m.display_order})):[],
      }
    })
  }
  async save(id,input,actor) {
    const columns=toProductColumns(input.product)
    if(Object.hasOwn(input.product,'categoryId')) await new ProductAdminService(this.client,this.logger).assignCategory(columns,input.product.categoryId,id?(await this.get(id)).categoryId:null)
    if(columns.status==='Archived') columns.active=false
    if(columns.status==='Published') columns.active=true
    const {data,error}=await this.requireClient().rpc('save_tester_pack',{p_product_id:id,p_patch:columns,p_definition:input.definition,
      p_expected_revision:input.expectedRevision ?? null,p_expected_definition_revision:input.expectedDefinitionRevision ?? null,p_actor_id:actor.userId,p_request_id:actor.requestId})
    if(error) throw this.failure(error,'save','tester_packs',actor.requestId)
    return this.get(data.product.id)
  }
  failure(error,operation,subsystem,requestId=this.requestId) {
    const message=error?.message ?? ''
    if(error?.code==='42501' && message==='TESTER_PERMISSION_DENIED') return new ProductApiError(403,'PERMISSION_DENIED','Tester catalog access denied.')
    if(message.includes('CATALOG_STALE')) return new ProductApiError(409,'CATALOG_STALE','Catalog changed. Reopen before saving.')
    if(message.includes('NOT_FOUND')) return new ProductApiError(404,'TESTER_PACK_NOT_FOUND','Tester pack not found.')
    if(error?.code==='23505') return new ProductApiError(409,'CATALOG_CONFLICT','A slug, SKU, or membership already exists.')
    if(error?.code?.startsWith('22') || error?.code?.startsWith('23') || message.startsWith('TESTER_')) return new ProductApiError(400,'INVALID_REQUEST','Tester catalog fields or publication are invalid.')
    this.logger.error?.({event:'tester_catalog.failed',operation,subsystem,category:'RELATIONAL_FAILURE',requestId})
    return new ProductApiError(503,'TESTER_SERVICE_UNAVAILABLE','Tester catalog is unavailable.')
  }
}
function numberOrNull(n) { return n==null?null:Number(n) }
function option(r,v,p) {
  if(!v||!p||v.product_id!==r.tester_product_id) return null
  const regular=Number(v.regular_price),sale=numberOrNull(v.sale_price)
  const publicEligible=Boolean(Number(r.volume_ml)===5 && v.option_name==='Size' && v.option_value==='5 ml' && p.status==='Published' && p.active && v.active && r.manual_available===true && v.available && v.stock_quantity>0 && Number.isFinite(regular) && regular>0 && (sale===null||sale>0&&sale<regular))
  return {testerVariantId:v.id,productId:p.id,name:p.name,sku:v.sku,image:p.main_image_url,volumeMl:Number(r.volume_ml),regularPrice:regular,salePrice:sale,price:sale??regular,stockQuantity:v.stock_quantity,publicEligible,sourceProductId:r.source_product_id}
}
function safeOption(o,isPublic) { if(!o) return {unavailable:true}; if(!isPublic)return o; const {publicEligible,sourceProductId,...safe}=o; return safe }
