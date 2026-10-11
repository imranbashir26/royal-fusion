import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { isAllowedCorsOrigin } from '../auth/config.js'
import { requestContext } from '../middleware/authSecurity.js'
import { mountSanityBlogApi } from '../services/blogActivation.js'
import { blockExternalBlogTestNetwork, createSanityBlogClientFixture } from './support/sanityBlogFixtures.js'

const origin = 'https://shop.example.invalid'
const environment = { ENABLE_SANITY_BLOG_API: 'true', CLIENT_ORIGIN: origin }
let network
before(() => { network = blockExternalBlogTestNetwork() })
after(() => { network.restore(); assert.deepEqual(network.attempts, []) })
async function start(t, { env = environment, clientFactory, limit = 400 } = {}) {
  const app = express(), fixture = createSanityBlogClientFixture(), diagnostics = []
  let constructions = 0
  app.use(helmet(), requestContext, cors({ credentials: true, origin(value, callback) {
    const allowed = isAllowedCorsOrigin(value, { allowedOrigins: [origin], environment: 'production' })
    callback(allowed ? null : Object.assign(new Error('Origin denied.'), { status: 403 }), allowed)
  } }), rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false }))
  const activation = await mountSanityBlogApi(app, { environment: env,
    clientFactory(options) { constructions++; return clientFactory ? clientFactory(options) : fixture.client },
    logger: { warn(value) { diagnostics.push(value) } },
  })
  app.use(express.json())
  app.get('/api/v1/public/sibling', (_req, res) => res.json({ data: 'sibling fixture' }))
  app.get('/api/public/blogs', (_req, res) => res.json({ data: 'historical fixture' }))
  app.get('/api/v1/auth/session', (_req, res) => res.json({ data: { authenticated: false } }))
  app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: { message: 'Request denied.' } }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  return { base: `http://127.0.0.1:${server.address().port}`, activation, fixture, diagnostics, constructions: () => constructions }
}

// A fresh process avoids the SDK cache populated by other fixture tests. Native
// loader hooks replace only the observed module or reject the real SDK import.
// module.register is available throughout the existing Node >=22.12 contract.
function importProbe(mode, body) {
  const activationUrl = new URL('../services/blogActivation.js', import.meta.url).href
  const sourceUrl = new URL('../services/sanityBlogSource.js', import.meta.url).href
  const hooks = `
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@sanity/') || (${JSON.stringify(mode)} === 'observe' && specifier === 'groq')) {
        throw new Error('PRIVATE_FIXTURE_SDK_IMPORT_FAILURE');
      }
      return nextResolve(specifier, context);
    }
    export async function load(url, context, nextLoad) {
      if (${JSON.stringify(mode)} === 'observe' && url === ${JSON.stringify(sourceUrl)}) {
        return {format:'module',shortCircuit:true,source:
          "globalThis.__blogServiceEvaluations = (globalThis.__blogServiceEvaluations || 0) + 1; export function createSanityBlogV1Service() { globalThis.__blogServiceConstructions = (globalThis.__blogServiceConstructions || 0) + 1; throw new Error('PRIVATE_FIXTURE_CONSTRUCTION'); }"};
      }
      if (url.includes('/node_modules/@sanity/') || (${JSON.stringify(mode)} === 'observe' && url.endsWith('/sanityBlogQueries.js'))) {
        throw new Error('PRIVATE_FIXTURE_SDK_EVALUATION_FAILURE');
      }
      return nextLoad(url, context);
    }
  `
  const program = `
    import assert from 'node:assert/strict';
    import net from 'node:net';
    import {register} from 'node:module';
    const originalConnect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (...input) {
      const args = Array.isArray(input[0]) ? input[0] : input;
      const options = args[0];
      const host = typeof options === 'object' ? options.host || options.hostname || 'localhost' : typeof args[1] === 'string' ? args[1] : 'localhost';
      assert.ok(['localhost','127.0.0.1','::1'].includes(host), 'No external probe sockets');
      return originalConnect.apply(this, input);
    };
    register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(hooks)}), ${JSON.stringify(activationUrl)});
    const {mountSanityBlogApi} = await import(${JSON.stringify(activationUrl)});
    ${body}
  `
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', program], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, NODE_OPTIONS: '' },
  }))
}

test('fresh disabled activation never evaluates the Sanity-dependent chain; the evaluation detector has a positive control', () => {
  const sourceUrl = new URL('../services/sanityBlogSource.js', import.meta.url).href
  const result = importProbe('observe', `
    let registrations = 0, constructions = 0;
    const diagnostics = [];
    for (const flag of [undefined, 'false', 'TRUE', ' true ', '1', true]) {
      const result = await mountSanityBlogApi({use(){registrations++;}}, {
        environment:{ENABLE_SANITY_BLOG_API:flag,CLIENT_ORIGIN:'PRIVATE_INVALID'},
        clientFactory(){constructions++;throw new Error('Unexpected SDK construction');},
        logger:{warn(value){diagnostics.push(value);}},
      });
      assert.equal(result.status,'disabled');
    }
    const disabledEvaluations = globalThis.__blogServiceEvaluations || 0;
    assert.equal(disabledEvaluations,0);
    assert.equal(registrations,0);assert.equal(constructions,0);assert.deepEqual(diagnostics,[]);
    await import(${JSON.stringify(sourceUrl)});
    assert.equal(globalThis.__blogServiceEvaluations,1,'Positive control must catch module evaluation');
    assert.equal(globalThis.__blogServiceConstructions || 0,0);
    console.log(JSON.stringify({disabledEvaluations,registrations,constructions,positiveControlEvaluations:globalThis.__blogServiceEvaluations}));
  `)
  assert.deepEqual(result, { disabledEvaluations: 0, registrations: 0, constructions: 0, positiveControlEvaluations: 1 })
})

