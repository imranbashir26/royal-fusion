import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { publicTesterPacksApi } from '../src/services/publicTesterPacksApi.ts'
import { getFixedPackLineId, getConfigurablePackLineId, createCartStore } from '../src/store/cartStore.ts'

function memoryStorage(initial) {
  const values = new Map(initial ? [['royal-fusion-cart', JSON.stringify(initial)]] : [])
  return {
    getItem: (key = 'royal-fusion-cart') => values.get(key) ?? null,
    setItem: (key, next) => { values.set(key, next) },
    removeItem: (key = 'royal-fusion-cart') => { values.delete(key) },
  }
}

// Mock tester options
const sampleTesters = [
  {
    testerVariantId: '11111111-1111-4111-8111-111111111111',
    productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Royal Oud 5 ml',
    sku: 'RF-OUD-5ML',
    volumeMl: 5,
    regularPrice: 500,
    salePrice: 450,
    effectivePrice: 450,
    saleActive: true,
    stockQuantity: 10,
    displayOrder: 1,
  },
  {
    testerVariantId: '22222222-2222-4222-8222-222222222222',
    productId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Velvet Rose 5 ml',
    sku: 'RF-ROSE-5ML',
    volumeMl: 5,
    regularPrice: 400,
    salePrice: null,
    effectivePrice: 400,
    saleActive: false,
    stockQuantity: 5,
    displayOrder: 2,
  },
  {
    testerVariantId: '33333333-3333-4333-8333-333333333333',
    productId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    name: 'Amber Night 5 ml',
    sku: 'RF-AMBER-5ML',
    volumeMl: 5,
    regularPrice: 600,
    salePrice: null,
    effectivePrice: 600,
    saleActive: false,
    stockQuantity: 2,
    displayOrder: 3,
  },
]

// Mock fixed pack
const fixedPack = {
  id: '44444444-4444-4444-8444-444444444444',
  packId: '44444444-4444-4444-8444-444444444444',
  commerceKind: 'tester_pack',
  name: 'Signature Trio Discovery Set',
  slug: 'signature-trio-discovery-set',
  sku: 'RF-PACK-TRIO',
  image: '/images/trio.webp',
  gallery: ['/images/trio-1.webp', '/images/trio-2.webp'],
  description: 'Three authentic 5 ml testers of our signature perfumes.',
  shortDescription: 'Curated 3-fragrance discovery set.',
  scentFamily: 'Oriental Woody',
  categoryId: null,
  status: 'Published',
  active: true,
  catalogRevision: '2',
  definitionRevision: '1',
  mode: 'fixed',
  minimumUnits: null,
  maximumUnits: null,
  fixedRegularPrice: 1400,
  fixedSalePrice: 1250,
  regularPrice: 1400,
  salePrice: 1250,
  effectivePrice: 1250,
  saleActive: true,
  manualAvailable: true,
  available: true,
  availablePackCount: 8,
  components: [
    { ...sampleTesters[0], quantityPerPack: 1 },
    { ...sampleTesters[1], quantityPerPack: 1 },
    { ...sampleTesters[2], quantityPerPack: 1 },
  ],
  allowedVariants: [],
}

// Mock configurable pack
const configurablePack = {
  id: '55555555-5555-4555-8555-555555555555',
  packId: '55555555-5555-4555-8555-555555555555',
  commerceKind: 'tester_pack',
  name: 'Bespoke Discovery Set',
  slug: 'bespoke-discovery-set',
  sku: 'RF-PACK-BESPOKE',
  image: '/images/bespoke.webp',
  gallery: [],
  description: 'Choose any 3 to 5 fragrances to build your custom discovery set.',
  shortDescription: 'Build your own 3 to 5 tester pack.',
  scentFamily: 'Custom Discovery',
  categoryId: null,
  status: 'Published',
  active: true,
  catalogRevision: '3',
  definitionRevision: '2',
  mode: 'configurable',
  minimumUnits: 3,
  maximumUnits: 5,
  fixedRegularPrice: null,
  fixedSalePrice: null,
  regularPrice: null,
  salePrice: null,
  effectivePrice: null,
  saleActive: false,
  manualAvailable: true,
  available: true,
  availablePackCount: null,
  components: [],
  allowedVariants: sampleTesters,
}

