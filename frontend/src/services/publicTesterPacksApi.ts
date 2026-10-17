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

export const publicTesterPacksApi = {
  async list(page = 1, pageSize = 25): Promise<{ items: PublicTesterPack[]; total: number; totalPages: number }> {
    const res = await fetch(`${publicBase}?page=${page}&pageSize=${pageSize}`)
    if (!res.ok) throw new Error('Failed to load tester packs')
    const json = await res.json()
    return json.data
  },
  async get(id: string): Promise<PublicTesterPack> {
    const res = await fetch(`${publicBase}/${encodeURIComponent(id)}`)
    if (!res.ok) throw new Error('Failed to load tester pack')
    const json = await res.json()
    return json.data
  },
  async getBySlugOrId(slugOrId: string): Promise<PublicTesterPack | null> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId)
    if (isUuid) {
      try {
        return await publicTesterPacksApi.get(slugOrId)
      } catch {
        return null
      }
    }
    try {
      const list = await publicTesterPacksApi.list(1, 100)
      const found = list.items.find((p) => p.slug === slugOrId || p.id === slugOrId)
      return found ?? null
    } catch {
      return null
    }
  },
}
