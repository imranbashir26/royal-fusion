import type { ReactNode } from 'react'
import { Crown } from 'lucide-react'
import { Link } from 'react-router-dom'
import { buttonClasses } from '../../utils/buttonClasses'

interface EmptyStateProps {
  title: string
  description: string
  actionLabel?: string
  actionTo?: string
  children?: ReactNode
}

export function EmptyState({
  title,
  description,
  actionLabel = 'Explore Shop',
  actionTo = '/shop',
  children,
}: EmptyStateProps) {
  return (
    <div className="rounded-[14px] border border-soft-border bg-pure-white/80 px-6 py-12 text-center shadow-[0_4px_20px_rgba(48,35,30,0.04)]">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-soft-border bg-soft-cream text-champagne">
        <Crown className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="font-serif text-2xl font-semibold text-royal-burgundy md:text-3xl">{title}</h2>
      <p className="mx-auto mt-2.5 max-w-xl text-sm leading-relaxed text-muted-taupe md:text-base">{description}</p>
      {children}
      <Link className={buttonClasses({ variant: 'primary', className: 'mt-6' })} to={actionTo}>
        {actionLabel}
      </Link>
    </div>
  )
}
