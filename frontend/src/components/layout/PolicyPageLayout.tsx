import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Mail, MapPin, Phone, ShieldCheck } from 'lucide-react'
import { PageHeader } from '../common/PageHeader'
import { cn } from '../../utils/cn'

interface PolicyPageLayoutProps {
  title: string
  description: string
  activePath: '/privacy-policy' | '/terms-and-conditions' | '/shipping-policy' | '/returns-refunds'
  children: ReactNode
}

const policyNavigation = [
  { label: 'Privacy Policy', path: '/privacy-policy' },
  { label: 'Terms & Conditions', path: '/terms-and-conditions' },
  { label: 'Shipping & Delivery', path: '/shipping-policy' },
  { label: 'Returns & Exchanges', path: '/returns-refunds' },
]

export function PolicyPageLayout({
  title,
  description,
  activePath,
  children,
}: PolicyPageLayoutProps) {
  return (
    <>
      <PageHeader
        eyebrow="Customer Care & Policies"
        title={title}
        description={description}
      />
      <div className="border-b border-champagne/30 bg-marble/60">
        <nav
          aria-label="Policy pages navigation"
          className="container-lux flex flex-wrap gap-2 py-3 sm:gap-3"
        >
          {policyNavigation.map((item) => {
            const isActive = item.path === activePath
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'rounded-full px-3.5 py-1.5 text-xs font-semibold tracking-wide transition-colors sm:text-sm',
                  isActive
                    ? 'bg-burgundy text-ivory shadow-xs'
                    : 'bg-ivory/80 text-brownroyal/80 hover:bg-champagne/20 hover:text-burgundy border border-champagne/30'
                )}
                aria-current={isActive ? 'page' : undefined}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>
      <main className="container-lux max-w-4xl py-12 md:py-16">
        <article className="space-y-10 text-brownroyal/85 leading-relaxed">
          {children}
        </article>

        <section
          aria-labelledby="policy-contact-heading"
          className="mt-14 rounded-xl border border-champagne/35 bg-ivory/80 p-6 md:p-8 shadow-xs"
        >
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-6 w-6 text-burgundy shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2
                id="policy-contact-heading"
                className="font-serif text-xl font-semibold text-burgundy md:text-2xl"
              >
                Royal Fusion Customer Concierge
              </h2>
              <p className="mt-1 text-sm text-brownroyal/75">
                For questions regarding your order, delivery status, or policy details, our concierge team is at your service.
              </p>
            </div>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3 text-sm">
            <div className="flex items-start gap-2.5">
              <MapPin className="h-4 w-4 text-oldgold shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-semibold text-burgundy">Premises</p>
                <p className="text-xs text-brownroyal/80">Shop #544, Saddar Bazar, Attock Cantt, Pakistan</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Mail className="h-4 w-4 text-oldgold shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-semibold text-burgundy">Email Enquiries</p>
                <a
                  href="mailto:billing@royal-fusion.com"
                  className="text-xs text-brownroyal/80 underline hover:text-burgundy"
                >
                  billing@royal-fusion.com
                </a>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Phone className="h-4 w-4 text-oldgold shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-semibold text-burgundy">WhatsApp Support</p>
                <a
                  href="https://wa.me/923278647667"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brownroyal/80 underline hover:text-burgundy"
                >
                  +92 3278647667
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  )
}
