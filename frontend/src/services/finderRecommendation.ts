import type { FinderPreference, FinderPreferenceKey, Product } from '../types'

export function resolveFinderRecommendation(
  key: FinderPreferenceKey,
  preferences: FinderPreference[],
  products: Product[],
): Product | null {
  const productId = preferences.find((preference) => preference.key === key)?.productId
  return productId ? products.find((product) => product.id === productId) ?? null : null
}
