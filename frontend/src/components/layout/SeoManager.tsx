import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useStorefront } from '../../storefront/StorefrontProvider'

export function SeoManager() {
  const location = useLocation()
  const { seo } = useStorefront()

  useEffect(() => {
    const current =
      seo.find((entry) => entry.slug === location.pathname) ??
      seo.find((entry) => entry.slug === '/')

    if (!current) return

    const title = String(current.seoTitle ?? current.ogTitle ?? 'Royal Fusion')
    const description = String(current.metaDescription ?? current.ogDescription ?? '')

    document.title = title
    setMeta('description', description)
    setMeta('og:title', String(current.ogTitle ?? title), 'property')
    setMeta('og:description', String(current.ogDescription ?? description), 'property')
    if (current.ogImage) setMeta('og:image', String(current.ogImage), 'property')
  }, [location.pathname, seo])

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
