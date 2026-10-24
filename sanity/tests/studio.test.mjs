import assert from 'node:assert/strict'
import test from 'node:test'
import config from '../sanity.config.ts'
import cliConfig from '../sanity.cli.ts'
import { resolveStudioConfiguration, studioConfiguration } from '../studioConfiguration.ts'
import { schemaTypes } from '../schemas/index.ts'
import blogPost from '../schemas/blogPost.ts'
import blogCategory from '../schemas/blogCategory.ts'
import { notBlank, publishedReference, safeLink, slugify, validCanonical, validSlug } from '../schemas/validation.ts'
import { blogSlugSchema, blogSourceArticleSchema } from '../../backend/server/schemas/blogV1.js'
import { makeBlogArticle } from '../../backend/server/tests/support/blogFixtures.js'

const field = (name, schema = blogPost) => schema.fields.find(entry => entry.name === name)

test('Studio and CLI target only the reviewed existing project/dataset', () => {
  assert.deepEqual(resolveStudioConfiguration(), { projectId: '6n1y88j4', dataset: 'production', apiVersion: '2025-01-01', canonicalOrigin: undefined })
  assert.equal(config.projectId, '6n1y88j4')
  assert.equal(config.dataset, 'production')
  assert.deepEqual(cliConfig.api, { projectId: '6n1y88j4', dataset: 'production' })
  assert.throws(() => resolveStudioConfiguration({ projectId: 'another' }))
  assert.throws(() => resolveStudioConfiguration({ dataset: 'staging' }))
  assert.throws(() => resolveStudioConfiguration({ apiVersion: '2025-02-30' }))
  assert.throws(() => resolveStudioConfiguration({ apiVersion: 'latest' }))
})

test('the registered document types are exclusively blog, author and existing category', () => {
  assert.deepEqual(schemaTypes.map(type => [type.name, type.type]), [['author', 'document'], ['blogCategory', 'document'], ['blogPost', 'document']])
  assert.deepEqual(config.schema.types, schemaTypes)
  assert.equal(config.plugins.length, 1)
  assert.equal(config.plugins[0].name, 'sanity/structure')
})

test('Studio retains built-in login, native IDs and Draft/Publish controls', () => {
  for (const property of ['auth', 'document', 'initialValueTemplates', 'token', 'credentials']) assert.equal(property in config, false)
  assert.equal(field('status'), undefined)
  assert.equal(field('published'), undefined)
  assert.equal(field('_id'), undefined)
  assert.equal(field('_updatedAt'), undefined)
  assert.equal(field('publishedAt').type, 'datetime')
  assert.ok(Number.isFinite(Date.parse(field('publishedAt').initialValue())))
  assert.equal(cliConfig.deployment.autoUpdates, false)
  assert.equal(cliConfig.schemaExtraction.enabled, false)
  assert.equal(cliConfig.typegen.enabled, false)
})

test('existing article fields and reference targets remain compatible with Phase 4B', () => {
  for (const name of ['title', 'slug', 'excerpt', 'author', 'category', 'tags', 'featuredImage', 'imageAlt', 'publishedAt', 'readTime', 'body', 'seoTitle', 'seoDescription', 'canonicalUrl', 'noIndex', 'ogImage']) assert.ok(field(name), name)
  assert.deepEqual(field('author').to, [{ type: 'author' }])
  assert.deepEqual(field('category').to, [{ type: 'blogCategory' }])
  assert.equal(field('featuredImage').type, 'image')
  assert.equal(field('featuredImage').options.hotspot, true)
  assert.equal(field('noIndex').initialValue, false)
  const fixture = makeBlogArticle()
  const before = structuredClone(fixture)
  assert.equal(blogSourceArticleSchema.safeParse(fixture).success, true)
  assert.deepEqual(fixture, before)
})

test('Portable Text editor styles, lists, annotations and image nodes match the domain', () => {
  const body = field('body')
  assert.deepEqual(body.of.map(member => member.type), ['block', 'image'])
  const block = body.of[0]
  assert.deepEqual(block.styles.map(style => style.value), ['normal', 'h2', 'h3', 'blockquote'])
  assert.deepEqual(block.lists.map(list => list.value), ['bullet', 'number'])
  assert.deepEqual(block.marks.decorators.map(mark => mark.value), ['strong', 'em', 'code', 'underline', 'strike-through'])
  assert.deepEqual(block.marks.annotations.map(mark => mark.name), ['link'])
  assert.deepEqual(body.of[1].fields.map(imageField => imageField.name), ['alt', 'caption'])
  assert.equal(body.of[1].options.hotspot, true)
  assert.ok(body.of[1].validation)
  assert.equal(body.of[1].name, undefined) // No renamed _type incompatible with historical image nodes.
})

