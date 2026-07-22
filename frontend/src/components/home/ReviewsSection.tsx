import { useStorefront } from '../../storefront/StorefrontProvider'
import { AnimatedSection } from '../common/AnimatedSection'
import { RatingStars } from '../common/RatingStars'
import { SectionHeading } from '../common/SectionHeading'

export function ReviewsSection() {
  const { reviews, testimonials } = useStorefront()
  const displayReviews = testimonials.length > 0 ? testimonials : reviews

  return (
    <AnimatedSection className="bg-marble/75">
      <div className="container-lux">
        <SectionHeading
          description="Realistic boutique-style feedback for the prototype shopping experience."
          eyebrow="Reviews"
          title="Loved by Fragrance Collectors"
        />
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {displayReviews.map((review) => (
            <article className="rounded-lg border border-champagne/25 bg-ivory/88 p-5 shadow-sm" key={review.id}>
              <RatingStars rating={review.rating} />
              <p className="mt-5 text-sm leading-7 text-brownroyal/72">"{review.text}"</p>
              <div className="mt-5 border-t border-champagne/25 pt-4">
                <h3 className="font-serif text-2xl font-semibold text-burgundy">{review.name}</h3>
                <p className="text-sm text-brownroyal/60">{review.city}</p>
                <p className="mt-2 text-xs font-bold uppercase tracking-[0.16em] text-oldgold">
                  Purchased {review.product}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </AnimatedSection>
  )
}
