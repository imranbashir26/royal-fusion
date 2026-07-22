export default {
  name: 'blogCategory',
  title: 'Blog Category',
  type: 'document',
  fields: [
    { name: 'title', title: 'Title', type: 'string', validation: (Rule: any) => Rule.required().min(2).max(80) },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title', maxLength: 80 },
      validation: (Rule: any) => Rule.required(),
    },
    { name: 'description', title: 'Description', type: 'text', rows: 3 },
  ],
}
