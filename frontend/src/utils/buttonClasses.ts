import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'gold' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

export const buttonClasses = ({
  variant = 'primary',
  size = 'md',
  className,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
}) =>
  cn(
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-champagne focus-visible:ring-offset-2 focus-visible:ring-offset-warm-ivory disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer',
    size === 'sm' && 'h-9 px-3.5 text-xs',
    size === 'md' && 'h-11 px-5 text-sm',
    size === 'lg' && 'h-12 px-7 text-base',
    variant === 'primary' &&
      'bg-royal-burgundy text-white shadow-sm hover:bg-deep-wine hover:shadow-md active:scale-[0.99]',
    variant === 'secondary' &&
      'border border-soft-border bg-warm-ivory text-espresso hover:border-champagne hover:bg-soft-cream/70 hover:text-royal-burgundy',
    variant === 'outline' &&
      'border border-soft-border bg-transparent text-espresso hover:border-royal-burgundy hover:bg-royal-burgundy/5 hover:text-royal-burgundy',
    variant === 'gold' &&
      'bg-champagne text-deep-wine font-semibold shadow-sm hover:bg-[#b88c34] hover:text-white',
    variant === 'ghost' &&
      'bg-transparent text-espresso hover:bg-royal-burgundy/6 hover:text-royal-burgundy',
    className,
  )
