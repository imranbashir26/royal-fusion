import { Router } from 'express'
import { z } from 'zod'
import { createAdminIdentity,createOriginGuard,requireAuthenticatedCsrf,sendCode } from '../middleware/authSecurity.js'
import { AUTH_ERROR_CODES } from '../auth/contracts.js'
import { ProductApiError } from '../services/productAdminService.js'
import { TesterCatalogService } from '../services/testerCatalogService.js'
import {createSaleSchedulingPolicy} from '../services/saleSchedulingPolicy.js'
import { createPackSchema,updatePackSchema,archivePackSchema,listPacksSchema,boundedCatalogPayload } from '../schemas/testerCatalog.js'

export function createTesterPacksV2Router(runtime,{client=runtime.repository.client,logger=console,publicOnly=false,saleScheduling=createSaleSchedulingPolicy(client)}={}) {
 const router=Router(), service=req=>new TesterCatalogService(client,logger,{requestId:req.requestId,saleScheduling})
 router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next()})
 if(!publicOnly) router.use(createAdminIdentity(runtime))
 const permit=key=>(req,res,next)=>publicOnly || req.administrator.permissions.some(p=>p==='*'||p===key)?next():sendCode(res,AUTH_ERROR_CODES.PERMISSION_DENIED,req.requestId)
 const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next)
 const parse=(schema,value)=>{ const r=schema.safeParse(value);if(!r.success)throw new ProductApiError(400,'INVALID_REQUEST','Tester catalog request is invalid.');return r.data }
 const response=(req,res,data,status=200)=>res.status(status).json({data,meta:{requestId:req.requestId}})
 const id=req=>parse(z.string().uuid(),req.params.packId)
 router.get('/',permit('products.read'),wrap(async(req,res)=>response(req,res,await service(req).list(parse(listPacksSchema,req.query),publicOnly))))
 if(!publicOnly) router.get('/tester-options',permit('products.read'),wrap(async(req,res)=>response(req,res,await service(req).testers())))
 router.get('/:packId',permit('products.read'),wrap(async(req,res)=>response(req,res,await service(req).get(id(req),publicOnly))))
 if(!publicOnly) {
  const origin=createOriginGuard(runtime.config),csrf=requireAuthenticatedCsrf(runtime.config)
  const bound=(req,_res,next)=>{if(!boundedCatalogPayload(req.body))return next(new ProductApiError(413,'REQUEST_TOO_LARGE','Catalog request exceeds 32 KiB.'));next()}
  const actor=req=>({userId:req.administrator.userId,requestId:req.requestId})
  router.post('/',permit('products.manage'),origin,csrf,bound,wrap(async(req,res)=>response(req,res,await service(req).save(null,parse(createPackSchema,req.body),actor(req)),201)))
  router.patch('/:packId',permit('products.manage'),origin,csrf,bound,wrap(async(req,res)=>response(req,res,await service(req).save(id(req),parse(updatePackSchema,req.body),actor(req)))))
  router.post('/:packId/archive',permit('products.manage'),origin,csrf,bound,wrap(async(req,res)=>{
   const revisions=parse(archivePackSchema,req.body)
   response(req,res,await service(req).save(id(req),{...revisions,product:{status:'Archived',active:false},definition:{}},actor(req)))
  }))
 }
 router.use((error,req,res,next)=>{if(!(error instanceof ProductApiError))return next(error);res.status(error.status).json({error:{code:error.code,message:error.message,requestId:req.requestId}})})
 return router
}
