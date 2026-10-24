import { defineArrayMember, defineField, defineType } from 'sanity'
import { DocumentTextIcon } from '@sanity/icons/DocumentText'
import type { BlogTextBlock } from '../../shared/contracts/blogV1.ts'
import { studioConfiguration } from '../studioConfiguration.ts'
import { imageFields, portableTextImage } from './blogImage.ts'
import { notBlank, publishedReference, safeLink, slugify, validCanonical, validSlug } from './validation.ts'

const styles: Array<{ title: string; value: BlogTextBlock['style'] }> = [
  { title: 'Paragraph', value: 'normal' }, { title: 'Heading 2', value: 'h2' },
  { title: 'Heading 3', value: 'h3' }, { title: 'Quote', value: 'blockquote' },
]

export default defineType({
  name: 'blogPost', title: 'Blog Post', type: 'document', icon: DocumentTextIcon,
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string', validation: rule => rule.required().min(3).max(120).custom(notBlank) }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'title', maxLength: 96, slugify: input => slugify(input, 96) }, validation: rule => rule.required().custom(validSlug) }),
    defineField({ name: 'excerpt', title: 'Excerpt', type: 'text', rows: 3, validation: rule => rule.required().max(240).custom(notBlank) }),
    defineField({ name: 'author', title: 'Author', type: 'reference', to: [{ type: 'author' }], validation: rule => rule.required().custom((value, context) => publishedReference(value, context, 'author')) }),
    defineField({ name: 'category', title: 'Category', type: 'reference', to: [{ type: 'blogCategory' }], validation: rule => rule.required().custom((value, context) => publishedReference(value, context, 'blogCategory')) }),
    defineField({ name: 'tags', title: 'Tags', type: 'array', of: [defineArrayMember({ type: 'string', validation: rule => rule.max(80).custom(notBlank) })], validation: rule => rule.max(30).unique() }),
    defineField({ name: 'featuredImage', title: 'Featured image', type: 'image', options: { hotspot: true }, validation: rule => rule.required().assetRequired() }),
    // Preserve the historical alt field used by the existing projection and Phase 4B adapter.
    defineField({ name: 'imageAlt', title: 'Featured image alt text', type: 'string', validation: rule => rule.required().max(160).custom(notBlank) }),
    defineField({ name: 'publishedAt', title: 'Publication date', type: 'datetime', initialValue: () => new Date().toISOString(), description: 'Descriptive article date. Availability is controlled by native Publish/Unpublish.', validation: rule => rule.required() }),
    defineField({ name: 'readTime', title: 'Reading time', type: 'string', validation: rule => rule.max(80) }),
    defineField({
      name: 'body', title: 'Article', type: 'array', validation: rule => rule.required().min(1).max(1000),
      of: [
        defineArrayMember({
          type: 'block', styles, lists: [{ title: 'Bullet', value: 'bullet' }, { title: 'Numbered', value: 'number' }],
          marks: {
            decorators: [{ title: 'Strong', value: 'strong' }, { title: 'Emphasis', value: 'em' }, { title: 'Code', value: 'code' }, { title: 'Underline', value: 'underline' }, { title: 'Strike through', value: 'strike-through' }],
            annotations: [defineArrayMember({ name: 'link', title: 'Link', type: 'object', fields: [defineField({ name: 'href', title: 'URL', type: 'url', validation: rule => rule.required().uri({ scheme: ['https'], allowRelative: true }).custom(safeLink) })] })],
          },
        }),
        portableTextImage,
      ],
    }),
    defineField({ name: 'seoTitle', title: 'SEO title', type: 'string', validation: rule => rule.max(70) }),
    defineField({ name: 'seoDescription', title: 'SEO description', type: 'text', rows: 3, validation: rule => rule.max(160) }),
    defineField({ name: 'canonicalUrl', title: 'Canonical override', type: 'url', description: 'Normally leave blank to use the article URL.', readOnly: !studioConfiguration.canonicalOrigin, validation: rule => rule.uri({ scheme: ['https'], allowRelative: false }).custom((value, context) => validCanonical(value, context.document)) }),
    defineField({ name: 'noIndex', title: 'Exclude article from indexing', type: 'boolean', initialValue: false }),
    defineField({ name: 'ogImage', title: 'Open Graph image', type: 'image', options: { hotspot: true }, fields: imageFields(false), validation: rule => rule.assetRequired() }),
  ],
  preview: { select: { title: 'title', subtitle: 'author.name', media: 'featuredImage' } },
})
