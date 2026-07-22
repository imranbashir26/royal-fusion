import { blogs } from '../data/blogs'
import { categories } from '../data/categories'
import { products } from '../data/products'
import { reviews } from '../data/reviews'
import type { StorefrontData } from '../types/admin'
import { apiClient } from './apiClient'
import { mergeStorefrontData } from './productionMappers'
import { sanityContentService } from './sanityContentService'
import { supabaseStorefrontService } from './supabaseStorefrontService'

export const fallbackStorefrontData: StorefrontData = {
  products,
  categories,
  blogs,
  reviews,
  testimonials: reviews.map((review) => ({
    id: review.id,
    name: review.name,
    city: review.city,
    rating: review.rating,
    product: review.product,
    text: review.text,
    featured: true,
    status: 'Approved',
  })),
  banners: [],
  settings: {
    brandName: 'Royal Fusion',
    logo: '/assets/brand/logo.png',
    favicon: '/favicon.svg',
    currency: 'PKR',
    whatsappNumber: '+923000000000',
    phoneNumber: '+92 300 0000000',
    emailAddress: 'hello@royalfusion.pk',
    businessAddress: 'Karachi, Pakistan',
    instagramLink: '#',
    facebookLink: '#',
    tiktokLink: '#',
    youtubeLink: '#',
    footerDescription:
      'Premium fragrance impressions, attars, and gift-ready perfume experiences made for elegance, confidence, and lasting presence.',
    copyrightText: 'Royal Fusion. Luxury perfume eCommerce prototype.',
    contactReceiverEmail: 'hello@royalfusion.pk',
    announcementEnabled: false,
    announcementText: '',
  },
  homepage: {},
  shipping: {
    defaultShippingFee: 250,
    freeShippingAbove: 7000,
  },
  payments: [
    { id: 'pay-cod', name: 'Cash on Delivery', active: true },
    { id: 'pay-bank', name: 'Bank Transfer', active: true },
    { id: 'pay-card', name: 'Card', active: true },
  ],
  seo: [],
  editablePages: [],
}

export const storefrontService = {
  async getStorefrontData() {
    try {
      const [supabaseData, sanityHomepage, sanityBlogs, sanityBanners] = await Promise.all([
        supabaseStorefrontService.getStorefrontData(),
        sanityContentService.getHomepage(),
        sanityContentService.getBlogs(),
        sanityContentService.getBanners(),
      ])

      if (supabaseData || sanityHomepage || sanityBlogs || sanityBanners) {
        return mergeStorefrontData(fallbackStorefrontData, {
          ...(supabaseData ?? {}),
          ...(sanityHomepage ? { homepage: sanityHomepage } : {}),
          ...(sanityBlogs ? { blogs: sanityBlogs } : {}),
          ...(sanityBanners ? { banners: sanityBanners } : {}),
        })
      }
    } catch (error) {
      console.warn('Production storefront services unavailable. Falling back to local API.', error)
    }

    try {
      return await apiClient.request<StorefrontData>('/public/storefront')
    } catch {
      return fallbackStorefrontData
    }
  },
}
