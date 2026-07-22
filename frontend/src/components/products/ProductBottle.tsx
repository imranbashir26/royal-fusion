import { motion } from 'framer-motion'
import { Crown } from 'lucide-react'
import type { CSSProperties } from 'react'
import { cn } from '../../utils/cn'

const palettes: Record<
  string,
  {
    liquid: string
    cap: string
    glow: string
    label: string
  }
> = {
  'ruby-amber': {
    liquid: 'linear-gradient(180deg, #b42647 0%, #6f1831 46%, #361016 100%)',
    cap: 'linear-gradient(180deg, #f1c96d, #a97822)',
    glow: 'rgba(139, 31, 61, 0.35)',
    label: '#4b1323',
  },
  'rose-crystal': {
    liquid: 'linear-gradient(180deg, #f0aaa8 0%, #d56f82 48%, #8b1f3d 100%)',
    cap: 'linear-gradient(180deg, #f8d98b, #b68125)',
    glow: 'rgba(217, 146, 146, 0.38)',
    label: '#6f1831',
  },
  'smoked-gold': {
    liquid: 'linear-gradient(180deg, #c99b4b 0%, #82602e 48%, #3d2c1f 100%)',
    cap: 'linear-gradient(180deg, #f2d285, #a97822)',
    glow: 'rgba(169, 120, 34, 0.34)',
    label: '#4b2f22',
  },
  'white-oud': {
    liquid: 'linear-gradient(180deg, #fff8ec 0%, #e9d7b9 46%, #b9945b 100%)',
    cap: 'linear-gradient(180deg, #f7e6a8, #b4872e)',
    glow: 'rgba(215, 173, 88, 0.32)',
    label: '#744f26',
  },
  'citrus-gold': {
    liquid: 'linear-gradient(180deg, #f7cd57 0%, #df9d2d 52%, #9b5f1b 100%)',
    cap: 'linear-gradient(180deg, #fff1a8, #c38a24)',
    glow: 'rgba(223, 157, 45, 0.36)',
    label: '#6d3f15',
  },
  'noir-oud': {
    liquid: 'linear-gradient(180deg, #5c2d32 0%, #2c2020 58%, #15100f 100%)',
    cap: 'linear-gradient(180deg, #e9c66b, #8d681f)',
    glow: 'rgba(75, 47, 34, 0.4)',
    label: '#2c171a',
  },
  'pearl-rose': {
    liquid: 'linear-gradient(180deg, #f6dfd3 0%, #de9b98 50%, #9d4f64 100%)',
    cap: 'linear-gradient(180deg, #f6d98b, #b8842a)',
    glow: 'rgba(222, 155, 152, 0.36)',
    label: '#7d2a41',
  },
  'velvet-ruby': {
    liquid: 'linear-gradient(180deg, #cf4e53 0%, #8b1f3d 52%, #4c0d22 100%)',
    cap: 'linear-gradient(180deg, #f6d681, #a97822)',
    glow: 'rgba(111, 24, 49, 0.36)',
    label: '#5b1028',
  },
  'champagne-amber': {
    liquid: 'linear-gradient(180deg, #edd087 0%, #c68a34 52%, #7f4e24 100%)',
    cap: 'linear-gradient(180deg, #fff0a2, #a97822)',
    glow: 'rgba(198, 138, 52, 0.34)',
    label: '#6d3f1d',
  },
}

interface ProductBottleProps {
  tone: string
  name: string
  compact?: boolean
  floating?: boolean
  className?: string
}

export function ProductBottle({
  tone,
  name,
  compact = false,
  floating = false,
  className,
}: ProductBottleProps) {
  const isImageSource = tone.startsWith('/') || tone.startsWith('http')
  const palette = palettes[tone] ?? palettes['ruby-amber']

  const Bottle = floating ? motion.div : 'div'

  return (
    <Bottle
      className={cn(
        'relative mx-auto grid place-items-center',
        compact ? 'h-52 w-44' : 'h-72 w-60 md:h-80 md:w-72',
        className,
      )}
      {...(floating
        ? {
            animate: { y: [0, -10, 0], rotate: [0, 1.5, 0] },
            transition: { duration: 5, repeat: Infinity, ease: 'easeInOut' },
        }
        : {})}
    >
      {isImageSource ? (
        <img
          alt={`${name} product image`}
          className="h-full w-full rounded-lg object-contain drop-shadow-2xl"
          decoding="async"
          loading="lazy"
          src={tone}
        />
      ) : (
        <>
      <div
        className="absolute bottom-4 h-8 w-40 rounded-full blur-xl"
        style={{ background: palette.glow }}
      />
      <div className="absolute top-8 h-8 w-20 rounded-t-lg border border-champagne/70" style={{ background: palette.cap }} />
      <div className="absolute top-14 h-8 w-14 border-x border-champagne/55 bg-oldgold/60" />
      <div
        className={cn(
          'bottle-glass relative mt-10 overflow-hidden rounded-lg border border-white/45 shadow-2xl',
          compact ? 'h-36 w-28' : 'h-48 w-36 md:h-56 md:w-40',
        )}
        style={{ '--bottle-liquid': palette.liquid } as CSSProperties}
        aria-label={`${name} perfume bottle placeholder`}
        role="img"
      >
        <div className="absolute inset-x-3 top-4 h-10 rounded-full bg-white/16 blur-sm" />
        <div className="absolute left-3 top-4 h-[80%] w-4 rounded-full bg-white/32 blur-sm" />
        <div
          className={cn(
            'absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center border border-champagne/70 bg-ivory/88 px-3 text-center shadow-lg',
            compact ? 'h-20 w-20' : 'h-24 w-24',
          )}
          style={{ color: palette.label }}
        >
          <Crown className="mb-1 h-4 w-4 text-oldgold" aria-hidden="true" />
          <span className="font-serif text-lg font-bold leading-none">Royal</span>
          <span className="text-[10px] font-bold uppercase tracking-[0.18em]">Fusion</span>
        </div>
      </div>
        </>
      )}
    </Bottle>
  )
}
