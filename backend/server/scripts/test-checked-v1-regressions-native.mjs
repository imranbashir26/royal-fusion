// Starts only a fresh owned loopback cluster. Never reads dotenv or PG connection settings.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {nativeGroups,tapTotals} from './backend-test-selection.mjs'
import {runOwnedNativeCommand} from './owned-native-command.mjs'
const INITDB_TIMEOUT_MS=120000
const root=fileURLToPath(new URL('../../..',import.meta.url))
const options = Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all) => v.startsWith('--') ? [...a,[v.slice(2),all[i+1]]] : a,[]))
options.selection ??= 'all'
if(![...Object.keys(nativeGroups),'native','api','sql','retirement'].includes(options.selection))throw Error('Invalid test selection')
const bin = options['pg-bin']
const pgModule = options['pg-module']
if (!bin || !pgModule) throw Error('Specify --pg-bin (PostgreSQL 17 binaries) and --pg-module (local pg/lib/index.js)')
const output = path.resolve(options.output ?? path.join(os.tmpdir(),'royal-fusion-release007-'+randomUUID()))
const cluster = path.join(output,'pgdata')
if (fs.existsSync(cluster)) throw Error('Refusing to reuse an existing cluster; choose a fresh --output directory')
fs.mkdirSync(output,{recursive:true})
const suffix=process.platform==='win32'?'.exe':''
const command=(name,args,log)=>{const fd=fs.openSync(path.join(output,log),'a');try{return execFileSync(path.join(bin,name+suffix),args,{stdio:['ignore',fd,fd],windowsHide:true,timeout:45000})}finally{fs.closeSync(fd)}}
let interrupted=false,stopActiveTest
const initializationAbort=new AbortController()
const interrupt=()=>{interrupted=true;initializationAbort.abort();stopActiveTest?.()}
process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt)
process.on('message',message=>{if(message?.type==='RF_TEST_STOP')interrupt()})
async function runTests(args,env){
 return await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,args,{cwd:root,env,windowsHide:true,detached:process.platform!=='win32'})
  let stdout='',stderr='',stopped=false
  const log=path.join(output,'native-tests.log');fs.writeFileSync(log,'')
  const stop=()=>{
   if(stopped)return;stopped=true
   try{if(process.platform==='win32')execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else process.kill(-child.pid,'SIGTERM')}
   catch{child.kill('SIGTERM')} // The child may already have exited after reporting failure.
  }
  const timer=setTimeout(stop,600000)
  stopActiveTest=stop;if(interrupted)stop()
  child.stdout.on('data',data=>{stdout+=data;fs.appendFileSync(log,data);if(/(?:^|\n)\s*not ok \d/.test(stdout))stop()})
  child.stderr.on('data',data=>{stderr+=data;fs.appendFileSync(log,data)})
  child.on('error',error=>{stopActiveTest=null;clearTimeout(timer);reject(error)})
  child.on('close',status=>{stopActiveTest=null;clearTimeout(timer);resolve({stdout,stderr,status:stopped?1:status,error:stopped?{message:'Stopped at first failed test, interruption or timeout'}:null})})
 })
}
const version=execFileSync(path.join(bin,'postgres'+suffix),['--version'],{encoding:'utf8',windowsHide:true}).trim()
if (!/PostgreSQL\) 17\./.test(version)) throw Error('Native PostgreSQL 17 required: '+version)
const marker=randomUUID(),port=59705
let started=false,result,primaryError=null,phase='initialization'
const report={version,host:'127.0.0.1',port,status:1,error:null,productionAccess:false,output,
 initialization:{started:false,succeeded:false},startup:{started:false,succeeded:false},
 tests:{started:false,completeSummary:false,counts:null},shutdown:{attempted:false,succeeded:false},cleanup:{complete:false,error:null}}
