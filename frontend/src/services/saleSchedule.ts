export interface AdminSaleSnapshot {
  regularPrice?: number | null; salePrice?: number | null; effectivePrice?: number | null
  saleActive?: boolean; pricingAt?: string; validUntil?: string | null
  saleStartsAt?: string | null; saleEndsAt?: string | null
}

export function validatedSalePatch(original: AdminSaleSnapshot, edited: AdminSaleSnapshot) {
  const merged = {...original, ...edited}, sale = merged.salePrice
  if (sale != null && (!Number.isFinite(sale) || sale <= 0 || sale >= Number(original.regularPrice)
    || Math.abs(sale * 100 - Math.round(sale * 100)) > 0.001)) throw new Error('Sale price must be a positive PKR amount with two decimals, below the regular price.')
  const bounds = saleSchedulePatch(original, edited, sale == null)
  if (sale == null && (edited.saleStartsAt || edited.saleEndsAt)) throw new Error('A schedule requires a sale price.')
  return {...bounds, salePrice:sale ?? null}
}

/** Validate without converting/reformatting the original offset or fractional digits. */
export function saleTimestampMicros(value: string): bigint {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) throw new Error('Use an ISO timestamp with seconds, an explicit UTC offset and at most six fractional digits.')
  const [,y,m,d,h,min,s,fraction,offset] = match
  const year=Number(y),month=Number(m),day=Number(d)
  const calendar=new Date(0); calendar.setUTCFullYear(year,month,0)
  const days=calendar.getUTCDate()
  if (year<1 || month<1 || month>12 || day<1 || day>days || Number(h)>23 || Number(min)>59 || Number(s)>59
    || (offset!=='Z' && (Number(offset.slice(1,3))>23 || Number(offset.slice(4))>59))) throw new Error('Invalid sale timestamp.')
  const milliseconds=Date.parse(`${y}-${m}-${d}T${h}:${min}:${s}${offset}`)
  if (!Number.isFinite(milliseconds)) throw new Error('Invalid sale timestamp.')
  return BigInt(milliseconds)*1000n+BigInt((fraction??'').padEnd(6,'0'))
}

/** Prepared serialization only. Disabled UI never offers schedule submission. */
export function saleSchedulePatch(original: AdminSaleSnapshot, edited: AdminSaleSnapshot, clearing = false) {
  if (clearing) return {saleStartsAt:null, saleEndsAt:null}
  const patch: Pick<AdminSaleSnapshot,'saleStartsAt'|'saleEndsAt'> = {}
  for (const key of ['saleStartsAt','saleEndsAt'] as const) {
    if (!Object.hasOwn(edited,key)) continue
    const value=edited[key]
    if (value !== null && value !== undefined) saleTimestampMicros(value)
    if (value !== original[key]) patch[key]=value
  }
  const starts=Object.hasOwn(patch,'saleStartsAt')?patch.saleStartsAt:original.saleStartsAt
  const ends=Object.hasOwn(patch,'saleEndsAt')?patch.saleEndsAt:original.saleEndsAt
  if(starts && ends && saleTimestampMicros(starts)>=saleTimestampMicros(ends)) throw new Error('Sale end must be after sale start.')
  return patch
}

/** State is relative to the DATABASE snapshot, never Date.now(). */
export function adminSaleState(sale: AdminSaleSnapshot): string {
  if (!sale.pricingAt || typeof sale.saleActive !== 'boolean' || typeof sale.effectivePrice !== 'number') return 'Unavailable until refreshed'
  if (sale.salePrice == null) return 'Inactive'
  if (sale.saleActive) return sale.saleStartsAt || sale.saleEndsAt ? 'Active' : 'Active (unscheduled)'
  try {
    const at=saleTimestampMicros(sale.pricingAt)
    if(sale.saleStartsAt && saleTimestampMicros(sale.saleStartsAt)>at) return 'Scheduled'
    if(sale.saleEndsAt && saleTimestampMicros(sale.saleEndsAt)<=at) return 'Expired'
  } catch { return 'Unavailable until refreshed' }
  return 'Inactive'
}
