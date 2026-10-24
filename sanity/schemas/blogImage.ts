import { defineArrayMember, defineField } from 'sanity'
import { ImageIcon } from '@sanity/icons/Image'
import { notBlank } from './validation.ts'

export function imageFields(requiredAlt: boolean) {
  return [
    defineField({ name: 'alt', title: 'Alt text', type: 'string', validation: rule => (requiredAlt ? rule.required() : rule).max(160).custom(notBlank) }),
    defineField({ name: 'caption', title: 'Caption', type: 'string', validation: rule => rule.max(300) }),
  ]
}

// Native image member preserves existing body nodes' _type: "image".
export const portableTextImage = defineArrayMember({
  type: 'image', title: 'Article image', icon: ImageIcon, options: { hotspot: true },
  fields: imageFields(true), validation: rule => rule.required().assetRequired(),
})
