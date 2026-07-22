import { motion } from 'framer-motion'
import { useEffect } from 'react'
import logo from '../../assets/brand/logo.png'

interface PreloaderProps {
  onComplete: () => void
}

const INTRO_DURATION_MS = 3000
const CURTAIN_OPEN_DELAY_RATIO = 0.54
const LOADING_BAR_DURATION_SECONDS = 1.62

export function Preloader({ onComplete }: PreloaderProps) {
  useEffect(() => {
    const timer = window.setTimeout(onComplete, INTRO_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [onComplete])

  return (
    <motion.div
      className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-ivory"
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <motion.div
        className="absolute inset-0 bg-burgundy"
        initial={{ opacity: 1 }}
        animate={{ opacity: [1, 1, 0.08] }}
        transition={{ duration: 3, times: [0, CURTAIN_OPEN_DELAY_RATIO, 1], ease: 'easeOut' }}
      />

      <motion.div
        className="curtain-texture curtain-left absolute inset-y-0 left-0 w-1/2 shadow-2xl"
        initial={{ x: 0 }}
        animate={{ x: ['0%', '0%', '-102%'] }}
        transition={{ duration: 3, times: [0, CURTAIN_OPEN_DELAY_RATIO, 1], ease: [0.76, 0, 0.24, 1] }}
      />
      <motion.div
        className="curtain-texture curtain-right absolute inset-y-0 right-0 w-1/2 shadow-2xl"
        initial={{ x: 0 }}
        animate={{ x: ['0%', '0%', '102%'] }}
        transition={{ duration: 3, times: [0, CURTAIN_OPEN_DELAY_RATIO, 1], ease: [0.76, 0, 0.24, 1] }}
      />

      <motion.div
        className="relative z-10 px-5 text-center text-ivory"
        initial={{ opacity: 0, y: 14, scale: 0.96 }}
        animate={{ opacity: [0, 1, 1, 0], y: [14, 0, 0, -8], scale: [0.96, 1, 1, 0.99] }}
        transition={{ duration: 2.12, times: [0, 0.17, 0.76, 1], ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.div
          className="mx-auto mb-4 grid place-items-center"
          initial={{ scale: 0.88 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.72, ease: [0.22, 1, 0.36, 1] }}
        >
          <img
            src={logo}
            alt="Royal Fusion logo"
            className="h-auto w-44 drop-shadow-[0_18px_34px_rgba(0,0,0,0.32)] sm:w-56 md:w-64"
            decoding="async"
            loading="eager"
          />
        </motion.div>
        <p className="mt-4 text-sm font-semibold uppercase tracking-[0.22em] text-ivory/78">
          Crafting your royal fragrance experience...
        </p>
        <div className="mx-auto mt-6 h-1 w-56 overflow-hidden rounded-full bg-ivory/18">
          <motion.div
            className="h-full rounded-full bg-champagne"
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            transition={{ duration: LOADING_BAR_DURATION_SECONDS, ease: 'easeInOut' }}
          />
        </div>
      </motion.div>
    </motion.div>
  )
}
