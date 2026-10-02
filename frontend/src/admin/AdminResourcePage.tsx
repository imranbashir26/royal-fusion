import { Download, Edit, Plus, Search, Trash2 } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '../components/common/Button'
import { adminApi } from '../services/adminApi'
import { AdminAuthError } from '../services/adminAuthClient'
import { adminProductsApi, productErrorMessage } from '../services/adminProductsApi'
import { adminCategoriesApi, categoryErrorMessage } from '../services/adminCategoriesApi'
import { selectableCategories } from '../services/adminCategoryContract'
import { adminCollectionsApi, collectionErrorMessage } from '../services/adminCollectionsApi'
import { adminMediaApi, mediaErrorMessage, secureMediaUrl } from '../services/adminMediaApi'
import { cn } from '../utils/cn'
import { AdminMediaUploader } from './AdminMediaUploader'
import { useAdminAuth } from './AdminAuthProvider'
import type { AdminField, AdminResourceConfig } from './adminConfig'
import { resourceConfigs } from './adminConfig'

type AdminRecord = Record<string, unknown> & { id?: string }

const NOTE_PRESETS: Record<string, string[]> = {
  'notes.top': ['Bergamot', 'Lemon', 'Saffron', 'Cardamom', 'Apple', 'Lavender', 'Pink Pepper', 'Grapefruit', 'Mint'],
  'notes.middle': ['Rose', 'Jasmine', 'Oud', 'Nutmeg', 'Cinnamon', 'Cedarwood', 'Amberwood', 'Iris', 'Geranium'],
  'notes.base': ['Amber', 'Musk', 'Sandalwood', 'Vanilla', 'Leather', 'Patchouli', 'Vetiver', 'Tonka Bean', 'Oakmoss'],
  'tags': ['Best Seller', 'Signature Perfume', 'Long Lasting', 'Gift Set', 'Unisex', 'Attar Oil', 'Woody Notes', 'Fresh Scent'],
  'occasion': ['Evening / Formal', 'Daily / Office', 'Date Night', 'Special Events', 'All Season', 'Summer Fresh', 'Winter Warmth'],
}

export function AdminResourcePage() {
  const { resource = 'products' } = useParams()
  return <AdminResourceManager resource={resource} />
}

export function AdminResourceManager({ resource }: { resource: string }) {
  const config = resourceConfigs[resource]

  if (!config) {
    return (
      <AdminShellTitle title="Admin Resource" eyebrow="Missing">
        <p className="rounded-lg border border-champagne/25 bg-ivory p-5 text-burgundy">
          This admin resource is not configured.
        </p>
      </AdminShellTitle>
    )
  }

  return <ConfiguredResourcePage config={config} />
}

