import { Camera, Mail, MapPin, MessageCircle, Phone, Send, Users } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import logo from '../../assets/brand/logo.png'
import { newsletterService } from '../../services/newsletterService'
import { useStorefront } from '../../storefront/StorefrontProvider'
import { Button } from '../common/Button'

const footerGroups = [
  {
    title: 'Shop',
    links: [
      ['All Perfumes', '/shop'],
      ['Best Sellers', '/shop?best=true'],
      ['Attars', '/attars'],
      ['Gift Sets', '/shop?category=Gift Sets'],
    ],
  },
  {
    title: 'Categories',
    links: [
      ['For Him', '/shop?gender=Men'],
      ['For Her', '/shop?gender=Women'],
      ['Unisex', '/shop?gender=Unisex'],
      ['Collections', '/collections'],
    ],
  },
  {
    title: 'Policies',
    links: [
      ['Returns', '/contact'],
      ['Shipping', '/contact'],
      ['Privacy', '/contact'],
      ['FAQs', '/about'],
    ],
  },
]

export function Footer() {
  const { settings } = useStorefront()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!email) return
    try {
      const response = await newsletterService.subscribe(email)
      setStatus(response.message)
      setEmail('')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to subscribe.')
    }
  }

  return (
    <footer className="border-t border-champagne/30 bg-burgundy text-ivory">
      <div className="container-lux grid gap-10 py-14 lg:grid-cols-[1.2fr_2fr_1.2fr]">
        <div>
          <Link className="inline-flex items-center gap-3" to="/">
            <img className="h-14 w-14 rounded-full bg-ivory object-contain" src={logo} alt="Royal Fusion logo" />
            <span>
              <span className="block font-serif text-3xl font-bold leading-none">Royal Fusion</span>
              <span className="text-xs font-bold uppercase tracking-[0.24em] text-champagne">
                Luxury Perfumes
              </span>
            </span>
          </Link>
          <p className="mt-5 max-w-sm text-sm leading-7 text-ivory/72">{settings.footerDescription}</p>
          <a
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-champagne px-5 py-3 text-sm font-bold text-brownroyal transition hover:bg-ivory"
            href={`https://wa.me/${settings.whatsappNumber.replace(/\D/g, '')}`}
            rel="noreferrer"
            target="_blank"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            Order on WhatsApp
          </a>
        </div>

        <div className="grid gap-7 sm:grid-cols-3">
          {footerGroups.map((group) => (
            <div key={group.title}>
              <h3 className="font-serif text-2xl font-semibold">{group.title}</h3>
              <ul className="mt-4 space-y-3 text-sm text-ivory/72">
                {group.links.map(([label, to]) => (
                  <li key={label}>
                    <Link className="transition hover:text-champagne" to={to}>
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div>
          <h3 className="font-serif text-2xl font-semibold">Fragrance Letters</h3>
          <p className="mt-3 text-sm leading-7 text-ivory/72">
            Receive new launches, gift edits, and Royal Fusion boutique updates.
          </p>
          <form className="mt-5 flex overflow-hidden rounded-full bg-ivory p-1" onSubmit={handleSubmit}>
            <input
              className="min-w-0 flex-1 bg-transparent px-4 text-sm font-semibold text-brownroyal outline-none placeholder:text-brownroyal/45"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email address"
              type="email"
              value={email}
            />
            <Button className="h-10 px-4" size="sm" type="submit" variant="secondary">
              <Send className="h-4 w-4" aria-hidden="true" />
            </Button>
          </form>
          {status && <p className="mt-3 text-sm text-champagne">{status}</p>}
          <div className="mt-6 space-y-3 text-sm text-ivory/72">
            <p className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-champagne" aria-hidden="true" />
              {settings.phoneNumber}
            </p>
            <p className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-champagne" aria-hidden="true" />
              {settings.emailAddress}
            </p>
            <p className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-champagne" aria-hidden="true" />
              {settings.businessAddress}
            </p>
          </div>
          <div className="mt-5 flex gap-3">
            <a aria-label="Instagram" className="grid h-10 w-10 place-items-center rounded-full bg-ivory/10 text-ivory hover:bg-champagne hover:text-brownroyal" href="#">
              <Camera className="h-5 w-5" aria-hidden="true" />
            </a>
            <a aria-label="Facebook" className="grid h-10 w-10 place-items-center rounded-full bg-ivory/10 text-ivory hover:bg-champagne hover:text-brownroyal" href="#">
              <Users className="h-5 w-5" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
      <div className="border-t border-ivory/10 py-5 text-center text-xs text-ivory/60">
        {settings.copyrightText}
      </div>
    </footer>
  )
}
