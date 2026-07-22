export default {
  name: 'banner',
  title: 'Banner / Campaign',
  type: 'document',
  fields: [
    { name: 'title', title: 'Title', type: 'string', validation: (Rule: any) => Rule.required().min(2).max(120) },
    { name: 'subtitle', title: 'Subtitle', type: 'text', rows: 2 },
    { name: 'image', title: 'Image', type: 'image', options: { hotspot: true }, validation: (Rule: any) => Rule.required() },
    { name: 'imageAlt', title: 'Image Alt Text', type: 'string', validation: (Rule: any) => Rule.required().max(160) },
    { name: 'ctaText', title: 'CTA Text', type: 'string' },
    { name: 'ctaLink', title: 'CTA Link', type: 'string', description: 'Use an internal path like /shop or a full external URL.' },
    {
      name: 'position',
      title: 'Position',
      type: 'string',
      options: {
        list: [
          'Top announcement bar',
          'Homepage hero',
          'Homepage campaign section',
          'Shop page banner',
          'Product page banner',
          'Checkout banner',
        ],
      },
      validation: (Rule: any) => Rule.required(),
    },
    { name: 'enabled', title: 'Enabled', type: 'boolean', initialValue: false },
    { name: 'startDate', title: 'Start Date', type: 'datetime' },
    { name: 'endDate', title: 'End Date', type: 'datetime' },
  ],
}
