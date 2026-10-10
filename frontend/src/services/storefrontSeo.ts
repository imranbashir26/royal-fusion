import type { StorefrontData } from '../types/admin'

export const staticSeoPaths = ['/', '/shop', '/collections', '/attars', '/about', '/contact']
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
  // Editorial fields come exclusively from Sanity's existing document projection.
  const title = domain?.seoTitle || String(base?.seoTitle || 'Royal Fusion | Luxury Perfumes in Pakistan')
  const description = domain?.seoDescription || String(base?.metaDescription || '')
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
