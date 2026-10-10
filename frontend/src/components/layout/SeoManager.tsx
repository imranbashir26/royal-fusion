import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useStorefront } from '../../storefront/StorefrontProvider'
import { resolveStorefrontSeo, resolvePublicBlogSeo } from '../../services/storefrontSeo'
import { usePublicBlogIntegration } from '../../blog/PublicBlogProvider'

export function SeoManager() {
  const location = useLocation()
  const { seo, products, categories, collections, blogs } = useStorefront()
  const integration = usePublicBlogIntegration()

  useEffect(() => {
    const metadata = integration.enabled && integration.client && /^\/blogs(?:\/|$)/.test(location.pathname)
      ? resolvePublicBlogSeo(location.pathname, integration.metadata, integration.client.configuration)
      : resolveStorefrontSeo(location.pathname, location.search, { seo, products, categories, collections, blogs }, window.location.origin)
    document.title = metadata.title
    setMeta('description', metadata.description)
    setMeta('og:title', metadata.ogTitle, 'property')
    setMeta('og:description', metadata.ogDescription, 'property')
    setMeta('robots', metadata.robots)
    if (metadata.ogImage) setMeta('og:image', metadata.ogImage, 'property')
    else document.head.querySelector('meta[property="og:image"]')?.remove()
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical) }
    canonical.href = metadata.canonical
  }, [location.pathname, location.search, seo, products, categories, collections, blogs, integration])

  return null
}

function setMeta(name: string, content: string, attribute: 'name' | 'property' = 'name') {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${name}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, name)
    document.head.appendChild(element)
  }
  element.content = content
}
