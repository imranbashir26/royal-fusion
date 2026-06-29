import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost'
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
    'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-champagne focus-visible:ring-offset-2 focus-visible:ring-offset-ivory disabled:pointer-events-none disabled:opacity-60',
    size === 'sm' && 'h-9 px-4 text-sm',
    size === 'md' && 'h-11 px-5 text-sm',
    size === 'lg' && 'h-12 px-6 text-base',
    variant === 'primary' &&
      'button-shimmer bg-burgundy text-ivory shadow-lg shadow-burgundy/20 hover:bg-velvet',
    variant === 'secondary' &&
      'button-shimmer bg-champagne text-brownroyal shadow-lg shadow-champagne/25 hover:bg-oldgold hover:text-ivory',
    variant === 'outline' &&
      'border border-champagne/55 bg-ivory/70 text-brownroyal hover:border-oldgold hover:bg-champagne/12',
    variant === 'ghost' && 'text-brownroyal hover:bg-burgundy/7',
    className,
  )
