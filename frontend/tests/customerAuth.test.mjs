import assert from 'node:assert/strict'
import test from 'node:test'
import { createCustomerAuthClient } from '../src/services/customerAuthClient.ts'
import { useCustomerAuthStore } from '../src/store/customerAuthStore.ts'
import { customerAuthClient } from '../src/services/customerAuthClient.ts'
const id='00000000-0000-4000-8000-000000000101'
const customer={id,name:'Trusted Customer',email:'customer@example.invalid',phone:'',address:'',city:'',province:''}
test('trusted client sends credentials and CSRF; signup/signin/restore/profile/logout',async()=>{
 let active=false;const calls=[]
 const client=createCustomerAuthClient(async(url,options)=>{
  calls.push({url,...options});assert.equal(options.credentials,'include')
  if(url.endsWith('/session'))return Response.json({data:{authenticated:active,csrfToken:'server-csrf',...(active?{identity:{id,emailVerified:true}}:{})}})
  if(url.endsWith('/signin')){active=true;return Response.json({data:{authenticated:true}})}
  if(url.endsWith('/signup'))return Response.json({data:{message:'Verify email'}},{status:202})
  if(url.endsWith('/signout')){active=false;return new Response(null,{status:204})}
  if(url.endsWith('/profile'))return Response.json({data:customer})
  assert.fail(url)
 },'/api')
 assert.equal(await client.restore(),null)
 await client.signUp({name:'Trusted Customer',email:customer.email,phone:'',password:'FictionalPass1!'})
 assert.equal((await client.signIn({identifier:customer.email,password:'FictionalPass1!'})).id,id)
 assert.equal((await client.restore()).id,id)
 await client.updateProfile({name:customer.name,phone:''});await client.logout()
 assert.equal(await client.restore(),null)
 for(const call of calls.filter(c=>c.method!=='GET'))assert.equal(call.headers['X-RF-CSRF'],'server-csrf')
 const patch=calls.find(c=>c.method==='PATCH');assert.deepEqual(JSON.parse(patch.body),{name:customer.name,phone:''})
})
test('client rejects unverified/customer-shaped admin sessions and profile ID substitution',async()=>{
 for(const session of [{authenticated:true,csrfToken:'x',identity:{id,emailVerified:false}},{authenticated:true,csrfToken:'x',identity:{id,emailVerified:true},administrator:{roleKey:'admin'}},{authenticated:true,csrfToken:'x',identity:{id:'customer-local',emailVerified:true}}]){
  const client=createCustomerAuthClient(async()=>Response.json({data:session}),'/api');await assert.rejects(client.restore())
 }
 const client=createCustomerAuthClient(async url=>Response.json({data:url.endsWith('/session')?{authenticated:true,csrfToken:'x',identity:{id,emailVerified:true}}:{...customer,id:'00000000-0000-4000-8000-000000000999'}}),'/api')
 await assert.rejects(client.restore())
})
test('old localStorage cannot authenticate; access failure and late restore cannot resurrect identity',async t=>{
 const original=customerAuthClient.restore,logout=customerAuthClient.logout;const removed=[]
 globalThis.window={localStorage:{removeItem:key=>removed.push(key),getItem:()=>JSON.stringify({currentCustomer:{id:'customer-spoof',passwordHash:'spoof'}})}}
 t.after(()=>{customerAuthClient.restore=original;customerAuthClient.logout=logout;delete globalThis.window;useCustomerAuthStore.setState({currentCustomer:null})})
 customerAuthClient.restore=async()=>null;await useCustomerAuthStore.getState().restoreSession()
 assert.equal(useCustomerAuthStore.getState().currentCustomer,null);assert.deepEqual(removed,['royal-fusion-customer-auth'])
 window.localStorage.removeItem=()=>{throw Error('Storage unavailable')};customerAuthClient.restore=async()=>customer
 await useCustomerAuthStore.getState().restoreSession();assert.equal(useCustomerAuthStore.getState().currentCustomer.id,id)
 customerAuthClient.restore=async()=>{throw Error('Server unavailable')};await assert.rejects(useCustomerAuthStore.getState().restoreSession());assert.equal(useCustomerAuthStore.getState().currentCustomer,null)
 let resolve;customerAuthClient.restore=()=>new Promise(r=>{resolve=r});customerAuthClient.logout=async()=>{}
 const pending=useCustomerAuthStore.getState().restoreSession();await useCustomerAuthStore.getState().logout();resolve(customer);await pending
 assert.equal(useCustomerAuthStore.getState().currentCustomer,null)
})
