import assert from 'node:assert/strict'
import test from 'node:test'
import { validPricingEvidence, moneyCents } from '../src/services/checkoutPricing.ts'
import { isQuote, isOrderReceipt } from '../src/services/checkoutClient.ts'

const V1 = 'b35b3be7-a7dd-4c70-9c14-d1a9394d4711'
const V2 = '1f13a011-20fb-4c1d-930c-fe42a420ed5e'
const V3 = '2f13a011-20fb-4c1d-930c-fe42a420ed5e'
const PACK1 = 'fd007e9b-fa2c-4d90-9202-24771cfda807'
const PACK2 = 'ad007e9b-fa2c-4d90-9202-24771cfda807'
const ITEM1 = 'c1007e9b-fa2c-4d90-9202-24771cfda807'
const ITEM2 = 'c2007e9b-fa2c-4d90-9202-24771cfda807'

test('1. Valid normal variant quotation', () => {
  const quote = {
    contractVersion: 2, subtotal: 2900,
    lines: [{ kind: 'normal_variant', variantId: V1, quantity: 1, unitPrice: 2900, lineTotal: 2900 }]
  }
  assert.equal(validPricingEvidence(quote), true)
})

test('2. Valid standalone tester quotation', () => {
  const quote = {
    contractVersion: 2, subtotal: 500,
    lines: [{ kind: 'normal_variant', variantId: V2, quantity: 2, unitPrice: 250, lineTotal: 500 }]
  }
  assert.equal(validPricingEvidence(quote), true)
})

