import { z } from 'zod'

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required.').max(100),
  slug: z.string().trim().min(1, 'Slug is required.').max(100).regex(slugRegex, 'Slug must be lowercase alphanumeric with hyphens.'),
  description: z.string().trim().max(1000).optional().default(''),
  image: z.string().trim().max(1000).optional().default(''),
  imageUrl: z.string().trim().max(1000).optional(),
  displayOrder: z.coerce.number().int().min(0).optional().default(0),
  showOnHomepage: z.boolean().optional().default(false),
  status: z.enum(['Published', 'Draft', 'Unpublished', 'Archived']).optional().default('Published'),
  active: z.boolean().optional().default(true),
  seoTitle: z.string().trim().max(200).optional().default(''),
  seoDescription: z.string().trim().max(500).optional().default(''),
}).transform((data) => ({
  name: data.name,
  slug: data.slug,
  description: data.description,
  imageUrl: data.imageUrl || data.image || '',
  displayOrder: data.displayOrder,
  showOnHomepage: data.showOnHomepage,
  status: data.status,
  active: data.status === 'Archived' ? false : data.active,
  seoTitle: data.seoTitle,
  seoDescription: data.seoDescription,
}))

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  slug: z.string().trim().min(1).max(100).regex(slugRegex, 'Slug must be lowercase alphanumeric with hyphens.').optional(),
  description: z.string().trim().max(1000).optional(),
  image: z.string().trim().max(1000).optional(),
  imageUrl: z.string().trim().max(1000).optional(),
  displayOrder: z.coerce.number().int().min(0).optional(),
  showOnHomepage: z.boolean().optional(),
  status: z.enum(['Published', 'Draft', 'Unpublished', 'Archived']).optional(),
  active: z.boolean().optional(),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(500).optional(),
}).transform((data) => {
  const result = { ...data }
  if (data.image !== undefined && data.imageUrl === undefined) {
    result.imageUrl = data.image
  }
  delete result.image
  if (result.status === 'Archived') {
    result.active = false
  } else if (result.status === 'Published' && result.active === undefined) {
    result.active = true
  }
  return result
})

export const categoryIdSchema = z.string().uuid('Invalid category ID.')

export const listCategoriesSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.string().trim().optional(),
  active: z.enum(['true', 'false', 'all']).optional(),
})
