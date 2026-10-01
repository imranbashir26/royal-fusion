import { categories } from '../data/categories'
import { collections } from '../data/collections'
import { products } from '../data/products'
import type { StorefrontData } from '../types/admin'
import { apiClient } from './apiClient'
import { catalogFallback, normalizePrototypeProducts, prototypeCatalogFallback } from './catalogFallback'
import { collectionFallback, prototypeCollectionFallback } from './collectionFallback'
import { getPublicFinderPreferences } from './fragranceFinderService'
import { mergeStorefrontData } from './productionMappers'
import { mapPublicSettingsRows } from './publicSettingsMapper'
import { getPublicReviews } from './publicReviewsService'
import { withApprovedReviewRatings } from './reviewAggregation'
import { sanityContentService } from './sanityContentService'
import { supabaseStorefrontService } from './supabaseStorefrontService'
import { isSupabaseConfigured } from './supabaseClient'
import type { CatalogLoad, StorefrontLoad } from './catalogRefresh'

export const fallbackStorefrontData: StorefrontData = {
  products: withApprovedReviewRatings(catalogFallback(import.meta.env.PROD, products), []),
  categories: catalogFallback(import.meta.env.PROD, categories),
  collections: collectionFallback(import.meta.env.PROD, collections),
  finderPreferences: [],
  blogs: [],
  reviews: [],
  testimonials: [],
  banners: [],
  settings: {
    brandName: 'Royal Fusion',
    logo: '/assets/brand/logo.png',
    favicon: '/favicon.svg',
    currency: 'PKR',
    whatsappNumber: '',
    phoneNumber: '',
    emailAddress: '',
    businessAddress: '',
    instagramLink: '',
    facebookLink: '',
    tiktokLink: '',
    youtubeLink: '',
    footerDescription:
      'Premium fragrance impressions, attars, and gift-ready perfume experiences made for elegance, confidence, and lasting presence.',
    copyrightText: 'Royal Fusion. All rights reserved.',
    announcementEnabled: true,
    announcementText: 'Free nationwide shipping on orders above PKR 7,000',
    announcementCtaLabel: 'Shop Now',
    announcementCtaUrl: '/shop',
    googleMapsUrl: '',
  },
  homepage: {
    heroEyebrow: 'THE ROYAL COLLECTION',
    heroHeading: 'Leave a Lasting\nImpression.',
    heroSubtitle:
      'Distinctive fragrances crafted for confidence, character, and moments worth remembering.',
    heroImage: '',
    heroImageAlt: 'Royal Fusion luxury perfume bottle campaign presentation',
    primaryCtaText: 'Shop Collection',
    primaryCtaLink: '/collections',
    secondaryCtaText: 'Explore Best Sellers',
    secondaryCtaLink: '/shop?best=true',
  },
  shipping: {
    defaultShippingFee: 250,
    freeShippingAbove: 7000,
  },
  payments: [
    { id: 'pay-cod', name: 'Cash on Delivery', active: true },
    { id: 'pay-bank', name: 'Bank Transfer', active: true },
  ],
  seo: [],
  editablePages: [],
}

export const storefrontService = {
  async getStorefrontData(): Promise<StorefrontLoad> {
    const productionConfigured = isSupabaseConfigured()
    let catalogLoad: CatalogLoad = { status: 'failed', error: 'Canonical catalog is not configured.' }
    const canonicalPromise = supabaseStorefrontService.getStorefrontData().then((data) => {
      if (data) catalogLoad = { status: 'success' }
      return data
    }).catch(() => {
      catalogLoad = { status: 'failed', error: 'Unable to load the product catalog. Please try again.' }
      return null
    })
    const productionSettings = productionConfigured
      ? await supabaseStorefrontService.getSettings().catch(() => {
          console.warn('Public Supabase settings unavailable; using safe public defaults.')
          return mapPublicSettingsRows([])
        })
      : null
    const sanityBlogsPromise = sanityContentService.getBlogs().catch((error) => {
      console.warn('Published Sanity blogs unavailable.', error)
      return null
    })
    const finderPreferencesPromise = getPublicFinderPreferences().catch(() => [])
    const reviewsPromise = getPublicReviews().catch(() => [])

    try {
      const [supabaseData, sanityHomepage, sanityBlogs, sanityBanners, finderPreferences, publicReviews] = await Promise.all([
        canonicalPromise,
        sanityContentService.getHomepage().catch(() => null),
        sanityBlogsPromise,
        sanityContentService.getBanners().catch(() => null),
        finderPreferencesPromise,
        reviewsPromise,
      ])

      if (supabaseData || sanityHomepage || sanityBlogs || sanityBanners) {
        const merged = mergeStorefrontData(fallbackStorefrontData, {
          ...(supabaseData ?? {}),
          finderPreferences,
          reviews: publicReviews,
          testimonials: [],
          ...(productionSettings ?? {}),
          homepage: { ...(sanityHomepage ?? {}), ...(productionSettings?.homepage ?? {}) },
          blogs: sanityBlogs ?? [],
          ...(sanityBanners ? { banners: sanityBanners } : {}),
        })
        return { ...merged, catalogLoad, products: withApprovedReviewRatings(merged.products, publicReviews) }
      }
    } catch (error) {
      console.warn('Production storefront services unavailable. Falling back to local API.', error)
    }

    const sanityBlogs = await sanityBlogsPromise
    const finderPreferences = await finderPreferencesPromise
    const publicReviews = await reviewsPromise
    try {
      const prototype = await apiClient.request<StorefrontData>('/public/storefront')
      const fallbackSettings = mapPublicSettingsRows([
        { key: 'settings', value: prototype.settings },
        { key: 'shipping', value: prototype.shipping },
        { key: 'payments', value: prototype.payments },
      ])
      const merged = mergeStorefrontData(fallbackStorefrontData, {
        ...prototype,
        products: prototypeCatalogFallback(import.meta.env.PROD, normalizePrototypeProducts(prototype.products), products),
        categories: catalogFallback(import.meta.env.PROD, categories),
        collections: prototypeCollectionFallback(import.meta.env.PROD, prototype.collections, collections),
        finderPreferences,
        reviews: publicReviews,
        testimonials: [],
        ...(productionSettings ?? fallbackSettings),
        homepage: { ...prototype.homepage, ...(productionSettings?.homepage ?? {}) },
        blogs: sanityBlogs ?? [],
      })
      return { ...merged, catalogLoad, products: withApprovedReviewRatings(merged.products, publicReviews) }
    } catch {
      console.warn('Prototype storefront unavailable; using bundled storefront data.')
      const merged = mergeStorefrontData(fallbackStorefrontData, {
        ...(productionSettings ?? {}),
        homepage: { ...fallbackStorefrontData.homepage, ...(productionSettings?.homepage ?? {}) },
        finderPreferences,
        reviews: publicReviews,
        testimonials: [],
        blogs: sanityBlogs ?? [],
      })
      return { ...merged, catalogLoad, products: withApprovedReviewRatings(merged.products, publicReviews) }
    }
  },
}
