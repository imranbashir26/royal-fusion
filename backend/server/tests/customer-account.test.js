import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import cookieParser from 'cookie-parser'
import { randomUUID } from 'node:crypto'
import { legacyAdminDatabase, applyRelease, sessionSqlClient } from './support/singleAdminDatabase.js'
import { createAuthRuntime } from '../auth/runtime.js'
import { createAuthConfig } from '../auth/config.js'
import { SupabaseSessionRepository } from '../services/sessionRepository.js'
import { createAuthV1Router } from '../routes/authV1.js'
import { createCustomerAccountV1Router } from '../routes/customerAccountV1.js'
import { createOrdersV1Router } from '../routes/ordersV1.js'
import { authErrorHandler, createAdminIdentity, requestContext } from '../middleware/authSecurity.js'

test('trusted customer HTTP cookies, own profile, verification, checkout identity and signout', async t => {
  const {db,admin,customer}=await legacyAdminDatabase(); t.after(()=>db.close())
  await applyRelease(db,'001_single_admin_expansion.sql',admin)
  const queries=[], sql=sessionSqlClient(db)
  const client={...sql,from(table){const wrap=q=>new Proxy(q,{get(target,key){const value=target[key];if(typeof value!=='function')return value;return (...args)=>{if(key==='eq')queries.push({table,key:args[0],value:args[1]});const result=value.apply(target,args);return result&&typeof result.select==='function'?wrap(result):result}}});return wrap(sql.from(table)) }}


  let verified=true, registrations=0
  const identity=()=>({id:customer,email:'customer@example.invalid',emailVerified:verified,assuranceLevel:'aal1'})
  const gateway={signUp:async()=>{registrations++;return {}},signIn:async()=>({identity:identity(),accessToken:'fixture-access',refreshToken:'fixture-refresh',accessExpiresAt:new Date(Date.now()+3600000).toISOString()}),
    verifyAccessToken:async()=>({identity:identity()}),signOut:async()=>{}}
  const config=createAuthConfig({NODE_ENV:'test',CUSTOMER_AUTH_PROVIDER:'supabase',ADMIN_AUTH_PROVIDER:'supabase',AUTH_CSRF_SECRET:'x'.repeat(40),CLIENT_ORIGIN:'http://localhost:5173',AUTH_CALLBACK_URL:'http://localhost/api/v1/auth/verify/callback'})
  const runtime=createAuthRuntime({config,gateway,repository:new SupabaseSessionRepository(client)})
  const app=express();app.use(express.json(),cookieParser(),requestContext)
  app.use('/api/v1/auth',createAuthV1Router(runtime))
  app.use('/api/v1/customer',createCustomerAccountV1Router(runtime))
  app.use('/api/v1',createOrdersV1Router(runtime,{logger:{warn(){}}}))
  app.get('/admin-fixture',createAdminIdentity(runtime),(_req,res)=>res.sendStatus(204))
  app.use(authErrorHandler(config))
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)))
  const jar={};const request=async(path,method='GET',body,csrf)=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{Origin:'http://localhost:5173',Cookie:Object.entries(jar).map(([k,v])=>`${k}=${v}`).join('; '),...(body?{'Content-Type':'application/json'}:{}),...(csrf?{'X-RF-CSRF':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})})
    for(const cookie of response.headers.getSetCookie()){const [key,value]=cookie.split(';')[0].split('=');if(value)jar[key]=value;else delete jar[key]}
    return {status:response.status,body:await response.json().catch(()=>null),response}
  }
  let session=await request('/api/v1/auth/session');assert.equal(session.body.data.authenticated,false)
  assert.equal((await request('/api/v1/customer/profile')).status,401)
  assert.equal((await request('/api/v1/auth/signup','POST',{email:'new@example.invalid',password:'StrongPass1!',fullName:'Fixture Customer',phone:''},session.body.data.csrfToken)).status,202);assert.equal(registrations,1)
  verified=false
  assert.equal((await request('/api/v1/auth/signin','POST',{email:'customer@example.invalid',password:'StrongPass1!'},session.body.data.csrfToken)).status,403)
  verified=true
  const signed=await request('/api/v1/auth/signin','POST',{email:'customer@example.invalid',password:'StrongPass1!'},session.body.data.csrfToken)
  assert.equal(signed.status,200);assert.ok(signed.response.headers.getSetCookie().some(v=>v.includes('HttpOnly')))
  assert.doesNotMatch(JSON.stringify(signed.body),/fixture-access|fixture-refresh|password/)
  session=await request('/api/v1/auth/session');assert.equal(session.body.data.identity.id,customer)
  const csrf=session.body.data.csrfToken
  assert.equal((await request('/admin-fixture')).status,403)
  const profile=await request('/api/v1/customer/profile');assert.equal(profile.body.data.id,customer)
  assert.equal((await request('/api/v1/customer/profile','PATCH',{name:'Updated Customer',phone:''})).status,403)
  assert.equal((await request('/api/v1/customer/profile','PATCH',{name:'Updated Customer',phone:'',id:admin},csrf)).status,400)
  assert.equal((await request('/api/v1/customer/profile','PATCH',{name:'Updated Customer',phone:'00000000000'},csrf)).body.data.name,'Updated Customer')
  assert.equal((await db.query('select full_name from public.profiles where id=$1',[customer])).rows[0].full_name,'Updated Customer')
  assert.equal((await db.query('select count(*)::int n from public.user_roles where user_id=$1',[customer])).rows[0].n,0)
  // The real quote service validates the cookie's UUID, never a browser customerId.
  const quote={items:[{variantId:randomUUID(),quantity:1}],shipping:{city:'Lahore',province:'Punjab'}}
  assert.equal((await request('/api/v1/checkout/quote','POST',{...quote,customerId:admin},csrf)).status,400)
  queries.length=0;await request('/api/v1/checkout/quote','POST',quote,csrf)
  assert.ok(queries.some(q=>q.table==='profiles'&&q.key==='id'&&q.value===customer));assert.ok(!queries.some(q=>q.value===admin))
  await db.query("update public.profiles set status='Inactive' where id=$1",[customer])
  assert.equal((await request('/api/v1/customer/profile')).status,403)
  assert.equal((await request('/api/v1/checkout/quote','POST',quote,csrf)).body.error.code,'CUSTOMER_UNAVAILABLE')
  await db.query("update public.profiles set status='Active' where id=$1",[customer])
  assert.equal((await request('/api/v1/auth/signout','POST',undefined,csrf)).status,204)
  assert.equal((await request('/api/v1/auth/session')).body.data.authenticated,false)
})
