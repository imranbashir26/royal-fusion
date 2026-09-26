import { CreditCard, Gift, ShieldCheck, Truck } from 'lucide-react'

const trustItems = [
  {
    title: '7-Day Returns',
    description: 'Easy returns on eligible purchases.',
    icon: ShieldCheck,
  },
  {
    title: 'Flexible Payments',
    description: 'Cash on Delivery and bank transfer.',
    icon: CreditCard,
  },
  {
    title: 'Free Bulk Shipping',
    description: 'Added value for qualifying bulk orders.',
    icon: Truck,
  },
  {
    title: 'Exclusive Packaging',
    description: 'Presented beautifully and ready for gifting.',
    icon: Gift,
  },
]

export function TrustBar() {
  return (
    <section
      aria-label="Benefits & Guarantees"
      className="relative w-full border-y border-soft-border/70 bg-warm-ivory"
    >
      <div className="container-lux">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {trustItems.map((item, idx) => (
            <div
              className={`group flex flex-col items-center text-center px-3.5 py-6 sm:px-6 sm:py-7 lg:px-5 lg:py-7 transition-colors duration-200 ${
                // Mobile & Tablet (2 cols x 2 rows):
                // Items 0 and 2 get right border; Items 0 and 1 get bottom border
                // Desktop (4 cols x 1 row):
                // Items 0, 1, 2 get right border; no bottom border on any item
                idx === 0
                  ? 'border-r border-b border-soft-border/60 lg:border-b-0'
                  : idx === 1
                    ? 'border-b border-soft-border/60 lg:border-r lg:border-b-0'
                    : idx === 2
                      ? 'border-r border-soft-border/60 lg:border-r'
                      : 'border-r-0 border-b-0 lg:border-r-0'
              }`}
              key={item.title}
            >
              {/* Refined Gold Line Icon */}
              <div className="mb-2.5 flex items-center justify-center text-champagne transition-all duration-200 group-hover:-translate-y-0.5 group-hover:text-[#b3852e] motion-reduce:transform-none">
                <item.icon
                  aria-hidden="true"
                  className="h-5 w-5 sm:h-5.5 sm:w-5.5 stroke-[1.7]"
                />
              </div>

              {/* Benefit Title */}
              <p className="font-sans text-[14px] sm:text-[15px] font-semibold text-espresso leading-snug tracking-tight transition-colors duration-200 group-hover:text-royal-burgundy">
                {item.title}
              </p>

              {/* Optional Subtle Gold Underline Accent */}
              <span
                aria-hidden="true"
                className="mt-1 h-[1.5px] w-0 bg-champagne/60 transition-all duration-200 group-hover:w-5 motion-reduce:transition-none"
              />

              {/* Supporting Copy */}
              <p className="mt-1 font-sans text-[12.5px] sm:text-[13px] text-muted-taupe leading-normal sm:leading-relaxed max-w-[230px]">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
