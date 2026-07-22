import type { Product, ScentFamily } from '../types'

const standardSizes = [
  { label: '30ml', value: '30ml', price: 2490 },
  { label: '50ml', value: '50ml', price: 3990 },
  { label: '100ml', value: '100ml', price: 6490 },
]

const productImages = {
  shaheen: '/uploads/products/shaheen.webp',
  floralFusion: '/uploads/products/floral-fusion.webp',
  voiceOfHeart: '/uploads/products/voice-of-heart.webp',
  pitchBlack: '/uploads/products/pitch-black.webp',
  baraan: '/uploads/products/baraan.webp',
  change: '/uploads/products/change.webp',
  crimsonCrystal: '/uploads/products/crimson-crystal.webp',
}

function createProduct({
  id,
  name,
  slug,
  image,
  scentFamily,
  gender = 'Unisex',
  category = 'Best Sellers',
  badge = 'Featured',
}: {
  id: string
  name: string
  slug: string
  image: string
  scentFamily: ScentFamily
  gender?: Product['gender']
  category?: string
  badge?: string
}): Product {
  return {
    id,
    slug,
    name,
    category,
    collection: 'Royal Fusion Originals',
    gender,
    price: 3990,
    oldPrice: 4590,
    rating: 4.8,
    reviewCount: 48,
    image,
    gallery: [image],
    badge,
    description:
      'A Royal Fusion fragrance presented with original product imagery. Full notes, pricing, and detailed story can be updated later from the admin dashboard.',
    shortDescription: 'Premium Royal Fusion fragrance with original product imagery.',
    notes: {
      top: ['Citrus', 'Fresh Spice'],
      middle: ['Floral Accord', 'Amber'],
      base: ['Musk', 'Woods'],
    },
    scentFamily,
    longevity: '7-9 hours',
    sillage: 'Moderate',
    occasion: ['Daily Wear', 'Formal', 'Gifting'],
    sizeOptions: standardSizes,
    stock: 25,
    isBestSeller: true,
    isFeatured: true,
    isAttar: false,
  }
}

export const products: Product[] = [
  createProduct({
    id: 'p-shaheen',
    name: 'SHAHEEN',
    slug: 'shaheen',
    image: productImages.shaheen,
    scentFamily: 'Fresh',
    gender: 'Men',
    badge: 'New',
  }),
  createProduct({
    id: 'p-floral-fusion',
    name: 'FLORAL FUSION',
    slug: 'floral-fusion',
    image: productImages.floralFusion,
    scentFamily: 'Floral',
    gender: 'Women',
    category: 'For Her',
    badge: 'Floral',
  }),
  createProduct({
    id: 'p-voice-of-heart',
    name: 'VOICE OF HEART',
    slug: 'voice-of-heart',
    image: productImages.voiceOfHeart,
    scentFamily: 'Spicy',
    badge: 'Signature',
  }),
  createProduct({
    id: 'p-pitch-black',
    name: 'PITCH BLACK',
    slug: 'pitch-black',
    image: productImages.pitchBlack,
    scentFamily: 'Woody',
    gender: 'Men',
    category: 'For Him',
    badge: 'Intense',
  }),
  createProduct({
    id: 'p-baraan',
    name: 'BARAAN',
    slug: 'baraan',
    image: productImages.baraan,
    scentFamily: 'Fresh',
    gender: 'Men',
    category: 'For Him',
    badge: 'Office',
  }),
  createProduct({
    id: 'p-change',
    name: 'CHANGE',
    slug: 'change',
    image: productImages.change,
    scentFamily: 'Citrus',
    gender: 'Men',
    category: 'For Him',
    badge: 'Bold',
  }),
  createProduct({
    id: 'p-crimson-crystal',
    name: 'CRIMSON CRYSTAL',
    slug: 'crimson-crystal',
    image: productImages.crimsonCrystal,
    scentFamily: 'Oriental',
    gender: 'Unisex',
    badge: 'Best Seller',
  }),
]
