import { z } from 'zod'

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const createCollectionSchema = z.object({
  name: z.string().trim().min(1, 'Collection name is required.').max(100),
  slug: z.string().trim().min(1, 'Slug is required.').max(100).regex(slugRegex, 'Slug must be lowercase alphanumeric with hyphens.'),
  description: z.string().trim().max(1000).optional().default(''),
  displayOrder: z.coerce.number().int().min(0).optional().default(0),
  featured: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
  status: z.enum(['Published', 'Draft', 'Unpublished', 'Archived']).optional(),
  bannerCloudinaryPublicId: z.string().trim().max(500).optional().default(''),
  bannerSecureUrl: z.string().trim().max(1000).optional().default(''),
  bannerAltText: z.string().trim().max(255).optional().default(''),
  image: z.string().trim().max(1000).optional(),
  imageUrl: z.string().trim().max(1000).optional(),
  seoTitle: z.string().trim().max(200).optional().default(''),
  seoDescription: z.string().trim().max(500).optional().default(''),
}).transform((data) => {
  const bannerUrl = data.bannerSecureUrl || data.imageUrl || data.image || ''
  const active = data.status === 'Archived' ? false : (data.active ?? true)
  return {
    name: data.name,
    slug: data.slug,
    description: data.description,
    displayOrder: data.displayOrder,
    featured: data.featured,
    active,
    status: data.status || (active ? 'Published' : 'Archived'),
    bannerCloudinaryPublicId: data.bannerCloudinaryPublicId,
    bannerSecureUrl: bannerUrl,
    bannerAltText: data.bannerAltText,
    seoTitle: data.seoTitle,
    seoDescription: data.seoDescription,
  }
})

export const updateCollectionSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  slug: z.string().trim().min(1).max(100).regex(slugRegex, 'Slug must be lowercase alphanumeric with hyphens.').optional(),
  description: z.string().trim().max(1000).optional(),
  displayOrder: z.coerce.number().int().min(0).optional(),
  featured: z.boolean().optional(),
  active: z.boolean().optional(),
  status: z.enum(['Published', 'Draft', 'Unpublished', 'Archived']).optional(),
  bannerCloudinaryPublicId: z.string().trim().max(500).optional(),
  bannerSecureUrl: z.string().trim().max(1000).optional(),
  bannerAltText: z.string().trim().max(255).optional(),
  image: z.string().trim().max(1000).optional(),
  imageUrl: z.string().trim().max(1000).optional(),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(500).optional(),
}).transform((data) => {
  const result = { ...data }
  if (data.image !== undefined && data.bannerSecureUrl === undefined) {
    result.bannerSecureUrl = data.image
  } else if (data.imageUrl !== undefined && data.bannerSecureUrl === undefined) {
    result.bannerSecureUrl = data.imageUrl
  }
  delete result.image
  delete result.imageUrl

  if (result.status === 'Archived') {
    result.active = false
  } else if (result.status === 'Published' && result.active === undefined) {
    result.active = true
  }
  return result
})

export const collectionIdSchema = z.string().uuid('Invalid collection ID.')

export const listCollectionsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  active: z.enum(['true', 'false', 'all']).optional(),
  featured: z.enum(['true', 'false', 'all']).optional(),
  status: z.string().trim().optional(),
})

export const assignProductsSchema = z.object({
  productIds: z.array(z.string().uuid('Invalid product ID in list.')).max(100),
})
