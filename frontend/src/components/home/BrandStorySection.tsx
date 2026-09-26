import { ArrowRight, Gem, Heart, Sparkles } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { Link } from 'react-router-dom'
import brandStoryImage from '../../assets/brand/royal-fusion-brand-story.webp'

const brandValues = [
  {
    label: 'SIGNATURE CHARACTER',
    description: 'Distinctive fragrances designed to make a memorable impression.',
    icon: Sparkles,
  },
  {
    label: 'REFINED PRESENTATION',
    description: 'A considered visual identity shaped around elegance and occasion.',
    icon: Gem,
  },
  {
    label: 'MADE FOR MOMENTS',
    description: 'Scents created to complement everyday confidence and special occasions.',
    icon: Heart,
  },
]

export function BrandStorySection() {
  const reduceMotion = useReducedMotion()

  return (
    <section aria-labelledby="brand-story-heading" className="bg-warm-ivory py-10 md:py-12 min-[960px]:py-10">
      <div className="container-lux grid items-center gap-9 min-[960px]:grid-cols-2 min-[960px]:gap-8 xl:gap-12">
        <div className="mx-auto aspect-[3/4] w-full max-w-[520px] overflow-hidden rounded-[18px] border border-soft-border/60 shadow-[0_8px_30px_rgba(48,35,30,0.06)] min-[960px]:mx-0 min-[960px]:h-[clamp(500px,40vw,540px)] min-[960px]:max-w-[540px] min-[960px]:aspect-auto">
          <motion.img
            alt="Royal Fusion fragrance collection featuring Oud ul Abyaz, Voice of Heart, Bloom, and Arabian Nights"
            className="h-full w-full object-cover object-center"
            decoding="async"
            loading="lazy"
            src={brandStoryImage}
            initial={reduceMotion ? false : { opacity: 0, scale: 1.015 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ duration: reduceMotion ? 0 : 0.55, ease: 'easeOut' }}
          />
        </div>

        <motion.div
          className="max-w-[38rem]"
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: reduceMotion ? 0 : 0.5, ease: 'easeOut' }}
        >
          <p className="eyebrow-label mb-4 text-xs font-semibold tracking-[0.22em] text-champagne sm:text-[13px]">
            OUR STORY
          </p>
          <h2 id="brand-story-heading" className="font-serif text-[clamp(2.5rem,3.8vw,3.625rem)] font-semibold leading-[1.08] text-royal-burgundy">
            A Fragrance Story Made to Be Remembered
          </h2>
          <p className="mt-5 max-w-[34rem] text-base leading-[1.65] text-muted-taupe">
            Royal Fusion brings together expressive fragrance, refined presentation, and a modern sense of occasion—creating scents designed to leave a lasting impression and become part of the moments people remember.
          </p>

          <div className="mt-7 grid gap-5 sm:grid-cols-3 sm:gap-3 xl:gap-5">
            {brandValues.map(({ label, description, icon: Icon }) => (
              <div className="flex items-start gap-3 sm:block" key={label}>
                <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-soft-cream text-royal-burgundy sm:mb-3">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-[11px] font-semibold leading-[1.4] tracking-[0.11em] text-royal-burgundy">
                    {label}
                  </h3>
                  <p className="mt-1.5 text-xs leading-[1.55] text-muted-taupe">{description}</p>
                </div>
              </div>
            ))}
          </div>

          <Link
            className="group mt-8 inline-flex min-h-12 items-center justify-center gap-3 rounded-[10px] border border-champagne/40 bg-royal-burgundy px-6 py-3 text-sm font-semibold text-warm-ivory transition-colors duration-300 hover:bg-deep-wine focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-royal-burgundy motion-reduce:transition-none"
            to="/about"
          >
            Discover Our Story
            <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform duration-300 ease-out motion-safe:group-hover:translate-x-1 motion-safe:group-focus-visible:translate-x-1 motion-reduce:transition-none" />
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
