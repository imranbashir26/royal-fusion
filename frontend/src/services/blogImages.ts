import { createImageUrlBuilder } from '@sanity/image-url'
import type { BlogImage } from '../../../shared/contracts/blogV1'

export interface BlogMediaConfiguration { projectId: '6n1y88j4'; dataset: 'production' }
export function validateBlogMediaConfiguration(value: BlogMediaConfiguration) {
  if (value.projectId !== '6n1y88j4' || value.dataset !== 'production') throw new TypeError('Blog configuration is invalid.')
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Article image is invalid.')
  return value as Record<string, unknown>
}
function fraction(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new TypeError('Article image is invalid.')
  return value
}
function dimension(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new TypeError('Article image is invalid.')
  return value
}
/** Validate and project the approved DTO, including its configured asset namespace. */
export function projectBlogImage(value: unknown, configuration: BlogMediaConfiguration): BlogImage {
  validateBlogMediaConfiguration(configuration)
  const image = object(value), asset = object(image.asset)
  if (asset._type !== 'reference' || typeof asset._ref !== 'string' || !/^image-[A-Za-z0-9]+-\d+x\d+-[a-z0-9]+$/.test(asset._ref)
    || typeof asset.url !== 'string' || /[<>\s]/.test(asset.url)) throw new TypeError('Article image is invalid.')
  const url = new URL(asset.url)
  const filename = asset._ref.slice(6).replace(/-([a-z0-9]+)$/, '.$1')
  const width = dimension(asset.width), height = dimension(asset.height)
  if (url.origin !== 'https://cdn.sanity.io' || url.username || url.password || url.search || url.hash
    || url.pathname !== `/images/${configuration.projectId}/${configuration.dataset}/${filename}`
    || !asset._ref.includes(`-${width}x${height}-`)) throw new TypeError('Article image is invalid.')
  if (typeof image.alt !== 'string' || !image.alt.trim() || image.alt.length > 160
    || !(image.caption === null || typeof image.caption === 'string' && image.caption.length <= 300)) throw new TypeError('Article image is invalid.')
  let crop: BlogImage['crop'] = null, hotspot: BlogImage['hotspot'] = null
  if (image.crop !== null) {
    const source = object(image.crop)
    crop = { top: fraction(source.top), bottom: fraction(source.bottom), left: fraction(source.left), right: fraction(source.right) }
    if (crop.top + crop.bottom >= 1 || crop.left + crop.right >= 1) throw new TypeError('Article image is invalid.')
  }
  if (image.hotspot !== null) {
    const source = object(image.hotspot)
    hotspot = { x: fraction(source.x), y: fraction(source.y), width: fraction(source.width), height: fraction(source.height) }
    if (!hotspot.width || !hotspot.height || hotspot.x - hotspot.width / 2 < 0 || hotspot.x + hotspot.width / 2 > 1
      || hotspot.y - hotspot.height / 2 < 0 || hotspot.y + hotspot.height / 2 > 1) throw new TypeError('Article image is invalid.')
  }
  return { asset: { _type: 'reference', _ref: asset._ref, url: url.href, width, height }, alt: image.alt, caption: image.caption, crop, hotspot }
}

/** URL construction only: no Sanity client, credentials or network operations. */
export function blogImageUrl(value: BlogImage, configuration: BlogMediaConfiguration, width: number, height?: number) {
  const image = projectBlogImage(value, configuration)
  if (!Number.isInteger(width) || width < 1 || width > 2400 || height !== undefined && (!Number.isInteger(height) || height < 1 || height > 2400)) {
    throw new TypeError('Article image is invalid.')
  }
  let builder = createImageUrlBuilder(configuration).image({ asset: { _ref: image.asset._ref },
    ...(image.crop ? { crop: image.crop } : {}), ...(image.hotspot ? { hotspot: image.hotspot } : {}),
  }).width(width).auto('format')
  if (height !== undefined) builder = builder.height(height)
  return builder.url()
}
