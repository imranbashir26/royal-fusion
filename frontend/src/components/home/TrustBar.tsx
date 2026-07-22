import { CreditCard, PackageCheck, ShieldCheck, Truck } from 'lucide-react'
import { AnimatedSection } from '../common/AnimatedSection'

const trustItems = [
  {
    title: '7-Day Return Policy',
    description: 'Elegant assurance on eligible products.',
    icon: ShieldCheck,
  },
  {
    title: 'Multiple Payment Methods',
    description: 'COD, bank transfer, and card-ready UI.',
    icon: CreditCard,
  },
  {
    title: 'Free Shipping on Bulk Orders',
    description: 'Premium support for corporate gifting.',
    icon: Truck,
  },
  {
    title: 'Exclusive Packaging',
    description: 'Gift-ready presentation with royal detail.',
    icon: PackageCheck,
  },
]

export function TrustBar() {
  return (
    <AnimatedSection className="py-8">
      <div className="container-lux grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {trustItems.map((item) => (
          <div
            className="rounded-lg border border-champagne/25 bg-ivory/85 p-5 shadow-sm"
            key={item.title}
          >
            <div className="mb-4 grid h-11 w-11 place-items-center rounded-full bg-champagne/18 text-oldgold">
              <item.icon className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="font-serif text-2xl font-semibold leading-tight text-burgundy">{item.title}</h2>
            <p className="mt-2 text-sm leading-6 text-brownroyal/66">{item.description}</p>
          </div>
        ))}
      </div>
    </AnimatedSection>
  )
}
