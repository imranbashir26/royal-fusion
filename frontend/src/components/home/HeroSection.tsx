import { motion } from 'framer-motion'
import { ArrowRight, Crown, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import heroBanner from '../../assets/brand/hero-banner.webp'
import { useStorefront } from '../../storefront/StorefrontProvider'
import { buttonClasses } from '../../utils/buttonClasses'

const HERO_INTRO_REVEAL_DELAY_SECONDS = 1.62

export function HeroSection() {
  const { homepage } = useStorefront()
  const heroHeading = String(homepage.heroHeading ?? 'Crafted for Kings & Queens')
  const heroSubtitle = String(
    homepage.heroSubtitle ??
      'Experience premium fragrance impressions made for elegance, confidence, and lasting presence.',
  )
  const primaryCtaText = String(homepage.primaryCtaText ?? 'Discover Collection')
  const primaryCtaLink = String(homepage.primaryCtaLink ?? '/collections')
  const secondaryCtaText = String(homepage.secondaryCtaText ?? 'Shop Best Sellers')
  const secondaryCtaLink = String(homepage.secondaryCtaLink ?? '/shop?best=true')
  const heroImage = String(homepage.heroImage ?? '')
  const safeHeroImage = heroImage.startsWith('/uploads') || heroImage.startsWith('http')
    ? heroImage
    : heroBanner
  const shouldSyncWithIntro =
    typeof window !== 'undefined' && !window.sessionStorage.getItem('royal-fusion-intro-played')

  return (
    <section className="relative overflow-hidden">
      <div className="relative min-h-[78svh] md:min-h-[82svh]">
        <img
          alt="Royal Fusion perfume bottle in a cream palace interior with gold columns"
          className="absolute inset-0 h-full w-full object-cover object-[76%_center] md:object-[68%_center]"
          decoding="async"
          fetchPriority="high"
          loading="eager"
          src={safeHeroImage}
        />
        <div className="hero-mask absolute inset-0" />
        <div className="container-lux relative z-10 flex min-h-[78svh] items-center py-16 md:min-h-[82svh]">
          <motion.div
            className="max-w-[20rem] sm:max-w-2xl"
            initial={{ opacity: 0, y: 44 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: shouldSyncWithIntro ? HERO_INTRO_REVEAL_DELAY_SECONDS : 0,
              duration: 0.92,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-champagne/45 bg-ivory/70 px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-oldgold shadow-sm backdrop-blur">
              <Crown className="h-4 w-4" aria-hidden="true" />
              Royal Heritage Collection
            </div>
            <h1 className="font-serif text-4xl font-bold leading-none text-burgundy sm:text-6xl md:text-7xl">
              {heroHeading}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-brownroyal/78 md:text-xl">
              {heroSubtitle}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link className={buttonClasses({ size: 'lg', className: 'w-full sm:w-auto' })} to={primaryCtaLink}>
                {primaryCtaText}
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
              <Link className={buttonClasses({ variant: 'outline', size: 'lg', className: 'w-full sm:w-auto' })} to={secondaryCtaLink}>
                <Sparkles className="h-5 w-5" aria-hidden="true" />
                {secondaryCtaText}
              </Link>
            </div>
          </motion.div>
        </div>
        <motion.div
          aria-hidden="true"
          className="absolute bottom-8 right-[18%] hidden h-24 w-24 rounded-full border border-champagne/40 bg-champagne/15 blur-[1px] xl:block"
          animate={{ y: [0, -16, 0], opacity: [0.4, 0.72, 0.4] }}
          transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
    </section>
  )
}
