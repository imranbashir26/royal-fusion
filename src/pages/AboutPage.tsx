import { Award, Crown, Gem, ShieldCheck } from 'lucide-react'
import { PageHeader } from '../components/common/PageHeader'
import { faqs } from '../data/faqs'

const values = [
  {
    title: 'Royal Heritage',
    text: 'Classic opulence, palace-inspired packaging, and a boutique buying experience.',
    icon: Crown,
  },
  {
    title: 'Long Lasting Wear',
    text: 'Fragrance profiles selected for strong performance in Pakistani weather.',
    icon: Award,
  },
  {
    title: 'Gift-Ready Detail',
    text: 'Presentation, care, and thoughtful packaging built into the shopping flow.',
    icon: Gem,
  },
  {
    title: 'Customer Assurance',
    text: '7-day return policy, multiple payment methods, and future backend-ready support.',
    icon: ShieldCheck,
  },
]

export function AboutPage() {
  return (
    <>
      <PageHeader
        description="Royal Fusion is a premium fragrance boutique concept for luxury perfumes, attars, and gift-ready scent experiences in Pakistan."
        eyebrow="About Us"
        title="A Palace-Inspired Perfume House"
      />
      <section className="container-lux grid gap-10 py-12 md:py-16 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-oldgold">Our Story</p>
          <h2 className="mt-3 font-serif text-5xl font-semibold leading-none text-burgundy">
            Built for elegance, confidence, and lasting presence.
          </h2>
        </div>
        <div className="space-y-5 text-lg leading-9 text-brownroyal/74">
          <p>
            Royal Fusion reimagines perfume shopping as a luxury boutique experience:
            warm service, refined visuals, easy discovery, and a catalog structured around
            notes, occasions, gender preferences, and collections.
          </p>
          <p>
            This prototype is designed to grow into a complete eCommerce system with
            product APIs, reviews, orders, authentication, admin tools, and optional
            WooCommerce REST API integration.
          </p>
        </div>
      </section>
      <section className="bg-marble/75 py-14">
        <div className="container-lux grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {values.map((value) => (
            <article className="rounded-lg border border-champagne/25 bg-ivory/88 p-6 shadow-sm" key={value.title}>
              <div className="mb-5 grid h-12 w-12 place-items-center rounded-full bg-champagne/18 text-oldgold">
                <value.icon className="h-6 w-6" aria-hidden="true" />
              </div>
              <h3 className="font-serif text-3xl font-semibold text-burgundy">{value.title}</h3>
              <p className="mt-3 text-sm leading-7 text-brownroyal/68">{value.text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="container-lux py-12 md:py-16">
        <div className="mb-8 max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-oldgold">FAQs</p>
          <h2 className="mt-3 font-serif text-5xl font-semibold text-burgundy">Boutique Questions</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {faqs.map((faq) => (
            <details className="rounded-lg border border-champagne/25 bg-ivory/88 p-5 shadow-sm" key={faq.id}>
              <summary className="cursor-pointer font-serif text-2xl font-semibold text-burgundy">
                {faq.question}
              </summary>
              <p className="mt-3 text-sm leading-7 text-brownroyal/70">{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  )
}
