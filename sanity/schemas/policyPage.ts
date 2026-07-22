export default {
  name: 'policyPage',
  title: 'Policy / Editable Page',
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
    {
      name: 'pageType',
      title: 'Page Type',
      type: 'string',
      options: {
        list: [
          'About Us',
          'Contact Us',
          'FAQs',
          'Shipping Policy',
          'Return Policy',
          'Privacy Policy',
          'Terms & Conditions',
          'Fragrance Guide',
        ],
      },
      validation: (Rule: any) => Rule.required(),
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
    { name: 'seoTitle', title: 'SEO Title', type: 'string', validation: (Rule: any) => Rule.max(70) },
    { name: 'seoDescription', title: 'SEO Description', type: 'text', rows: 3, validation: (Rule: any) => Rule.max(160) },
  ],
}
