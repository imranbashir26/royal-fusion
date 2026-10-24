import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
test('v2 types compile without changing v1 persistence or exposing a purchasing client',()=>{
 const source=readFileSync(new URL('../src/types/checkoutV2.ts',import.meta.url),'utf8')
 const r=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext},reportDiagnostics:true})
 assert.equal(r.diagnostics.length,0);assert.equal(r.outputText.trim(),'export {};')
 for(const kind of ['normal_variant','fixed_tester_pack','configurable_tester_pack'])assert.ok(source.includes(kind))
 assert.ok(source.includes('orderingEnabled:false'));assert.ok(source.includes('snapshotVersion:2'))
 assert.doesNotMatch(source,/fetch\(|localStorage|sessionStorage|cartStore|create_order_transaction/)
})
