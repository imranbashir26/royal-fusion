import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import express from 'express'

const require = createRequire(import.meta.url)
const proxyAddress = require('proxy-addr')
const { parse, quote } = require('shell-quote')
const qs = require('qs')
const { Address4, Address6 } = require('ip-address')

test('mapped IPv6 trust prefixes cannot accidentally trust unrelated IPv4 clients', () => {
  for (const prefix of ['::ffff:10.0.0.0/8', '::/1']) {
    const trust = proxyAddress.compile(prefix)
    assert.equal(trust('203.0.113.9'), false, prefix)
    assert.equal(trust('10.1.2.3'), false, prefix)
  }
  const intended = proxyAddress.compile('::ffff:10.0.0.0/104')
  assert.equal(intended('10.1.2.3'), true)
  assert.equal(intended('::ffff:10.1.2.3'), true)
  assert.equal(intended('203.0.113.9'), false)
})

test('Express default and existing numeric one-hop trust retain their client-IP contracts', () => {
  const app = express()
  const request = { connection: { remoteAddress: '10.0.0.2' }, headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.24' } }
  assert.equal(proxyAddress(request, app.get('trust proxy fn')), '10.0.0.2')
  app.set('trust proxy', 1)
  assert.equal(proxyAddress(request, app.get('trust proxy fn')), '198.51.100.24')
  assert.deepEqual(proxyAddress.all(request, app.get('trust proxy fn')), ['10.0.0.2', '198.51.100.24'])
})

test('shell quoting rejects line terminators after a comment without executing a command', () => {
  assert.throws(() => quote(['echo', 'ok', { comment: 'fixture' }, 'value\ninjected;#']), /line terminators/)
  const command = ['npm', 'run', 'dev:backend']
  assert.deepEqual(parse(quote(command)), command)
})

test('query-string round trips do not invoke an attacker-supplied constructor.isBuffer', () => {
  const hostile = qs.parse('constructor[isBuffer]=true', { plainObjects: true })
  assert.equal(qs.stringify(hostile), 'constructor%5BisBuffer%5D=true')
  assert.equal(qs.parse('page=1&search=oud').search, 'oud')
})

test('IP parsing rejects ambiguous IPv4 octets and oversized IPv6 input safely', () => {
  assert.throws(() => new Address4('010.0.0.1'), /leading zeroes/)
  assert.equal(new Address4('10.0.0.1').correctForm(), '10.0.0.1')
  assert.throws(() => new Address6('!'.repeat(10000)), error => error.name === 'AddressError' && error.message.length < 128 && error.parseMessage === undefined)
})
