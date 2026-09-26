import { ArrowLeft, ArrowRight } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { useStorefront } from '../../storefront/StorefrontProvider'
import type { Product, Review } from '../../types'
import { RatingStars } from '../common/RatingStars'

export function ReviewsSection() {
  const { isLoading, products, reviews } = useStorefront()
  const reduceMotion = useReducedMotion()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const publicReviews = reviews.filter(
    (review) => review.productId && review.name.trim() && review.text.trim() && review.rating >= 1 && review.rating <= 5,
  )
  const averageRating = publicReviews.length
    ? Number((publicReviews.reduce((total, review) => total + review.rating, 0) / publicReviews.length).toFixed(1))
    : null

  const scrollReviews = (direction: -1 | 1) => {
    const scroller = scrollerRef.current
    const card = scroller?.firstElementChild as HTMLElement | null
    if (!scroller || !card) return

    const step = card.offsetWidth + 20
    const end = scroller.scrollWidth - scroller.clientWidth
    const next = scroller.scrollLeft + direction * step
    scroller.scrollTo({
      left: next < -1 ? end : next > end + 1 ? 0 : next,
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }

  const controlsClass = publicReviews.length > 4
    ? ''
    : publicReviews.length > 2
      ? 'xl:hidden'
      : 'md:hidden'

  return (
    <section aria-labelledby="customer-reviews-heading" className="bg-soft-cream py-14 md:py-20">
      <div className="container-lux">
        <div className="mx-auto max-w-[44rem] text-center">
          <p className="eyebrow-label mb-3 text-xs font-semibold tracking-[0.22em] text-champagne sm:text-[13px]">
            CUSTOMER REVIEWS
          </p>
          <h2 id="customer-reviews-heading" className="font-serif text-[clamp(2.625rem,4vw,3.5rem)] font-semibold leading-[1.08] text-royal-burgundy">
            Loved by Fragrance Enthusiasts
          </h2>
          <p className="mx-auto mt-4 max-w-[37rem] text-[15px] leading-[1.7] text-muted-taupe md:text-base">
            Real experiences from customers who have made Royal Fusion part of their everyday moments.
          </p>
          {averageRating !== null && (
            <div className="mt-6 flex flex-col items-center gap-1">
              <RatingStars rating={averageRating} />
              <p className="text-sm text-muted-taupe">Based on {publicReviews.length} {publicReviews.length === 1 ? 'review' : 'reviews'}</p>
            </div>
          )}
        </div>

        {isLoading ? (
          <p className="mt-10 text-center text-sm text-muted-taupe" role="status">Loading customer reviews…</p>
        ) : publicReviews.length === 0 ? (
          <p className="mx-auto mt-10 max-w-lg rounded-2xl border border-soft-border bg-white px-6 py-10 text-center font-serif text-2xl text-espresso">
            Be among the first to share your Royal Fusion experience.
          </p>
        ) : (
          <>
            <div
              aria-label="Customer reviews"
              className="mt-10 flex snap-x snap-mandatory gap-5 overflow-x-auto pb-3 motion-safe:scroll-smooth"
              ref={scrollerRef}
              role="region"
            >
              {publicReviews.map((review) => (
                <ReviewCard
                  key={review.id}
                  product={products.find((item) => item.id === review.productId)}
                  reduceMotion={Boolean(reduceMotion)}
                  review={review}
                />
              ))}
            </div>
            {publicReviews.length > 1 && (
              <div className={`mt-5 flex items-center justify-center gap-3 ${controlsClass}`}>
                <button
                  aria-label="Previous reviews"
                  className="grid h-11 w-11 place-items-center rounded-full border border-soft-border bg-white text-royal-burgundy transition-colors hover:bg-warm-ivory focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-royal-burgundy"
                  onClick={() => scrollReviews(-1)}
                  type="button"
                >
                  <ArrowLeft aria-hidden="true" className="h-5 w-5" />
                </button>
                <button
                  aria-label="Next reviews"
                  className="grid h-11 w-11 place-items-center rounded-full border border-soft-border bg-white text-royal-burgundy transition-colors hover:bg-warm-ivory focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-royal-burgundy"
                  onClick={() => scrollReviews(1)}
                  type="button"
                >
                  <ArrowRight aria-hidden="true" className="h-5 w-5" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function ReviewCard({ product, reduceMotion, review }: { product?: Product; reduceMotion: boolean; review: Review }) {
  const image = product?.cardHoverImage || product?.cardImage || product?.image

  return (
    <motion.article
      className="flex w-full shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-soft-border bg-white shadow-[0_6px_24px_rgba(48,35,30,0.05)] md:w-[calc((100%-1.25rem)/2)] xl:w-[calc((100%-3.75rem)/4)]"
      initial={reduceMotion ? false : { opacity: 0, y: 14 }}
      transition={{ duration: reduceMotion ? 0 : 0.5, ease: 'easeOut' }}
      viewport={{ once: true, amount: 0.15 }}
      whileInView={{ opacity: 1, y: 0 }}
    >
      {image && (
        <div className="aspect-[16/10] overflow-hidden bg-warm-ivory">
          <img
            alt={product.name}
            className={`h-full w-full ${product.cardHoverImage ? 'object-cover' : 'object-contain'}`}
            decoding="async"
            loading="lazy"
            src={image}
          />
        </div>
      )}
      <div className="flex flex-1 flex-col p-5">
        <RatingStars rating={review.rating} />
        <blockquote className="mt-4 flex-1 font-serif text-xl leading-[1.45] text-espresso">“{review.text}”</blockquote>
        <div className="mt-6 border-t border-soft-border pt-4">
          <p className="font-semibold text-royal-burgundy">{review.name}</p>
          {review.city && <p className="mt-0.5 text-sm text-muted-taupe">{review.city}</p>}
          {review.product && (
            product ? (
              <Link className="mt-3 inline-block text-xs font-semibold uppercase tracking-[0.12em] text-royal-burgundy underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-royal-burgundy" to={`/product/${product.slug}`}>
                {review.product}
              </Link>
            ) : (
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-royal-burgundy">{review.product}</p>
            )
          )}
        </div>
      </div>
    </motion.article>
  )
}
