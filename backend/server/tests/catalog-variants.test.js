import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { catalogVariantsSchema, toCatalogVariants, normalizeOption } from '../schemas/catalogVariants.js'
import { createCatalogDatabase, saveCatalog } from './support/catalogDatabase.js'

function product(overrides = {}) {
  const key = randomUUID()
  return { name: 'Test fragrance', slug: key, sku: key, price: 2900,
    sale_price: 0, stock_quantity: 12, bottle_size: '50ml', status: 'Published',
    scent_family: 'Fresh', main_image_url: 'https://example.invalid/product.webp', ...overrides }
}
function variant(overrides = {}) {
  return { optionName: 'Size', optionValue: '50 ml', sku: randomUUID(), regularPrice: 2900,
    salePrice: null, stockQuantity: 12, active: true, displayOrder: 0, ...overrides }
}

test('normalized contract rejects duplicate identities, options and prices', () => {
  assert.equal(normalizeOption('  50ML  '), '50 ml')
  assert.equal(normalizeOption('100   ml'), '100 ml')
  assert.equal(toCatalogVariants({ variants: [variant({ salePrice: 0 })] })[0].salePrice, null)
  assert.throws(() => catalogVariantsSchema.parse([variant({ regularPrice: 0 })]))
  assert.throws(() => catalogVariantsSchema.parse([variant({ salePrice: 3000 })]))
  assert.throws(() => catalogVariantsSchema.parse([variant(), variant({ optionValue: '50ml' })]))
  assert.throws(() => catalogVariantsSchema.parse([variant({ sku: 'DUP' }), variant({ sku: 'dup', optionValue: '30ml' })]))
})

