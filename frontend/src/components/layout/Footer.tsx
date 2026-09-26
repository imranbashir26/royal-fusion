import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Camera, Mail, MapPin, Music2, Phone, Users, Video } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import logo from '../../assets/brand/logo.png'
import { publicAddress, publicEmail, publicPhone } from '../../utils/contactDetails'
import { newsletterService } from '../../services/newsletterService'
import { useStorefront } from '../../storefront/StorefrontProvider'

const footerGroups = [
  {
    title: 'Shop',
    links: [
      { label: 'All Fragrances', to: '/shop' },
      { label: 'Best Sellers', to: '/shop?best=true' },
      { label: 'Gift Sets', to: '/shop?category=Gift%20Sets' },
      { label: 'Attars', to: '/attars' },
    ],
  },
  {
    title: 'Explore',
    links: [
      { label: 'Collections', to: '/collections' },
      { label: 'Fragrance Journal', to: '/blogs' },
      { label: 'Our Story', to: '/about' },
    ],
  },
  {
    title: 'Customer Care',
    links: [
      { label: 'Contact Us', to: '/contact' },
      { label: 'About & FAQs', to: '/about' },
    ],
  },
]

function configuredSocialUrl(raw: string | undefined, domains: string[]) {
  try {
    const url = new URL(raw ?? '')
    const host = url.hostname.replace(/^www\./, '')
    return url.protocol === 'https:' &&
      domains.some((domain) => host === domain || host.endsWith(`.${domain}`)) &&
      url.pathname.length > 1
      ? url.toString()
      : ''
  } catch {
    return ''
  }
}

function NewsletterSection() {
  const reduceMotion = useReducedMotion()
  const [email, setEmail] = useState('')
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; message: string } | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return

    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setFeedback({ kind: 'error', message: 'Please enter your email address.' })
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFeedback({ kind: 'error', message: 'Please enter a valid email address.' })
      return
    }

    setFeedback(null)
    setIsSubmitting(true)
    try {
      const response = await newsletterService.subscribe(trimmedEmail)
      setFeedback({ kind: 'success', message: response.message })
      setEmail('')
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : 'Subscriptions are temporarily unavailable. Please try again later.'
      setFeedback({ kind: 'error', message })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section aria-labelledby="newsletter-heading" className="bg-warm-ivory py-14">
      <motion.div
        className="container-lux mx-auto max-w-[820px] text-center"
        initial={reduceMotion ? false : { opacity: 0, y: 14 }}
        transition={{ duration: reduceMotion ? 0 : 0.5 }}
        viewport={{ once: true, amount: 0.2 }}
        whileInView={{ opacity: 1, y: 0 }}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#805b1e] sm:text-[13px]">
          JOIN OUR JOURNEY
        </p>
        <h2 id="newsletter-heading" className="mt-4 font-serif text-[clamp(2.625rem,4vw,3.5rem)] font-semibold leading-[1.08] text-royal-burgundy">
          Be the First to Discover
        </h2>
        <p className="mx-auto mt-4 max-w-[700px] text-[15px] leading-[1.7] text-[#75645a] sm:text-base">
          Subscribe to receive updates on new launches, special offers, and fragrance inspiration from Royal Fusion.
        </p>

        <form className="mx-auto mt-8 flex max-w-[700px] flex-col gap-3 sm:flex-row" noValidate onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="newsletter-email">Email address</label>
          <div className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-[11px] border border-soft-border bg-white px-4 text-muted-taupe focus-within:border-royal-burgundy focus-within:ring-2 focus-within:ring-royal-burgundy/20">
            <Mail aria-hidden="true" className="h-5 w-5 shrink-0" />
            <input
              aria-describedby={feedback?.kind === 'error' ? 'newsletter-feedback' : 'newsletter-note'}
              aria-invalid={feedback?.kind === 'error'}
              autoComplete="email"
              className="min-h-12 min-w-0 flex-1 bg-transparent text-sm text-espresso outline-none placeholder:text-muted-taupe"
              id="newsletter-email"
              inputMode="email"
              name="email"
              onChange={(event) => {
                setEmail(event.target.value)
                setFeedback(null)
              }}
              placeholder="Enter your email address"
              required
              type="email"
              value={email}
            />
          </div>
          <button
            className="group inline-flex min-h-12 items-center justify-center gap-2.5 rounded-[10px] bg-royal-burgundy px-7 py-3 text-sm font-semibold text-warm-ivory transition-colors duration-300 hover:bg-deep-wine focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-royal-burgundy disabled:cursor-wait disabled:opacity-70 motion-reduce:transition-none"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? 'Subscribing…' : 'Subscribe'}
            <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform duration-300 motion-safe:group-hover:translate-x-1 motion-reduce:transition-none" />
          </button>
        </form>
        <p className="mt-4 text-xs text-[#75645a]" id="newsletter-note">
          We use your email to send Royal Fusion newsletter updates.
        </p>
        {feedback && (
          <p
            className={`mt-3 text-sm font-medium ${feedback.kind === 'error' ? 'text-royal-burgundy' : 'text-espresso'}`}
            id="newsletter-feedback"
            role={feedback.kind === 'error' ? 'alert' : 'status'}
          >
            {feedback.message}
          </p>
        )}
      </motion.div>
    </section>
  )
}

