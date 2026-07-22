import type { BlogPost } from '../types'
import type { Banner } from '../types/admin'
import { mapSanityBanner, mapSanityBlog } from './productionMappers'
import { getSanityClient } from './sanityClient'

const blogFields = `{
  _id,
  title,
  "slug": slug.current,
  excerpt,
  "image": featuredImage.asset->url,
  imageAlt,
  "category": category->title,
  "author": author->name,
  tags,
  readTime,
  publishedAt,
  body,
  seoTitle,
  seoDescription
}`

export const sanityContentService = {
  async getBlogs(): Promise<BlogPost[] | null> {
    const client = getSanityClient()
    if (!client) return null
    const data = await client.fetch<Array<Record<string, unknown>>>(
      `*[_type == "blogPost" && status == "Published"] | order(publishedAt desc) ${blogFields}`,
    )
    return data.map(mapSanityBlog)
  },

  async getBlogBySlug(slug: string): Promise<BlogPost | null> {
    const client = getSanityClient()
    if (!client) return null
    const data = await client.fetch<Record<string, unknown> | null>(
      `*[_type == "blogPost" && status == "Published" && slug.current == $slug][0] ${blogFields}`,
      { slug },
    )
    return data ? mapSanityBlog(data) : null
  },

  async getHomepage(): Promise<Record<string, unknown> | null> {
    const client = getSanityClient()
    if (!client) return null
    return client.fetch<Record<string, unknown> | null>(`*[_type == "homepage"][0] {
      heroHeading,
      heroSubtitle,
      "heroImage": heroImage.asset->url,
      primaryCtaText,
      primaryCtaLink,
      secondaryCtaText,
      secondaryCtaLink,
      collectionTitle,
      collectionCopy,
      giftTitle,
      giftCopy,
      newsletterTitle,
      newsletterCopy,
      featuredProductSlugs,
      featuredCategorySlugs
    }`)
  },

  async getBanners(): Promise<Banner[] | null> {
    const client = getSanityClient()
    if (!client) return null
    const data = await client.fetch<Array<Record<string, unknown>>>(`*[
      _type == "banner"
      && enabled == true
      && (!defined(startDate) || startDate <= now())
      && (!defined(endDate) || endDate >= now())
    ] {
      _id,
      title,
      subtitle,
      "image": image.asset->url,
      imageAlt,
      ctaText,
      ctaLink,
      position,
      startDate,
      endDate
    }`)
    return data.map(mapSanityBanner)
  },
}
