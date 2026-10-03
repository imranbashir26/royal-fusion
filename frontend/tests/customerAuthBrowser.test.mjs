import assert from 'node:assert/strict'
import test from 'node:test'
import { pageFixture, origin } from './support/variantBrowserHarness.mjs'

test('AccountModal ignores prototype storage and uses trusted customer session APIs', {timeout:90000},async t=>{
 const {page}=await pageFixture(t)
 let authenticated=false;const requests=[]
 const id='00000000-0000-4000-8000-000000000101'
 let profile={id,name:'Trusted Customer',email:'customer@example.invalid',phone:'',address:'',city:'',province:''}
 await page.context().addInitScript(()=>localStorage.setItem('royal-fusion-customer-auth',JSON.stringify({state:{currentCustomer:{id:'customer-spoof',name:'Spoof',email:'spoof@example.invalid',passwordHash:'fake'}}})))
 await page.context().route('**/api/v1/**',route=>{
  const path=new URL(route.request().url()).pathname;const method=route.request().method();requests.push({path,method,body:route.request().postDataJSON()})
  if(path.endsWith('/auth/session'))return route.fulfill({json:{data:{authenticated,csrfToken:'trusted-csrf',...(authenticated?{identity:{id,email:profile.email,emailVerified:true}}:{})}}})
  if(path.endsWith('/auth/signin')){authenticated=true;assert.equal(route.request().headers()['x-rf-csrf'],'trusted-csrf');return route.fulfill({json:{data:{authenticated:true}}})}
  if(path.endsWith('/auth/signup'))return route.fulfill({status:202,json:{data:{message:'Verify email'}}})
  if(path.endsWith('/auth/signout')){authenticated=false;return route.fulfill({status:204,body:''})}
  if(path.endsWith('/customer/profile')){if(method==='PATCH')profile={...profile,...route.request().postDataJSON()};return route.fulfill({json:{data:profile}})}
  return route.fulfill({status:403,json:{error:{code:'PERMISSION_DENIED'}}})
 })
 await page.goto(origin);await page.getByRole('button',{name:'Account',exact:true}).click()
 await page.getByRole('heading',{name:'Sign in to Royal Fusion'}).waitFor()
 await page.waitForFunction(()=>localStorage.getItem('royal-fusion-customer-auth')===null)
 assert.equal(await page.getByText('Spoof',{exact:true}).count(),0)
 await page.getByRole('button',{name:'Sign Up',exact:true}).click()
 const modal=page.getByLabel('Customer account')
 await modal.getByLabel(/^Full name/).fill('Trusted Customer')
 await modal.getByLabel(/^Email address/).fill(profile.email)
 await modal.getByLabel(/^Password/).fill('FictionalPass1!')
 await modal.getByLabel(/^Confirm Password/i).fill('FictionalPass1!')
 await modal.getByRole('button',{name:'Create Account',exact:true}).click()
 await page.getByText('Check your email to verify your account, then sign in.').waitFor()
 await modal.getByLabel(/^Email address/).fill(profile.email)
 await modal.getByLabel(/^Password/).fill('FictionalPass1!')
 await modal.locator('form').getByRole('button',{name:'Sign In',exact:true}).click()
 await page.getByRole('heading',{name:'Your Royal Profile'}).waitFor()
 await modal.getByLabel(/^Full name/).fill('Updated Customer')
 await modal.getByRole('button',{name:'Update Profile'}).click()
 await page.getByText('Profile updated successfully.').waitFor()
 await page.reload();await page.getByRole('button',{name:'Account',exact:true}).click()
 await page.getByRole('heading',{name:'Your Royal Profile'}).waitFor()
 assert.equal(await modal.getByLabel(/^Full name/).inputValue(),'Updated Customer')
 await modal.getByRole('button',{name:'Logout'}).click()
 await page.getByRole('heading',{name:'Sign in to Royal Fusion'}).waitFor()
 assert.ok(requests.some(r=>r.path.endsWith('/customer/profile')&&r.method==='PATCH'))
 assert.ok(!requests.some(r=>r.path.includes('/admin/users')))
 assert.equal(await page.evaluate(()=>localStorage.getItem('royal-fusion-customer-auth')),null)
})
