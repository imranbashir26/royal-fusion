import { parse, evaluate } from 'groq-js'
import net from 'node:net'
import { makeBlogDocuments } from './blogFixtures.js'

/** Disposable raw documents: the adapter must dereference these using the real centralized GROQ. */
export function makeSanityBlogDocuments() {
  const records = new Map()
  const image = value => {
    records.set(value.asset._id, structuredClone(value.asset))
    return { ...structuredClone(value), asset: { _type: 'reference', _ref: value.asset._id } }
  }
  const posts = makeBlogDocuments().map(value => {
    records.set(value.author._id, structuredClone(value.author))
    records.set(value.category._id, structuredClone(value.category))
    return { ...structuredClone(value),
      author: { _type: 'reference', _ref: value.author._id },
      category: { _type: 'reference', _ref: value.category._id },
      featuredImage: image(value.featuredImage),
      ogImage: value.ogImage ? image(value.ogImage) : null,
      body: value.body.map(node => node._type === 'image' ? image(node) : structuredClone(node)),
    }
  })
  return [...posts, ...records.values(),
    { _id: 'drafts.author-a', _type: 'author', name: 'PRIVATE_FIXTURE_DRAFT_AUTHOR' },
    { _id: 'versions.release.category-a', _type: 'blogCategory', title: 'PRIVATE_FIXTURE_RELEASE_CATEGORY' },
  ]
}

export function createSanityBlogClientFixture(documents = makeSanityBlogDocuments(), { honorPerspective = true } = {}) {
  const records = structuredClone(documents), calls = []
  return { records, calls, client: {
    async fetch(query, params, options) {
      calls.push({ query, params: structuredClone(params), options })
      if (options.perspective !== 'published' || options.useCdn !== false) throw new Error('Incorrect fixture publication options.')
      const dataset = honorPerspective ? records.filter(value => !value._id.includes('.')) : records
      // The parser resolves parameterized slice bounds; no query-specific canned return values.
      const expression = parse(query, { params })
      return structuredClone(await (await evaluate(expression, { dataset, params })).get())
    },
  } }
}

/** Blocks outbound sockets before DNS/connect; isolated HTTP tests may use loopback only. */
export function blockExternalBlogTestNetwork() {
  const originalConnect = net.Socket.prototype.connect, originalFetch = globalThis.fetch
  const attempts = []
  const assertLoopback = host => {
    if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
      attempts.push(host)
      throw new Error('External network is prohibited in blog adapter fixtures.')
    }
  }
  net.Socket.prototype.connect = function (...input) {
    const args = Array.isArray(input[0]) ? input[0] : input
    const options = args[0]
    const host = typeof options === 'object' ? options.host || options.hostname || 'localhost'
      : typeof args[1] === 'string' ? args[1] : 'localhost'
    assertLoopback(host)
    return originalConnect.apply(this, input)
  }
  globalThis.fetch = (input, options) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    assertLoopback(url.hostname)
    return originalFetch(input, options)
  }
  return { attempts, restore() { net.Socket.prototype.connect = originalConnect; globalThis.fetch = originalFetch } }
}
