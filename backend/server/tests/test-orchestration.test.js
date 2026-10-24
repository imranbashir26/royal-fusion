import assert from 'node:assert/strict'
import test from 'node:test'
import {verifySelection,prerequisites,runChild} from '../scripts/test-backend.mjs'
import {tapTotals,nativeGroups} from '../scripts/backend-test-selection.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {runOwnedNativeCommand,OwnedCommandError} from '../scripts/owned-native-command.mjs'
test('required selection is exhaustive and unique; retirement and checked API are mandatory',()=>{
 assert.equal(verifySelection().length,52)
 for(const file of ['checkout-retirement-native.test.js','checked-v1-native.test.js','checked-v1-api-native.test.js','scheduled-sales-native.test.js','scheduled-sales-api-native.test.js'])assert.ok(nativeGroups.acceptance.includes(file))
})
test('a skipped, cancelled, empty or failed summary cannot report PASS',()=>{
 for(const counts of [[0,0,0,0,0],[2,1,0,1,0],[2,1,0,0,1],[2,1,1,0,0]]){
  const text=['tests','pass','fail','skipped','cancelled'].map((key,i)=>'# '+key+' '+counts[i]).join('\n')
  assert.throws(()=>tapTotals(text),/Incomplete or failed/)
 }
 assert.equal(tapTotals('# tests 2\n# pass 2\n# fail 0\n# skipped 0\n# cancelled 0').pass,2)
})
test('missing native binaries fail before starting a database',()=>assert.throws(()=>prerequisites({'pg-bin':'missing-owned-postgresql-binaries'}),/Missing PostgreSQL executable/))
test('actual intentionally failed child test propagates a nonzero failure',async()=>{
 const code="const {test}=require('node:test');const assert=require('node:assert/strict');test('intentional infrastructure failure',()=>assert.equal(1,2))"
 await assert.rejects(()=>runChild(['-e',code],{quiet:true,failFast:false}),/Child verification failed/)
})

