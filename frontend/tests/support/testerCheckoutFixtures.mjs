import { createHash, randomUUID } from 'node:crypto'

export const testVariantId = '11111111-1111-4111-8111-111111111111'
export const testPackId = '44444444-4444-4444-8444-444444444444'
export const testProductId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const memoryStorage = () => {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}

// Explicit HTTP snapshots for transport/recovery tests, not assertions about SQL pricing.
export function testerQuote(lines, overrides = {}) {
  const quoted = lines.map(line => {
    const selections = line.kind === 'configurable_tester_pack'
      ? [...line.selections].sort((a, b) => a.variantId.localeCompare(b.variantId)) : []
    const identity = line.kind === 'normal_variant' ? [line.kind, line.variantId]
      : line.kind === 'fixed_tester_pack' ? [line.kind, line.packId, line.definitionRevision]
      : [line.kind, line.packId, line.definitionRevision, selections.map(s => [s.variantId, s.quantityPerPack])]
    const members = line.kind === 'normal_variant' ? [] : selections.length ? selections : [{ variantId: testVariantId, quantityPerPack: 2 }]
    const unitPrice = line.kind === 'normal_variant' ? 2900 : line.kind === 'fixed_tester_pack' ? 1250 : members.reduce((sum, s) => sum + 450 * s.quantityPerPack, 0)
    return { ...line, identity, identityHash: createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
      productId: line.packId ?? testProductId, name: line.kind === 'normal_variant' ? 'Baraan' : 'Discovery Pack', sku: 'RF-FIXTURE', size: '5 ml',
      ...(line.packId ? { definitionFingerprint: 'd'.repeat(64) } : {}), unitPrice, lineTotal: unitPrice * line.quantity,
      components: members.map((s, position) => ({ testerVariantId: s.variantId, testerProductId: testProductId,
        testerName: 'Royal Oud 5 ml', sku: 'RF-OUD-5ML', size: '5 ml', volumeMl: 5, quantityPerPack: s.quantityPerPack,
        totalPhysicalQuantity: s.quantityPerPack * line.quantity, referenceUnitPrice: 450, position })) }
  }).sort((a, b) => JSON.stringify(a.identity).localeCompare(JSON.stringify(b.identity)))
    .map((line, position) => ({ ...line, position }))
  const subtotal = quoted.reduce((sum, line) => sum + line.lineTotal, 0)
  return { contractVersion: 2, quoteFingerprint: 'c'.repeat(64), lines: quoted, subtotal, discount: 0, shippingFee: 250,
    total: subtotal + 250, currency: 'PKR', shippingMethodId: '60000000-0000-4000-8000-000000000001',
    paymentMethods: ['Cash on Delivery'], orderingEnabled: false, ...overrides }
}

export function testerReceipt(request, overrides = {}) {
  const { orderingEnabled, shippingMethodId, paymentMethods, ...quote } = testerQuote(request.lines)
  return { ...quote, snapshotVersion: 2, id: randomUUID(), idempotencyKey: request.idempotencyKey,
    orderNumber: 'RF-20261018-1234ABCD', status: 'Pending', paymentStatus: 'Unpaid', paymentMethod: request.paymentMethod,
    idempotent: false, requestFingerprint: 'e'.repeat(64), quoteFingerprint: request.quoteFingerprint,
    lines: quote.lines.map(line => ({ ...line, id: randomUUID(), components: line.components.map(c => ({ ...c, id: randomUUID() })) })),
    ...overrides }
}
