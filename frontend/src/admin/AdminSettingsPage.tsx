import { Save } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Button } from '../components/common/Button'
import { adminSettingsApi, type SettingsSection } from '../services/adminSettingsApi'
import { useAdminAuth } from './AdminAuthProvider'

type SettingsRecord = Record<string, unknown>

const websiteFields = [
  'brandName',
  'logo',
  'favicon',
  'currency',
  'whatsappNumber',
  'phoneNumber',
  'emailAddress',
  'businessAddress',
  'googleMapsUrl',
  'instagramLink',
  'facebookLink',
  'tiktokLink',
  'youtubeLink',
  'footerDescription',
  'copyrightText',
  'contactReceiverEmail',
]

const homepageFields = [
  'heroEyebrow',
  'heroHeading',
  'heroSubtitle',
  'heroImage',
  'heroImageAlt',
  'primaryCtaText',
  'primaryCtaLink',
  'secondaryCtaText',
  'secondaryCtaLink',
  'collectionTitle',
  'collectionText',
  'promotionalBannerText',
  'newsletterTitle',
]

export function AdminSettingsPage() {
  const { can } = useAdminAuth()
  const allowed = can('settings.manage')
  const [settings, setSettings] = useState<SettingsRecord>({})
  const [homepage, setHomepage] = useState<SettingsRecord>({})
  const [shipping, setShipping] = useState<SettingsRecord>({})
  const [paymentsJson, setPaymentsJson] = useState('[]')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState<Record<'settings' | 'homepage' | 'shipping', SettingsRecord>>({ settings: {}, homepage: {}, shipping: {} })
  const [paymentsDirty, setPaymentsDirty] = useState(false)

  useEffect(() => {
    if (!allowed) return
    let active = true
    adminSettingsApi.get().then((data) => {
      if (!active) return
      setSettings(data.settings)
      setHomepage(data.homepage)
      setShipping(data.shipping)
      setPaymentsJson(JSON.stringify(data.payments, null, 2))
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Settings could not be loaded.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [allowed])

  const change = (section: Exclude<SettingsSection, 'payments'>, field: string, value: unknown) => {
    const update = (current: SettingsRecord) => ({ ...current, [field]: value })
    if (section === 'settings') setSettings(update)
    if (section === 'homepage') setHomepage(update)
    if (section === 'shipping') setShipping(update)
    setDirty((current) => ({ ...current, [section]: { ...current[section], [field]: value } }))
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setStatus('')
    setSaving(true)
    try {
      const payments = paymentsDirty ? JSON.parse(paymentsJson) as unknown : null
      if (paymentsDirty && !Array.isArray(payments)) throw new Error('Payment methods must be a JSON array.')
      let changed = false
      for (const section of ['settings', 'homepage', 'shipping'] as const) {
        if (!Object.keys(dirty[section]).length) continue
        await adminSettingsApi.update(section, dirty[section])
        changed = true
        setDirty((current) => ({ ...current, [section]: {} }))
      }
      if (paymentsDirty) {
        await adminSettingsApi.update('payments', payments as Array<{ name: 'Cash on Delivery' | 'Bank Transfer'; active: boolean }>)
        setPaymentsDirty(false)
        changed = true
      }
      if (!changed) { setStatus('No changes to save.'); return }
      setStatus('Settings saved successfully.')
    } catch (err) {
      setError(`${err instanceof Error ? err.message : 'Unable to save settings.'} Any unsaved values remain in the form.`)
    } finally {
      setSaving(false)
    }
  }

  if (!allowed) return <p role="alert">You do not have permission to manage settings.</p>
  if (loading) return <p role="status">Loading settings…</p>

  return (
    <form className="space-y-6" onSubmit={save}>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-oldgold">Website Settings</p>
        <h1 className="mt-2 font-serif text-4xl font-semibold text-burgundy">Settings</h1>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {status && <Alert tone="success">{status}</Alert>}

      <SettingsPanel title="General Website Settings">
        <div className="grid gap-4 md:grid-cols-2">
          {websiteFields.map((field) => (
            <TextField
              key={field}
              label={labelize(field)}
              onChange={(value) => change('settings', field, value)}
              textarea={field.toLowerCase().includes('description') || field.toLowerCase().includes('text')}
              value={String(settings[field] ?? '')}
            />
          ))}
        </div>
      </SettingsPanel>

      <SettingsPanel title="Announcement Bar Settings">
        <div className="space-y-4">
          <label className="flex items-center justify-between rounded-lg border border-champagne/25 bg-marble p-4">
            <div>
              <span className="block font-bold text-burgundy">Announcement Enabled</span>
              <span className="text-xs text-brownroyal/65">Toggle visibility of the top announcement bar</span>
            </div>
            <input
              checked={Boolean(settings.announcementEnabled)}
              className="h-5 w-5 accent-burgundy cursor-pointer"
              onChange={(event) => change('settings', 'announcementEnabled', event.target.checked)}
              type="checkbox"
            />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <TextField
                label="Announcement Text"
                onChange={(value) => change('settings', 'announcementText', value)}
                value={String(settings.announcementText ?? '')}
              />
            </div>
            <TextField
              label="Announcement CTA Label (Optional)"
              onChange={(value) => change('settings', 'announcementCtaLabel', value)}
              value={String(settings.announcementCtaLabel ?? '')}
            />
            <TextField
              label="Announcement CTA URL (Optional)"
              onChange={(value) => change('settings', 'announcementCtaUrl', value)}
              value={String(settings.announcementCtaUrl ?? '')}
            />
          </div>
        </div>
      </SettingsPanel>

      <SettingsPanel title="Homepage Content">
        <div className="grid gap-4 md:grid-cols-2">
          {homepageFields.map((field) => (
            <TextField
              key={field}
              label={labelize(field)}
              onChange={(value) => change('homepage', field, value)}
              textarea={field.toLowerCase().includes('subtitle') || field.toLowerCase().includes('text')}
              value={String(homepage[field] ?? '')}
            />
          ))}
          {['featuredProductIds', 'bestSellerProductIds', 'featuredCategoryIds'].map((field) => (
            <TextField
              key={field}
              label={`${labelize(field)} (comma separated IDs)`}
              onChange={(value) => change('homepage', field, split(value))}
              value={Array.isArray(homepage[field]) ? (homepage[field] as string[]).join(', ') : String(homepage[field] ?? '')}
            />
          ))}
        </div>
      </SettingsPanel>

      <SettingsPanel title="Shipping & Policy Settings">
        <div className="grid gap-4 md:grid-cols-2">
          {['defaultShippingFee', 'freeShippingAbove', 'deliveryTimeText', 'courierInformation', 'shippingPolicyText', 'returnPolicyText', 'exchangePolicyText'].map((field) => (
            <TextField
              key={field}
              label={labelize(field)}
              onChange={(value) => change('shipping', field, field.includes('Fee') || field.includes('Above') ? Number(value) : value)}
              textarea={field.toLowerCase().includes('policy') || field.toLowerCase().includes('information')}
              type={field.includes('Fee') || field.includes('Above') ? 'number' : 'text'}
              value={String(shipping[field] ?? '')}
            />
          ))}
        </div>
      </SettingsPanel>

      <SettingsPanel title="Payment Methods">
        <label>
          <span className="mb-2 block text-sm font-bold">Payment methods JSON</span>
          <textarea
            className="min-h-72 w-full rounded-lg border border-champagne/35 bg-marble px-4 py-3 font-mono text-sm outline-none focus:border-burgundy"
            onChange={(event) => { setPaymentsJson(event.target.value); setPaymentsDirty(true) }}
            value={paymentsJson}
          />
        </label>
      </SettingsPanel>

      <Button disabled={saving} size="lg" type="submit">
        <Save className="h-5 w-5" />
        {saving ? 'Saving…' : 'Save Settings'}
      </Button>
    </form>
  )
}

function SettingsPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-champagne/25 bg-ivory p-5 shadow-sm">
      <h2 className="mb-5 font-serif text-3xl font-semibold text-burgundy">{title}</h2>
      {children}
    </section>
  )
}

function TextField({
  label,
  value,
  onChange,
  textarea,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  textarea?: boolean
  type?: string
}) {
  return (
    <label className={textarea ? 'md:col-span-2' : undefined}>
      <span className="mb-2 block text-sm font-bold">{label}</span>
      {textarea ? (
        <textarea
          className="min-h-28 w-full rounded-lg border border-champagne/35 bg-marble px-4 py-3 outline-none focus:border-burgundy"
          onChange={(event) => onChange(event.target.value)}
          value={value}
        />
      ) : (
        <input
          className="h-12 w-full rounded-full border border-champagne/35 bg-marble px-4 outline-none focus:border-burgundy"
          onChange={(event) => onChange(event.target.value)}
          type={type}
          value={value}
        />
      )}
    </label>
  )
}

function Alert({ children, tone }: { children: ReactNode; tone: 'success' | 'error' }) {
  return (
    <div className={tone === 'success' ? 'rounded-lg border border-[#2f8f5b]/20 bg-[#2f8f5b]/10 p-4 text-[#2f8f5b]' : 'rounded-lg border border-burgundy/20 bg-burgundy/8 p-4 text-burgundy'}>
      {children}
    </div>
  )
}

function labelize(value: string) {
  return value.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) => letter.toUpperCase())
}

function split(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}