test('publicTesterPacksApi.getBySlugOrId resolves UUID directly and slug via list', async () => {
  const originalFetch = globalThis.fetch
  try {
    // 1. UUID lookup
    globalThis.fetch = async (url) => {
      if (url.includes('/api/v2/public/tester-packs/44444444-4444-4444-8444-444444444444')) {
        return {
          ok: true,
          json: async () => ({ data: fixedPack }),
        }
      }
      if (url.includes('/api/v2/public/tester-packs?page=1&pageSize=100')) {
        return {
          ok: true,
          json: async () => ({
            data: {
              items: [fixedPack, configurablePack],
              total: 2,
              totalPages: 1,
            },
          }),
        }
      }
      throw new Error(`Unexpected url: ${url}`)
    }

    const byId = await publicTesterPacksApi.getBySlugOrId('44444444-4444-4444-8444-444444444444')
    assert.ok(byId)
    assert.equal(byId.id, fixedPack.id)
    assert.equal(byId.mode, 'fixed')

    // 2. Slug lookup
    const bySlug = await publicTesterPacksApi.getBySlugOrId('bespoke-discovery-set')
    assert.ok(bySlug)
    assert.equal(bySlug.id, configurablePack.id)
    assert.equal(bySlug.mode, 'configurable')
    assert.equal(bySlug.minimumUnits, 3)
    assert.equal(bySlug.maximumUnits, 5)

    // 3. Non-existent slug returns null
    const notFound = await publicTesterPacksApi.getBySlugOrId('non-existent-pack')
    assert.equal(notFound, null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Fixed pack add to cart generates canonical line ID and enforces available count', () => {
  const store = createCartStore(memoryStorage())

  const expectedLineId = getFixedPackLineId(fixedPack.id, fixedPack.definitionRevision)
  assert.equal(expectedLineId, JSON.stringify(['fixed_tester_pack', fixedPack.id.toLowerCase(), '1']))

  // Add 2 sets
  const added = store.getState().addFixedPack(fixedPack, 2)
  assert.equal(added, true)

  const items = store.getState().items
  assert.equal(items.length, 1)
  assert.equal(items[0].lineId, expectedLineId)
  assert.equal(items[0].kind, 'fixed_tester_pack')
  assert.equal(items[0].quantity, 2)
  assert.equal(items[0].name, fixedPack.name)

  // Adding more than availablePackCount (8) fails
  const excess = store.getState().addFixedPack(fixedPack, 7) // 2 + 7 = 9 > 8
  assert.equal(excess, false)
  assert.equal(store.getState().items[0].quantity, 2)
})

test('Configurable pack builder validates minimum and maximum slot constraints', () => {
  const store = createCartStore(memoryStorage())

  // Case A: 2 units selected, but pack requires minimum 3 -> rejected by cartStore
  const underMinimumSelections = [
    { variantId: sampleTesters[0].testerVariantId, quantityPerPack: 1, testerName: sampleTesters[0].name },
    { variantId: sampleTesters[1].testerVariantId, quantityPerPack: 1, testerName: sampleTesters[1].name },
  ]
  const underMin = store.getState().addConfigurablePack(configurablePack, underMinimumSelections, 1)
  assert.equal(underMin, false)
  assert.equal(store.getState().items.length, 0)

  // Case B: 6 units selected, but pack specifies maximum 5 -> rejected by cartStore
  const overMaximumSelections = [
    { variantId: sampleTesters[0].testerVariantId, quantityPerPack: 2, testerName: sampleTesters[0].name },
    { variantId: sampleTesters[1].testerVariantId, quantityPerPack: 2, testerName: sampleTesters[1].name },
    { variantId: sampleTesters[2].testerVariantId, quantityPerPack: 2, testerName: sampleTesters[2].name },
  ]
  const overMax = store.getState().addConfigurablePack(configurablePack, overMaximumSelections, 1)
  assert.equal(overMax, false)
  assert.equal(store.getState().items.length, 0)

  // Case C: 4 units selected (within [3, 5]) -> accepted
  const validSelections = [
    { variantId: sampleTesters[0].testerVariantId, quantityPerPack: 2, testerName: sampleTesters[0].name },
    { variantId: sampleTesters[1].testerVariantId, quantityPerPack: 1, testerName: sampleTesters[1].name },
    { variantId: sampleTesters[2].testerVariantId, quantityPerPack: 1, testerName: sampleTesters[2].name },
  ]
  const success = store.getState().addConfigurablePack(configurablePack, validSelections, 1)
  assert.equal(success, true)

  const items = store.getState().items
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'configurable_tester_pack')
  assert.equal(items[0].quantity, 1)

  const expectedLineId = getConfigurablePackLineId(
    configurablePack.id,
    configurablePack.definitionRevision,
    validSelections,
  )
  assert.equal(items[0].lineId, expectedLineId)
  assert.deepEqual(items[0].selections.length, 3)

  // Financial calculation of this bespoke pack:
  // 2x Royal Oud (450) + 1x Velvet Rose (400) + 1x Amber Night (600) = 900 + 400 + 600 = 1900
  const calculatedUnitPrice = validSelections.reduce((sum, s) => {
    const v = sampleTesters.find((t) => t.testerVariantId === s.variantId)
    return sum + (v.effectivePrice ?? v.regularPrice) * s.quantityPerPack
  }, 0)
  assert.equal(calculatedUnitPrice, 1900)
})

test('Navbar and App routing integrate public discovery pack entry points', () => {
  const appCode = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const navbarCode = readFileSync(new URL('../src/components/layout/Navbar.tsx', import.meta.url), 'utf8')

  // App.tsx routes
  assert.match(appCode, /path="\/discovery-packs"/)
  assert.match(appCode, /path="\/discovery-packs\/:slugOrId"/)
  assert.match(appCode, /path="\/tester-packs"/)
  assert.match(appCode, /path="\/tester-packs\/:slugOrId"/)

  // Navbar.tsx links
  assert.match(navbarCode, /to="\/discovery-packs"/)
  assert.match(navbarCode, /Discovery Packs/)
  assert.match(navbarCode, /isDiscoveryPacksActive/)
})

test('CartDrawer provides configurable tester pack selections and quantity controls', () => {
  const cartDrawerCode = readFileSync(
    new URL('../src/components/layout/CartDrawer.tsx', import.meta.url),
    'utf8',
  )
  assert.match(cartDrawerCode, /item\.kind === 'configurable_tester_pack'/)
  assert.match(cartDrawerCode, /Included:/)
  assert.match(cartDrawerCode, /disabled=\{!item\.eligible\}/)
})
