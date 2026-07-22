export default {
  name: 'faq',
  title: 'FAQ',
  type: 'document',
  fields: [
    { name: 'question', title: 'Question', type: 'string', validation: (Rule: any) => Rule.required().min(5).max(180) },
    { name: 'answer', title: 'Answer', type: 'text', rows: 4, validation: (Rule: any) => Rule.required().min(10).max(1000) },
    { name: 'displayOrder', title: 'Display Order', type: 'number', initialValue: 0 },
    { name: 'enabled', title: 'Enabled', type: 'boolean', initialValue: true },
  ],
  orderings: [
    {
      title: 'Display Order',
      name: 'displayOrderAsc',
      by: [{ field: 'displayOrder', direction: 'asc' }],
    },
  ],
}
