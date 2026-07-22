import { Star } from 'lucide-react'

interface RatingStarsProps {
  rating: number
  count?: number
}

export function RatingStars({ rating, count }: RatingStarsProps) {
  return (
    <div className="flex items-center gap-2 text-sm text-brownroyal/70">
      <span className="flex items-center gap-0.5 text-oldgold" aria-label={`${rating} out of 5`}>
        {Array.from({ length: 5 }).map((_, index) => (
          <Star
            aria-hidden="true"
            className="h-4 w-4 fill-current"
            key={index}
            opacity={index + 1 <= Math.round(rating) ? 1 : 0.24}
          />
        ))}
      </span>
      <span>
        {rating.toFixed(1)}
        {count ? ` (${count})` : ''}
      </span>
    </div>
  )
}
