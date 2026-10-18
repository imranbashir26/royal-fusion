import type { StorefrontData } from '../types/admin'
import type { BlogRouteState } from '../blog/PublicBlogProvider'
import { blogImageUrl } from './blogImages'
import { isPublicBlogSlug, publicBlogSearchInput, validatePublicBlogConfiguration, type PublicBlogConfiguration } from './publicBlogsApi'

export const staticSeoPaths = ['/', '/shop', '/collections', '/attars', '/about', '/contact', '/privacy-policy', '/terms-and-conditions', '/shipping-policy', '/returns-refunds']
const defaultPolicySeo: Record<string, { title: string; description: string }> = {
  '/privacy-policy': {
    title: 'Privacy Policy | Royal Fusion',
    description: 'Learn how Royal Fusion protects customer personal information, order data, and privacy in Pakistan.',
  },
  '/terms-and-conditions': {
    title: 'Terms and Conditions | Royal Fusion',
    description: 'Read the official terms and conditions for ordering luxury perfumes and attars from Royal Fusion.',
  },
  '/shipping-policy': {
    title: 'Shipping & Delivery Policy | Royal Fusion',
    description: 'Nationwide delivery across Pakistan, flat PKR 200 standard shipping, and free delivery on orders strictly over PKR 5,000.',
  },
  '/returns-refunds': {
    title: 'Returns, Refunds & Exchanges | Royal Fusion',
    description: 'Royal Fusion 15-day return and exchange policy for eligible fragrances with 97–98% perfume remaining.',
  },
}
function https(value: unknown) {
  if (typeof value !== 'string') return ''
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !/[<>\s]/.test(value) ? url.href : '' } catch { return '' }
}
export function mapPublicSeoRows(rows: Array<Record<string, unknown>>) {
  return rows.filter(row => row.active === true && staticSeoPaths.includes(String(row.route_path))).map(row => ({
    slug: String(row.route_path), seoTitle: String(row.title ?? ''), metaDescription: String(row.description ?? ''),
    canonicalUrl: https(row.canonical_url), robots: String(row.robots || 'index,follow'),
    ogTitle: String(row.og_title ?? ''), ogDescription: String(row.og_description ?? ''), ogImage: https(row.og_image_secure_url),
  }))
}
export function resolveStorefrontSeo(path: string, search: string, data: Pick<StorefrontData, 'seo' | 'products' | 'blogs' | 'categories' | 'collections'>, origin: string) {
  const exact = data.seo.find(row => row.slug === path), base = exact ?? data.seo.find(row => row.slug === '/')
  const params = new URLSearchParams(search)
  const product = path.startsWith('/product/') ? data.products.find(row => path === `/product/${row.slug}`) : undefined
  const blog = path.startsWith('/blogs/') ? data.blogs.find(row => path === `/blogs/${row.slug}`) : undefined
  const collectionSlug = params.get('collection')?.replace(/^royal-collection$/, 'royal-fusion-originals')
  const collection = path === '/shop' && collectionSlug ? data.collections?.find(row => row.slug.replace(/^royal-collection$/, 'royal-fusion-originals') === collectionSlug) : undefined
  const category = path === '/shop' && params.get('category') ? data.categories.find(row => row.name === params.get('category') || row.slug === params.get('category')) : undefined
  const domain = product ?? blog ?? collection ?? category
  const policyMeta = defaultPolicySeo[path]
  // Editorial fields come exclusively from Sanity's existing document projection.
  const title = domain?.seoTitle || policyMeta?.title || String(exact?.seoTitle || base?.seoTitle || 'Royal Fusion | Luxury Perfumes in Pakistan')
  const description = domain?.seoDescription || policyMeta?.description || String(exact?.metaDescription || base?.metaDescription || '')
  const configured = https(exact?.canonicalUrl)
  const fallbackCanonical = new URL(origin)
  fallbackCanonical.pathname = path; fallbackCanonical.search = ''; fallbackCanonical.hash = ''
  const configuredUrl = configured ? new URL(configured) : null
  // The caller supplies the storefront origin; stored metadata cannot authorize another host.
  const canonical = configuredUrl && configuredUrl.origin === fallbackCanonical.origin
    && configuredUrl.pathname === path && !configuredUrl.search && !configuredUrl.hash
    ? configured : fallbackCanonical.href
  return { title, description, canonical, robots: String(exact?.robots || 'index,follow'),
    ogTitle: domain?.seoTitle || String(base?.ogTitle || title), ogDescription: domain?.seoDescription || String(base?.ogDescription || description),
    ogImage: https(product?.image || blog?.image || base?.ogImage) }
}

/** Fixture-enabled editorial metadata uses only the explicitly approved origin. */
export function resolvePublicBlogSeo(path: string, state: BlogRouteState, configuration: PublicBlogConfiguration, search = '') {
  const approved = validatePublicBlogConfiguration(configuration)
  const listing = /^\/blogs\/?$/.test(path)
  let slug = ''
  try { const match = /^\/blogs\/([^/]+)\/?$/.exec(path); if (match) slug = decodeURIComponent(match[1]) } catch { /* Invalid article path. */ }
  const candidate = state.status === 'ready' && state.data?.slug === slug ? state.data : undefined
  const url = new URL(listing ? '/blogs' : isPublicBlogSlug(slug) ? `/blogs/${slug}` : '/blogs', approved.canonicalOrigin)
  let valid = listing || isPublicBlogSlug(slug)
  try {
    if (listing) {
      const input = publicBlogSearchInput(new URLSearchParams(search))
      if (input.page > 1) url.searchParams.set('page', String(input.page))
      if (input.pageSize !== 20) url.searchParams.set('pageSize', String(input.pageSize))
    } else if (search) valid = false
  } catch { valid = false }
  const failed = ['invalid', 'not-found', 'unavailable', 'rate-limited'].includes(state.status)
  const beyondEnd = listing && state.status === 'empty' && url.searchParams.has('page')
  const canonical = valid && !failed && !beyondEnd ? url.href : ''
  const article = valid && !failed ? candidate : undefined
  if (article && article.seo.canonicalUrl !== canonical) throw new TypeError('Article metadata is invalid.')
  const title = article ? article.seo.title || article.title : listing ? `Royal Fusion Journal${url.searchParams.has('page') ? ` | Page ${url.searchParams.get('page')}` : ''}` : 'Royal Fusion Journal | Article'
  const description = article ? article.seo.description || article.excerpt : listing && valid && !failed ? 'Stories, education and fragrance insights from Royal Fusion.' : ''
  const image = article?.seo.ogImage ?? article?.featuredImage
  return { title, description, canonical, robots: article ? article.seo.noIndex ? 'noindex,follow' : 'index,follow'
    : listing && valid && state.status === 'ready' ? 'index,follow' : 'noindex,follow',
    ogTitle: title, ogDescription: description, ogImage: image ? blogImageUrl(image, approved, 1200, 630) : '' }
}
