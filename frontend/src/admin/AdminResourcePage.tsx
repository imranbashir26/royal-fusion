import { Download, Edit, Plus, Search, Trash2 } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '../components/common/Button'
import { adminApi } from '../services/adminApi'
import { cn } from '../utils/cn'
import { AdminMediaUploader } from './AdminMediaUploader'
import type { AdminField, AdminResourceConfig } from './adminConfig'
import { resourceConfigs } from './adminConfig'

type AdminRecord = Record<string, unknown> & { id?: string }

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
  const [items, setItems] = useState<AdminRecord[]>([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [editingItem, setEditingItem] = useState<AdminRecord | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      setItems(await adminApi.list<AdminRecord>(config.endpoint, query))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load admin data.')
    } finally {
      setIsLoading(false)
    }
  }, [config.endpoint, query])

  useEffect(() => {
    void load()
  }, [load])

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesStatus =
        statusFilter === 'All' || String(item.status ?? item.enabled ?? '') === statusFilter
      const matchesQuery =
        !query || JSON.stringify(item).toLowerCase().includes(query.toLowerCase())
      return matchesStatus && matchesQuery
    })
  }, [items, query, statusFilter])

  const openAdd = () => {
    setEditingItem(null)
    setIsFormOpen(true)
  }

  const openEdit = (item: AdminRecord) => {
    setEditingItem(item)
    setIsFormOpen(true)
  }

  const remove = async (item: AdminRecord) => {
    const title = String(item.name ?? item.title ?? item.code ?? item.email ?? config.singular)
    const confirmed = window.confirm(`Delete "${title}"? This cannot be undone.`)
    if (!confirmed) return
    if (!item.id) return
    await adminApi.remove(config.endpoint, item.id)
    setSuccess(`${config.singular} deleted.`)
    void load()
  }

  return (
    <div className="space-y-5">
      <AdminShellTitle title={config.label} eyebrow="Admin Management">
        {!config.readOnly && (
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" />
            Add {config.singular}
          </Button>
        )}
      </AdminShellTitle>

      <div className="rounded-lg border border-champagne/25 bg-ivory p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_auto]">
          <label className="flex h-11 items-center gap-3 rounded-full border border-champagne/35 bg-marble px-4">
            <Search className="h-4 w-4 text-oldgold" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${config.label.toLowerCase()}...`}
              value={query}
            />
          </label>
          <select
            className="h-11 rounded-full border border-champagne/35 bg-marble px-4 text-sm font-bold outline-none"
            onChange={(event) => setStatusFilter(event.target.value)}
            value={statusFilter}
          >
            <option>All</option>
            <option>Published</option>
            <option>Draft</option>
            <option>Active</option>
            <option>Inactive</option>
            <option>Approved</option>
            <option>Pending</option>
            <option>Rejected</option>
            <option>Unread</option>
            <option>Read</option>
            <option>true</option>
            <option>false</option>
          </select>
          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-champagne/35 bg-marble px-4 text-sm font-bold text-brownroyal transition hover:bg-champagne/15"
            onClick={() => void adminApi.exportResource(config.endpoint)}
            type="button"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      <div className="overflow-hidden rounded-lg border border-champagne/25 bg-ivory shadow-sm">
        {isLoading ? (
          <div className="p-8 text-center text-brownroyal/65">Loading {config.label.toLowerCase()}...</div>
        ) : filteredItems.length === 0 ? (
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
                        {!config.readOnly && (
                          <Button size="sm" variant="outline" onClick={() => openEdit(item)}>
                            <Edit className="h-4 w-4" />
                            Edit
                          </Button>
                        )}
                        {!config.readOnly && (
                          <Button size="sm" variant="ghost" onClick={() => void remove(item)}>
                            <Trash2 className="h-4 w-4" />
                            Delete
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
  const [form, setForm] = useState<AdminRecord>(() => ({
    ...(initialValue ?? createDefaultRecord(config.fields)),
  } as AdminRecord))
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const setValue = (field: AdminField, value: unknown) => {
    setForm((current) => setPath(current, field.name, value))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    try {
      const payload = normalizePayload(config.fields, form)
      const validationErrors = validateAdminRecord(config, payload)
      if (validationErrors.length > 0) {
        setError(validationErrors.join(' '))
        return
      }

      setIsSaving(true)
      if (initialValue) {
        await adminApi.update(config.endpoint, String(initialValue.id), payload)
        onSaved(`${config.singular} updated.`)
      } else {
        await adminApi.create(config.endpoint, payload)
        onSaved(`${config.singular} created.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-brownroyal/55 p-4 backdrop-blur-sm">
      <div className="mx-auto my-6 max-w-5xl rounded-lg border border-champagne/30 bg-ivory shadow-2xl">
        <div className="flex items-center justify-between border-b border-champagne/25 px-5 py-4">
          <h2 className="font-serif text-3xl font-semibold text-burgundy">
            {initialValue ? `Edit ${config.singular}` : `Add ${config.singular}`}
          </h2>
          <button className="text-sm font-bold text-burgundy" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <form className="p-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            {config.fields.map((field) => (
              <AdminFormField
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
          {error && <Alert className="mt-5" tone="error">{error}</Alert>}
          <div className="mt-6 flex justify-end gap-3">
            <Button onClick={onClose} variant="outline">Cancel</Button>
            <Button disabled={isSaving} type="submit">
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AdminFormField({
  field,
  value,
  onChange,
  onMainImageSelect,
}: {
  field: AdminField
  value: unknown
  onChange: (value: unknown) => void
  onMainImageSelect?: (value: string) => void
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
    return (
      <label>
        {label}
        <input
          className="h-12 w-full rounded-full border border-champagne/35 bg-marble px-4 outline-none focus:border-burgundy"
          onChange={(event) => onChange(splitList(event.target.value))}
          placeholder="Comma separated"
          value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
        />
      </label>
    )
  }

  if (type === 'images') {
    const images = Array.isArray(value) ? value.map(String) : value ? [String(value)] : []
    return (
      <div className="md:col-span-2">
        {label}
        <AdminMediaUploader
          onChange={(next) => onChange(field.name === 'image' || field.name === 'avatar' ? next[0] ?? '' : next)}
          onMainImageSelect={onMainImageSelect}
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
    const stock = Number(payload.stock)
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
  return !isEmptyAdminValue(payload.image) || !isEmptyAdminValue(payload.mainImage) || !isEmptyAdminValue(payload.gallery)
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
