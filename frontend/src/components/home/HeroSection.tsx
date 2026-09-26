import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import heroVideo from '../../assets/hero/royal-fusion-hero-bg.mp4'
import heroPoster from '../../assets/hero/royal-fusion-hero-poster.webp'
import heroBottle from '../../assets/hero/crimson-crystal-transparent.webp'
import { useStorefront } from '../../storefront/StorefrontProvider'

const HERO_INTRO_REVEAL_DELAY_SECONDS = 1.62

function CampaignMedia() {
  const reducedMotion = useReducedMotion()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [canPlay, setCanPlay] = useState(false)
  const [videoReady, setVideoReady] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 640px) and (prefers-reduced-motion: no-preference)')
    const update = () => setCanPlay(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !canPlay) return
    let inView = true
    const updatePlayback = () => {
      if (document.hidden || !inView) video.pause()
      else void video.play().catch(() => setVideoReady(false))
    }
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
      updatePlayback()
    })
    observer.observe(video)
    document.addEventListener('visibilitychange', updatePlayback)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', updatePlayback)
      video.pause()
    }
  }, [canPlay])

  const animateProduct = canPlay && !reducedMotion
  const transition = { duration: 8, ease: 'easeInOut' as const, repeat: Infinity }

  return (
    <div className="hero-campaign absolute inset-0 pointer-events-none select-none" aria-hidden="true">
      <div className="hero-campaign-scene absolute z-0">
        <img src={heroPoster} alt="" width={1920} height={1080}
          className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" loading="eager" />
        {canPlay && (
          <video ref={videoRef} autoPlay muted loop playsInline preload="metadata"
            poster={heroPoster} src={heroVideo} tabIndex={-1}
            className="absolute inset-0 h-full w-full object-cover pointer-events-none"
            style={{ opacity: videoReady ? 1 : 0 }}
            onPlaying={() => setVideoReady(true)}
            onError={() => setVideoReady(false)}
            onEmptied={() => setVideoReady(false)} />
        )}
      </div>
      <div className="hero-atmospheric-overlay absolute inset-0 z-10" />
      <div className="hero-product-anchor absolute z-20">
        <motion.div className="hero-contact-shadow absolute"
          initial={false}
          animate={animateProduct ? { scaleX: [1, 0.94, 1], opacity: [0.22, 0.16, 0.22] } : { scaleX: 1, opacity: 0.22 }}
          transition={animateProduct ? transition : { duration: 0 }} />
        <motion.div className="hero-bottle absolute"
          initial={false}
          animate={animateProduct ? { y: [0, -7, 0], rotate: [-0.3, 0.3, -0.3] } : { y: 0, rotate: 0 }}
          transition={animateProduct ? transition : { duration: 0 }}>
          <img src={heroBottle} alt="" width={1120} height={1402}
            className="h-full w-full object-contain" loading="eager" decoding="async" />
          {animateProduct && (
            <div className="hero-bottle-reflection absolute inset-0" style={{ maskImage: `url(${heroBottle})` }}>
              <motion.div className="hero-bottle-highlight absolute inset-0"
                animate={{ x: ['-80%', '140%', '140%'] }}
                transition={{ duration: 6, times: [0, 0.45, 1], ease: 'easeInOut', repeat: Infinity }} />
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}

export function HeroSection() {
  const { homepage, banners } = useStorefront()
  const shouldReduceMotion = useReducedMotion()

  // 1. Check for active promotional banner positioned at 'Homepage hero'
  const activeHeroBanner = banners?.find(
    (banner) => banner.position === 'Homepage hero' && banner.enabled,
  )

  // 2. Resolve content hierarchy: banner overrides -> homepage settings -> approved editorial defaults
  const heroEnabled = homepage.heroEnabled !== false

  const rawEyebrow = String(homepage.heroEyebrow ?? '')
  const heroEyebrow =
    !rawEyebrow || rawEyebrow.toLowerCase().includes('royal heritage collection')
      ? 'THE ROYAL COLLECTION'
      : rawEyebrow

  const rawHeading = String(
    activeHeroBanner?.title ??
      homepage.heroHeading ??
      homepage.heroTitle ??
      '',
  )
  const heroHeading =
    !rawHeading || rawHeading.toLowerCase().includes('crafted for kings')
      ? 'Leave a Lasting\nImpression.'
      : rawHeading

  const rawSubtitle = String(
    activeHeroBanner?.subtitle ??
      homepage.heroSubtitle ??
      homepage.heroDescription ??
      '',
  )
  const heroSubtitle =
    !rawSubtitle || rawSubtitle.toLowerCase().includes('experience premium fragrance impressions')
      ? 'Distinctive fragrances crafted for confidence, character, and moments worth remembering.'
      : rawSubtitle

  const rawPrimaryCta = String(
    activeHeroBanner?.ctaText ??
      homepage.heroPrimaryCtaLabel ??
      homepage.primaryCtaText ??
      '',
  )
  const primaryCtaText =
    !rawPrimaryCta || rawPrimaryCta.toLowerCase().includes('discover collection')
      ? 'Shop Collection'
      : rawPrimaryCta

  const primaryCtaLink = String(
    activeHeroBanner?.ctaLink ??
      homepage.heroPrimaryCtaUrl ??
      homepage.primaryCtaLink ??
      '/collections',
  )

  const rawSecondaryCta = String(
    homepage.heroSecondaryCtaLabel ??
      homepage.secondaryCtaText ??
      '',
  )
  const secondaryCtaText =
    !rawSecondaryCta || rawSecondaryCta.toLowerCase().includes('shop best sellers')
      ? 'Explore Best Sellers'
      : rawSecondaryCta

  const secondaryCtaLink = String(
    homepage.heroSecondaryCtaUrl ??
      homepage.secondaryCtaLink ??
      '/shop?best=true',
  )

  const rawImage = String(activeHeroBanner?.image ?? homepage.heroImage ?? '')
  const hasCustomHeroImage =
    Boolean(rawImage) &&
    !rawImage.includes('hero-banner') &&
    (rawImage.startsWith('/uploads') ||
      rawImage.startsWith('http') ||
      rawImage.startsWith('/'))

  // Existing custom banner/homepage images still take precedence. The approved
  // local campaign replaces only the default artwork during design validation.
  const useLocalCampaign = !hasCustomHeroImage

  const heroImageAlt = String(
    homepage.heroImageAlt ??
      'Royal Fusion signature perfume bottle presented in a luxury palace interior',
  )

  const shouldSyncWithIntro =
    typeof window !== 'undefined' &&
    !window.sessionStorage.getItem('royal-fusion-intro-played')

  if (!heroEnabled) {
    return null
  }

  // Animation delay calculation
  const baseDelay = shouldSyncWithIntro ? HERO_INTRO_REVEAL_DELAY_SECONDS : 0.05
  const animDuration = shouldReduceMotion ? 0 : 0.65

  // Parse multiline headline if newline is present
  const headlineLines = heroHeading.includes('\n')
    ? heroHeading.split('\n')
    : [heroHeading]

  return (
    <section
      aria-label="Welcome to Royal Fusion"
      className={`relative overflow-hidden bg-warm-ivory hero-viewport-height flex items-center${useLocalCampaign ? ' hero-animated-campaign' : ''}`}
    >
      {/* Edge-to-Edge Campaign Artwork & Atmospheric Overlay */}
      {useLocalCampaign ? <CampaignMedia /> : <motion.div
        animate={{ opacity: 1 }}
        className="absolute inset-0 z-0 overflow-hidden pointer-events-none select-none"
        initial={shouldReduceMotion ? false : { opacity: 0.9 }}
        transition={{
          delay: baseDelay,
          duration: shouldReduceMotion ? 0 : 0.75,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        <img
          alt={heroImageAlt}
          className="h-full w-full object-cover object-[78%_center] sm:object-[72%_center] md:object-[68%_center] lg:object-[66%_center] xl:object-[64%_center]"
          decoding="async"
          fetchPriority="high"
          loading="eager"
          src={rawImage}
        />
        {/* Subtle Luxury Atmospheric Left-to-Right Readability Overlay */}
        <div
          aria-hidden="true"
          className="hero-atmospheric-overlay absolute inset-0"
        />
      </motion.div>}

      {/* Content Container */}
      <div className="hero-content container-lux relative z-30 w-full py-12 sm:py-14 md:py-16 lg:py-8 xl:py-10">
        <div className="max-w-[560px] lg:max-w-[620px] flex flex-col items-start text-left">
          {/* Minimal Editorial Eyebrow */}
          <motion.p
            animate={{ opacity: 1, y: 0 }}
            className="eyebrow-label text-[11px] sm:text-xs tracking-[0.24em] uppercase text-royal-burgundy font-semibold mb-3.5 sm:mb-4 select-none"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
            transition={{
              delay: baseDelay,
              duration: animDuration,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            {heroEyebrow}
          </motion.p>

          {/* Main Editorial Headline */}
          <motion.h1
            animate={{ opacity: 1, y: 0 }}
            className="font-serif text-editorial-hero text-royal-burgundy font-semibold tracking-tight text-balance max-w-[620px]"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
            transition={{
              delay: baseDelay + 0.08,
              duration: animDuration + 0.05,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            {headlineLines.map((line, idx) => (
              <span key={idx} className="block">
                {line}
              </span>
            ))}
          </motion.h1>

          {/* Supporting Copy */}
          <motion.p
            animate={{ opacity: 1, y: 0 }}
            className="mt-5 sm:mt-6 text-base sm:text-lg lg:text-[17px] leading-relaxed text-muted-taupe max-w-xl text-balance"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
            transition={{
              delay: baseDelay + 0.16,
              duration: animDuration + 0.05,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            {heroSubtitle}
          </motion.p>

          {/* CTA Hierarchy */}
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 sm:mt-9 lg:mt-10 flex flex-col sm:flex-row items-stretch sm:items-center gap-3.5 sm:gap-4 w-full sm:w-auto"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 14 }}
            transition={{
              delay: baseDelay + 0.24,
              duration: animDuration,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            {/* Primary CTA */}
            <Link
              className="group inline-flex items-center justify-center gap-2.5 rounded-[10px] bg-royal-burgundy px-7 py-3.5 text-sm font-semibold tracking-[0.02em] text-white shadow-sm transition-all duration-200 hover:bg-deep-wine hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-burgundy focus-visible:ring-offset-2 focus-visible:ring-offset-warm-ivory active:scale-[0.99] w-full sm:w-auto"
              to={primaryCtaLink}
            >
              <span>{primaryCtaText}</span>
              <ArrowRight
                aria-hidden="true"
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </Link>

            {/* Secondary CTA */}
            <Link
              className="inline-flex items-center justify-center gap-2 rounded-[10px] border border-soft-border/90 bg-warm-ivory/60 backdrop-blur-[2px] px-6 py-3.5 text-sm font-medium tracking-[0.02em] text-espresso transition-all duration-200 hover:border-champagne hover:bg-champagne/15 hover:text-royal-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne focus-visible:ring-offset-2 focus-visible:ring-offset-warm-ivory active:scale-[0.99] w-full sm:w-auto"
              to={secondaryCtaLink}
            >
              <span>{secondaryCtaText}</span>
            </Link>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
