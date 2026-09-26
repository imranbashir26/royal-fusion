import type { Product, Review } from '../types'

export function withApprovedReviewRatings(products: Product[], reviews: Review[]): Product[] {
  const totals = new Map<string, { count: number; sum: number }>()
  for (const review of reviews) {
    if (!review.productId || !Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5) continue
    const total = totals.get(review.productId) ?? { count: 0, sum: 0 }
    total.count += 1
    total.sum += review.rating
    totals.set(review.productId, total)
  }
  return products.map((product) => {
    const total = totals.get(product.id)
    return {
      ...product,
      rating: total ? total.sum / total.count : null,
      reviewCount: total?.count ?? 0,
    }
  })
}
