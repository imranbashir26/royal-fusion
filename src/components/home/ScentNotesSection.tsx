import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { scentNotes } from '../../data/scentNotes'
import { AnimatedSection } from '../common/AnimatedSection'
import { SectionHeading } from '../common/SectionHeading'

export function ScentNotesSection() {
  return (
    <AnimatedSection>
      <div className="container-lux">
        <SectionHeading
          description="Choose by mood and ingredient character, from glowing oriental spices to polished woods."
          eyebrow="Shop by Scent Notes"
          title="Find Your Royal Trail"
        />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {scentNotes.map((note) => (
            <motion.div
              key={note.id}
              whileHover={{ y: -8, scale: 1.015 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            >
              <Link
                className="block overflow-hidden rounded-lg border border-champagne/25 bg-ivory shadow-sm transition hover:border-champagne/60 hover:shadow-2xl hover:shadow-brownroyal/12"
                to={`/shop?scent=${note.name}`}
              >
                <img className="aspect-square w-full object-cover" src={note.image} alt={`${note.name} perfume notes`} />
                <div className="p-5">
                  <h3 className="font-serif text-3xl font-semibold text-burgundy">{note.name}</h3>
                  <p className="mt-2 text-sm leading-6 text-brownroyal/68">{note.description}</p>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </AnimatedSection>
  )
}