test('3. Valid fixed tester-pack quotation', () => {
  const quote = {
    contractVersion: 2, subtotal: 750,
    lines: [{ kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', quantity: 1, unitPrice: 750, lineTotal: 750 }]
  }
  assert.equal(validPricingEvidence(quote), true)
})

test('4. Valid configurable tester-pack quotation', () => {
  const quote = {
    contractVersion: 2, subtotal: 800,
    lines: [{
      kind: 'configurable_tester_pack', packId: PACK2, definitionRevision: '1', quantity: 1, unitPrice: 800, lineTotal: 800,
      selections: [{ variantId: V2, quantityPerPack: 1 }, { variantId: V3, quantityPerPack: 2 }]
    }]
  }
  assert.equal(validPricingEvidence(quote), true)
})

test('5. Mixed normal and pack quotation', () => {
  const quote = {
    contractVersion: 2, subtotal: 4450,
    lines: [
      { kind: 'normal_variant', variantId: V1, quantity: 1, unitPrice: 2900, lineTotal: 2900 },
      { kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', quantity: 1, unitPrice: 750, lineTotal: 750 },
      {
        kind: 'configurable_tester_pack', packId: PACK2, definitionRevision: '1', quantity: 1, unitPrice: 800, lineTotal: 800,
        selections: [{ variantId: V2, quantityPerPack: 1 }, { variantId: V3, quantityPerPack: 2 }]
      }
    ]
  }
  assert.equal(validPricingEvidence(quote), true)
})

test('6. Distinct configurable selections of the same pack', () => {
  const quote = {
    contractVersion: 2, subtotal: 1600,
    lines: [
      {
        kind: 'configurable_tester_pack', packId: PACK2, definitionRevision: '1', quantity: 1, unitPrice: 800, lineTotal: 800,
        selections: [{ variantId: V2, quantityPerPack: 2 }]
      },
      {
        kind: 'configurable_tester_pack', packId: PACK2, definitionRevision: '1', quantity: 1, unitPrice: 800, lineTotal: 800,
        selections: [{ variantId: V3, quantityPerPack: 2 }]
      }
    ]
  }
  assert.equal(validPricingEvidence(quote), true)
})

test('7. Duplicate normal variant quotation line', () => {
  const quote = {
    contractVersion: 2, subtotal: 5800,
    lines: [
      { kind: 'normal_variant', variantId: V1, quantity: 1, unitPrice: 2900, lineTotal: 2900 },
      { kind: 'normal_variant', variantId: V1, quantity: 1, unitPrice: 2900, lineTotal: 2900 }
    ]
  }
  assert.equal(validPricingEvidence(quote), false)
})

test('8. Duplicate pack line under the canonical duplicate rules', () => {
  const duplicateFixed = {
    contractVersion: 2, subtotal: 1500,
    lines: [
      { kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', quantity: 1, unitPrice: 750, lineTotal: 750 },
      { kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', quantity: 1, unitPrice: 750, lineTotal: 750 }
    ]
  }
  assert.equal(validPricingEvidence(duplicateFixed), false)

  const duplicateConfigurable = {
    contractVersion: 2, subtotal: 1600,
    lines: [
      {
        kind: 'configurable_tester_pack', packId: PACK2, definitionRevision: '1', quantity: 1, unitPrice: 800, lineTotal: 800,
        selections: [{ variantId: V2, quantityPerPack: 2 }]
      },
      {
        kind: 'configurable_tester_pack', packId: PACK2, definitionRevision: '1', quantity: 1, unitPrice: 800, lineTotal: 800,
        selections: [{ variantId: V2, quantityPerPack: 2 }]
      }
    ]
  }
  assert.equal(validPricingEvidence(duplicateConfigurable), false)
})

test('9. Missing packId', () => {
  const quote = {
    contractVersion: 2, subtotal: 750,
    lines: [{ kind: 'fixed_tester_pack', definitionRevision: '1', quantity: 1, unitPrice: 750, lineTotal: 750 }]
  }
  assert.equal(validPricingEvidence(quote), false)
})

test('10. Invalid packId', () => {
  const quote = {
    contractVersion: 2, subtotal: 750,
    lines: [{ kind: 'fixed_tester_pack', packId: 'invalid-not-uuid', definitionRevision: '1', quantity: 1, unitPrice: 750, lineTotal: 750 }]
  }
  assert.equal(validPricingEvidence(quote), false)
})

test('11. Missing or malformed definitionRevision', () => {
  assert.equal(validPricingEvidence({
    contractVersion: 2, subtotal: 750,
    lines: [{ kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '', quantity: 1, unitPrice: 750, lineTotal: 750 }]
  }), false)

  assert.equal(validPricingEvidence({
    contractVersion: 2, subtotal: 750,
    lines: [{ kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '0', quantity: 1, unitPrice: 750, lineTotal: 750 }]
  }), false)

  assert.equal(validPricingEvidence({
    contractVersion: 2, subtotal: 750,
    lines: [{ kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: 'not-digits', quantity: 1, unitPrice: 750, lineTotal: 750 }]
  }), false)

  assert.equal(validPricingEvidence({
    contractVersion: 2, subtotal: 750,
    lines: [{ kind: 'fixed_tester_pack', packId: PACK1, quantity: 1, unitPrice: 750, lineTotal: 750 }]
  }), false)
})

test('12. Missing required configurable identity metadata', () => {
  const quote = {
    contractVersion: 2, subtotal: 800,
    lines: [{ kind: 'configurable_tester_pack', packId: PACK2, definitionRevision: '1', quantity: 1, unitPrice: 800, lineTotal: 800 }]
  }
  assert.equal(validPricingEvidence(quote), false)
})

test('13. Unsupported line kind', () => {
  const quote = {
    contractVersion: 2, subtotal: 750,
    lines: [{ kind: 'mystery_tester_pack', packId: PACK1, definitionRevision: '1', quantity: 1, unitPrice: 750, lineTotal: 750 }]
  }
  assert.equal(validPricingEvidence(quote), false)
})

test('14. Invalid quantity', () => {
  assert.equal(validPricingEvidence({
    contractVersion: 2, subtotal: 750,
    lines: [{ kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', quantity: 0, unitPrice: 750, lineTotal: 750 }]
  }), false)

  assert.equal(validPricingEvidence({
    contractVersion: 2, subtotal: 750,
    lines: [{ kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', quantity: -1, unitPrice: 750, lineTotal: 750 }]
  }), false)

  assert.equal(validPricingEvidence({
    contractVersion: 2, subtotal: 750,
    lines: [{ kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', quantity: 1.5, unitPrice: 750, lineTotal: 750 }]
  }), false)

  assert.equal(validPricingEvidence({
    contractVersion: 2, subtotal: 750,
    lines: [{ kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', quantity: 2147483648, unitPrice: 750, lineTotal: 750 }]
  }), false)
})

test('15. Incorrect lineTotal arithmetic', () => {
  const quote = {
    contractVersion: 2, subtotal: 1500,
    lines: [{ kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', quantity: 2, unitPrice: 750, lineTotal: 1400 }]
  }
  assert.equal(validPricingEvidence(quote), false)
})

test('16. Incorrect subtotal arithmetic', () => {
  const quote = {
    contractVersion: 2, subtotal: 1000,
    lines: [{ kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', quantity: 1, unitPrice: 750, lineTotal: 750 }]
  }
  assert.equal(validPricingEvidence(quote), false)
})

test('17. Invalid price precision', () => {
  const quote = {
    contractVersion: 2, subtotal: 750.555,
    lines: [{ kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', quantity: 1, unitPrice: 750.555, lineTotal: 750.555 }]
  }
  assert.equal(validPricingEvidence(quote), false)
})

test('18. Valid frozen pack receipt', () => {
  const receipt = {
    contractVersion: 2, subtotal: 750,
    lines: [{ id: ITEM1, kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', quantity: 1, unitPrice: 750, lineTotal: 750, variantId: null }]
  }
  assert.equal(validPricingEvidence(receipt, true), true)
})

test('19. Malformed frozen pack receipt', () => {
  assert.equal(validPricingEvidence({
    contractVersion: 2, subtotal: 750,
    lines: [{ id: 'not-a-valid-uuid', kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', quantity: 1, unitPrice: 750, lineTotal: 750, variantId: null }]
  }, true), false)

  assert.equal(validPricingEvidence({
    contractVersion: 2, subtotal: 750,
    lines: [{ kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', quantity: 1, unitPrice: 750, lineTotal: 750, variantId: null }]
  }, true), false)
})

test('20. Existing V1 quote/receipt compatibility', () => {
  const v1Quote = {
    subtotal: 2900,
    lines: [{ variantId: V1, quantity: 1, unitPrice: 2900, lineTotal: 2900 }]
  }
  assert.equal(validPricingEvidence(v1Quote), true)

  const v1Receipt = {
    subtotal: 2900,
    lines: [{ id: ITEM1, variantId: V1, quantity: 1, unitPrice: 2900, lineTotal: 2900 }]
  }
  assert.equal(validPricingEvidence(v1Receipt, true), true)

  const v1NoLines = { subtotal: 2900 }
  assert.equal(validPricingEvidence(v1NoLines, true), true)
})

test('Explicit null and undefined variantId behavior', () => {
  // Normal variant: null variantId rejected
  assert.equal(validPricingEvidence({ contractVersion: 2, subtotal: 2900, lines: [{ kind: 'normal_variant', variantId: null, quantity: 1, unitPrice: 2900, lineTotal: 2900 }] }), false)
  // Normal variant: undefined variantId rejected
  assert.equal(validPricingEvidence({ contractVersion: 2, subtotal: 2900, lines: [{ kind: 'normal_variant', quantity: 1, unitPrice: 2900, lineTotal: 2900 }] }), false)

  // Fixed pack quote: null variantId rejected
  assert.equal(validPricingEvidence({ contractVersion: 2, subtotal: 750, lines: [{ kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', variantId: null, quantity: 1, unitPrice: 750, lineTotal: 750 }] }), false)
  // Fixed pack quote: undefined variantId accepted
  assert.equal(validPricingEvidence({ contractVersion: 2, subtotal: 750, lines: [{ kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', quantity: 1, unitPrice: 750, lineTotal: 750 }] }), true)
  // Fixed pack quote: string variantId rejected
  assert.equal(validPricingEvidence({ contractVersion: 2, subtotal: 750, lines: [{ kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', variantId: V1, quantity: 1, unitPrice: 750, lineTotal: 750 }] }), false)

  // Fixed pack receipt: null variantId accepted
  assert.equal(validPricingEvidence({ contractVersion: 2, subtotal: 750, lines: [{ id: ITEM1, kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', variantId: null, quantity: 1, unitPrice: 750, lineTotal: 750 }] }, true), true)
  // Fixed pack receipt: undefined variantId accepted
  assert.equal(validPricingEvidence({ contractVersion: 2, subtotal: 750, lines: [{ id: ITEM1, kind: 'fixed_tester_pack', packId: PACK1, definitionRevision: '1', quantity: 1, unitPrice: 750, lineTotal: 750 }] }, true), true)
})
