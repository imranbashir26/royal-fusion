import type { ReactNode } from 'react'
import { cn } from '../../utils/cn'

interface SectionHeadingProps {
  eyebrow?: string
  title: string
  description?: string
  align?: 'left' | 'center'
  action?: ReactNode
  className?: string
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'center',
  action,
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        'mb-8 flex flex-col gap-4 md:mb-12',
        align === 'center' && 'items-center text-center',
        align === 'left' && 'items-start text-left md:flex-row md:items-end md:justify-between',
        className,
      )}
    >
      <div className={cn(align === 'center' ? 'max-w-3xl' : 'max-w-2xl')}>
        {eyebrow && (
          <p className="eyebrow-label mb-3">
            {eyebrow}
          </p>
        )}
        <h2 className="text-editorial-h2 font-serif font-semibold text-royal-burgundy">
          {title}
        </h2>
        {description && (
          <p className="mt-3.5 text-base leading-relaxed text-muted-taupe md:text-lg">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  )
}
