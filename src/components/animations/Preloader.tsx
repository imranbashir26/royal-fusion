import { motion } from 'framer-motion'
import { Crown } from 'lucide-react'
import { useEffect } from 'react'

interface PreloaderProps {
  onComplete: () => void
}

export function Preloader({ onComplete }: PreloaderProps) {
  useEffect(() => {
    const timer = window.setTimeout(onComplete, 3900)
    return () => window.clearTimeout(timer)
  }, [onComplete])

  return (
    <motion.div
      className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-ivory"
      exit={{ opacity: 0 }}
      transition={{ duration: 0.65, ease: 'easeOut' }}
    >
      <motion.div
        className="absolute inset-0 bg-burgundy"
        initial={{ opacity: 1 }}
        animate={{ opacity: [1, 1, 0.06] }}
        transition={{ duration: 2.7, times: [0, 0.72, 1] }}
      />

      <motion.div
        className="absolute inset-y-0 left-0 w-1/2 curtain-texture shadow-2xl"
        initial={{ x: 0 }}
        animate={{ x: ['0%', '0%', '-102%'] }}
        transition={{ duration: 3.45, times: [0, 0.72, 1], ease: [0.76, 0, 0.24, 1] }}
      />
      <motion.div
        className="absolute inset-y-0 right-0 w-1/2 curtain-texture shadow-2xl"
        initial={{ x: 0 }}
        animate={{ x: ['0%', '0%', '102%'] }}
        transition={{ duration: 3.45, times: [0, 0.72, 1], ease: [0.76, 0, 0.24, 1] }}
      />

      <motion.div
        className="relative z-10 px-5 text-center text-ivory"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: [0, 1, 1, 0], y: [18, 0, 0, -12] }}
        transition={{ duration: 3.1, times: [0, 0.22, 0.78, 1], ease: 'easeOut' }}
      >
        <motion.div
          className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full border border-champagne/70 bg-ivory/10 text-champagne backdrop-blur"
          initial={{ scale: 0.7, rotate: -8 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <Crown className="h-9 w-9" aria-hidden="true" />
        </motion.div>
        <h1 className="font-serif text-5xl font-bold leading-none text-champagne md:text-7xl">
          ROYAL FUSION
        </h1>
        <p className="mt-4 text-sm font-semibold uppercase tracking-[0.22em] text-ivory/78">
          Crafting your royal fragrance experience...
        </p>
        <div className="mx-auto mt-7 h-1.5 w-64 overflow-hidden rounded-full bg-ivory/18">
          <motion.div
            className="h-full rounded-full bg-champagne"
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            transition={{ duration: 2.55, ease: 'easeInOut' }}
          />
        </div>
      </motion.div>
    </motion.div>
  )
}
