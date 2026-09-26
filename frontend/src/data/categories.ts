import type { Category } from '../types'

// Product types only. Gender, flags, and collections are separate facets.
export const categories: Category[] = [
  { id: 'eau-de-parfum', name: 'Eau de Parfum', slug: 'eau-de-parfum', description: 'Eau de Parfum fragrances.', icon: 'Crown' },
  { id: 'extrait-de-parfum', name: 'Extrait de Parfum', slug: 'extrait-de-parfum', description: 'Extrait de Parfum fragrances.', icon: 'Gem' },
  { id: 'attar', name: 'Attar', slug: 'attar', description: 'Concentrated fragrance oils.', icon: 'Droplets' },
  { id: 'gift-set', name: 'Gift Set', slug: 'gift-set', description: 'Fragrance gift sets.', icon: 'Gift' },
]
