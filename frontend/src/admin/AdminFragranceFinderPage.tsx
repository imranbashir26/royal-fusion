import { useEffect, useState } from 'react'
import { Button } from '../components/common/Button'
import { adminFragranceFinderApi, type AdminFinderPreference } from '../services/adminFragranceFinderApi'
import { useAdminAuth } from './AdminAuthProvider'

export function AdminFragranceFinderPage() {
  const { can } = useAdminAuth()
  const allowed = can('homepage.manage')
  const [preferences, setPreferences] = useState<AdminFinderPreference[]>([])
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!allowed) return
    let active = true
    Promise.all([adminFragranceFinderApi.list(), adminFragranceFinderApi.eligibleProducts()])
      .then(([nextPreferences, nextProducts]) => {
        if (active) {
          setPreferences(nextPreferences)
          setProducts(nextProducts)
        }
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Finder could not be loaded.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [allowed])

  if (!allowed) return <p role="alert">You do not have permission to manage Fragrance Finder.</p>

  const change = (key: string, patch: Partial<AdminFinderPreference>) => {
    setPreferences((items) => items.map((item) => item.key === key ? { ...item, ...patch } : item))
    setMessage('')
  }

  const save = async (preference: AdminFinderPreference) => {
    setSaving(preference.key)
    setError('')
    setMessage('')
    try {
      const updated = await adminFragranceFinderApi.update(preference.key, preference.productId, preference.active)
      change(preference.key, updated)
      setMessage(`${updated.label} preference saved.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Finder preference could not be saved.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-burgundy">Fragrance Finder</h1>
        <p className="mt-2 text-sm text-brownroyal/70">Choose a published product for each scent preference.</p>
      </div>
      {error && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {message && <p className="rounded-lg border border-champagne/40 bg-ivory p-3 text-sm text-brownroyal" role="status">{message}</p>}
      {loading ? <p>Loading preferences...</p> : preferences.length === 0 ? <p>No Finder preferences are available.</p> : (
        <div className="grid gap-4">
          {preferences.map((preference) => (
            <div className="grid gap-4 rounded-lg border border-champagne/30 bg-ivory p-5 md:grid-cols-[1fr_1.5fr_auto_auto] md:items-end" key={preference.key}>
              <div>
                <p className="font-serif text-xl font-semibold text-burgundy">{preference.label}</p>
                <p className="mt-1 text-xs text-brownroyal/60">{preference.descriptors}</p>
              </div>
              <label className="grid gap-1 text-sm font-semibold text-brownroyal">
                Assigned Product
                <select
                  className="min-h-11 min-w-0 rounded-lg border border-champagne/40 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-burgundy"
                  onChange={(event) => change(preference.key, { productId: event.target.value || null })}
                  value={preference.productId ?? ''}
                >
                  <option value="">No product assigned</option>
                  {preference.productId && !products.some((product) => product.id === preference.productId) && (
                    <option disabled value={preference.productId}>Unavailable product — choose another</option>
                  )}
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-brownroyal">
                <input
                  checked={preference.active}
                  className="h-4 w-4 accent-burgundy"
                  onChange={(event) => change(preference.key, { active: event.target.checked })}
                  type="checkbox"
                />
                Active
              </label>
              <Button disabled={saving !== null} onClick={() => void save(preference)} type="button">
                {saving === preference.key ? 'Saving...' : 'Save'}
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
