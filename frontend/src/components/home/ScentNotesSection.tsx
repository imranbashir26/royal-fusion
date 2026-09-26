import { motion, useReducedMotion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { scentNotes } from '../../data/scentNotes'
import { AnimatedSection } from '../common/AnimatedSection'
import { SectionHeading } from '../common/SectionHeading'

export function ScentNotesSection() {
  const reduceMotion = useReducedMotion()
  return (
    <AnimatedSection>
      <div className="container-lux">
        <SectionHeading
          description="Choose by mood and ingredient character, from glowing oriental spices to polished woods."
          eyebrow="Shop by Scent Notes"
          title="Find Your Royal Trail"
        />
        <div className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4 lg:gap-6">
          {scentNotes.map((note, index) => (
            <motion.div
              key={note.id}
              initial={reduceMotion ? false : { opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{
                duration: reduceMotion ? 0 : 0.5,
                delay: reduceMotion ? 0 : index * 0.1,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <Link
                aria-label={`Shop ${note.name} fragrances`}
                className="group relative block aspect-[4/5] overflow-hidden rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-royal-burgundy"
                to={`/shop?scent=${note.name}`}
              >
                {/* Image with hover scale */}
                <img
                  alt={`${note.name} perfume notes`}
                  className="absolute inset-0 z-0 h-full w-full object-cover transition-transform duration-700 ease-out motion-safe:group-hover:scale-[1.02] motion-reduce:transition-none"
                  decoding="async"
                  loading="lazy"
                  src={note.image}
                />

                {/* Dark overlay — readable default, noticeably darker on hover */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 z-10 bg-[#30231e]/20 transition-colors duration-300 ease-out group-hover:bg-[#30231e]/75 group-focus-visible:bg-[#30231e]/75"
                />

                {/* Scent name — true center */}
                <div className="absolute inset-0 z-20 flex items-center justify-center">
                  <h3 className="text-center font-sans text-[23px] font-bold tracking-wide text-white uppercase sm:text-[25px] lg:text-[29px] xl:text-[32px]">
                    {note.name}
                  </h3>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </AnimatedSection>
  )
}
