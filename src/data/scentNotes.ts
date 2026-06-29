import citrusImage from '../assets/brand/scent-citrus.png'
import floralImage from '../assets/brand/scent-floral.png'
import orientalImage from '../assets/brand/scent-oriental.png'
import woodyImage from '../assets/brand/scent-woody.png'
import type { ScentNote } from '../types'

export const scentNotes: ScentNote[] = [
  {
    id: 'oriental',
    name: 'Oriental',
    slug: 'oriental',
    image: orientalImage,
    description: 'Cinnamon, star anise, cardamom, clove, and glowing amber.',
  },
  {
    id: 'floral',
    name: 'Floral',
    slug: 'floral',
    image: floralImage,
    description: 'Roses, jasmine petals, peony softness, and creamy white blooms.',
  },
  {
    id: 'citrus',
    name: 'Citrus',
    slug: 'citrus',
    image: citrusImage,
    description: 'Orange, lemon, lime, green leaves, and a bright polished lift.',
  },
  {
    id: 'woody',
    name: 'Woody',
    slug: 'woody',
    image: woodyImage,
    description: 'Sandalwood, oud chips, cedar texture, and polished warmth.',
  },
]
