import { isVariantId } from './productVariants.ts'

const publicBase = `${import.meta.env?.VITE_API_URL || '/api'}/v2/public/tester-packs`

export interface PublicTesterOption {
  testerVariantId: string
  productId: string
  name: string
  sku: string
  image?: string
  volumeMl: number
  regularPrice: number
  salePrice: number | null
  effectivePrice?: number
  saleActive?: boolean
  stockQuantity: number
  quantityPerPack?: number
  active?: boolean
  displayOrder: number
}

export interface PublicTesterPack {
  id: string
  packId: string
  commerceKind: 'tester_pack'
  name: string
  slug: string
  sku: string
  image: string
  gallery: string[]
  description: string
  shortDescription: string
  scentFamily: string
  categoryId: string | null
  status: 'Published'
  active: boolean
  catalogRevision: string
  definitionRevision: string
  mode: 'fixed' | 'configurable'
  minimumUnits: number | null
  maximumUnits: number | null
  fixedRegularPrice: number | null
  fixedSalePrice: number | null
  regularPrice: number | null
  salePrice?: number | null
  effectivePrice?: number
  saleActive?: boolean
  manualAvailable: boolean
  available: boolean
  availablePackCount: number | null
  components: PublicTesterOption[]
  allowedVariants: PublicTesterOption[]
}

export class TesterPackApiError extends Error {
  status: number
  constructor(message: string, status = 0) { super(message); this.status = status }
}

async function readPublic<T>(url: string): Promise<T> {
  let res: Response
  try { res = await fetch(url, { cache: 'no-store' }) }
  catch { throw new TesterPackApiError('Unable to connect to the discovery catalog. Please retry.') }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new TesterPackApiError(res.status === 404
    ? 'This discovery pack is no longer published or available.'
    : 'The discovery catalog is temporarily unavailable. Please retry.', res.status)
  if (!json?.data) throw new TesterPackApiError('The discovery catalog returned an invalid response. Please retry.')
  return json.data
}

function isPublicPack(value: unknown): value is PublicTesterPack {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const pack = value as PublicTesterPack
  return isVariantId(pack.id) && pack.status === 'Published' && pack.active === true
    && (pack.mode === 'fixed' || pack.mode === 'configurable') && typeof pack.name === 'string'
    && typeof pack.definitionRevision === 'string' && /^[1-9][0-9]{0,18}$/.test(pack.definitionRevision)
    && BigInt(pack.definitionRevision) <= 9223372036854775807n
    && typeof pack.available === 'boolean' && Array.isArray(pack.components) && Array.isArray(pack.allowedVariants)
    && [...pack.components, ...pack.allowedVariants].every(option => option && isVariantId(option.testerVariantId)
      && typeof option.name === 'string' && typeof option.sku === 'string'
      && Number.isSafeInteger(option.stockQuantity) && option.stockQuantity >= 0)
}

export const publicTesterPacksApi = {
  async list(page = 1, pageSize = 25): Promise<{ items: PublicTesterPack[]; total: number; totalPages: number }> {
    const data = await readPublic<{ items: PublicTesterPack[]; total: number; totalPages: number }>(`${publicBase}?page=${page}&pageSize=${pageSize}`)
    if (!Array.isArray(data.items) || !data.items.every(isPublicPack) || !Number.isSafeInteger(data.totalPages) || data.totalPages < 0) {
      throw new TesterPackApiError('The discovery catalog returned an invalid response. Please retry.')
    }
    return data
  },
  async get(id: string): Promise<PublicTesterPack> {
    const pack = await readPublic<PublicTesterPack>(`${publicBase}/${encodeURIComponent(id)}`)
    if (!isPublicPack(pack) || pack.id.toLowerCase() !== id.toLowerCase()) throw new TesterPackApiError('The discovery catalog returned an invalid pack. Please retry.')
    return pack
  },
  async listAll(): Promise<PublicTesterPack[]> {
    const first = await publicTesterPacksApi.list(1, 100)
    const items = [...first.items]
    for (let page = 2; page <= first.totalPages; page++) {
      items.push(...(await publicTesterPacksApi.list(page, 100)).items)
    }
    return items
  },
  async getBySlugOrId(slugOrId: string): Promise<PublicTesterPack | null> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId)
    if (isUuid) {
      try {
        return await publicTesterPacksApi.get(slugOrId)
      } catch (error) {
        if (error instanceof TesterPackApiError && error.status === 404) return null
        throw error
      }
    }
    const packs = await publicTesterPacksApi.listAll()
    const found = packs.find((p) => p.slug === slugOrId || p.id === slugOrId)
    // Details are always fetched by canonical pack ID after resolving a slug.
    return found ? publicTesterPacksApi.getBySlugOrId(found.id) : null
  },
}