test('injected JSON-only composition also leaves HTML and SDK-dependent modules unevaluated', () => {
  const deliveryUrl = new URL('../services/blogDelivery.js', import.meta.url).href
  const result = importProbe('observe', `
    const {createInjectedBlogDelivery}=await import(${JSON.stringify(deliveryUrl)});
    const service={async list(){throw new Error('No source reads');},async getBySlug(){throw new Error('No source reads');}};
    for(const documentMode of [undefined,false,'true',1]) {
      const delivery=await createInjectedBlogDelivery({service,documentMode,canonicalOrigin:'PRIVATE_INVALID'});
      assert.equal(delivery.htmlRouter,undefined);assert.equal(typeof delivery.apiRouter,'function');
    }
    assert.equal(globalThis.__blogServiceEvaluations||0,0);
    console.log(JSON.stringify({evaluations:0}));
  `)
  assert.deepEqual(result,{evaluations:0})
})

test('a real SDK import failure is caught before construction and preserves safe blog errors and sibling services', () => {
  const result = importProbe('reject-sdk', `
    const {default:express} = await import('express');
    const {once} = await import('node:events');
    const app = express(), diagnostics = [];let constructions = 0;
    const activation = await mountSanityBlogApi(app, {
      environment:${JSON.stringify(environment)},
      clientFactory(){constructions++;throw new Error('Unexpected construction');},
      logger:{warn(value){diagnostics.push(value);}},
    });
    assert.equal(activation.status,'unavailable');assert.equal(constructions,0);
    app.use(express.json());
    app.get('/sibling',(_req,res)=>res.json({data:'unchanged'}));
    const server = app.listen(0,'127.0.0.1');await once(server,'listening');
    const base = 'http://127.0.0.1:' + server.address().port;
    try {
      const response = await fetch(base+'/api/v1/public/blogs');
      assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
      const body = await response.json();assert.equal(body.error.code,'BLOGS_UNAVAILABLE');
      assert.equal((await fetch(base+'/api/v1/public/blogs/Upper')).status,400);
      assert.equal((await fetch(base+'/api/v1/public/blogs',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,405);
      assert.deepEqual(await (await fetch(base+'/sibling')).json(),{data:'unchanged'});
      assert.equal(diagnostics[0].event,'blog.module.unavailable');
      assert.equal(/PRIVATE|stack|sanityBlogSource/.test(JSON.stringify({body,diagnostics})),false);
      console.log(JSON.stringify({status:activation.status,constructions,responseStatus:response.status,importDiagnostic:diagnostics[0].event}));
    } finally {await new Promise(resolve=>server.close(resolve));}
  `)
  assert.deepEqual(result, { status: 'unavailable', constructions: 0, responseStatus: 503, importDiagnostic: 'blog.module.unavailable' })
})

