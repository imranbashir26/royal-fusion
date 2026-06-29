import type { ReactNode } from 'react'
import { cn } from '../../utils/cn'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: string
  children?: ReactNode
  className?: string
}

export function PageHeader({ eyebrow, title, description, children, className }: PageHeaderProps) {
  return (
    <section className={cn('relative overflow-hidden border-b border-champagne/25 bg-marble py-14 md:py-20', className)}>
      <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(215,173,88,0.15),transparent_30%,rgba(111,24,49,0.08)),repeating-linear-gradient(90deg,rgba(169,120,34,0.08)_0_1px,transparent_1px_42px)] opacity-70" />
      <div className="container-lux relative z-10">
        {eyebrow && (
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-oldgold">
            {eyebrow}
          </p>
        )}
        <h1 className="max-w-4xl font-serif text-5xl font-bold leading-none text-burgundy md:text-7xl">
          {title}
        </h1>
        {description && (
          <p className="mt-5 max-w-2xl text-lg leading-8 text-brownroyal/72">{description}</p>
        )}
        {children}
      </div>
    </section>
  )
}
