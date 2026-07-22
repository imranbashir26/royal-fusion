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
        'mb-9 flex flex-col gap-4 md:mb-12',
        align === 'center' && 'items-center text-center',
        align === 'left' && 'items-start text-left md:flex-row md:justify-between',
        className,
      )}
    >
      <div className={cn(align === 'center' ? 'max-w-3xl' : 'max-w-2xl')}>
        {eyebrow && (
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-oldgold">
            {eyebrow}
          </p>
        )}
        <h2 className="font-serif text-4xl font-semibold leading-none text-burgundy md:text-5xl">
          {title}
        </h2>
        {description && (
          <p className="mt-4 text-base leading-7 text-brownroyal/75 md:text-lg">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  )
}
