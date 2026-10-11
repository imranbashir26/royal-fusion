import { defineField, defineType } from 'sanity'
import { UserIcon } from '@sanity/icons/User'
import { imageFields } from './blogImage.ts'
import { notBlank } from './validation.ts'

export default defineType({
  name: 'author', title: 'Author', type: 'document', icon: UserIcon,
  fields: [
    defineField({ name: 'name', title: 'Name', type: 'string', validation: rule => rule.required().min(2).max(100).custom(notBlank) }),
    defineField({ name: 'role', title: 'Role/Label', type: 'string', initialValue: 'Royal Fusion', validation: rule => rule.max(80) }),
    defineField({ name: 'image', title: 'Photo', type: 'image', options: { hotspot: true }, fields: imageFields(true), validation: rule => rule.assetRequired() }),
    defineField({ name: 'bio', title: 'Biography', type: 'text', rows: 3, validation: rule => rule.max(1000) }),
  ],
  preview: { select: { title: 'name', subtitle: 'role', media: 'image' } },
})
