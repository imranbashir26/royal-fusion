// Starts only a fresh owned loopback cluster. Never reads dotenv or PG connection settings.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {nativeGroups,tapTotals} from './backend-test-selection.mjs'
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
const interrupt=()=>{interrupted=true;stopActiveTest?.()}
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
let started=false,result
try {
 command('initdb',['-D',cluster,'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C'],'initdb.log')
 fs.writeFileSync(path.join(cluster,'release005-owned-marker'),marker)
 command('pg_ctl',['start','-D',cluster,'-l',path.join(output,'postgres.log'),'-o','-h 127.0.0.1 -p '+port,'-w','-t','20'],'pg_ctl.log');started=true
 const config={cluster:cluster.replaceAll('\\','/'),marker,port,pgModule:path.resolve(pgModule),version,pgBin:path.resolve(bin)}
 const configuration=path.join(output,'native-config.json');fs.writeFileSync(configuration,JSON.stringify(config,null,2))

 const tests=nativeGroups[options.selection]??(options.selection==='native'?['checked-v1-native.test.js','checked-v1-api-native.test.js']:options.selection==='retirement'?['checkout-retirement-native.test.js']:options.selection==='api'?['orders-v2.test.js']:['checkout-v2-sql.test.js'])
 result=await runTests(['--test','--test-concurrency=1','--test-reporter=tap',...(options.pattern?['--test-name-pattern='+options.pattern]:[]),...tests.map(p=>'backend/server/tests/'+p)],{...process.env,RF_RELEASE005_NATIVE_CONFIG:configuration})
 if(result.status===0&&!options.pattern){try{tapTotals(result.stdout)}catch(error){result.status=1;result.error=error}}
 fs.writeFileSync(path.join(output,'native-tests.log'),(result.stdout??'')+(result.stderr??''))
 console.log(result.stdout??'');if(result.stderr)console.error(result.stderr)
 fs.writeFileSync(path.join(output,'native-result.json'),JSON.stringify({version,host:'127.0.0.1',port,status:result.status,
  error:result.error?.message??null,productionAccess:false,output},null,2))
} finally {
 if(started||fs.existsSync(cluster+'/postmaster.pid')){
  if(fs.readFileSync(cluster+'/release005-owned-marker','utf8')!==marker)throw Error('Owned cluster marker changed; refusing shutdown')
  let running=true
  try{command('pg_ctl',['status','-D',cluster],'pg_ctl.log')}catch(error){if(error.status===3)running=false;else throw error}
  if(running)command('pg_ctl',['stop','-D',cluster,'-m','fast','-w','-t','20'],'pg_ctl.log')
  if(fs.existsSync(cluster+'/postmaster.pid'))throw Error('Owned cluster shutdown incomplete')
 }
}
console.log('Owned disposable cluster stopped. Evidence: '+output)
process.exitCode=result?.status===0?0:1
if(process.connected)process.disconnect()
