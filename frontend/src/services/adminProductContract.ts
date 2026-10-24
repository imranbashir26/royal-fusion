import {validatedSalePatch} from './saleSchedule.ts'
import type {AdminSaleSnapshot} from './saleSchedule'
const editableFields = [
  'commerceKind', 'sourceProductId', 'testerAvailable', 'name', 'slug', 'sku', 'shortDescription', 'description', 'price', 'salePrice',
  'oldPrice', 'stockQuantity', 'categoryId', 'collection', 'gender',
  'scentFamily', 'notes', 'bottleSize', 'concentration', 'longevity',
  'sillage', 'occasion', 'inspiredBy', 'image', 'gallery', 'imageAlt',
  'badge', 'tags', 'variations', 'isFeatured', 'isBestSeller',
  'isNewArrival', 'isPremium', 'isAttar', 'status', 'seoTitle',
  'seoDescription', 'cardImage', 'cardHoverImage', 'cardBackgroundColor', 'expectedRevision',
] as const

export function toProductPayload(form: Record<string, unknown>): Record<string, unknown> {
  if (form.commerceKind != null && !['standard','tester'].includes(String(form.commerceKind))) throw new Error('Packs require the Tester Packs editor.')
  const payload: Record<string, unknown> = {}
  for (const field of editableFields) {
    if (Object.hasOwn(form, field)) payload[field] = form[field]
  }
  if (payload.sourceProductId === '') payload.sourceProductId = null
  if (payload.commerceKind === 'tester') payload.bottleSize = '5 ml'
  if (payload.categoryId === '') payload.categoryId = null
  if (payload.salePrice === '') payload.salePrice = null
  if (payload.oldPrice === '') payload.oldPrice = null
  if (!payload.image && Array.isArray(payload.gallery)) payload.image = payload.gallery[0] ?? ''
  if (!payload.cardBackgroundColor) payload.cardBackgroundColor = '#E7C78F'
  const edits = form.saleScheduleEdits as Record<string,AdminSaleSnapshot> | undefined
  if (edits && Object.keys(edits).length) {
    const rows = Array.isArray(form.variants) ? form.variants as Array<Record<string,unknown> & AdminSaleSnapshot> : []
    if (rows.length) {
      const baseline = form.variantEditBaseline as Record<string,unknown> | undefined
      const single = rows.length === 1 ? rows[0] : undefined
      const aliases = {price:'regularPrice',salePrice:'salePrice',stockQuantity:'stockQuantity',sku:'sku',bottleSize:'optionValue'} as const
      const changed = new Map<string,Record<string,unknown>>()
      const saleEdits = {...edits}, added: Record<string,unknown>[] = []
      for (const [alias,canonical] of Object.entries(aliases)) {
        if (!Object.hasOwn(payload,alias)) continue
        const prior = baseline ? baseline[alias] : single?.[canonical]
        if (payload[alias] === prior) continue
        if (!single) throw new Error('Multi-variant price, stock, SKU and size edits require explicit variation rows.')
        changed.set(String(single.id),{...changed.get(String(single.id)),[canonical]:canonical === 'salePrice' && payload[alias] === 0 ? null : payload[alias]})
      }
      const variationChanges = Array.isArray(form.variations) &&
        (baseline ? JSON.stringify(form.variations) !== JSON.stringify(baseline.variations) : form.variations.length > 0)
      if (variationChanges) {
        if (!(form.variations as unknown[]).length) throw new Error('Use explicit variation rows to edit existing variants; empty rows cannot remove inventory.')
        for (const [index,item] of (form.variations as Array<Record<string,unknown>>).entries()) {
          const prior = rows.find(row => item.id ? row.id === item.id : row.sku === item.sku || row.optionValue === item.name)
          const oldVariation = (baseline?.variations as Array<Record<string,unknown>> | undefined)?.find(old => item.id ? old.id === item.id : old.sku === item.sku || old.name === item.name)
          // Canonical variant writes have no image field. Never pretend a legacy
          // image edit was saved when switching this request to canonical rows.
          if (Object.hasOwn(item,'image') && item.image !== (oldVariation?.image ?? '')) throw new Error('Variation image edits cannot be combined with schedule edits; use the product media editor.')
          const patch = {optionValue:item.name,regularPrice:item.price,salePrice:item.salePrice || null,sku:item.sku,stockQuantity:item.stock,active:item.active}
          const dates = Object.fromEntries(['saleStartsAt','saleEndsAt'].filter(key=>Object.hasOwn(item,key)).map(key=>[key,item[key]])) as AdminSaleSnapshot
          if (!prior) {
            if (item.id) throw new Error('Reopen the product: a variation ID no longer belongs to this product.')
            added.push({optionName:'Size',...patch,displayOrder:index,...validatedSalePatch({regularPrice:Number(item.price),salePrice:patch.salePrice as number|null},dates)})
            continue
          }
          for (const key of ['saleStartsAt','saleEndsAt'] as const) if (Object.hasOwn(dates,key) && Object.hasOwn(saleEdits[String(prior.id)] ?? {},key) && dates[key] !== saleEdits[String(prior.id)][key]) throw new Error('Conflicting schedule bounds. Use one value per variant field.')
          saleEdits[String(prior.id)] = {...dates,...saleEdits[String(prior.id)]}
          const aliasPatch = changed.get(String(prior.id)) ?? {}
          for (const [key,value] of Object.entries(aliasPatch)) if (Object.hasOwn(patch,key) && patch[key as keyof typeof patch] !== value) throw new Error('Conflicting variation and convenience-field edits. Use one value per variant field.')
          changed.set(String(prior.id),{...aliasPatch,...patch})
        }
      }
      payload.variants = [...rows.filter(row => Object.hasOwn(saleEdits,String(row.id)) || changed.has(String(row.id))).map(row => {
        const patch = changed.get(String(row.id)) ?? {}, saleEdit = saleEdits[String(row.id)] ?? {}
        if (Object.hasOwn(patch,'salePrice') && Object.hasOwn(saleEdit,'salePrice') && patch.salePrice !== saleEdit.salePrice) throw new Error('Conflicting sale prices. Use the same amount in both price controls.')
        const current = {...row,...patch}
        const allowed = ['id','optionName','optionValue','sku','regularPrice','salePrice','stockQuantity','active','displayOrder','standardManualAvailable']
        return {...Object.fromEntries(allowed.filter(key=>Object.hasOwn(current,key)).map(key=>[key,current[key]])), ...validatedSalePatch(current,saleEdit)}
      }),...added]
      if (!(payload.variants as unknown[]).length) throw new Error('Reopen the product before editing its schedule.')
      // Canonical rows own these values; never replay legacy aggregate aliases.
      for (const key of ['price','salePrice','stockQuantity','sku','bottleSize','variations']) delete payload[key]
    } else if (edits.new) {
      const prior = {regularPrice:Number(payload.price),salePrice:payload.salePrice == null ? null : Number(payload.salePrice)}
      payload.variants = [{optionName:'Size',optionValue:payload.commerceKind === 'tester' ? '5 ml' : payload.bottleSize || '50 ml',sku:payload.sku,regularPrice:prior.regularPrice,stockQuantity:payload.stockQuantity ?? 0,active:true,displayOrder:0,...validatedSalePatch(prior,edits.new)}]
    }
  }
  return payload
}

export function productErrorMessage(error: unknown): string {
  if (!(error instanceof Error) || !('status' in error)) {
    return error instanceof Error ? error.message : 'Product request failed.'
  }
  const status = Number(error.status)
  const code = 'code' in error ? error.code : ''
  switch (status) {
    case 400: return code === 'INVALID_CATEGORY'
      ? 'Select an available category.' : 'Check the product fields, image URLs, prices, and stock before saving.'
    case 401: return 'Your session has expired. Sign in again to continue.'
    case 403: return code === 'CSRF_INVALID'
      ? 'The request could not be verified. Refresh the page and try again.'
      : 'You do not have permission to manage products.'
    case 404: return 'This product no longer exists. Refresh the list.'
    case 409: return code === 'SALE_SCHEDULING_DISABLED' ? 'Scheduled-sale submissions are unavailable. Reopen the editor and leave schedule bounds unchanged.' : code === 'CATALOG_STALE' ? 'Catalog or stock changed. Close this form and reopen the product before saving.' : 'A product with this slug or SKU already exists. Choose a unique slug and SKU.'
    default: return 'The product service is unavailable. Try again later.'
  }
}
