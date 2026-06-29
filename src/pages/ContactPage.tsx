import { Mail, MapPin, MessageCircle, Phone, Send } from 'lucide-react'
import type { FormEvent, ReactElement } from 'react'
import { useState } from 'react'
import { Button } from '../components/common/Button'
import { PageHeader } from '../components/common/PageHeader'
import { contactService } from '../services/contactService'

export function ContactPage() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    message: '',
  })
  const [status, setStatus] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const response = await contactService.sendMessage(form)
    setStatus(response.message)
    setForm({ name: '', email: '', phone: '', message: '' })
  }

  return (
    <>
      <PageHeader
        description="Speak with the Royal Fusion fragrance concierge for product guidance, gifting, bulk orders, and support."
        eyebrow="Contact Us"
        title="Your Royal Concierge"
      />
      <section className="container-lux grid gap-8 py-12 md:py-16 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <ContactCard icon={<Phone />} label="Phone" value="+92 300 0000000" />
          <ContactCard icon={<Mail />} label="Email" value="hello@royalfusion.pk" />
          <ContactCard icon={<MapPin />} label="Location" value="Karachi, Pakistan" />
          <a
            className="flex items-center gap-4 rounded-lg border border-champagne/25 bg-[#2f8f5b] p-5 text-white shadow-sm transition hover:-translate-y-1"
            href="https://wa.me/923000000000"
            rel="noreferrer"
            target="_blank"
          >
            <MessageCircle className="h-6 w-6" aria-hidden="true" />
            <span>
              <span className="block font-serif text-2xl font-semibold">WhatsApp Orders</span>
              <span className="text-sm text-white/80">Fast support for fragrance selection</span>
            </span>
          </a>
        </div>

        <form
          className="rounded-lg border border-champagne/25 bg-ivory/88 p-6 shadow-xl shadow-brownroyal/10"
          onSubmit={handleSubmit}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Name"
              onChange={(value) => setForm((current) => ({ ...current, name: value }))}
              value={form.name}
            />
            <Field
              label="Phone"
              onChange={(value) => setForm((current) => ({ ...current, phone: value }))}
              type="tel"
              value={form.phone}
            />
          </div>
          <Field
            className="mt-4"
            label="Email"
            onChange={(value) => setForm((current) => ({ ...current, email: value }))}
            type="email"
            value={form.email}
          />
          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-bold text-brownroyal">Message</span>
            <textarea
              className="min-h-36 w-full resize-y rounded-lg border border-champagne/35 bg-marble px-4 py-3 text-brownroyal outline-none focus:border-burgundy"
              onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
              required
              value={form.message}
            />
          </label>
          <Button className="mt-5 w-full sm:w-auto" type="submit">
            <Send className="h-4 w-4" aria-hidden="true" />
            Send Message
          </Button>
          {status && <p className="mt-4 font-semibold text-oldgold">{status}</p>}
        </form>
      </section>
    </>
  )
}

function ContactCard({ icon, label, value }: { icon: ReactElement; label: string; value: string }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-champagne/25 bg-ivory/88 p-5 shadow-sm">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-champagne/18 text-oldgold">
        {icon}
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-oldgold">{label}</p>
        <p className="mt-1 font-serif text-2xl font-semibold text-burgundy">{value}</p>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  className?: string
}) {
  return (
    <label className={className}>
      <span className="mb-2 block text-sm font-bold text-brownroyal">{label}</span>
      <input
        className="h-12 w-full rounded-full border border-champagne/35 bg-marble px-4 text-brownroyal outline-none focus:border-burgundy"
        onChange={(event) => onChange(event.target.value)}
        required
        type={type}
        value={value}
      />
    </label>
  )
}
