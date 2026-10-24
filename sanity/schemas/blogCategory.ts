import { defineField, defineType } from 'sanity'
import { TagIcon } from '@sanity/icons/Tag'
import { notBlank, slugify, validSlug } from './validation.ts'

export default defineType({
  name: 'blogCategory', title: 'Blog Category', type: 'document', icon: TagIcon,
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string', validation: rule => rule.required().min(2).max(80).custom(notBlank) }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'title', maxLength: 80, slugify: input => slugify(input, 80) }, validation: rule => rule.required().custom(validSlug) }),
    defineField({ name: 'description', title: 'Description', type: 'text', rows: 3, validation: rule => rule.max(1000) }),
  ],
  preview: { select: { title: 'title', subtitle: 'slug.current' } },
})
