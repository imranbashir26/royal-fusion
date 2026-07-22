export default {
  name: 'fragranceGuide',
  title: 'Fragrance Guide',
  type: 'document',
  fields: [
    { name: 'title', title: 'Title', type: 'string', validation: (Rule: any) => Rule.required().min(3).max(120) },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title', maxLength: 96 },
      validation: (Rule: any) => Rule.required(),
    },
    { name: 'summary', title: 'Summary', type: 'text', rows: 3, validation: (Rule: any) => Rule.required().max(240) },
    { name: 'featuredImage', title: 'Featured Image', type: 'image', options: { hotspot: true } },
    {
      name: 'scentFamilies',
      title: 'Related Scent Families',
      type: 'array',
      of: [{ type: 'string' }],
      options: { list: ['Oriental', 'Floral', 'Citrus', 'Woody', 'Oud', 'Fresh', 'Spicy', 'Sweet'] },
    },
    {
      name: 'body',
      title: 'Body',
      type: 'array',
      of: [{ type: 'block' }, { type: 'image', options: { hotspot: true } }],
      validation: (Rule: any) => Rule.required(),
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: { list: ['Draft', 'Published', 'Unpublished'], layout: 'radio' },
      initialValue: 'Draft',
    },
  ],
}