test('slugs preserve native uniqueness checks and follow the domain slug contract', () => {
  assert.equal(field('slug').options.isUnique, undefined)
  assert.equal(field('slug', blogCategory).options.isUnique, undefined)
  for (const title of ['Fragrance Journal', 'Été & Oud', '  Daily / Wear  ', 'a'.repeat(110)]) {
    const slug = field('slug').options.slugify(title)
    assert.equal(validSlug({ current: slug }), true)
    assert.equal(blogSlugSchema.safeParse(slug).success, true)
  }
  assert.equal(slugify('Été & Oud', 96), 'ete-oud')
  for (const slug of ['', 'UPPER', 'two--hyphens', '../article', 'article?x=1', 'a'.repeat(97)]) assert.notEqual(validSlug({ current: slug }), true)
  assert.notEqual(notBlank('   '), true)
  assert.equal(notBlank('Article'), true)
})

test('Portable Text link validation rejects unsafe schemes, credentials and protocol-relative URLs', () => {
  for (const value of ['https://example.invalid/guide', '/blogs/article', '/shop?category=oud']) assert.equal(safeLink(value), true)
  for (const value of ['javascript:alert(1)', 'data:text/html,test', 'http://example.invalid', '//example.invalid', 'https://user:pass@example.invalid', '/\\example.invalid', '<unsafe>']) assert.notEqual(safeLink(value), true)
})

test('canonical overrides require explicit approved origin and exact article path', () => {
  const origin = 'https://shop.example.invalid'
  const document = { slug: { current: 'fragrance-journal' } }
  assert.equal(validCanonical(undefined, document, origin), true)
  assert.equal(validCanonical(`${origin}/blogs/fragrance-journal`, document, origin), true)
  for (const value of ['https://foreign.example.invalid/blogs/fragrance-journal', `${origin}/blogs/other`, `${origin}/blogs/fragrance-journal?q=1`, `${origin}/blogs/fragrance-journal#fragment`, 'https://user:pass@shop.example.invalid/blogs/fragrance-journal', 'javascript:alert(1)']) assert.notEqual(validCanonical(value, document, origin), true)
  assert.notEqual(validCanonical(`${origin}/blogs/fragrance-journal`, document, undefined), true)
  assert.equal(field('canonicalUrl').readOnly, !studioConfiguration.canonicalOrigin)
  for (const canonicalOrigin of ['http://shop.example.invalid', 'https://user:pass@shop.example.invalid', `${origin}/path`, `${origin}?q=1`]) assert.throws(() => resolveStudioConfiguration({ canonicalOrigin }))
})

function referenceClient(result) {
  const calls = []
  return { calls, context: { getClient(options) {
    calls.push({ options })
    return { withConfig(configuration) {
      calls.push({ configuration })
      return { async fetch(query, parameters) {
        calls.push({ query, parameters })
        if (result instanceof Error) throw result
        return result
      } }
    } }
  } } }
}

test('author/category validation uses parameterized published-only reads through native Studio context', async () => {
  for (const type of ['author', 'blogCategory']) {
    const { context, calls } = referenceClient(true)
    assert.equal(await publishedReference({ _type: 'reference', _ref: 'existing-ref', _weak: true }, context, type), true)
    assert.deepEqual(calls, [
      { options: { apiVersion: studioConfiguration.apiVersion } },
      { configuration: { perspective: 'published', useCdn: false } },
      { query: 'count(*[_id == $id && _type == $type]) > 0', parameters: { id: 'existing-ref', type } },
    ])
  }
})

test('draft-only/missing references and upstream failure prevent publication without leaking errors', async () => {
  for (const result of [false, null, 'PRIVATE_FIXTURE_TOKEN', new Error('PRIVATE_FIXTURE_TOKEN')]) {
    const { context } = referenceClient(result)
    const validation = await publishedReference({ _ref: 'author-a' }, context, 'author')
    assert.notEqual(validation, true)
    assert.equal(String(validation).includes('PRIVATE_FIXTURE_TOKEN'), false)
  }
  for (const ref of ['drafts.author-a', 'versions.release.author-a', 'unsafe"ref']) {
    const { context, calls } = referenceClient(true)
    assert.notEqual(await publishedReference({ _ref: ref }, context, 'author'), true)
    assert.deepEqual(calls, [])
  }
})