try {
 fs.writeFileSync(path.join(output,'runner-owned-marker'),marker,{flag:'wx'})
 report.initialization.started=true
 try{report.initialization.command=await runOwnedNativeCommand({file:path.resolve(bin,'initdb'+suffix),
  args:['-D',cluster,'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C'],cwd:root,output,
  timeoutMs:INITDB_TIMEOUT_MS,cleanupTimeoutMs:10000,signal:initializationAbort.signal})}
 catch(error){report.initialization.command=error.result??null;throw error}
 const initialization=report.initialization.command
 fs.copyFileSync(initialization.stdoutPath,path.join(output,'initdb.log'))
 fs.copyFileSync(initialization.stderrPath,path.join(output,'initdb.stderr.log'))
 report.initialization.succeeded=true
 if(interrupted)throw Error('Interrupted before PostgreSQL startup')
 fs.writeFileSync(path.join(cluster,'release005-owned-marker'),marker)
 phase='startup';report.startup.started=true
 command('pg_ctl',['start','-D',cluster,'-l',path.join(output,'postgres.log'),'-o','-h 127.0.0.1 -p '+port,'-w','-t','20'],'pg_ctl.log');started=true
 report.startup.succeeded=true
 const config={cluster:cluster.replaceAll('\\','/'),marker,port,pgModule:path.resolve(pgModule),version,pgBin:path.resolve(bin)}
 const configuration=path.join(output,'native-config.json');fs.writeFileSync(configuration,JSON.stringify(config,null,2))

 const tests=nativeGroups[options.selection]??(options.selection==='native'?['checked-v1-native.test.js','checked-v1-api-native.test.js']:options.selection==='retirement'?['checkout-retirement-native.test.js']:options.selection==='api'?['orders-v2.test.js']:['checkout-v2-sql.test.js'])
 phase='tests';report.tests.started=true
 result=await runTests(['--test','--test-concurrency=1','--test-reporter=tap',...(options.pattern?['--test-name-pattern='+options.pattern]:[]),...tests.map(p=>'backend/server/tests/'+p)],{...process.env,RF_RELEASE005_NATIVE_CONFIG:configuration,RF_REFRESH_RELEASE008_MANIFESTS:options['refresh-manifests']==='true'?'true':'false'})
 report.tests.exitCode=result.status
 if(result.status===0&&!options.pattern){report.tests.counts=tapTotals(result.stdout);report.tests.completeSummary=true}
 fs.writeFileSync(path.join(output,'native-tests.log'),(result.stdout??'')+(result.stderr??''))
 console.log(result.stdout??'');if(result.stderr)console.error(result.stderr)
 if(result.status!==0)throw Error(result.error?.message??'Native tests failed')
 if(interrupted)throw Error('Native verification interrupted')
} catch(error) {
 primaryError=error;report.error=error.message;report.failedPhase=phase
} finally {
 try{
  const initialization=report.initialization.command
  if(initialization){
   if(fs.existsSync(initialization.stdoutPath))fs.copyFileSync(initialization.stdoutPath,path.join(output,'initdb.log'))
   if(fs.existsSync(initialization.stderrPath))fs.copyFileSync(initialization.stderrPath,path.join(output,'initdb.stderr.log'))
   if(!initialization.cleanupComplete)throw Error(initialization.cleanupError??'Initialization process cleanup is incomplete')
  }
  if(started||fs.existsSync(cluster+'/postmaster.pid')){
   report.shutdown.attempted=true
   if(fs.readFileSync(output+'/runner-owned-marker','utf8')!==marker||fs.readFileSync(cluster+'/release005-owned-marker','utf8')!==marker)throw Error('Owned cluster marker changed; refusing shutdown')
   let running=true
   try{command('pg_ctl',['status','-D',cluster],'pg_ctl.log')}catch(error){if(error.status===3)running=false;else throw error}
   if(running)command('pg_ctl',['stop','-D',cluster,'-m','fast','-w','-t','20'],'pg_ctl.log')
   if(fs.existsSync(cluster+'/postmaster.pid'))throw Error('Owned cluster shutdown incomplete')
   report.shutdown.succeeded=true
  }
  report.cleanup.complete=true
 }catch(error){report.cleanup.error=error.message;report.cleanup.complete=false;report.error??=error.message;report.failedPhase??='cleanup'}
 report.interrupted=interrupted
 report.status=!primaryError&&!interrupted&&result?.status===0&&report.cleanup.complete?0:1
 // Final status is written only after startup/test and cleanup outcomes are known.
 fs.writeFileSync(path.join(output,'native-result.json'),JSON.stringify(report,null,2))
 }
if(report.cleanup.complete)console.log('Owned disposable cluster stopped. Evidence: '+output)
if(report.error)console.error(report.error)
process.exitCode=report.status
if(process.connected)process.disconnect()
