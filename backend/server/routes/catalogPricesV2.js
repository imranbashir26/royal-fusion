import {Router} from 'express'
import {z} from 'zod'
import {CatalogPricingService} from '../services/catalogPricingService.js'
import {ProductApiError} from '../services/productAdminService.js'

const query=z.object({ids:z.string().max(3699).transform(value=>value.split(',')).pipe(z.array(z.string().uuid().transform(id=>id.toLowerCase())).min(1).max(100).refine(ids=>new Set(ids).size===ids.length))}).strict()
export function createCatalogPricesV2Router(runtime,{client=runtime.repository.client}={}){
 const router=Router(),service=new CatalogPricingService(client)
 router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next()})
 router.get('/variant-prices',(req,res,next)=>{
  const parsed=query.safeParse(req.query)
  if(!parsed.success)return next(new ProductApiError(400,'INVALID_REQUEST','Provide one to 100 unique variant UUIDs.'))
  service.variants(parsed.data.ids).then(data=>res.json({data,meta:{requestId:req.requestId}})).catch(next)
 })
 router.use((error,req,res,next)=>{if(!(error instanceof ProductApiError))return next(error);res.status(error.status).json({error:{code:error.code,message:error.message,requestId:req.requestId}})})
 return router
}