export function Footer() {
  const { settings, payments } = useStorefront()
  const phone = publicPhone(settings.phoneNumber)
  const email = publicEmail(settings.emailAddress)
  const address = publicAddress(settings.businessAddress)
  const socialLinks = [
    { label: 'Instagram', href: configuredSocialUrl(settings.instagramLink, ['instagram.com']), icon: Camera },
    { label: 'Facebook', href: configuredSocialUrl(settings.facebookLink, ['facebook.com', 'fb.com']), icon: Users },
    { label: 'TikTok', href: configuredSocialUrl(settings.tiktokLink, ['tiktok.com']), icon: Music2 },
    { label: 'YouTube', href: configuredSocialUrl(settings.youtubeLink, ['youtube.com', 'youtu.be']), icon: Video },
  ].filter((link) => link.href)
  const paymentMethods = payments
    .filter((payment) => payment.active !== false)
    .map((payment) => String(payment.name ?? ''))
    .filter((name) => name === 'Cash on Delivery' || name === 'Bank Transfer')

  return (
    <>
      <NewsletterSection />
      <footer className="bg-deep-wine text-warm-ivory">
        <div className="container-lux grid gap-x-8 gap-y-10 py-14 sm:grid-cols-2 md:py-16 lg:grid-cols-3 xl:grid-cols-[1.5fr_0.85fr_0.85fr_1fr_1.1fr]">
          <div className="min-w-0 sm:col-span-2 lg:col-span-1">
            <Link className="inline-flex items-center gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-warm-ivory" to="/">
              <img alt="Royal Fusion logo" className="h-13 w-13 rounded-full bg-warm-ivory object-contain p-0.5" height={52} src={logo} width={52} />
              <span className="font-serif text-3xl font-semibold leading-none text-warm-ivory">Royal Fusion</span>
            </Link>
            <p className="mt-5 max-w-[310px] text-sm leading-[1.7] text-warm-ivory/80">
              {settings.footerDescription && !settings.footerDescription.toLowerCase().includes('prototype')
                ? settings.footerDescription
                : 'Royal Fusion brings expressive fragrances and refined presentation together, creating scents for the moments that matter.'}
            </p>
            {socialLinks.length > 0 && (
              <div aria-label="Royal Fusion social profiles" className="mt-6 flex gap-2.5">
                {socialLinks.map(({ label, href, icon: Icon }) => (
                  <a
                    aria-label={label}
                    className="grid h-10 w-10 place-items-center rounded-lg border border-white/20 text-warm-ivory transition-colors hover:border-champagne hover:text-champagne focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warm-ivory motion-reduce:transition-none"
                    href={href}
                    key={label}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <Icon aria-hidden="true" className="h-4 w-4" />
                  </a>
                ))}
              </div>
            )}
          </div>

          {footerGroups.map((group) => (
            <nav aria-label={group.title} className="min-w-0" key={group.title}>
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[#e0b861]">{group.title}</h2>
              <ul className="mt-5 space-y-2.5">
                {group.links.map(({ label, to }) => (
                  <li key={label}>
                    <Link
                      className="inline-flex min-h-8 items-center rounded-sm text-sm leading-6 text-warm-ivory/85 transition-colors hover:text-champagne focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warm-ivory motion-reduce:transition-none"
                      to={to}
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          <div className="min-w-0 sm:col-span-1 lg:col-span-2 xl:col-span-1">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[#e0b861]">Contact</h2>
            <p className="mt-5 max-w-[240px] text-sm leading-[1.65] text-warm-ivory/80">
              Questions about fragrances or your order? We’re here to help.
            </p>
            <div className="mt-4 space-y-2.5 text-sm text-warm-ivory/85">
              {phone && (
                <a className="flex items-start gap-2 hover:text-champagne focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warm-ivory" href={`tel:${phone.replace(/[^\d+]/g, '')}`}>
                  <Phone aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#e0b861]" />
                  {phone}
                </a>
              )}
              {email && (
                <a className="flex items-start gap-2 break-all hover:text-champagne focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warm-ivory" href={`mailto:${email}`}>
                  <Mail aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#e0b861]" />
                  {email}
                </a>
              )}
              {address && (
                <p className="flex items-start gap-2">
                  <MapPin aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#e0b861]" />
                  {address}
                </p>
              )}
            </div>
            <Link className="mt-5 inline-flex min-h-9 items-center gap-2 rounded-sm text-sm font-semibold text-warm-ivory hover:text-champagne focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warm-ivory" to="/contact">
              Get in Touch <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="border-t border-white/15">
          <div className="container-lux flex flex-col gap-3 py-5 text-xs text-warm-ivory/75 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} Royal Fusion. All rights reserved.</p>
            {paymentMethods.length > 0 && (
              <div aria-label="Accepted payment methods" className="flex flex-wrap items-center gap-2">
                {paymentMethods.map((method) => (
                  <span className="rounded-md border border-white/20 px-2.5 py-1 text-[11px] text-warm-ivory/85" key={method}>
                    {method}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </footer>
    </>
  )
}
