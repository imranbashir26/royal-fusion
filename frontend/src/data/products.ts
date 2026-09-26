import crimsonCrystalTransparent from '../assets/hero/crimson-crystal-transparent.webp'
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
  cardImage,
  cardHoverImage,
  cardBackgroundColor = '#E7C78F',
  scentFamily,
  gender = 'Unisex',
  category = 'Eau de Parfum',
  badge = 'Featured',
}: {
  id: string
  name: string
  slug: string
  image: string
  cardImage?: string
  cardHoverImage?: string
  cardBackgroundColor?: string
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
    cardImage: cardImage || image,
    cardHoverImage: cardHoverImage || '',
    cardBackgroundColor: cardBackgroundColor || '#E7C78F',
    gallery: [image],
    badge,
    description: `${name} is a ${scentFamily.toLowerCase()} fragrance from Royal Fusion.`,
    shortDescription: `Explore ${name}, a ${scentFamily.toLowerCase()} fragrance from Royal Fusion.`,
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
    isNewArrival: slug === 'shaheen',
    isPremium: true,
  }
}

export const products: Product[] = [
  createProduct({
    id: 'p-shaheen',
    name: 'SHAHEEN',
    slug: 'shaheen',
    image: productImages.shaheen,
    cardHoverImage: productImages.shaheen,
    cardBackgroundColor: '#E7C78F',
    scentFamily: 'Fresh',
    gender: 'Men',
    badge: 'New',
  }),
  createProduct({
    id: 'p-floral-fusion',
    name: 'FLORAL FUSION',
    slug: 'floral-fusion',
    image: productImages.floralFusion,
    cardHoverImage: productImages.floralFusion,
    cardBackgroundColor: '#EBC0BE',
    scentFamily: 'Floral',
    gender: 'Women',
    badge: 'Floral',
  }),
  createProduct({
    id: 'p-voice-of-heart',
    name: 'VOICE OF HEART',
    slug: 'voice-of-heart',
    image: productImages.voiceOfHeart,
    cardHoverImage: productImages.voiceOfHeart,
    cardBackgroundColor: '#D7A35B',
    scentFamily: 'Spicy',
    badge: 'Signature',
  }),
  createProduct({
    id: 'p-pitch-black',
    name: 'PITCH BLACK',
    slug: 'pitch-black',
    image: productImages.pitchBlack,
    cardHoverImage: productImages.pitchBlack,
    cardBackgroundColor: '#4A3026',
    scentFamily: 'Woody',
    gender: 'Men',
    badge: 'Intense',
  }),
  createProduct({
    id: 'p-baraan',
    name: 'BARAAN',
    slug: 'baraan',
    image: productImages.baraan,
    cardHoverImage: productImages.baraan,
    cardBackgroundColor: '#F3E8D5',
    scentFamily: 'Fresh',
    gender: 'Men',
    badge: 'Office',
  }),
  createProduct({
    id: 'p-change',
    name: 'CHANGE',
    slug: 'change',
    image: productImages.change,
    cardHoverImage: productImages.change,
    cardBackgroundColor: '#C7AE96',
    scentFamily: 'Citrus',
    gender: 'Men',
    badge: 'Bold',
  }),
  createProduct({
    id: 'p-crimson-crystal',
    name: 'CRIMSON CRYSTAL',
    slug: 'crimson-crystal',
    image: productImages.crimsonCrystal,
    cardImage: crimsonCrystalTransparent,
    cardHoverImage: productImages.crimsonCrystal,
    cardBackgroundColor: '#E7C78F',
    scentFamily: 'Oriental',
    gender: 'Unisex',
    badge: 'Best Seller',
  }),
]