test('real PostgreSQL catalog transaction lifecycle', async (t) => {
  const db = await createCatalogDatabase()
  t.after(() => db.close())
  await t.test('single-size maps all fields and preserves UUID through price, stock and size edits', async () => {
    const created = await saveCatalog(db, null, product())
    assert.equal(created.variants.length, 1)
    const v = created.variants[0]
    assert.equal(v.product_id, created.product.id)
    assert.equal(v.option_name, 'Size')
    assert.equal(v.option_value, '50 ml')
    assert.equal(v.sku, created.product.sku)
    assert.equal(Number(v.regular_price), 2900)
    assert.equal(v.sale_price, null)
    assert.equal(v.stock_quantity, 12)
    assert.equal(v.active, true)
    assert.equal(v.available, true)
    const updated = await saveCatalog(db, created.product.id, { price: 3100, stock_quantity: 7, bottle_size: '100ML' })
    assert.equal(updated.variants[0].id, v.id)
    assert.equal(Number(updated.variants[0].regular_price), 3100)
    assert.equal(updated.variants[0].stock_quantity, 7)
    assert.equal(updated.product.stock_quantity, 7)
    assert.equal(updated.variants[0].option_value, '100 ml')
    const empty = await saveCatalog(db, created.product.id, { stock_quantity: 0, sale_price: 0 })
    assert.equal(empty.product.stock_quantity, 0)
    assert.equal(empty.variants[0].available, false)
    const metadata = await saveCatalog(db, created.product.id, { description: 'New copy' })
    assert.equal(metadata.variants[0].stock_quantity, 0)
  })
  await t.test('variant failure rolls back inserted product and modified product/variant', async () => {
    const p = product()
    const count = (await db.query('select count(*)::int as n from public.products')).rows[0].n
    await assert.rejects(saveCatalog(db, null, p, [variant({ regularPrice: -1 })]), { code: '23514' })
    assert.equal((await db.query('select count(*)::int as n from public.products')).rows[0].n, count)
    const created = await saveCatalog(db, null, product())
    await assert.rejects(saveCatalog(db, created.product.id, { name: 'Must rollback' }, [
      variant({ id: created.variants[0].id }), variant({ optionValue: '100 ml', regularPrice: -1 }),
    ]), { code: '23514' })
    const after = (await db.query('select name from public.products where id = $1', [created.product.id])).rows[0]
    assert.equal(after.name, created.product.name)
    assert.equal((await db.query('select count(*)::int as n from public.product_variants where product_id = $1', [created.product.id])).rows[0].n, 1)
  })
  await t.test('multi-size upserts stable identities, retains omitted options and derives active stock', async () => {
    const created = await saveCatalog(db, null, product(), [variant({ optionValue: '30ml', stockQuantity: 3 }),
      variant({ optionValue: '50ml', stockQuantity: 4, displayOrder: 1 })])
    assert.equal(created.variants.length, 2)
    assert.equal(created.product.stock_quantity, 7)
    const first = created.variants[0]
    const updated = await saveCatalog(db, created.product.id, { description: 'Updated' }, [
      variant({ id: first.id, sku: first.sku, optionValue: '100 ml', stockQuantity: 8 }),
    ])
    assert.equal(updated.variants.length, 2)
    assert.equal(updated.variants[0].id, first.id)
    assert.equal(updated.product.stock_quantity, 12)
    await assert.rejects(saveCatalog(db, created.product.id, { stock_quantity: 99 }), { code: '22023' })
    const unchanged = await saveCatalog(db, created.product.id, { name: 'Metadata only' })
    assert.equal(unchanged.product.stock_quantity, 12)
    const variantsOnly = await saveCatalog(db, created.product.id, {}, [
      variant({ id: first.id, sku: first.sku, optionValue: '100 ml', stockQuantity: 2 }),
    ])
    assert.equal(variantsOnly.product.stock_quantity, 6)
    assert.equal(variantsOnly.variants[0].id, first.id)
    assert.equal(variantsOnly.product.name, 'Metadata only')
    await assert.rejects(saveCatalog(db, created.product.id, {}), { code: '22023' })
    await assert.rejects(saveCatalog(db, created.product.id, { name: 'Rollback ambiguous identity' }, [
      variant({ optionValue: '100 ml', sku: created.variants[1].sku }),
    ]), { code: '23505' })
    const inactive = await saveCatalog(db, created.product.id, {}, [
      variant({ id: first.id, sku: first.sku, optionValue: '100 ml', stockQuantity: 20, active: false }),
    ])
    assert.equal(inactive.product.stock_quantity, 4)
  })
  await t.test('SKU, normalized-option and foreign-variant conflicts fail cleanly', async () => {
    const a = await saveCatalog(db, null, product())
    await assert.rejects(saveCatalog(db, null, product(), [variant({ sku: a.variants[0].sku })]), { code: '23505' })
    await assert.rejects(saveCatalog(db, null, product(), [variant(), variant({ optionValue: '50ML' })]), { code: '23505' })
    await assert.rejects(saveCatalog(db, null, product(), [variant({ id: a.variants[0].id })]), { code: '22023' })
  })
  await t.test('legacy variation edits resolve the same SKU, and unambiguous options; archived sizes are retained', async () => {
    const input = toCatalogVariants({ variations: [{ name: '50ML', price: 2900, salePrice: 0,
      sku: randomUUID(), stock: 12, active: true }] })
    const created = await saveCatalog(db, null, product(), input)
    const changed = await saveCatalog(db, created.product.id, { description: 'Size changed' }, [
      variant({ sku: created.variants[0].sku, optionValue: '100ml', stockQuantity: 9 }),
    ])
    assert.equal(changed.variants.length, 1)
    assert.equal(changed.variants[0].id, created.variants[0].id)
    assert.equal(changed.variants[0].option_value, '100 ml')
    const skuEdit = await saveCatalog(db, changed.product.id, {}, [
      variant({ optionValue: '100 ml', sku: randomUUID(), stockQuantity: 9 }),
    ])
    assert.equal(skuEdit.variants[0].id, changed.variants[0].id)
    const draft = await saveCatalog(db, changed.product.id, { status: 'Draft' }, [
      variant({ id: skuEdit.variants[0].id, sku: skuEdit.variants[0].sku, active: false }),
    ])
    assert.equal(draft.product.stock_quantity, 0)
    await assert.rejects(saveCatalog(db, draft.product.id, { status: 'Published' }), { code: '22023' })
  })
  await t.test('metadata-only reconciliation creates a missing legacy default once, without copying stock twice', async () => {
    const p = product()
    const { rows } = await db.query(`insert into public.products(name,slug,sku,price,sale_price,stock_quantity,bottle_size,status,scent_family,main_image_url)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [p.name,p.slug,p.sku,p.price,p.sale_price,p.stock_quantity,p.bottle_size,p.status,p.scent_family,p.main_image_url])
    const first = await saveCatalog(db, rows[0].id, { description: 'Reviewed reconciliation' })
    assert.equal(first.variants[0].stock_quantity, 12)
    assert.equal(first.variants[0].option_value, '50 ml')
    const second = await saveCatalog(db, rows[0].id, { description: 'Repeat save' })
    assert.equal(second.variants.length, 1)
    assert.equal(second.variants[0].id, first.variants[0].id)
    assert.equal(second.product.stock_quantity, 12)
    const legacyDraft = product({ status: 'Draft', bottle_size: '' })
    const draftRow = (await db.query(`insert into public.products(name,slug,sku,price,stock_quantity,status,scent_family,main_image_url)
      values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [legacyDraft.name,legacyDraft.slug,legacyDraft.sku,legacyDraft.price,legacyDraft.stock_quantity,legacyDraft.status,
      legacyDraft.scent_family,legacyDraft.main_image_url])).rows[0]
    await assert.rejects(saveCatalog(db, draftRow.id, { description: 'Must not discard stock' }), { code: '22023' })
    assert.equal((await db.query('select stock_quantity from public.products where id = $1', [draftRow.id])).rows[0].stock_quantity, 12)
  })
  await t.test('draft without size has no inventory; publishing requires variant; archival preserves identities', async () => {
    const draft = await saveCatalog(db, null, product({ status: 'Draft', bottle_size: '', stock_quantity: 0 }))
    assert.equal(draft.variants.length, 0)
    await assert.rejects(saveCatalog(db, draft.product.id, { status: 'Published' }), { code: '22023' })
    const published = await saveCatalog(db, draft.product.id, { status: 'Published', bottle_size: '50 ml', stock_quantity: 12 })
    assert.equal(published.variants.length, 1)
    const archived = await saveCatalog(db, published.product.id, { status: 'Archived', active: false })
    assert.equal(archived.variants[0].id, published.variants[0].id)
    assert.equal(archived.product.active, false)
    await assert.rejects(saveCatalog(db, null, product({ bottle_size: '' })), { code: '22023' })
  })
  await t.test('RPC denies browser execution and non-service claims; migration can replay without data changes', async () => {
    const acl = (await db.query(`select
      has_function_privilege('anon', 'public.save_catalog_product(uuid,jsonb,jsonb)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.save_catalog_product(uuid,jsonb,jsonb)', 'execute') as authenticated,
      has_function_privilege('service_role', 'public.save_catalog_product(uuid,jsonb,jsonb)', 'execute') as service`)).rows[0]
    assert.deepEqual(acl, { anon: false, authenticated: false, service: true })
    await db.exec("select set_config('request.jwt.claim.role', 'authenticated', false)")
    await assert.rejects(saveCatalog(db, null, product()), { code: '42501' })
    await db.exec("select set_config('request.jwt.claim.role', 'service_role', false)")
    const before = (await db.query('select count(*)::int as n from public.product_variants')).rows[0].n
    await db.exec(await readFile(new URL('../../supabase/migrations/009_catalog_product_variants.sql', import.meta.url), 'utf8'))
    assert.equal((await db.query('select count(*)::int as n from public.product_variants')).rows[0].n, before)
  })
})
