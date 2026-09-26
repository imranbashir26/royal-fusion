import { z } from 'zod'

const text = (max = 500) => z.string().trim().max(max)
const requiredText = (max = 180) => text(max).min(1)
const imageReference = z.string().trim().max(2048).refine((value) => {
  if (!value) return true
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}, 'Use an HTTPS URL or a root-relative path.')
const notes = z.array(requiredText(80)).max(30)
const money = z.number().finite().nonnegative().multipleOf(0.01)
const optionList = z.array(z.object({
  label: requiredText(80),
  value: requiredText(80),
  price: money,
}).strict()).max(30)
const variationList = z.array(z.object({
  id: z.string().uuid().optional(),
  name: requiredText(120),
  price: money,
  salePrice: money.nullable().optional(),
  sku: requiredText(80),
  stock: z.number().int().nonnegative(),
  image: imageReference.optional(),
  active: z.boolean(),
}).strict()).max(50)

const fields = z.object({
  name: requiredText(),
  slug: requiredText().transform((value) => value.toLowerCase().replace(/\s+/g, '-')).pipe(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180)),
  sku: requiredText(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  shortDescription: text(500),
  description: text(20000),
  price: money.positive(),
  salePrice: money.nullable(),
  oldPrice: money.nullable(),
  stockQuantity: z.number().int().nonnegative(),
  categoryId: z.string().uuid().nullable(),
  collection: text(180),
  gender: z.enum(['Men', 'Women', 'Unisex']),
  scentFamily: requiredText(100),
  notes: z.object({ top: notes, middle: notes, base: notes }).strict(),
  bottleSize: text(80),
  concentration: text(80),
  longevity: text(80),
  sillage: text(80),
  occasion: notes,
  inspiredBy: text(180),
  image: imageReference.min(1),
  gallery: z.array(imageReference.min(1)).max(50),
  imageAlt: text(300),
  badge: text(80),
  tags: notes,
  sizeOptions: optionList,
  variations: variationList,
  isFeatured: z.boolean(),
  isBestSeller: z.boolean(),
  isNewArrival: z.boolean(),
  isPremium: z.boolean(),
  isAttar: z.boolean(),
  status: z.enum(['Draft', 'Published', 'Unpublished', 'Archived']),
  seoTitle: text(180),
  seoDescription: text(500),
  cardImage: imageReference,
  cardHoverImage: imageReference,
  cardBackgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
}).strict()

export const createProductSchema = fields.required({
  name: true, slug: true, sku: true, price: true, scentFamily: true, image: true,
}).partial({
  shortDescription: true, description: true, salePrice: true, oldPrice: true,
  stockQuantity: true, categoryId: true, collection: true, gender: true,
  notes: true, bottleSize: true, concentration: true, longevity: true,
  sillage: true, occasion: true, inspiredBy: true, gallery: true,
  imageAlt: true, badge: true, tags: true, sizeOptions: true,
  variations: true, isFeatured: true, isBestSeller: true, isNewArrival: true,
  isPremium: true, isAttar: true, status: true, seoTitle: true,
  seoDescription: true, cardImage: true, cardHoverImage: true,
  cardBackgroundColor: true,
}).superRefine(validatePriceRelationship)

export const updateProductSchema = fields.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one product field is required.',
).superRefine(validatePriceRelationship)

export const listProductsSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: text(120).default(''),
  status: z.enum(['Draft', 'Published', 'Unpublished', 'Archived']).optional(),
}).strict()

export const productIdSchema = z.string().uuid()

function validatePriceRelationship(value, context) {
  if (value.price !== undefined && value.salePrice !== undefined && value.salePrice !== null &&
    value.salePrice !== 0 && value.salePrice >= value.price) {
    context.addIssue({ code: 'custom', path: ['salePrice'], message: 'Sale price must be below price.' })
  }
}