test('missing, false and non-exact flags register nothing and construct no client despite invalid source configuration', async t => {
  for (const flag of [undefined, 'false', 'TRUE', ' true ', '1', true]) {
    const state = await start(t, { env: { ENABLE_SANITY_BLOG_API: flag, CLIENT_ORIGIN: 'PRIVATE_INVALID' } })
    assert.equal(state.activation.status, 'disabled'); assert.equal(state.constructions(), 0)
    assert.equal((await fetch(`${state.base}/api/v1/public/blogs`)).status, 404)
    assert.deepEqual(await (await fetch(`${state.base}/api/public/blogs`)).json(), { data: 'historical fixture' })
    assert.deepEqual(state.fixture.calls, []); assert.deepEqual(state.diagnostics, [])
  }
})
test('explicit activation constructs once without fetching and delivers published fixture summaries and independent details', async t => {
  const state = await start(t)
  assert.equal(state.activation.status, 'configured'); assert.equal(state.constructions(), 1)
  assert.deepEqual(state.fixture.calls, [])
  const response = await fetch(`${state.base}/api/v1/public/blogs?pageSize=2`), list = await response.json()
  assert.equal(response.status, 200); assert.equal(list.data.length, 2); assert.equal(list.pagination.total, 4)
  assert.equal(list.data.some(row => 'body' in row || row.id.includes('.')), false)
  assert.equal(/PRIVATE|token|private@example/.test(JSON.stringify(list)), false)
  const detail = await fetch(`${state.base}/api/v1/public/blogs/fragrance-journal`)
  assert.equal(detail.status, 200); assert.ok((await detail.json()).data.body.length)
  assert.equal(state.constructions(), 1); assert.equal(state.fixture.calls.length, 2)
  assert.ok(state.fixture.calls.every(call => call.options.perspective === 'published' && call.options.useCdn === false))
})
test('enabled mounting preserves headers, exact CORS and unrelated public/auth routes', async t => {
  const state = await start(t), id = '00000000-0000-4000-8000-000000000004'
  const response = await fetch(`${state.base}/api/v1/public/blogs`, { headers: { Origin: origin, 'X-Request-ID': id } })
  assert.equal(response.headers.get('x-request-id'), id)
  assert.equal(response.headers.get('access-control-allow-origin'), origin)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal((await fetch(`${state.base}/api/v1/public/blogs`, { headers: { Origin: 'https://foreign.invalid' } })).status, 403)
  for (const [path, body] of [['/api/v1/public/sibling', { data: 'sibling fixture' }], ['/api/public/blogs', { data: 'historical fixture' }], ['/api/v1/auth/session', { data: { authenticated: false } }]]) {
    assert.deepEqual(await (await fetch(`${state.base}${path}`)).json(), body)
  }
})
test('validation and missing articles retain 400/404 and deny mutations before malformed JSON parsing', async t => {
  const state = await start(t), base = `${state.base}/api/v1/public/blogs`
  assert.equal((await fetch(`${base}?page=0`)).status, 400)
  assert.equal((await fetch(`${base}/Upper`)).status, 400)
  assert.equal((await fetch(`${base}/missing-article`)).status, 404)
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(base, { method, headers: { 'Content-Type': 'application/json' }, body: '{' })
    assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET, HEAD, OPTIONS')
  }
  const head = await fetch(base, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '')
  assert.equal((await fetch(base, { method: 'OPTIONS' })).status, 204)
})
test('existing global limiter still runs before the blog router', async t => {
  const state = await start(t, { limit: 1 })
  assert.equal((await fetch(`${state.base}/api/v1/public/blogs`)).status, 200)
  const response = await fetch(`${state.base}/api/v1/public/blogs`)
  assert.equal(response.status, 429); assert.ok(response.headers.get('retry-after'))
  assert.equal(state.fixture.calls.length, 1)
})
test('invalid enabled configuration is isolated, never constructs a client and exposes only safe 503 diagnostics', async t => {
  for (const CLIENT_ORIGIN of [undefined, 'http://localhost:5173', 'https://user:PRIVATE_SECRET@shop.example.invalid', `${origin}/path`]) {
    const state = await start(t, { env: { ...environment, CLIENT_ORIGIN } })
    assert.equal(state.activation.status, 'unavailable'); assert.equal(state.constructions(), 0)
    const response = await fetch(`${state.base}/api/v1/public/blogs`)
    assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal((await response.json()).error.code, 'BLOGS_UNAVAILABLE')
    assert.equal((await fetch(`${state.base}/api/v1/public/blogs?page=0`)).status, 400)
    assert.equal((await fetch(`${state.base}/api/v1/public/blogs/Upper`)).status, 400)
    assert.equal((await fetch(`${state.base}/api/v1/auth/session`)).status, 200)
    assert.equal(/PRIVATE|localhost|stack|CLIENT_ORIGIN/.test(JSON.stringify(state.diagnostics)), false)
    assert.equal(state.diagnostics[0].event, 'blog.configuration.invalid')
  }
})
test('client construction and upstream failures do not terminate sibling services or reveal provider errors', async t => {
  for (const clientFactory of [() => { throw new Error('PRIVATE_CONSTRUCTION_TOKEN') }, () => ({ fetch() { throw new Error('PRIVATE_UPSTREAM_TOKEN') } })]) {
    const state = await start(t, { clientFactory })
    const response = await fetch(`${state.base}/api/v1/public/blogs`)
    assert.equal(response.status, 503); assert.equal(/PRIVATE|stack/.test(JSON.stringify(await response.json())), false)
    assert.equal((await fetch(`${state.base}/api/v1/public/sibling`)).status, 200)
    assert.equal(/PRIVATE|stack/.test(JSON.stringify(state.diagnostics)), false)
    assert.ok(state.diagnostics.some(value => value.event === 'blog.request.unavailable'))
  }
})
test('entry point wires activation after security/rate controls and before parsers without importing startup in tests', async () => {
  const entry = await readFile(new URL('../index.js', import.meta.url), 'utf8')
  const position = entry.indexOf('mountSanityBlogApi(app)')
  assert.ok(entry.includes('await mountSanityBlogApi(app)'))
  assert.ok(entry.indexOf('const authConfig = validateRuntimeEnv()') < position)
  for (const middleware of ['app.use(helmet(', 'app.use(requestContext)', 'app.use(cors(', 'app.use(rateLimit(']) assert.ok(entry.indexOf(middleware) < position)
  assert.ok(position < entry.indexOf('express.json('))
  assert.ok(position < entry.indexOf("app.use('/api/v1/public',"))
  assert.ok(entry.includes('limit: 400')); assert.equal(entry.match(/mountSanityBlogApi\(app\)/g).length, 1)
  assert.ok(entry.includes("app.use('/api/public', publicRouter)"))
})
