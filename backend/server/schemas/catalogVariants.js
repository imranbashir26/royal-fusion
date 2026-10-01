import { z } from 'zod'

export function normalizeOption(value) {
  return value.trim().replace(/\s+/g, ' ').replace(/^(\d+(?:\.\d+)?)\s*ml$/i, '$1 ml')
}

const money = z.number().finite().nonnegative().multipleOf(0.01)
export const catalogVariantSchema = z.object({
  id: z.string().uuid().optional(),
  optionName: z.string().trim().min(1).max(80).default('Size'),
  optionValue: z.string().trim().min(1).max(80).transform(normalizeOption),
  sku: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  regularPrice: money.positive(),
  salePrice: money.nullable().optional().transform((value) => value || null),
  stockQuantity: z.number().int().min(0).max(2147483647),
  active: z.boolean().default(true),
  available: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(2147483647).default(0),
}).strict().superRefine((value, context) => {
  if (value.salePrice !== null && value.salePrice >= value.regularPrice) {
    context.addIssue({ code: 'custom', path: ['salePrice'], message: 'Sale price must be below regular price.' })
  }
})

export const catalogVariantsSchema = z.array(catalogVariantSchema).min(1).max(50).superRefine((items, context) => {
  for (const key of ['sku', 'option', 'id']) {
    const values = items.map((item) => key === 'option'
      ? `${item.optionName.toLowerCase()}:${item.optionValue.toLowerCase()}`
      : item[key]?.toLowerCase()).filter(Boolean)
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', message: `Duplicate variant ${key}.` })
    }
  }
})

// Existing admin variation JSON remains compatible; no storefront contract changes.
export function toCatalogVariants(input) {
  if (input.variants !== undefined) return catalogVariantsSchema.parse(input.variants)
  if (!input.variations?.length) return null
  return catalogVariantsSchema.parse(input.variations.map((item, index) => ({
    ...(item.id ? { id: item.id } : {}),
    optionName: 'Size', optionValue: item.name, sku: item.sku,
    regularPrice: item.price, salePrice: item.salePrice ?? null,
    stockQuantity: item.stock, active: item.active, displayOrder: index,
  })))
}
