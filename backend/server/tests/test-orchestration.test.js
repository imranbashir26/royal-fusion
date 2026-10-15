import assert from 'node:assert/strict'
import test from 'node:test'
import {verifySelection,prerequisites,runChild} from '../scripts/test-backend.mjs'
import {tapTotals,nativeGroups} from '../scripts/backend-test-selection.mjs'
test('required selection is exhaustive and unique; retirement and checked API are mandatory',()=>{
 assert.equal(verifySelection().length,44)
 for(const file of ['checkout-retirement-native.test.js','checked-v1-native.test.js','checked-v1-api-native.test.js'])assert.ok(nativeGroups.acceptance.includes(file))
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
