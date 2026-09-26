import { Star } from 'lucide-react'

interface RatingStarsProps {
  rating: number | null
  count?: number
}

export function RatingStars({ rating, count }: RatingStarsProps) {
  if (rating === null || count === 0) {
    return <span className="text-xs text-muted-taupe sm:text-sm">No reviews yet</span>
  }
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-taupe sm:text-sm">
      <span className="flex items-center gap-0.5 text-champagne" aria-label={`${rating} out of 5`}>
        {Array.from({ length: 5 }).map((_, index) => (
          <Star
            aria-hidden="true"
            className="h-3.5 w-3.5 fill-current"
            key={index}
            opacity={index + 1 <= Math.round(rating) ? 1 : 0.2}
          />
        ))}
      </span>
      <span className="font-medium text-espresso/80">
        {rating.toFixed(1)}
        {count ? ` (${count})` : ''}
      </span>
    </div>
  )
}
