import { ArrowRight, Package, SlidersHorizontal, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { PublicTesterPack } from '../../services/publicTesterPacksApi'
import { buttonClasses } from '../../utils/buttonClasses'
import { formatCheckoutCurrency } from '../../utils/checkoutMoney'
import { cn } from '../../utils/cn'

interface TesterPackCardProps {
  pack: PublicTesterPack
  className?: string
}

export function TesterPackCard({ pack, className }: TesterPackCardProps) {
  const isFixed = pack.mode === 'fixed'
  const packUrl = `/discovery-packs/${pack.slug || pack.id}`

  // Price calculations
  const priceDisplay = isFixed ? (
    <div className="flex items-baseline gap-2">
      {pack.saleActive && pack.fixedSalePrice != null ? (
        <>
          <span className="font-serif text-xl font-bold text-royal-burgundy">
            {formatCheckoutCurrency(pack.fixedSalePrice)}
          </span>
          {pack.fixedRegularPrice != null && (
            <span className="text-sm text-muted-taupe line-through">
              {formatCheckoutCurrency(pack.fixedRegularPrice)}
            </span>
          )}
        </>
      ) : (
        <span className="font-serif text-xl font-bold text-royal-burgundy">
          {pack.fixedRegularPrice != null ? formatCheckoutCurrency(pack.fixedRegularPrice) : 'Custom'}
        </span>
      )}
    </div>
  ) : (
    <div>
      <span className="text-xs uppercase tracking-wider text-muted-taupe block font-medium">
        Custom pricing
      </span>
      <span className="font-serif text-lg font-bold text-royal-burgundy">
        {pack.minimumUnits ? `From ${pack.minimumUnits} testers` : 'Build your selection'}
      </span>
    </div>
  )

  // Availability text
  const stockBadge = !pack.available ? (
    <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800">
      Sold Out
    </span>
  ) : pack.availablePackCount != null && pack.availablePackCount <= 5 ? (
    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
      Only {pack.availablePackCount} left
    </span>
  ) : (
    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-900">
      In Stock
    </span>
  )

  return (
    <article
      className={cn(
        'group flex flex-col justify-between rounded-2xl border border-soft-border/80 bg-pure-white p-5 shadow-xs transition-all duration-300 hover:border-champagne/60 hover:shadow-md',
        className,
      )}
    >
      <div>
        {/* Top Badges */}
        <div className="mb-4 flex items-center justify-between gap-2">
          {isFixed ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-champagne/40 bg-champagne/15 px-3 py-1 text-xs font-medium text-royal-burgundy">
              <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-champagne" />
              Curated Set
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-royal-burgundy/20 bg-royal-burgundy/10 px-3 py-1 text-xs font-medium text-royal-burgundy">
              <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5 text-champagne" />
              Build Your Own
            </span>
          )}
          {stockBadge}
        </div>

        {/* Pack Image Container */}
        <Link
          aria-label={`View ${pack.name}`}
          className="relative mb-5 block aspect-[4/3] overflow-hidden rounded-xl bg-warm-ivory/60"
          to={packUrl}
        >
          {pack.image ? (
            <img
              alt={pack.name}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
              src={pack.image}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center text-muted-taupe">
              <Package aria-hidden="true" className="mb-2 h-12 w-12 text-champagne/60" />
              <span className="font-serif text-sm font-medium text-royal-burgundy/80">
                Royal Fusion
              </span>
              <span className="text-xs uppercase tracking-widest text-champagne">Discovery Set</span>
            </div>
          )}
        </Link>

        {/* Content */}
        <div>
          {pack.scentFamily && (
            <p className="eyebrow-label mb-1 text-[11px] text-muted-taupe">{pack.scentFamily}</p>
          )}
          <h3 className="font-serif text-xl font-semibold text-royal-burgundy">
            <Link className="transition hover:text-champagne" to={packUrl}>
              {pack.name}
            </Link>
          </h3>
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-taupe">
            {pack.shortDescription || pack.description}
          </p>

          {/* Highlights / Inclusions */}
          <div className="mt-4 rounded-lg border border-soft-border/60 bg-warm-ivory/40 p-3 text-xs text-espresso">
            {isFixed ? (
              <div className="space-y-1">
                <p className="font-semibold text-royal-burgundy">
                  Includes {pack.components.length} authentic 5 ml testers:
                </p>
                <p className="line-clamp-1 text-muted-taupe">
                  {pack.components.map((c) => c.name).join(', ')}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="font-semibold text-royal-burgundy">
                  Choose from {pack.allowedVariants.length} artisanal fragrances:
                </p>
                <p className="text-muted-taupe">
                  Select {pack.minimumUnits ?? 2}
                  {pack.maximumUnits ? ` to ${pack.maximumUnits}` : '+'} testers • 5 ml spray atomizers
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer / CTA */}
      <div className="mt-6 flex items-center justify-between border-t border-soft-border/60 pt-4">
        <div>{priceDisplay}</div>
        <Link
          className={buttonClasses({
            size: 'sm',
            variant: isFixed ? 'primary' : 'outline',
            className: 'gap-1.5',
          })}
          to={packUrl}
        >
          <span>{isFixed ? 'View Set' : 'Build Pack'}</span>
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>
    </article>
  )
}