function ConfiguredResourcePage({ config }: { config: AdminResourceConfig }) {
  const isProduct = config.endpoint === 'products'
  const isCategory = config.endpoint === 'categories'
  const isCollection = config.endpoint === 'collections'
  const isDedicated = isProduct || isCategory || isCollection
  const { can, refreshSession } = useAdminAuth()
  const canEdit = isProduct
    ? can('products:manage')
    : isCategory
      ? can('categories:manage')
      : isCollection
        ? can('collections:manage')
        : true
  const [items, setItems] = useState<AdminRecord[]>([])
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const loadSequence = useRef(0)
  const [editingItem, setEditingItem] = useState<AdminRecord | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const searchQuery = isDedicated ? debouncedQuery : query

  useEffect(() => {
    if (!isDedicated) return
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 300)
    return () => window.clearTimeout(timeout)
  }, [isDedicated, query])

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    setIsLoading(true)
    setError('')
    try {
      if (isProduct) {
        const result = await adminProductsApi.list({ page, pageSize: 25, search: searchQuery, status: statusFilter })
        if (sequence !== loadSequence.current) return
        if (page > 1 && result.totalPages < page) {
          setPage(Math.max(1, result.totalPages))
          return
        }
        setItems(result.items)
        setTotal(result.total)
        setTotalPages(result.totalPages)
      } else if (isCategory) {
        const result = await adminCategoriesApi.list({ search: searchQuery, status: statusFilter })
        if (sequence !== loadSequence.current) return
        setItems(result)
        setTotal(result.length)
      } else if (isCollection) {
        const result = await adminCollectionsApi.list({ search: searchQuery, status: statusFilter })
        if (sequence !== loadSequence.current) return
        setItems(result)
        setTotal(result.length)
      } else {
        const result = await adminApi.list<AdminRecord>(config.endpoint, searchQuery)
        if (sequence !== loadSequence.current) return
        setItems(result)
      }
    } catch (err) {
      if (err instanceof AdminAuthError && err.status === 401) void refreshSession().catch(() => {})
      if (sequence === loadSequence.current) {
        setError(
          isProduct
            ? productErrorMessage(err)
            : isCategory
              ? categoryErrorMessage(err)
              : isCollection
                ? collectionErrorMessage(err)
                : err instanceof Error
                  ? err.message
                  : 'Unable to load admin data.'
        )
      }
    } finally {
      if (sequence === loadSequence.current) setIsLoading(false)
    }
  }, [config.endpoint, isCategory, isCollection, isProduct, page, refreshSession, searchQuery, statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  const filteredItems = useMemo(() => {
    if (isDedicated) return items
    return items.filter((item) => {
      const matchesStatus =
        statusFilter === 'All' || String(item.status ?? item.enabled ?? '') === statusFilter
      const matchesQuery =
        !query || JSON.stringify(item).toLowerCase().includes(query.toLowerCase())
      return matchesStatus && matchesQuery
    })
  }, [isDedicated, items, query, statusFilter])

  const openAdd = () => {
    setEditingItem(null)
    setIsFormOpen(true)
  }

  const openEdit = async (item: AdminRecord) => {
    if (!item.id) {
      setEditingItem(item)
      setIsFormOpen(true)
      return
    }
    if (isProduct) {
      try {
        setEditingItem(await adminProductsApi.get(item.id))
        setIsFormOpen(true)
      } catch (err) {
        if (err instanceof AdminAuthError && err.status === 401) void refreshSession().catch(() => {})
        setError(productErrorMessage(err))
      }
    } else if (isCategory) {
      try {
        setEditingItem(await adminCategoriesApi.get(item.id))
        setIsFormOpen(true)
      } catch (err) {
        if (err instanceof AdminAuthError && err.status === 401) void refreshSession().catch(() => {})
        setError(categoryErrorMessage(err))
      }
    } else if (isCollection) {
      try {
        setEditingItem(await adminCollectionsApi.get(item.id))
        setIsFormOpen(true)
      } catch (err) {
        if (err instanceof AdminAuthError && err.status === 401) void refreshSession().catch(() => {})
        setError(collectionErrorMessage(err))
      }
    } else {
      setEditingItem(item)
      setIsFormOpen(true)
    }
  }

  const remove = async (item: AdminRecord) => {
    const title = String(item.name ?? item.title ?? item.code ?? item.email ?? config.singular)
    const confirmed = window.confirm(
      isProduct
        ? `Archive "${title}"? It will be removed from the public storefront.`
        : `Delete "${title}"? This cannot be undone.`
    )
    if (!confirmed) return
    if (!item.id) return
    try {
      if (isProduct) {
        await adminProductsApi.archive(item.id)
        setSuccess('Product archived.')
      } else if (isCategory) {
        const res = await adminCategoriesApi.delete(item.id)
        if (res.archived) {
          setSuccess(`"${title}" is referenced by existing products and has been archived instead of deleted.`)
        } else {
          setSuccess(`Category "${title}" deleted.`)
        }
      } else if (isCollection) {
        const res = await adminCollectionsApi.delete(item.id)
        if (res.archived) {
          setSuccess(`"${title}" is referenced by existing products and has been archived instead of deleted.`)
        } else {
          setSuccess(`Collection "${title}" deleted.`)
        }
      } else {
        await adminApi.remove(config.endpoint, item.id)
        setSuccess(`${config.singular} deleted.`)
      }
      await load()
    } catch (err) {
      if (err instanceof AdminAuthError && err.status === 401) void refreshSession().catch(() => {})
      setError(
        isProduct
          ? productErrorMessage(err)
          : isCategory
            ? categoryErrorMessage(err)
            : isCollection
              ? collectionErrorMessage(err)
              : err instanceof Error
                ? err.message
                : 'Unable to delete record.'
      )
    }
  }

  return (
    <div className="space-y-5">
      <AdminShellTitle title={config.label} eyebrow="Admin Management">
        {!config.readOnly && canEdit && (
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" />
            Add {config.singular}
          </Button>
        )}
      </AdminShellTitle>

      <div className="rounded-lg border border-champagne/25 bg-ivory p-4 shadow-sm">
        <div className={cn('grid gap-3', isDedicated ? 'lg:grid-cols-[1fr_180px]' : 'lg:grid-cols-[1fr_180px_auto]')}>
          <label className="flex h-11 items-center gap-3 rounded-full border border-champagne/35 bg-marble px-4">
            <Search className="h-4 w-4 text-oldgold" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              onChange={(event) => { setQuery(event.target.value); if (isDedicated) setPage(1) }}
              placeholder={`Search ${config.label.toLowerCase()}...`}
              value={query}
            />
          </label>
          <select
            className="h-11 rounded-full border border-champagne/35 bg-marble px-4 text-sm font-bold outline-none"
            onChange={(event) => { setStatusFilter(event.target.value); if (isDedicated) setPage(1) }}
            value={statusFilter}
          >
            <option>All</option>
            <option>Published</option>
            <option>Draft</option>
            {isDedicated && <option>Unpublished</option>}
            {isDedicated && <option>Archived</option>}
            {!isDedicated && <option>Active</option>}
            {!isDedicated && <>
            <option>Inactive</option>
            <option>Approved</option>
            <option>Pending</option>
            <option>Rejected</option>
            <option>Unread</option>
            <option>Read</option>
            <option>true</option>
            <option>false</option>
            </>}
          </select>
          {!isDedicated && <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-champagne/35 bg-marble px-4 text-sm font-bold text-brownroyal transition hover:bg-champagne/15"
            onClick={() => void adminApi.exportResource(config.endpoint)}
            type="button"
          >
            <Download className="h-4 w-4" />
            Export
          </button>}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      <div className="overflow-hidden rounded-lg border border-champagne/25 bg-ivory shadow-sm">
        {isLoading ? (
          <div className="p-8 text-center text-brownroyal/65">Loading {config.label.toLowerCase()}...</div>
        ) : !error && filteredItems.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-serif text-3xl font-semibold text-burgundy">No records found</p>
            <p className="mt-2 text-brownroyal/65">Use search/filter or add a new record.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-marble text-xs uppercase tracking-[0.16em] text-oldgold">
                <tr>
                  {config.columns.map((column) => (
                    <th className="px-4 py-3" key={column}>{toLabel(column)}</th>
                  ))}
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-champagne/20">
                {filteredItems.map((item) => (
                  <tr className="hover:bg-marble/55" key={item.id}>
                    {config.columns.map((column) => (
                      <td className="max-w-[260px] px-4 py-4 align-top" key={column}>
                        <CellValue value={getPath(item, column)} />
                      </td>
                    ))}
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        {!config.readOnly && canEdit && (
                          <Button size="sm" variant="outline" onClick={() => void openEdit(item)}>
                            <Edit className="h-4 w-4" />
                            Edit
                          </Button>
                        )}
                        {!config.readOnly && canEdit && ((!isDedicated) || item.status !== 'Archived') && (
                          <Button size="sm" variant="ghost" onClick={() => void remove(item)}>
                            <Trash2 className="h-4 w-4" />
                            {isProduct ? 'Archive Product' : 'Delete'}
                          </Button>
                        )}
                        {config.endpoint === 'contact-messages' && (
                          <a className="text-sm font-bold text-burgundy" href={`mailto:${item.email}`}>
                            Reply
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isProduct && !isLoading && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-brownroyal">
          <span>{total} products · Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button disabled={page <= 1} onClick={() => setPage((current) => current - 1)} size="sm" variant="outline">Previous</Button>
            <Button disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} size="sm" variant="outline">Next</Button>
          </div>
        </div>
      )}

      {isFormOpen && (
        <AdminRecordForm
          config={config}
          initialValue={editingItem}
          onClose={() => setIsFormOpen(false)}
          onSaved={(message) => {
            setSuccess(message)
            setIsFormOpen(false)
            void load()
          }}
        />
      )}
    </div>
  )
}

function AdminRecordForm({
  config,
  initialValue,
  onClose,
  onSaved,
}: {
  config: AdminResourceConfig
  initialValue: AdminRecord | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { refreshSession } = useAdminAuth()
  const [form, setForm] = useState<AdminRecord>(() => ({
    ...(initialValue ?? createDefaultRecord(config.fields)),
    ...(!initialValue && config.endpoint === 'categories' ? { active: true } : {}),
  } as AdminRecord))
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isUploadingMedia, setIsUploadingMedia] = useState(false)
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([])
  const [categoryError, setCategoryError] = useState('')
  const [categoryLoading, setCategoryLoading] = useState(config.endpoint === 'products')

  useEffect(() => {
    if (config.endpoint !== 'products') return
    let active = true
    adminCategoriesApi.list({ active: 'true', status: 'Published' })
      .then((result) => {
        if (!active) return
        setCategories(selectableCategories(result).map(({ id, name }) => ({ id, name })))
      })
      .catch((err) => {
        if (active) setCategoryError(categoryErrorMessage(err))
      })
      .finally(() => { if (active) setCategoryLoading(false) })
    return () => { active = false }
  }, [config.endpoint])

  const setValue = (field: AdminField, value: unknown) => {
    setForm((current) => setPath(current, field.name, value))
  }

  const stagedMediaRef = useRef(new Map<string, string>())
  const activeUploadsRef = useRef(0)

  const onUploadMedia = async (fieldName: string, file: File): Promise<string> => {
    const mediaType =
      fieldName === 'image'
        ? 'main'
        : fieldName === 'cardImage'
          ? 'card'
          : fieldName === 'cardHoverImage'
            ? 'cardHover'
            : 'gallery'

    const productId = initialValue?.id ? String(initialValue.id) : (form.id ? String(form.id) : undefined)
    activeUploadsRef.current += 1
    setIsUploadingMedia(true)
    try {
      const res = await adminMediaApi.upload(file, {
        productId,
        mediaType,
        altText: `${String(getPath(form, 'name') || 'Product')} ${fieldName}`,
      })
      const uploadedUrl = secureMediaUrl(res)
      if (!productId && !res.uploadToken) throw new Error('Upload could not be attached to a new product.')
      if (fieldName !== 'gallery') {
        const previousUrl = String(getPath(form, fieldName) || '')
        const previousToken = stagedMediaRef.current.get(previousUrl)
        if (previousToken && previousUrl !== uploadedUrl) {
          await adminMediaApi.deleteStaged(previousToken)
          stagedMediaRef.current.delete(previousUrl)
        }
      }
      if (res.uploadToken) stagedMediaRef.current.set(res.secureUrl, res.uploadToken)
      if (fieldName === 'image') {
        setForm((current) => ({
          ...current,
          gallery: [...new Set([
            ...(Array.isArray(current.gallery) ? current.gallery.filter((url) => url !== current.image) : []),
            uploadedUrl,
          ])],
        }))
      } else if (fieldName === 'gallery') {
        setForm((current) => current.image ? current : { ...current, image: uploadedUrl })
      }
      return uploadedUrl
    } catch (err) {
      throw new Error(mediaErrorMessage(err))
    } finally {
      activeUploadsRef.current -= 1
      setIsUploadingMedia(activeUploadsRef.current > 0)
    }
  }

  const onDeleteMedia = async (_fieldName: string, imageUrl: string): Promise<void> => {
    const stagedToken = stagedMediaRef.current.get(imageUrl)
    if (stagedToken) {
      await adminMediaApi.deleteStaged(stagedToken)
      stagedMediaRef.current.delete(imageUrl)
    } else {
      const productId = initialValue?.id ? String(initialValue.id) : (form.id ? String(form.id) : undefined)
      if (productId && (imageUrl.startsWith('https://res.cloudinary.com') || imageUrl.includes('royal-fusion'))) {
        await adminMediaApi.delete({ productId, secureUrl: imageUrl })
      }
    }
    setForm((current) => {
      const gallery = Array.isArray(current.gallery) ? current.gallery.filter((url) => url !== imageUrl) : []
      return {
        ...current,
        gallery,
        ...(current.image === imageUrl ? { image: gallery[0] || '' } : {}),
        ...(current.cardImage === imageUrl ? { cardImage: '' } : {}),
        ...(current.cardHoverImage === imageUrl ? { cardHoverImage: '' } : {}),
      }
    })
  }

  const handleClose = () => {
    if (activeUploadsRef.current > 0) return
    if (!form.id && stagedMediaRef.current.size) {
      const tokens = [...stagedMediaRef.current.values()]
      stagedMediaRef.current.clear()
      void Promise.allSettled(tokens.map((token) => adminMediaApi.deleteStaged(token)))
    }
    onClose()
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (activeUploadsRef.current > 0) {
      setError('Wait for image uploads to finish before saving.')
      return
    }
    try {
      const payload = normalizePayload(config.fields, form)
      const validationErrors = validateAdminRecord(config, payload)
      if (validationErrors.length > 0) {
        setError(validationErrors.join(' '))
        return
      }

      setIsSaving(true)
      if (initialValue || (config.endpoint === 'products' && form.id)) {
        if (config.endpoint === 'products') {
          const productId = String(initialValue?.id || form.id)
          await adminProductsApi.update(productId, { ...payload, expectedRevision: String(initialValue?.catalogRevision ?? form.catalogRevision ?? '') })
          try {
            for (const [secureUrl, uploadToken] of stagedMediaRef.current) {
              await adminMediaApi.claim(productId, uploadToken)
              stagedMediaRef.current.delete(secureUrl)
            }
          } catch (err) {
            setError(`Product saved, but media attachment failed: ${mediaErrorMessage(err)} Save again to retry.`)
            return
          }
        }
        else if (config.endpoint === 'categories') await adminCategoriesApi.update(String(initialValue?.id), payload)
        else if (config.endpoint === 'collections') await adminCollectionsApi.update(String(initialValue?.id), payload)
        else await adminApi.update(config.endpoint, String(initialValue?.id), payload)
        onSaved(`${config.singular} updated.`)
      } else {
        if (config.endpoint === 'products') {
          const created = await adminProductsApi.create(payload)
          if (stagedMediaRef.current.size > 0) {
            setForm((current) => ({ ...current, id: created.id, catalogRevision: created.catalogRevision }))
            try {
              for (const [secureUrl, uploadToken] of stagedMediaRef.current) {
                await adminMediaApi.claim(created.id, uploadToken)
                stagedMediaRef.current.delete(secureUrl)
              }
            } catch (err) {
              setError(`Product created (ID: ${created.id}), but media attachment failed: ${mediaErrorMessage(err)} Save again to retry.`)
              return
            }
          }
          onSaved(`${config.singular} created.`)
        } else if (config.endpoint === 'categories') {
          await adminCategoriesApi.create(payload)
          onSaved(`${config.singular} created.`)
        } else if (config.endpoint === 'collections') {
          await adminCollectionsApi.create(payload)
          onSaved(`${config.singular} created.`)
        } else {
          await adminApi.create(config.endpoint, payload)
          onSaved(`${config.singular} created.`)
        }
      }
    } catch (err) {
      if (err instanceof AdminAuthError && err.status === 401) void refreshSession().catch(() => {})
      setError(
        config.endpoint === 'products'
          ? productErrorMessage(err)
          : config.endpoint === 'categories'
            ? categoryErrorMessage(err)
            : config.endpoint === 'collections'
              ? collectionErrorMessage(err)
              : err instanceof Error
                ? err.message
                : 'Unable to save.'
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-brownroyal/55 p-4 backdrop-blur-sm">
      <div className="mx-auto my-6 max-w-5xl rounded-lg border border-champagne/30 bg-ivory shadow-2xl">
        <div className="flex items-center justify-between border-b border-champagne/25 px-5 py-4">
          <h2 className="font-serif text-3xl font-semibold text-burgundy">
            {initialValue || (config.endpoint === 'products' && form.id) ? `Edit ${config.singular}` : `Add ${config.singular}`}
          </h2>
          <button className="text-sm font-bold text-burgundy" disabled={isUploadingMedia} onClick={handleClose} type="button">
            Close
          </button>
        </div>
        <form className="p-5 space-y-6" onSubmit={handleSubmit}>
          {config.endpoint === 'products' ? (
            <ProductFormSections
              config={config}
              categories={categories}
              form={form}
              getPath={getPath}
              setForm={setForm}
              setValue={setValue}
              onUploadMedia={onUploadMedia}
              onDeleteMedia={onDeleteMedia}
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {config.fields.map((field) => (
                <AdminFormField
                  allowUpload={config.endpoint !== 'categories'}
                  field={field}
                  key={field.name}
                  onChange={(value) => setValue(field, value)}
                  onMainImageSelect={(image) => {
                    setForm((current) => ({
                      ...current,
                      mainImage: image,
                      image,
                    }))
                  }}
                  value={getPath(form, field.name)}
                />
              ))}
            </div>
          )}
          {categoryError && config.endpoint === 'products' && <Alert tone="error">{categoryError}</Alert>}
          {config.endpoint === 'products' && !categoryLoading && !categoryError && categories.length === 0 && (
            <p className="text-sm text-brownroyal/65">No published, active categories are available. Create one in <a className="font-bold text-burgundy underline" href="/admin/categories">Categories</a>, then reopen this form.</p>
          )}
          {error && <Alert className="mt-5" tone="error">{error}</Alert>}
          <div className="mt-6 flex justify-end gap-3 border-t border-champagne/25 pt-4">
            <Button disabled={isUploadingMedia} onClick={handleClose} variant="outline">Cancel</Button>
            <Button disabled={isSaving || isUploadingMedia} type="submit">
              {isSaving ? 'Saving...' : 'Save Record'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ProductFormSections({
  config,
  categories,
  form,
  getPath,
  setValue,
  setForm,
  onUploadMedia,
  onDeleteMedia,
}: {
  config: AdminResourceConfig
  categories: Array<{ id: string; name: string }>
  form: AdminRecord
  getPath: (source: Record<string, unknown>, path: string) => unknown
  setValue: (field: AdminField, value: unknown) => void
  setForm: React.Dispatch<React.SetStateAction<AdminRecord>>
  onUploadMedia?: (fieldName: string, file: File) => Promise<string>
  onDeleteMedia?: (fieldName: string, imageUrl: string) => Promise<void>
}) {
  const sections = [
    {
      title: '🏷️ 1. Basic Information & Pricing',
      fields: ['name', 'slug', 'sku', 'categoryId', 'price', 'salePrice', 'oldPrice', 'stockQuantity', 'bottleSize', 'shortDescription', 'description'],
    },
    {
      title: '🧪 2. Fragrance Pyramid & Notes Profile',
      fields: ['scentFamily', 'gender', 'concentration', 'longevity', 'occasion', 'inspiredBy', 'notes.top', 'notes.middle', 'notes.base'],
    },
    {
      title: '🖼️ 3. Media & Product Gallery',
      fields: ['gallery', 'image', 'imageAlt'],
    },
    {
      title: '🎨 4. Product Card Presentation (Concept 7)',
      fields: ['cardImage', 'cardHoverImage', 'cardBackgroundColor'],
    },
    {
      title: '⭐ 5. Badges, Variations & Publishing',
      fields: ['tags', 'badge', 'variations', 'isFeatured', 'isBestSeller', 'isNewArrival', 'isPremium', 'isAttar', 'status', 'seoTitle', 'seoDescription'],
    },
  ]

  const fieldMap = new Map(config.fields.map((f) => [f.name, f]))

  return (
    <div className="space-y-6">
      {sections.map((section) => {
        const sectionFields = section.fields
          .map((fieldName) => fieldMap.get(fieldName))
          .filter((f): f is AdminField => Boolean(f))

        if (sectionFields.length === 0) return null

        const isPresentationSection = section.title.includes('Product Card Presentation')
        const bgHex = String(getPath(form, 'cardBackgroundColor') || '#E7C78F')
        const defaultCardImg = String(getPath(form, 'cardImage') || getPath(form, 'image') || '')
        const hoverCardImg = String(getPath(form, 'cardHoverImage') || '')

        return (
          <fieldset className="rounded-lg border border-champagne/35 bg-ivory p-4 shadow-sm" key={section.title}>
            <legend className="px-2 font-serif text-lg font-bold text-burgundy bg-ivory rounded border border-champagne/30">
              {section.title}
            </legend>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {sectionFields.map((field) => field.name === 'categoryId' ? (
                <label key={field.name}>
                  <span className="mb-2 block text-sm font-bold text-brownroyal">Category</span>
                  <select
                    className="h-12 w-full rounded-full border border-champagne/35 bg-marble px-4 outline-none focus:border-burgundy"
                    onChange={(event) => setValue(field, event.target.value)}
                    value={String(getPath(form, 'categoryId') ?? '')}
                  >
                    <option value="">No category</option>
                    {Boolean(getPath(form, 'categoryId')) && !categories.some(({ id }) => id === getPath(form, 'categoryId')) && (
                      <option value={String(getPath(form, 'categoryId'))}>{String(getPath(form, 'category') || 'Current category')}</option>
                    )}
                    {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </label>
              ) : (
                <AdminFormField
                  allowUpload={true}
                  field={field}
                  key={field.name}
                  onChange={(value) => setValue(field, value)}
                  onDelete={onDeleteMedia ? (imageUrl) => onDeleteMedia(field.name, imageUrl) : undefined}
                  onMainImageSelect={(image) => {
                    setForm((current) => ({
                      ...current,
                      image,
                    }))
                  }}
                  onUpload={onUploadMedia ? (file) => onUploadMedia(field.name, file) : undefined}
                  value={getPath(form, field.name)}
                />
              ))}
            </div>

            {isPresentationSection && (
              <div className="mt-5 rounded-xl border border-champagne/35 bg-marble/60 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-oldgold mb-3">
                  Live Card Preview (Hover over card to preview lifestyle photoshoot)
                </p>
                <div className="flex flex-col sm:flex-row items-center gap-5">
                  <div
                    className="group relative aspect-[4/5] w-44 overflow-hidden rounded-[14px] border border-soft-border/80 shadow-md"
                    style={{ backgroundColor: bgHex }}
                  >
                    {Boolean(getPath(form, 'badge')) && (
                      <span className="absolute left-2.5 top-2.5 z-10 rounded-full border border-champagne/30 bg-royal-burgundy px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
                        {String(getPath(form, 'badge'))}
                      </span>
                    )}
                    {defaultCardImg ? (
                      <img
                        src={defaultCardImg}
                        alt="Product card preview"
                        className={cn(
                          'relative z-0 h-[82%] w-auto max-w-[82%] object-contain mx-auto my-auto absolute inset-0 m-auto transition-opacity duration-400 ease-out',
                          hoverCardImg && 'group-hover:opacity-0',
                        )}
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-xs font-bold text-brownroyal/40">
                        No PNG selected
                      </div>
                    )}
                    {hoverCardImg && (
                      <img
                        src={hoverCardImg}
                        alt="Card hover preview"
                        className="absolute inset-0 z-0 h-full w-full object-cover opacity-0 transition-opacity duration-400 ease-out group-hover:opacity-100"
                      />
                    )}
                  </div>
                  <div className="space-y-1.5 text-xs text-brownroyal/80 max-w-sm">
                    <p className="font-serif text-base font-bold text-burgundy">{String(getPath(form, 'name') || 'Product Name')}</p>
                    <p><strong>Configured Color:</strong> <span className="font-mono font-semibold text-burgundy">{bgHex}</span></p>
                    <p><strong>Default Bottle Image:</strong> {getPath(form, 'cardImage') ? 'Dedicated card PNG' : 'Fallback to primary image'}</p>
                    <p><strong>Hover Image:</strong> {hoverCardImg ? 'Configured (crossfade active)' : 'None (solid PNG retained)'}</p>
                  </div>
                </div>
              </div>
            )}
          </fieldset>
        )
      })}
    </div>
  )
}

function AdminFormField({
  field,
  value,
  onChange,
  onMainImageSelect,
  allowUpload = true,
  onUpload,
  onDelete,
}: {
  field: AdminField
  value: unknown
  onChange: (value: unknown) => void
  onMainImageSelect?: (value: string) => void
  allowUpload?: boolean
  onUpload?: (file: File) => Promise<string>
  onDelete?: (image: string) => Promise<void>
}) {
  const type = field.type ?? 'text'
  const label = (
    <span className="mb-2 block text-sm font-bold text-brownroyal">
      {field.label}
      {field.required && <span className="text-burgundy"> *</span>}
    </span>
  )

  if (type === 'checkbox') {
    return (
      <label className="flex items-center justify-between gap-4 rounded-lg border border-champagne/25 bg-marble p-4">
        <span className="font-bold text-brownroyal">{field.label}</span>
        <input
          checked={Boolean(value)}
          className="h-5 w-5 accent-burgundy"
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
      </label>
    )
  }

  if (type === 'textarea') {
    return (
      <label className="md:col-span-2">
        {label}
        <textarea
          className="min-h-28 w-full rounded-lg border border-champagne/35 bg-marble px-4 py-3 outline-none focus:border-burgundy"
          onChange={(event) => onChange(event.target.value)}
          required={field.required}
          value={String(value ?? '')}
        />
      </label>
    )
  }

  if (type === 'select') {
    return (
      <label>
        {label}
        <select
          className="h-12 w-full rounded-full border border-champagne/35 bg-marble px-4 outline-none focus:border-burgundy"
          onChange={(event) => onChange(event.target.value)}
          value={String(value ?? field.options?.[0] ?? '')}
        >
          {field.options?.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
    )
  }

  if (type === 'tags') {
    const currentTags = Array.isArray(value) ? value.map(String) : splitList(String(value ?? ''))
    const presets = NOTE_PRESETS[field.name]

    const togglePreset = (note: string) => {
      const exists = currentTags.some((t) => t.toLowerCase() === note.toLowerCase())
      const next = exists
        ? currentTags.filter((t) => t.toLowerCase() !== note.toLowerCase())
        : [...currentTags, note]
      onChange(next)
    }

    return (
      <div className="space-y-2">
        <label className="block">
          {label}
          <input
            className="h-12 w-full rounded-full border border-champagne/35 bg-marble px-4 outline-none focus:border-burgundy"
            onChange={(event) => onChange(splitList(event.target.value))}
            placeholder="Comma separated"
            value={currentTags.join(', ')}
          />
        </label>
        {presets && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] font-bold text-brownroyal/60">Quick Add Note:</span>
            {presets.map((note) => {
              const active = currentTags.some((t) => t.toLowerCase() === note.toLowerCase())
              return (
                <button
                  key={note}
                  type="button"
                  onClick={() => togglePreset(note)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-xs font-semibold transition',
                    active
                      ? 'bg-burgundy text-ivory'
                      : 'bg-champagne/20 text-brownroyal hover:bg-champagne/40',
                  )}
                >
                  {active ? `✓ ${note}` : `+ ${note}`}
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  if (type === 'color') {
    const currentColor = String(value || '#E7C78F')
    const presets = [
      { name: 'Warm Champagne', value: '#E7C78F' },
      { name: 'Soft Blush', value: '#EBC0BE' },
      { name: 'Muted Amber', value: '#D7A35B' },
      { name: 'Soft Ivory', value: '#F3E8D5' },
      { name: 'Warm Taupe', value: '#C7AE96' },
      { name: 'Dusty Rose', value: '#D6A3A8' },
      { name: 'Deep Wine', value: '#6B2A3C' },
      { name: 'Deep Espresso', value: '#4A3026' },
    ]

    const handleHexChange = (hex: string) => {
      let formatted = hex.trim()
      if (formatted && !formatted.startsWith('#')) {
        formatted = `#${formatted}`
      }
      onChange(formatted)
    }

    return (
      <div className="md:col-span-2 space-y-3">
        {label}
        <div className="flex flex-wrap items-center gap-2">
          {presets.map((preset) => {
            const isSelected = currentColor.toLowerCase() === preset.value.toLowerCase()
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => onChange(preset.value)}
                className={cn(
                  'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                  isSelected
                    ? 'border-burgundy bg-burgundy/10 text-burgundy shadow-xs ring-1 ring-burgundy/30'
                    : 'border-champagne/40 bg-marble text-brownroyal hover:border-champagne hover:bg-champagne/15',
                )}
              >
                <span
                  className="h-3.5 w-3.5 rounded-full border border-black/15 shadow-xs"
                  style={{ backgroundColor: preset.value }}
                />
                <span>{preset.name}</span>
                <span className="font-mono text-[10px] text-brownroyal/60">({preset.value})</span>
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <div className="flex h-11 items-center gap-2 rounded-full border border-champagne/35 bg-marble px-3">
            <input
              type="color"
              value={currentColor.startsWith('#') && (currentColor.length === 7 || currentColor.length === 4) ? currentColor : '#E7C78F'}
              onChange={(e) => onChange(e.target.value.toUpperCase())}
              className="h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent p-0"
              title="Pick custom color"
            />
            <input
              type="text"
              placeholder="#E7C78F"
              value={String(value ?? '')}
              onChange={(e) => handleHexChange(e.target.value)}
              className="w-24 font-mono text-sm font-semibold uppercase outline-none bg-transparent text-brownroyal"
            />
          </div>
          <span className="text-xs text-brownroyal/65">
            Click any luxury preset or use the color picker / enter HEX.
          </span>
        </div>
        {field.help && <p className="mt-1 text-xs text-brownroyal/60">{field.help}</p>}
      </div>
    )
  }

  if (type === 'images') {
    const images = Array.isArray(value) ? value.map(String) : value ? [String(value)] : []
    const isSingleImageField =
      field.name === 'image' ||
      field.name === 'avatar' ||
      field.name === 'cardImage' ||
      field.name === 'cardHoverImage'

    return (
      <div className="md:col-span-2">
        {label}
        <AdminMediaUploader
          allowUpload={allowUpload}
          multiple={!isSingleImageField}
          onChange={(next) =>
            onChange(isSingleImageField ? next[next.length - 1] ?? next[0] ?? '' : next)
          }
          onDelete={onDelete}
          onMainImageSelect={onMainImageSelect}
          onUpload={onUpload}
          value={images}
        />
        {field.help && <p className="mt-2 text-xs text-brownroyal/60">{field.help}</p>}
      </div>
    )
  }

  if (type === 'json') {
    return (
      <label className="md:col-span-2">
        {label}
        <textarea
          className="min-h-40 w-full rounded-lg border border-champagne/35 bg-marble px-4 py-3 font-mono text-sm outline-none focus:border-burgundy"
          onChange={(event) => {
            try {
              onChange(JSON.parse(event.target.value || '[]'))
            } catch {
              onChange(event.target.value)
            }
          }}
          value={typeof value === 'string' ? value : JSON.stringify(value ?? [], null, 2)}
        />
        {field.help && <p className="mt-2 text-xs text-brownroyal/60">{field.help}</p>}
      </label>
    )
  }

  return (
    <label>
      {label}
      <input
        className="h-12 w-full rounded-full border border-champagne/35 bg-marble px-4 outline-none focus:border-burgundy"
        onChange={(event) => onChange(type === 'number' ? Number(event.target.value) : event.target.value)}
        min={type === 'number' ? 0 : undefined}
        required={field.required}
        type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
        value={String(value ?? '')}
      />
    </label>
  )
}

function AdminShellTitle({
  title,
  eyebrow,
  children,
}: {
  title: string
  eyebrow: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-oldgold">{eyebrow}</p>
        <h1 className="mt-2 font-serif text-4xl font-semibold text-burgundy">{title}</h1>
      </div>
      {children}
    </div>
  )
}

function CellValue({ value }: { value: unknown }) {
  if (typeof value === 'boolean') {
    return <span className={cn('rounded-full px-2 py-1 text-xs font-bold', value ? 'bg-[#2f8f5b]/12 text-[#2f8f5b]' : 'bg-burgundy/10 text-burgundy')}>{String(value)}</span>
  }
  if (Array.isArray(value)) return <span>{value.join(', ')}</span>
  if (value && typeof value === 'object') return <span>{JSON.stringify(value)}</span>
  return <span className="line-clamp-2">{String(value ?? '-')}</span>
}

function Alert({
  children,
  tone,
  className,
}: {
  children: ReactNode
  tone: 'success' | 'error'
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3 text-sm font-semibold',
        tone === 'success'
          ? 'border-[#2f8f5b]/20 bg-[#2f8f5b]/10 text-[#2f8f5b]'
          : 'border-burgundy/20 bg-burgundy/8 text-burgundy',
        className,
      )}
    >
      {children}
    </div>
  )
}

function createDefaultRecord(fields: AdminField[]) {
  return fields.reduce<Record<string, unknown>>((acc, field) => {
    const type = field.type ?? 'text'
    const value =
      type === 'checkbox'
        ? false
        : type === 'number'
          ? 0
          : type === 'tags' || type === 'images' || type === 'json'
            ? []
            : type === 'select'
              ? field.options?.[0] ?? ''
              : ''
    return setPath(acc, field.name, value)
  }, {})
}

function normalizePayload(fields: AdminField[], form: AdminRecord) {
  const payload: Record<string, unknown> = { ...form }
  delete payload.id
  for (const field of fields) {
    if (field.type === 'json') {
      const value = getPath(payload, field.name)
      if (typeof value === 'string') {
        setPath(payload, field.name, JSON.parse(value || '[]'))
      }
    }
  }
  return payload
}

function validateAdminRecord(config: AdminResourceConfig, payload: Record<string, unknown>) {
  const errors: string[] = []

  for (const field of config.fields) {
    const value = getPath(payload, field.name)
    const isProductImageField = config.endpoint === 'products' && field.name === 'gallery'
    if (field.required && !isProductImageField && isEmptyAdminValue(value)) {
      errors.push(`${field.label} is required.`)
    }
    if (field.type === 'number' && !isEmptyAdminValue(value)) {
      const numberValue = Number(value)
      if (!Number.isFinite(numberValue) || numberValue < 0) {
        errors.push(`${field.label} must be a valid positive number.`)
      }
    }
  }

  if (config.endpoint === 'products') {
    const price = Number(payload.price)
    const salePrice = Number(payload.salePrice ?? 0)
    const stock = Number(payload.stockQuantity)
    if (!Number.isFinite(price) || price <= 0) errors.push('Product price must be greater than 0.')
    if (!Number.isInteger(stock) || stock < 0) errors.push('Stock quantity must be 0 or more.')
    if (salePrice > 0 && salePrice >= price) errors.push('Sale price must be lower than regular price.')
    if (!hasProductImage(payload)) errors.push('At least one product image is required.')
  }

  if (config.endpoint === 'coupons') {
    const discountValue = Number(payload.discountValue ?? 0)
    const minimumOrderAmount = Number(payload.minimumOrderAmount ?? 0)
    const type = String(payload.type ?? '')
    if (type !== 'Free Shipping' && discountValue <= 0) errors.push('Discount value is required.')
    if (type === 'Percentage' && discountValue > 100) errors.push('Percentage discount cannot exceed 100%.')
    if (minimumOrderAmount < 0) errors.push('Minimum order amount cannot be negative.')
    validateDateRange(payload, errors)
  }

  if (config.endpoint === 'banners') {
    if (isEmptyAdminValue(payload.image)) errors.push('Banner image is required.')
    validateDateRange(payload, errors)
  }

  if (config.endpoint === 'blogs' && isEmptyAdminValue(payload.image)) {
    errors.push('Featured image is required.')
  }

  if (config.endpoint === 'testimonials' || config.endpoint === 'reviews') {
    const rating = Number(payload.rating)
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      errors.push('Rating must be between 1 and 5.')
    }
    if (String(payload.text ?? '').trim().length < 5) {
      errors.push('Review text is required.')
    }
  }

  if (config.endpoint === 'newsletter' && !isValidEmail(String(payload.email ?? ''))) {
    errors.push('Subscriber email must be valid.')
  }

  return [...new Set(errors)]
}

function isEmptyAdminValue(value: unknown) {
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'number') return !Number.isFinite(value)
  if (typeof value === 'string') return value.trim().length === 0
  return value === null || value === undefined
}

function hasProductImage(payload: Record<string, unknown>) {
  return !isEmptyAdminValue(payload.image) || !isEmptyAdminValue(payload.gallery)
}

function validateDateRange(payload: Record<string, unknown>, errors: string[]) {
  const startDate = String(payload.startDate ?? '')
  const endDate = String(payload.endDate ?? '')
  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    errors.push('End date must be after start date.')
  }
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function getPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[key]
  }, source)
}

function setPath(source: Record<string, unknown>, path: string, value: unknown) {
  const next = structuredClone(source)
  const parts = path.split('.')
  let cursor: Record<string, unknown> = next
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part] as Record<string, unknown>
  })
  cursor[parts[parts.length - 1]] = value
  return next
}

function splitList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function toLabel(value: string) {
  return value
    .replace(/[A-Z]/g, (letter) => ` ${letter}`)
    .replace(/^./, (letter) => letter.toUpperCase())
}
