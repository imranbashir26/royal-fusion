import { z } from 'zod'
import {saleTimestamp,validateSaleWindow} from './saleSchedule.js'

const text = (max) => z.string().trim().max(max)
const money = z.number().finite().positive().max(9999999999.99).multipleOf(0.01)
const revision = z.string().regex(/^(0|[1-9][0-9]{0,18})$/)
const image = text(2048).refine(value => {
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return true
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password } catch { return false }
})
export const packProductSchema = z.object({
  name: text(180).min(1), slug: text(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  sku: text(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  image: image, gallery: z.array(image).max(50).optional(),
  description: text(20000).optional(), shortDescription: text(500).optional(),
  scentFamily: text(100).min(1), categoryId: z.string().uuid().nullable().optional(),
  status: z.enum(['Draft','Published','Unpublished','Archived']).optional(),
  active: z.boolean().optional(), imageAlt: text(300).optional(),
  cardImage: image.optional(), cardHoverImage: image.optional(),
  cardBackgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  seoTitle: text(180).optional(), seoDescription: text(500).optional(),
}).strict()
const component = z.object({ testerVariantId: z.string().uuid(), quantityPerPack: z.number().int().min(1).max(2147483647), displayOrder: z.number().int().min(0).max(2147483647) }).strict()
const member = z.object({ testerVariantId: z.string().uuid(), active: z.boolean(), displayOrder: z.number().int().min(0).max(2147483647) }).strict()
const unique = (items, ctx) => { if (new Set(items.map(i => i.testerVariantId.toLowerCase())).size !== items.length) ctx.addIssue({ code: 'custom', message: 'Duplicate tester.' }) }
export const packDefinitionSchema = z.object({
  mode: z.enum(['fixed','configurable']).optional(), minimumUnits: z.literal(2).nullable().optional(),
  maximumUnits: z.number().int().min(2).max(2147483647).nullable().optional(),
  fixedRegularPrice: money.nullable().optional(), fixedSalePrice: money.nullable().optional(),
  fixedSaleStartsAt:saleTimestamp.nullable().optional(),fixedSaleEndsAt:saleTimestamp.nullable().optional(),
  manualAvailable: z.boolean().optional(),
  components: z.array(component).max(100).superRefine(unique).optional(),
  allowedVariants: z.array(member).max(100).superRefine(unique).optional(),
}).strict().superRefine((value,context)=>{
 validateSaleWindow(value,context,{sale:'fixedSalePrice',start:'fixedSaleStartsAt',end:'fixedSaleEndsAt'})
 if(value.fixedSalePrice!=null&&value.fixedRegularPrice!=null&&value.fixedSalePrice>=value.fixedRegularPrice)context.addIssue({code:'custom',path:['fixedSalePrice'],message:'Sale must be below regular price.'})
 if(value.mode==='configurable'&&(value.fixedRegularPrice!=null||value.fixedSalePrice!=null||value.fixedSaleStartsAt!=null||value.fixedSaleEndsAt!=null))context.addIssue({code:'custom',message:'Configurable packs have no own prices or sale schedule.'})
})
export const createPackSchema = z.object({ product: packProductSchema, definition: packDefinitionSchema.safeExtend({ mode: z.enum(['fixed','configurable']) }) }).strict().superRefine((v,c) => {
  const d=v.definition
  if (d.mode==='fixed' && (!d.fixedRegularPrice || d.allowedVariants || d.minimumUnits != null || d.maximumUnits != null)) c.addIssue({ code:'custom', message:'Invalid fixed definition.' })
  if (d.mode==='configurable' && (d.fixedRegularPrice != null || d.fixedSalePrice != null || d.components || d.minimumUnits===null)) c.addIssue({code:'custom',message:'Invalid configurable definition.'})
  if (d.fixedSalePrice && d.fixedRegularPrice && d.fixedSalePrice>=d.fixedRegularPrice) c.addIssue({code:'custom',message:'Sale must be below regular price.'})
  if((d.fixedSaleStartsAt!=null||d.fixedSaleEndsAt!=null)&&d.fixedSalePrice==null)c.addIssue({code:'custom',message:'A schedule requires a sale price.'})
})
export const updatePackSchema = z.object({ product: packProductSchema.partial(), definition: packDefinitionSchema, expectedRevision: revision, expectedDefinitionRevision: revision }).strict()
export const archivePackSchema = z.object({ expectedRevision: revision, expectedDefinitionRevision: revision }).strict()
export const listPacksSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).strict()
export function boundedCatalogPayload(value) { return Buffer.byteLength(JSON.stringify(value),'utf8') <= 32768 }
