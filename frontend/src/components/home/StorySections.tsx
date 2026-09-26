import { ArrowRight } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { Link } from 'react-router-dom'
import collectionEditorial from '../../assets/royal-collection/royal-collection-editorial.webp'
import giftExperience from '../../assets/gift/royal-fusion-gift-experience.webp'

export function RoyalCollectionSection() {
  const reduceMotion = useReducedMotion()

  return (
    <section
      aria-labelledby="royal-collection-heading"
      className="overflow-hidden bg-deep-wine text-warm-ivory"
    >
      <div className="container-lux grid lg:min-h-[500px] lg:grid-cols-[45%_55%] xl:min-h-[530px] 2xl:min-h-[540px]">
      <div className="relative order-first -mx-5 aspect-[4/3] overflow-hidden md:-mx-8 lg:order-last lg:mx-0 lg:aspect-auto">
        <motion.img
          alt="Royal Fusion collection featuring Bloom, Oud ul Abyaz, and Arabian Nights fragrances"
          className="absolute inset-0 h-full w-full object-cover object-[50%_20%]"
          style={{ objectPosition: '50% 20%' }}
          decoding="async"
          loading="lazy"
          src={collectionEditorial}
          width={1448}
          height={1086}
          initial={reduceMotion ? false : { opacity: 0, scale: 1.02 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: reduceMotion ? 0 : 0.6, ease: 'easeOut' }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-deep-wine via-transparent via-20% to-transparent lg:bg-gradient-to-r lg:via-deep-wine/30 lg:via-8% lg:to-transparent lg:to-22%"
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden min-[1537px]:block min-[1537px]:bg-gradient-to-l min-[1537px]:from-deep-wine min-[1537px]:to-transparent min-[1537px]:to-12%" />
      </div>
      <div className="flex items-center py-10 sm:py-12">
        <motion.div
          className="max-w-[32rem]"
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: reduceMotion ? 0 : 0.5, ease: 'easeOut' }}
        >
          <p className="eyebrow-label mb-4 text-xs font-semibold tracking-[0.24em] text-champagne sm:text-[13px]">
            THE ROYAL COLLECTION
          </p>
          <h2 id="royal-collection-heading" className="max-w-[11em] font-serif text-[clamp(2.25rem,3.6vw,3.75rem)] font-semibold leading-[1.08] text-warm-ivory">
            Made for Moments That Stay With You
          </h2>
          <p className="mt-5 max-w-[29rem] text-base leading-[1.65] text-warm-ivory/85 xl:text-[17px]">
            A curated expression of depth, warmth, and character—created for celebrations, evenings, and moments worth remembering.
          </p>
          <Link
            className="group mt-7 inline-flex min-h-12 items-center justify-center gap-3 rounded-[10px] border border-soft-border bg-warm-ivory px-5 py-3.5 text-sm font-semibold text-deep-wine transition-colors duration-300 hover:bg-soft-cream focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-champagne motion-reduce:transition-none sm:px-6"
            to="/collections"
          >
            Explore Royal Collection
            <ArrowRight className="h-4 w-4 transition-transform duration-300 ease-out motion-safe:group-hover:translate-x-1 motion-safe:group-focus-visible:translate-x-1 motion-reduce:transition-none" aria-hidden="true" />
          </Link>
        </motion.div>
      </div>
      </div>
    </section>
  )
}

export function GiftPackagingSection() {
  const reduceMotion = useReducedMotion()

  return (
    <section aria-labelledby="gift-experience-heading" className="bg-warm-ivory py-12 md:py-16">
      <div className="container-lux grid items-center gap-8 md:gap-10 min-[960px]:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)] min-[960px]:gap-10 xl:gap-14">
        <div className="relative aspect-[4/3] max-h-[520px] overflow-hidden rounded-[18px] border border-soft-border/50 shadow-[0_8px_30px_rgba(48,35,30,0.06)] min-[960px]:aspect-auto min-[960px]:h-[clamp(400px,39vw,500px)]">
          <motion.img
            alt="Royal Fusion fragrances presented in a burgundy luxury gift box with ribbon"
            className="h-full w-full object-cover object-center"
            decoding="async"
            loading="lazy"
            src={giftExperience}
            width={1448}
            height={1086}
            initial={reduceMotion ? false : { opacity: 0, scale: 1.02 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ duration: reduceMotion ? 0 : 0.55, ease: 'easeOut' }}
          />
        </div>
        <motion.div
          className="max-w-[30rem] xl:justify-self-center"
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: reduceMotion ? 0 : 0.5, ease: 'easeOut' }}
        >
          <p className="eyebrow-label mb-4 text-xs font-semibold tracking-[0.22em] text-champagne sm:text-[13px]">
            GIFT EXPERIENCE
          </p>
          <h2 id="gift-experience-heading" className="font-serif text-[clamp(2.5rem,4vw,3.75rem)] font-semibold leading-[1.08] text-royal-burgundy">
            A Gift Worth Remembering
          </h2>
          <p className="mt-5 max-w-[29rem] text-base leading-[1.65] text-muted-taupe lg:text-[17px]">
            Thoughtfully presented fragrances, finished with the details that make every Royal Fusion gift feel considered from the first impression.
          </p>
          <Link
            className="group mt-7 inline-flex min-h-12 items-center justify-center gap-3 rounded-[10px] border border-champagne/40 bg-royal-burgundy px-6 py-3 text-sm font-semibold text-warm-ivory transition-colors duration-300 hover:bg-deep-wine focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-royal-burgundy motion-reduce:transition-none"
            to="/shop?category=Gift%20Sets"
          >
            Explore Gift Sets
            <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform duration-300 ease-out motion-safe:group-hover:translate-x-1 motion-safe:group-focus-visible:translate-x-1 motion-reduce:transition-none" />
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
