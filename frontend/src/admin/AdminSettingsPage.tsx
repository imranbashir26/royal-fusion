import { Save } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Button } from '../components/common/Button'
import { adminApi } from '../services/adminApi'

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
  'instagramLink',
  'facebookLink',
  'tiktokLink',
  'youtubeLink',
  'footerDescription',
  'copyrightText',
  'contactReceiverEmail',
  'announcementText',
]

const homepageFields = [
  'heroHeading',
  'heroSubtitle',
  'heroImage',
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
  const [settings, setSettings] = useState<SettingsRecord>({})
  const [homepage, setHomepage] = useState<SettingsRecord>({})
  const [shipping, setShipping] = useState<SettingsRecord>({})
  const [paymentsJson, setPaymentsJson] = useState('[]')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void load()
  }, [])

  const load = async () => {
    const [nextSettings, nextHomepage, nextShipping, nextPayments] = await Promise.all([
      adminApi.getSettings<SettingsRecord>('settings'),
      adminApi.getSettings<SettingsRecord>('homepage'),
      adminApi.getSettings<SettingsRecord>('shipping'),
      adminApi.list<Record<string, unknown>>('payments'),
    ])
    setSettings(nextSettings)
    setHomepage(nextHomepage)
    setShipping(nextShipping)
    setPaymentsJson(JSON.stringify(nextPayments, null, 2))
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setStatus('')
    try {
      await adminApi.updateSettings('settings', settings)
      await adminApi.updateSettings('homepage', homepage)
      await adminApi.updateSettings('shipping', normalizeShipping(shipping))
      const payments = JSON.parse(paymentsJson)
      const existing = await adminApi.list<Record<string, unknown>>('payments')
      await Promise.all(
        payments.map((payment: Record<string, unknown>, index: number) => {
          const id = String(payment.id || existing[index]?.id || `pay-${Date.now()}-${index}`)
          return existing.some((item) => item.id === id)
            ? adminApi.update('payments', id, { ...payment, id })
            : adminApi.create('payments', { ...payment, id })
        }),
      )
      setStatus('Settings saved successfully.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save settings.')
    }
  }

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
              onChange={(value) => setSettings((current) => ({ ...current, [field]: value }))}
              textarea={field.toLowerCase().includes('description') || field.toLowerCase().includes('text')}
              value={String(settings[field] ?? '')}
            />
          ))}
          <label className="flex items-center justify-between rounded-lg border border-champagne/25 bg-marble p-4">
            <span className="font-bold">Announcement enabled</span>
            <input
              checked={Boolean(settings.announcementEnabled)}
              className="h-5 w-5 accent-burgundy"
              onChange={(event) => setSettings((current) => ({ ...current, announcementEnabled: event.target.checked }))}
              type="checkbox"
            />
          </label>
        </div>
      </SettingsPanel>

      <SettingsPanel title="Homepage Content">
        <div className="grid gap-4 md:grid-cols-2">
          {homepageFields.map((field) => (
            <TextField
              key={field}
              label={labelize(field)}
              onChange={(value) => setHomepage((current) => ({ ...current, [field]: value }))}
              textarea={field.toLowerCase().includes('subtitle') || field.toLowerCase().includes('text')}
              value={String(homepage[field] ?? '')}
            />
          ))}
          {['featuredProductIds', 'bestSellerProductIds', 'featuredCategoryIds'].map((field) => (
            <TextField
              key={field}
              label={`${labelize(field)} (comma separated IDs)`}
              onChange={(value) => setHomepage((current) => ({ ...current, [field]: split(value) }))}
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
              onChange={(value) => setShipping((current) => ({ ...current, [field]: field.includes('Fee') || field.includes('Above') ? Number(value) : value }))}
              textarea={field.toLowerCase().includes('policy') || field.toLowerCase().includes('information')}
              type={field.includes('Fee') || field.includes('Above') ? 'number' : 'text'}
              value={String(shipping[field] ?? '')}
            />
          ))}
          <TextField
            label="City-wise shipping JSON"
            onChange={(value) => setShipping((current) => ({ ...current, cityWise: parseJson(value, []) }))}
            textarea
            value={JSON.stringify(shipping.cityWise ?? [], null, 2)}
          />
          <TextField
            label="Province-wise shipping JSON"
            onChange={(value) => setShipping((current) => ({ ...current, provinceWise: parseJson(value, []) }))}
            textarea
            value={JSON.stringify(shipping.provinceWise ?? [], null, 2)}
          />
        </div>
      </SettingsPanel>

      <SettingsPanel title="Payment Methods">
        <label>
          <span className="mb-2 block text-sm font-bold">Payment methods JSON</span>
          <textarea
            className="min-h-72 w-full rounded-lg border border-champagne/35 bg-marble px-4 py-3 font-mono text-sm outline-none focus:border-burgundy"
            onChange={(event) => setPaymentsJson(event.target.value)}
            value={paymentsJson}
          />
        </label>
      </SettingsPanel>

      <Button size="lg" type="submit">
        <Save className="h-5 w-5" />
        Save Settings
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

function parseJson(value: string, fallback: unknown) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function normalizeShipping(shipping: SettingsRecord) {
  return {
    ...shipping,
    defaultShippingFee: Number(shipping.defaultShippingFee || 0),
    freeShippingAbove: Number(shipping.freeShippingAbove || 0),
  }
}
