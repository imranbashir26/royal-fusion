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
    <div className="marble-panel rounded-lg px-6 py-12 text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-burgundy text-ivory">
        <Crown className="h-7 w-7" aria-hidden="true" />
      </div>
      <h2 className="font-serif text-3xl font-semibold text-burgundy">{title}</h2>
      <p className="mx-auto mt-3 max-w-xl text-brownroyal/75">{description}</p>
      {children}
      <Link className={buttonClasses({ className: 'mt-7' })} to={actionTo}>
        {actionLabel}
      </Link>
    </div>
  )
}
