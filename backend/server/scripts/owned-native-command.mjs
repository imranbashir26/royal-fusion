import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import {fileURLToPath} from 'node:url'

const bridge=fileURLToPath(new URL('./owned-native-command.windows.ps1',import.meta.url))
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
export class OwnedCommandError extends Error {
 constructor(result){super(result.error??'Owned native command failed');this.name='OwnedCommandError';this.result=result;this.code=result.kind}
}

// No shell, credential handling, external database configuration, or image-name kills.
export async function runOwnedNativeCommand({file,args=[],cwd=process.cwd(),env=process.env,output,timeoutMs,cleanupTimeoutMs=10000,signal,onStarted,onRootExit}) {
 if(!path.isAbsolute(file)||!fs.existsSync(file)||!Array.isArray(args)||args.some(a=>typeof a!=='string'||a.includes('\0'))
  ||!Number.isInteger(timeoutMs)||timeoutMs<=0||!Number.isInteger(cleanupTimeoutMs)||cleanupTimeoutMs<0||cleanupTimeoutMs>10000)throw Error('Invalid owned command configuration')
 fs.mkdirSync(output,{recursive:true})
 const id=randomUUID(),prefix=path.join(output,'owned-'+id),stdoutPath=prefix+'.stdout.log',stderrPath=prefix+'.stderr.log'
 const began=performance.now(),base={kind:'spawn_error',exitCode:null,timedOut:false,cancelled:false,containmentVerified:false,cleanupComplete:false,cleanupError:null,rootExitObserved:false,terminationRequested:false,remainingPids:[],observedPids:[],stdoutPath,stderrPath}
 const capture=result=>({...result,lifecycleDurationMs:performance.now()-began,stdout:fs.existsSync(stdoutPath)?fs.readFileSync(stdoutPath,'utf8'):'',stderr:fs.existsSync(stderrPath)?fs.readFileSync(stderrPath,'utf8'):''})
 if(signal?.aborted)throw new OwnedCommandError(capture({...base,kind:'cancelled',cancelled:true,cleanupComplete:true,error:'Cancelled before launch',durationMs:0}))
 let result
 if(process.platform==='win32') {
  // PowerShell Core compiles C# in-process. Do not fall back to an uncontained
  // compiler/process tree or bypass Windows execution policy.
  const host=(env.PATH??env.Path??'').split(path.delimiter).map(p=>path.join(p.replace(/^"|"$/g,''),'pwsh.exe')).find(p=>fs.existsSync(p))
  if(!host)throw new OwnedCommandError(capture({...base,error:'Existing PowerShell 7 host required for Windows containment',cleanupComplete:true,durationMs:0}))
  const requestPath=prefix+'.request.json'
  fs.writeFileSync(requestPath,JSON.stringify({file,args,cwd:path.resolve(cwd),timeoutMs,cleanupTimeoutMs,stdoutPath,stderrPath}),{flag:'wx'})
  result=await new Promise(resolve=>{
   const child=spawn(host,['-NoLogo','-NoProfile','-NonInteractive','-File',bridge,requestPath],{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
   let buffer='',diagnostics='',outcome,started=false,reason=null,guard,finished=false
   const finish=r=>{if(finished)return;finished=true;clearTimeout(guard);signal?.removeEventListener('abort',abort);resolve(r)}
   const stop=why=>{
    if(reason||finished)return;reason=why;clearTimeout(guard)
    if(!child.stdin.destroyed)child.stdin.write(why+'\n',()=>{})
    // The bridge closes its non-inherited kill-on-close job handle if it dies.
    guard=setTimeout(()=>{child.kill();},Math.max(1000,cleanupTimeoutMs+250))
   }
   const abort=()=>stop('cancelled')
   child.stdin.on('error',()=>{})
   signal?.addEventListener('abort',abort,{once:true})
   if(signal?.aborted)abort()
   // Bounded launcher bootstrap, independently of the actual command deadline.
   if(!reason)guard=setTimeout(()=>stop('bootstrap_timeout'),30000)
   child.stdout.on('data',data=>{
    buffer+=data.toString();let end
    while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(!line)continue
     try{const event=JSON.parse(line)
      if(event.event==='started'&&!started){started=true;base.containmentVerified=event.containmentVerified===true;base.observedPids=[event.pid]
       if(!reason){clearTimeout(guard);guard=setTimeout(()=>stop('timeout'),timeoutMs)}
       onStarted?.({pid:event.pid,containmentVerified:base.containmentVerified,stdoutPath,stderrPath})
      }else if(event.event==='root_exit')onRootExit?.({exitCode:event.exitCode,activePids:event.activePids,activeProcessCount:event.activeProcessCount})
      else if(event.event==='result')outcome=event.result
     }catch(e){diagnostics+='Invalid bridge response: '+line+'\n';stop('protocol_error')}
    }
   })
   child.stderr.on('data',d=>{diagnostics+=d.toString()})
   child.on('error',e=>finish({...base,error:'Bridge launch failed: '+e.message,durationMs:0,cleanupComplete:true}))
   child.on('close',code=>{
    fs.writeFileSync(prefix+'.bridge.log',diagnostics)
    let r=outcome?{...base,...outcome}:{...base,error:'Containment bridge did not return a complete result',cleanupError:'Process quiescence could not be certified',durationMs:performance.now()-began}
    if(reason){r={...r,kind:reason,timedOut:reason.includes('timeout'),cancelled:reason==='cancelled',error:r.error??('Owned command '+reason)}}
    if(code!==0&&r.kind==='success')r={...r,kind:'bridge_error',error:'Containment bridge exited nonzero'}
    finish(r)
   })
  })
 } else {
  const out=fs.openSync(stdoutPath,'wx'),err=fs.openSync(stderrPath,'wx')
  try{result=await new Promise(resolve=>{
   const child=spawn(file,args,{cwd,env,detached:true,stdio:['ignore',out,err]})
   let exitCode=null,exited=false,reason=null,error=null,startedAt=performance.now(),deadline
   let rootExitObserved=false,terminationRequested=false,activeProcessGroupAtRootExit=null,activeProcessGroupBeforeCleanup=null
   const groupAlive=()=>{try{process.kill(-child.pid,0);return true}catch(e){if(e.code==='ESRCH')return false;throw e}}
   const stop=why=>{reason??=why}
   const abort=()=>stop('cancelled')
   child.on('error',e=>{error=e.message;reason='spawn_error';exited=true})
   child.on('exit',code=>{
    exitCode=code;exited=true;rootExitObserved=true
    try{activeProcessGroupAtRootExit=groupAlive();onRootExit?.({exitCode,processGroupActive:activeProcessGroupAtRootExit})}
    catch(e){error??=e.message;stop('observer_error')}
   })
   child.once('spawn',()=>{startedAt=performance.now();deadline=startedAt+timeoutMs;base.containmentVerified=true;base.observedPids=[child.pid]
    try{onStarted?.({pid:child.pid,containmentVerified:true,stdoutPath,stderrPath})}catch(e){error=e.message;stop('observer_error')}
   })
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort()
   ;(async()=>{
    try{
     while(!reason){if(exited&&exitCode!==0){reason='exit_nonzero';break}if(exited&&!groupAlive())break
      if(deadline&&performance.now()>=deadline){reason='timeout';break}await sleep(20)}
     const durationMs=performance.now()-startedAt
     let cleanupComplete=true,cleanupError=null
     activeProcessGroupBeforeCleanup=child.pid?groupAlive():false
     if(activeProcessGroupBeforeCleanup){
      terminationRequested=true
      if(!reason){reason='forced_cleanup';error??='Unfinished owned processes required forced cleanup'}
      try{process.kill(-child.pid,'SIGTERM')}catch(e){if(e.code!=='ESRCH')throw e}
      const end=performance.now()+cleanupTimeoutMs,escalate=performance.now()+Math.min(200,cleanupTimeoutMs/2)
      while(groupAlive()&&performance.now()<end){if(performance.now()>=escalate){try{process.kill(-child.pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')throw e}}await sleep(20)}
      cleanupComplete=cleanupTimeoutMs>0&&!groupAlive();if(!cleanupComplete)cleanupError='Owned process group cleanup could not be verified within its deadline'
      // Even a zero verification budget must initiate definitive termination.
      if(!cleanupComplete)try{process.kill(-child.pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')throw e}
     }
     const kind=reason??'success'
     const finalProcessGroupActive=child.pid?groupAlive():false
     resolve({...base,kind,exitCode,durationMs,rootExitObserved,terminationRequested,activeProcessGroupAtRootExit,activeProcessGroupBeforeCleanup,finalProcessGroupActive,timedOut:kind==='timeout',cancelled:kind==='cancelled',cleanupComplete,cleanupError,error:error??(reason?'Owned command '+reason:null),remainingProcessGroup:finalProcessGroupActive?child.pid:null})
    }catch(e){
     let cleanupError=e.message
     if(child.pid){terminationRequested=true;try{process.kill(-child.pid,'SIGKILL')}catch(killError){if(killError.code!=='ESRCH')cleanupError+='; '+killError.message}}
     resolve({...base,kind:reason??'supervision_error',exitCode,rootExitObserved,terminationRequested,activeProcessGroupAtRootExit,activeProcessGroupBeforeCleanup,timedOut:reason==='timeout',cancelled:reason==='cancelled',error:error??(reason?'Owned command '+reason:e.message),cleanupError,durationMs:performance.now()-startedAt})
    }
    finally{signal?.removeEventListener('abort',abort)}
   })()
  })}finally{fs.closeSync(out);fs.closeSync(err)}
 }
 if(result.kind==='success'&&result.terminationRequested)result={...result,kind:'forced_cleanup',error:result.error??'Unfinished owned processes required forced cleanup'}
 result=capture(result)
 fs.writeFileSync(prefix+'.result.json',JSON.stringify(result,null,2),{flag:'wx'})
 if(result.kind!=='success'||!result.containmentVerified||!result.cleanupComplete)throw new OwnedCommandError(result)
 return result
}
