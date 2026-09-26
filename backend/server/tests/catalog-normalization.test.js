import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sql = readFileSync(path.join(root, 'supabase/seed/002_catalog_taxonomy_normalization.sql'), 'utf8')

test('catalog normalization targets known starter identities without fabricating commercial data', () => {
  for (const slug of ['shaheen', 'floral-fusion', 'voice-of-heart', 'pitch-black', 'baraan', 'change', 'crimson-crystal']) {
    assert.match(sql, new RegExp(`\\('${slug}', 'RF-`))
  }
  assert.match(sql, /p\.sku = k\.sku/)
  assert.match(sql, /p\.concentration <> 'Eau de Parfum'/)
  assert.doesNotMatch(sql, /insert into public\.products\b/i)
  assert.doesNotMatch(sql, /set\s+(?:price|sale_price|old_price|stock_quantity|main_image_url|gallery_urls|is_best_seller|is_new_arrival)\s*=/i)
})

test('canonical categories and Attar synchronization are explicit', () => {
  for (const slug of ['eau-de-parfum', 'extrait-de-parfum', 'attar', 'gift-set']) assert.ok(sql.includes(`'${slug}'`))
  assert.match(sql, /set category_name = c\.name, is_attar = \(c\.slug = 'attar'\)/)
  assert.match(sql, /where p\.category_id = c\.id/)
  assert.match(sql, /legacy categories still have other product references/i)
  assert.doesNotMatch(sql, /insert into public\.categories[^;]*'Best Sellers'/is)
})

test('collection links are relational, duplicate-safe, and independent of products.collection', () => {
  assert.match(sql, /insert into public\.product_collections/)
  assert.match(sql, /on conflict \(product_id, collection_id\) do nothing/)
  assert.match(sql, /royal-fusion-originals/)
  assert.match(sql, /crystal-edit/)
  assert.doesNotMatch(sql, /set\s+collection\s*=/i)
})

test('operator script is transactional, guarded, and idempotent by keys', () => {
  assert.match(sql, /^begin;/m)
  assert.match(sql, /^commit;/m)
  assert.match(sql, /primary key/)
  assert.match(sql, /on conflict \(slug\) do update/)
  assert.match(sql, /on conflict \(product_id, category_id\) do update/)
  assert.match(sql, /is distinct from/)
  assert.match(sql, /raise exception/)
})