test('real owned native process lifecycle and containment; stop at first failure',{timeout:240000},async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rf-owned-lifecycle-'))
 const work=path.join(directory,'working directory with spaces');fs.mkdirSync(work)
 const runtime=path.join(directory,'runtime with spaces')
 fs.symlinkSync(path.dirname(process.execPath),runtime,process.platform==='win32'?'junction':'dir')
 const executable=path.join(runtime,path.basename(process.execPath)),fixture=path.join(directory,'fixture with spaces.mjs')
 fs.writeFileSync(fixture,`
import fs from 'node:fs';import{spawn}from'node:child_process';import{fileURLToPath}from'node:url';
const [mode,record,...args]=process.argv.slice(2);
const publish=(file,value)=>{const pending=file+'.'+process.pid+'.pending';fs.writeFileSync(pending,JSON.stringify(value));fs.renameSync(pending,file);};
const waitFor=async file=>{const deadline=performance.now()+15000;while(!fs.existsSync(file)){if(performance.now()>deadline)throw Error('Fixture barrier deadline exceeded');await new Promise(r=>setTimeout(r,20));}};
if(mode==='success'){console.log(JSON.stringify({args,cwd:process.cwd(),environment:process.env.RF_OWNED_FIXTURE}));console.error('fixture stderr');}
else if(mode==='failure'){console.log('original stdout');console.error('original nonzero diagnostic');process.exitCode=7;}
else if(mode==='leaf'||mode==='finishing-leaf'){
 process.on('SIGTERM',()=>{});const hold=setInterval(()=>{},1000);publish(record,{pid:process.pid});
 if(mode==='finishing-leaf'){await waitFor(record+'.finish');clearInterval(hold);publish(record+'.completed',{pid:process.pid});}
}
else{
 const parentFirst=mode==='orphan'||mode==='parent-first';
 // Windows detached mode skips libuv's parent-owned kill-on-close job. It does
 // not request CREATE_BREAKAWAY_FROM_JOB. POSIX children retain our group.
 const child=spawn(process.execPath,[fileURLToPath(import.meta.url),mode==='parent-first'?'finishing-leaf':'leaf',record+'-child'],{stdio:'ignore',windowsHide:true,detached:process.platform==='win32'&&parentFirst});
 child.once('error',error=>{console.error('Fixture spawn failed: '+error.code);process.exit(2);});
 await waitFor(record+'-child');process.on('SIGTERM',()=>{});setInterval(()=>{},1000);
 publish(record,{pid:process.pid,child:child.pid});console.log('owned root ready');
 if(parentFirst){await waitFor(record+'.exit');process.exit(0);}
}
`)
 const delay=ms=>new Promise(r=>setTimeout(r,ms))
 const isAlive=pid=>{try{process.kill(pid,0);return true}catch(e){if(e.code==='ESRCH')return false;throw e}}
 async function until(check,message){const end=performance.now()+15000;while(!check()){if(performance.now()>end)throw Error(message);await delay(20)}}
 const runs=[]
 const launch=(mode,name,options={})=>{
  const record=path.join(directory,name+'.ready'),output=path.join(directory,name)
  const abort=new AbortController(),signal=options.signal?AbortSignal.any([abort.signal,options.signal]):abort.signal
  const run={record,rootPid:null,rootExit:null,abort:()=>abort.abort()}
  const promise=runOwnedNativeCommand({file:executable,args:[fixture,mode,record],cwd:work,output,timeoutMs:30000,...options,signal,
   onStarted:event=>{run.rootPid=event.pid;options.onStarted?.(event)},onRootExit:event=>{run.rootExit=event;options.onRootExit?.(event)}})
   .then(result=>({result}),error=>({error}))
  run.promise=promise;runs.push(run);return run
 }
 async function ready(run){await until(()=>fs.existsSync(run.record),'Owned fixture did not become ready');return JSON.parse(fs.readFileSync(run.record))}
 async function gone(...ids){await until(()=>ids.every(pid=>!isAlive(pid)),'Owned fixture process survived cleanup')}
 function failure(outcome,kind){
  assert.ok(outcome.error,'Expected '+kind+' error; actual supervisor result: '+JSON.stringify(outcome.result))
  assert.ok(outcome.error instanceof OwnedCommandError,'Expected OwnedCommandError; actual: '+String(outcome.error))
  assert.equal(outcome.error.result.kind,kind);return outcome.error.result
 }
 function release(file){const pending=file+'.pending';fs.writeFileSync(pending,'release',{flag:'wx'});fs.renameSync(pending,file)}
 async function parentExitedWithActiveChild(run,pids){
  await until(()=>run.rootPid!==null,'Supervisor did not identify the root')
  assert.equal(run.rootPid,pids.pid);assert.equal(JSON.parse(fs.readFileSync(run.record+'-child')).pid,pids.child)
  assert.equal(isAlive(pids.pid),true);assert.equal(isAlive(pids.child),true)
  release(run.record+'.exit')
  await until(()=>!isAlive(pids.pid),'Root did not exit after its barrier was released')
  await until(()=>run.rootExit!==null,'Supervisor did not report root exit')
  assert.equal(run.rootExit.exitCode,0);assert.equal(isAlive(pids.child),true,'Descendant must survive its parent')
  if(process.platform==='win32'){
   assert.ok(run.rootExit.activePids.includes(pids.child),'Surviving descendant must belong to the outer supervisor job')
   assert.ok(run.rootExit.activeProcessCount>0)
  }else assert.equal(run.rootExit.processGroupActive,true)
 }
 function drained(result){
  assert.equal(result.containmentVerified,true);assert.equal(result.cleanupComplete,true);assert.deepEqual(result.remainingPids,[])
  if(process.platform==='win32')assert.equal(result.finalActiveProcessCount,0)
  else assert.equal(result.finalProcessGroupActive,false)
 }
 async function scenario(name,run){let passed=false;await t.test(name,async()=>{await run();passed=true});if(!passed)throw Error('Critical owned-process verification failed: '+name)}
 try{
  await scenario('success preserves executable/argument spaces, quoting, empty arguments, cwd, environment and both logs',async()=>{
   const args=['spaced value','a"b','ends-with-slash\\','',String.raw`quoted\"value`]
   const r=await runOwnedNativeCommand({file:executable,args:[fixture,'success','unused',...args],cwd:work,env:{...process.env,RF_OWNED_FIXTURE:'disposable fixture'},output:path.join(directory,'success'),timeoutMs:30000})
   const value=JSON.parse(r.stdout.trim());assert.deepEqual(value.args,args);assert.equal(value.cwd,work);assert.equal(value.environment,'disposable fixture');assert.match(r.stderr,/fixture stderr/)
   assert.equal(r.kind,'success');assert.equal(r.exitCode,0);assert.equal(r.terminationRequested,false);drained(r);await gone(...r.observedPids)
  })
  await scenario('immediate nonzero exit retains its original failure and diagnostic logs',async()=>{
   const r=failure(await launch('failure','nonzero').promise,'exit_nonzero')
   assert.equal(r.kind,'exit_nonzero');assert.equal(r.exitCode,7);assert.equal(r.cleanupComplete,true);assert.match(r.stdout,/original stdout/);assert.match(r.stderr,/original nonzero diagnostic/);await gone(...r.observedPids)
  })
  await scenario('timeout terminates the owned root and real descendant',async()=>{
   const run=launch('tree','timeout',{timeoutMs:10000}),pids=await ready(run),r=failure(await run.promise,'timeout')
   assert.equal(r.timedOut,true);assert.equal(r.terminationRequested,true);drained(r);assert.match(r.stdout,/owned root ready/);await gone(pids.pid,pids.child)
   if(process.platform==='win32')assert.ok(r.observedPids.includes(pids.child),'The Windows job must observe its descendant')
  })
  await scenario('an exited root cannot conceal a still-active owned descendant',async()=>{
   const run=launch('orphan','orphan',{timeoutMs:10000}),pids=await ready(run)
   await parentExitedWithActiveChild(run,pids)
   const r=failure(await run.promise,'timeout')
   assert.equal(r.exitCode,0);assert.equal(r.rootExitObserved,true);assert.equal(r.timedOut,true);assert.equal(r.terminationRequested,true);drained(r)
   if(process.platform==='win32'){assert.ok(r.activePidsAtRootExit.includes(pids.child));assert.ok(r.activePidsBeforeCleanup.includes(pids.child))}
   await gone(pids.pid,pids.child)
  })
  await scenario('parent-first exit succeeds when the contained descendant subsequently completes normally',async()=>{
   const run=launch('parent-first','normal-descendant'),pids=await ready(run)
   await parentExitedWithActiveChild(run,pids)
   release(run.record+'-child.finish')
   const outcome=await run.promise
   assert.equal(outcome.error,undefined,'Unexpected supervisor failure: '+String(outcome.error));const r=outcome.result
   assert.equal(r.kind,'success');assert.equal(r.exitCode,0);assert.equal(r.rootExitObserved,true);assert.equal(r.terminationRequested,false);drained(r)
   assert.equal(JSON.parse(fs.readFileSync(run.record+'-child.completed')).pid,pids.child)
   if(process.platform==='win32'){assert.ok(r.activePidsAtRootExit.includes(pids.child));assert.equal(r.activeProcessCountBeforeCleanup,0);assert.deepEqual(r.activePidsBeforeCleanup,[])}
   await gone(pids.pid,pids.child)
  })
  await scenario('cancellation kills only its owned tree while an unrelated supervised process stays alive',async()=>{
   const otherAbort=new AbortController(),ownAbort=new AbortController()
   const other=launch('leaf','unrelated',{signal:otherAbort.signal}),own=launch('tree','cancelled',{signal:ownAbort.signal})
   let otherPid,ownPids
   try{
    otherPid=(await ready(other)).pid;ownPids=await ready(own);ownAbort.abort()
    const r=failure(await own.promise,'cancelled');assert.equal(r.cancelled,true);assert.equal(r.terminationRequested,true);drained(r)
    await gone(ownPids.pid,ownPids.child);assert.equal(isAlive(otherPid),true,'Unrelated job must remain active')
   }finally{
    ownAbort.abort();otherAbort.abort();await own.promise;const ended=await other.promise
    drained(failure(ended,'cancelled'));if(otherPid)await gone(otherPid)
   }
  })
  await scenario('zero cleanup verification budget fails closed while kill-on-close still reaps owned processes',async()=>{
   const run=launch('tree','cleanup-deadline',{timeoutMs:10000,cleanupTimeoutMs:0}),pids=await ready(run),r=failure(await run.promise,'timeout')
   assert.equal(r.timedOut,true);assert.equal(r.terminationRequested,true);assert.match(r.error,/timeout/)
   assert.equal(r.cleanupComplete,false);assert.match(r.cleanupError,/deadline|verified/);assert.match(r.stdout,/owned root ready/)
   await gone(pids.pid,pids.child)
  })
  await scenario('pre-launch cancellation cannot start an executable',async()=>{
   const abort=new AbortController();abort.abort();const run=launch('leaf','pre-cancel',{signal:abort.signal}),r=failure(await run.promise,'cancelled')
   assert.equal(r.cleanupComplete,true);assert.equal(r.terminationRequested,false);assert.equal(fs.existsSync(run.record),false)
  })
 }finally{
  for(const run of runs)run.abort()
  await Promise.all(runs.map(run=>run.promise))
  // Keep evidence, but unlink only the test-created runtime junction/symlink.
  // Never recursively delete a directory linked to an installed runtime.
  fs.unlinkSync(runtime)
 }
})
