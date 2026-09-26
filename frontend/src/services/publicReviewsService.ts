import type { Review } from '../types'
import { API_BASE_URL, apiClient } from './apiClient'

export interface ReviewSubmission {
  productId: string
  name: string
  city: string
  rating: number
  text: string
}

export async function getPublicReviews(): Promise<Review[]> {
  const response = await apiClient.request<{ data: Review[] }>('/v1/public/reviews')
  return Array.isArray(response.data) ? response.data : []
}

export async function submitProductReview(input: ReviewSubmission): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/v1/public/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await response.json().catch(() => null) as { data?: { message?: string }; error?: { message?: string } } | null
  if (!response.ok) throw new Error(body?.error?.message ?? 'Your review could not be submitted. Please try again.')
  return body?.data?.message ?? 'Your review was submitted for moderation.'
}
