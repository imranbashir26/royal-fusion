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
    <section className={cn('relative overflow-hidden border-b border-soft-border/70 bg-gradient-to-b from-warm-ivory to-soft-cream/60 py-12 md:py-16', className)}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(200,154,61,0.07),transparent_65%)]" />
      <div className="container-lux relative z-10">
        {eyebrow && (
          <p className="eyebrow-label mb-3">
            {eyebrow}
          </p>
        )}
        <h1 className="max-w-4xl text-editorial-h1 font-serif font-semibold text-royal-burgundy">
          {title}
        </h1>
        {description && (
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-taupe md:text-lg">{description}</p>
        )}
        {children}
      </div>
    </section>
  )
}
