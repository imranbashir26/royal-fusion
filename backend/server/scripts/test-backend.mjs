import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {randomUUID} from 'node:crypto'
import {execFileSync,spawn} from 'node:child_process'
import {unitFiles,nativeGroups,tapTotals} from './backend-test-selection.mjs'
const root=fileURLToPath(new URL('../../..',import.meta.url))
export function verifySelection(){
 const files=[...unitFiles,...Object.values(nativeGroups).flat()],actual=fs.readdirSync(root+'/backend/server/tests',{recursive:true}).filter(p=>/\.test\.(?:js|mjs|cjs)$/.test(p)).map(p=>p.replaceAll('\\','/')).sort()
 if(new Set(files).size!==files.length||JSON.stringify(files.toSorted())!==JSON.stringify(actual))throw Error('Backend test inventory is incomplete or duplicated; update backend-test-selection.mjs')
 return files
}
export function prerequisites(options={}){
 let bin=options['pg-bin']??process.env.RF_TEST_PG_BIN
 if(!bin){try{bin=execFileSync('pg_config',['--bindir'],{encoding:'utf8',windowsHide:true}).trim()}catch{throw Error('PostgreSQL 17 binaries required: use --pg-bin or RF_TEST_PG_BIN')}}
 const suffix=process.platform==='win32'?'.exe':''
 for(const command of ['postgres','initdb','pg_ctl'])if(!fs.existsSync(path.join(bin,command+suffix)))throw Error('Missing PostgreSQL executable: '+command)
 const version=execFileSync(path.join(bin,'postgres'+suffix),['--version'],{encoding:'utf8',windowsHide:true}).trim()
 if(!/PostgreSQL\) 17\./.test(version))throw Error('PostgreSQL 17 required; found '+version)
 let pgModule=options['pg-module']??process.env.RF_TEST_PG_MODULE
 if(!pgModule){try{pgModule=createRequire(import.meta.url).resolve('pg')}catch{throw Error('Missing pg test driver: install locked dependencies with npm ci or specify --pg-module')}}
 if(!fs.existsSync(pgModule))throw Error('Missing pg test driver: '+pgModule)
 return {bin:path.resolve(bin),pgModule:path.resolve(pgModule),version}
}
export async function runChild(args,{cwd=root,env=process.env,log,quiet=false,failFast=true,ownedRunner=false}={}){
 return await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,args,{cwd,env,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe','ipc']});let output=''
  if(log)fs.writeFileSync(log,'')
  let stopped=false
  const stop=()=>{if(stopped)return;stopped=true;try{if(process.platform==='win32')execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else process.kill(-child.pid,'SIGTERM')}catch{}}
  // Native parent must reach its finally block; use IPC for Windows as well.
  const cancel=()=>{if(ownedRunner&&child.connected)child.send({type:'RF_TEST_STOP'});else stop()}
  process.on('SIGINT',cancel);process.on('SIGTERM',cancel)
  // Existing native test limit is 10 min; 15 min here includes setup/teardown.
  const timer=setTimeout(cancel,ownedRunner?900000:600000)
  const finish=()=>{clearTimeout(timer);process.off('SIGINT',cancel);process.off('SIGTERM',cancel)}
  const onData=data=>{const text=data.toString();output+=text;if(log)fs.appendFileSync(log,text);if(!quiet)process.stdout.write(text);if(failFast&&/(?:^|\n)\s*not ok \d/.test(output))stop()}
  child.stdout.on('data',onData);child.stderr.on('data',onData)
  child.on('error',error=>{finish();reject(error)});child.on('close',status=>{finish();if(status!==0||stopped)reject(Error('Child verification failed (exit '+status+')'));else resolve(output)})
 })
}
async function main(){
 const [mode='full',...args]=process.argv.slice(2)
 if(!['unit','native','full','list'].includes(mode)||args.length%2)throw Error('Use unit/native/full/list with --pg-bin, --pg-module, --output value pairs')
 const options={};for(let i=0;i<args.length;i+=2){const key=args[i].slice(2);if(!args[i].startsWith('--')||!['pg-bin','pg-module','output'].includes(key)||options[key])throw Error('Unknown/duplicate option');options[key]=args[i+1]}
 const files=verifySelection()
 if(mode==='list'){console.log(JSON.stringify({unitFiles,nativeGroups},null,2));return}
 const native=mode==='unit'?null:prerequisites(options)
 const output=path.resolve(options.output??path.join(os.tmpdir(),'royal-fusion-backend-'+randomUUID()))
 if(fs.existsSync(output))throw Error('Refusing to reuse test output directory '+output)
 fs.mkdirSync(output,{recursive:true})
 const env={...process.env};delete env.RF_RELEASE005_NATIVE_CONFIG
 for(const key of Object.keys(env))if(key.startsWith('PG'))delete env[key]
 const report={mode,selection:mode==='unit'?unitFiles:mode==='native'?Object.values(nativeGroups).flat():files,version:native?.version??null,productionAccess:false,groups:[]}
 try{
  if(mode!=='native'){
   console.log('UNIT / EMBEDDED: '+unitFiles.join(', '))
   const text=await runChild(['--test','--test-concurrency=1','--test-reporter=tap',...unitFiles.map(p=>'backend/server/tests/'+p)],{env,log:output+'/unit.log'})
   report.groups.push({name:'unit',counts:tapTotals(text)})
  }
  if(native)for(const [selection,tests] of Object.entries(nativeGroups)){
   console.log('NATIVE '+selection+': '+tests.join(', '))
   const groupOutput=path.join(output,selection)
   // Delegate all cluster ownership, install fixtures and shutdown to the existing runner.
   await runChild(['backend/server/scripts/test-checked-v1-regressions-native.mjs','--pg-bin',native.bin,'--pg-module',native.pgModule,'--output',groupOutput,'--selection',selection],{env,failFast:false,ownedRunner:true})
   const result=JSON.parse(fs.readFileSync(groupOutput+'/native-result.json'))
   if(result.status!==0||result.productionAccess!==false)throw Error('Native group did not complete safely')
   report.groups.push({name:selection,counts:tapTotals(fs.readFileSync(groupOutput+'/native-tests.log','utf8'))})
  }
  report.status='PASS';console.log('BACKEND '+mode.toUpperCase()+' PASS: '+JSON.stringify(report.groups))
 }catch(error){report.status='FAIL';report.error=error.message;throw error}
 finally{fs.writeFileSync(output+'/backend-result.json',JSON.stringify(report,null,2))}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1})
