import {Router} from 'express'
import rateLimit from 'express-rate-limit'
import {createOptionalIdentity,createOriginGuard,requireAuthenticatedCsrf,sendCode} from '../middleware/authSecurity.js'
import {AUTH_ERROR_CODES} from '../auth/contracts.js'
import {CheckoutApiError} from '../services/checkoutQuoteService.js'
import {CheckoutQuoteV2Service} from '../services/checkoutQuoteV2Service.js'
import {OrdersV2Service} from '../services/ordersV2Service.js'
export function createOrdersV2Router(runtime,{client=runtime.repository.client,logger=console,quoteLimit=60,orderLimit=20,allowNonProductionOrders=false}={}){
 const router=Router(),quote=new CheckoutQuoteV2Service(client,{logger}),orders=new OrdersV2Service(client,{logger,environment:runtime.config.environment,allowNonProductionOrders})
 const limiter=(limit,windowMs)=>rateLimit({limit,windowMs,standardHeaders:true,legacyHeaders:false,
  handler:(req,res)=>res.status(429).json({error:{code:'CHECKOUT_RATE_LIMITED',message:'Please wait before trying checkout again.',requestId:req.requestId}})})
 router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next()})
 router.use(createOriginGuard(runtime.config),createOptionalIdentity(runtime),(req,res,next)=>{
  if(req.auth?.record.sessionClass!==undefined&&req.auth.record.sessionClass!=='customer')return sendCode(res,AUTH_ERROR_CODES.PERMISSION_DENIED,req.requestId)
  if(req.auth)return requireAuthenticatedCsrf(runtime.config)(req,res,next)
  next()
 },(req,_res,next)=>{
  if(!req.is('application/json'))return next(new CheckoutApiError(400,'INVALID_CHECKOUT_REQUEST','Please check your checkout information.'))
  next()
 })
 const run=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next)
 router.post('/checkout/quote',limiter(quoteLimit,60000),run(async(req,res)=>{
  const data=await quote.withRequestId(req.requestId).quote(req.body,req.auth?.identity.id??null)
  res.json({data:{...data,orderingEnabled:orders.policy.orderingEnabled},meta:{requestId:req.requestId}})
 }))
 router.post('/orders',limiter(orderLimit,900000),run(async(req,res)=>{
  const data=await orders.create(req.body,req.auth?.identity.id??null,req.requestId)
  res.status(data.idempotent?200:201).json({data,meta:{requestId:req.requestId}})
 }))
 router.use((error,req,res,next)=>{
  if(Object.values(AUTH_ERROR_CODES).includes(error.code))return next(error)
  const known=error instanceof CheckoutApiError||typeof error.code==='string'&&error.code.startsWith('INVALID_')
  logger.warn?.({event:'checkout.request_failed',requestId:req.requestId,operation:'request',subsystem:'orders_v2',category:known?error.code:'UNEXPECTED_FAILURE'})
  res.status(known?error.status:500).json({error:{code:known?error.code:'CHECKOUT_FAILED',message:known?error.message:'Checkout could not be completed.',requestId:req.requestId}})
 })
 return router
}
