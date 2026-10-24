import { createImageUrlBuilder } from '@sanity/image-url'

const invalid = () => new TypeError('Article image is invalid.')
/** @param {unknown} value @returns {Record<string, unknown>} */
const object = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  return /** @type {Record<string, unknown>} */ (value)
}
/** @param {unknown} value */
const fraction = value => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw invalid()
  return value
}
/** @param {unknown} value */
const dimension = value => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw invalid()
  return value
}

/** Same public media namespace and geometry rules as frontend blogImages.ts.
 * @param {{projectId: string, dataset: string}} configuration */
export function validateBlogHtmlMediaConfiguration(configuration) {
  if (configuration?.projectId !== '6n1y88j4' || configuration?.dataset !== 'production') throw invalid()
}

/** Allowlist the DTO; private asset metadata is never returned.
 * @param {unknown} value @param {{projectId: string, dataset: string}} configuration
 * @returns {import('../../../shared/contracts/blogV1.js').BlogImage} */
export function projectBlogHtmlImage(value, configuration) {
  validateBlogHtmlMediaConfiguration(configuration)
  const image = object(value), asset = object(image.asset)
  if (asset._type !== 'reference' || typeof asset._ref !== 'string' || asset._ref.length > 128
    || !/^image-[A-Za-z0-9]+-\d+x\d+-[a-z0-9]+$/.test(asset._ref)
    || typeof asset.url !== 'string' || asset.url.length > 2048 || /[<>\s]/.test(asset.url)) throw invalid()
  const url = new URL(asset.url), filename = asset._ref.slice(6).replace(/-([a-z0-9]+)$/, '.$1')
  const width = dimension(asset.width), height = dimension(asset.height)
  if (url.origin !== 'https://cdn.sanity.io' || url.username || url.password || url.search || url.hash
    || url.pathname !== `/images/${configuration.projectId}/${configuration.dataset}/${filename}`
    || !asset._ref.includes(`-${width}x${height}-`)) throw invalid()
  if (typeof image.alt !== 'string' || !image.alt.trim() || image.alt.length > 160
    || !(image.caption === null || typeof image.caption === 'string' && image.caption.length <= 300)) throw invalid()
  /** @type {import('../../../shared/contracts/blogV1.js').BlogImage['crop']} */
  let crop = null
  /** @type {import('../../../shared/contracts/blogV1.js').BlogImage['hotspot']} */
  let hotspot = null
  if (image.crop !== null) {
    const source = object(image.crop)
    crop = { top: fraction(source.top), bottom: fraction(source.bottom), left: fraction(source.left), right: fraction(source.right) }
    if (crop.top + crop.bottom >= 1 || crop.left + crop.right >= 1) throw invalid()
  }
  if (image.hotspot !== null) {
    const source = object(image.hotspot)
    hotspot = { x: fraction(source.x), y: fraction(source.y), width: fraction(source.width), height: fraction(source.height) }
    if (!hotspot.width || !hotspot.height || hotspot.x - hotspot.width / 2 < 0 || hotspot.x + hotspot.width / 2 > 1
      || hotspot.y - hotspot.height / 2 < 0 || hotspot.y + hotspot.height / 2 > 1) throw invalid()
  }
  return { asset: { _type: 'reference', _ref: asset._ref, url: url.href, width, height }, alt: image.alt,
    caption: /** @type {string|null} */ (image.caption), crop, hotspot }
}

/** URL construction only: no SDK client, asset download or credentials.
 * @param {unknown} value @param {{projectId: string, dataset: string}} configuration
 * @param {number} width @param {number} [height] */
export function blogHtmlImageUrl(value, configuration, width, height) {
  const image = projectBlogHtmlImage(value, configuration)
  if (!Number.isInteger(width) || width < 1 || width > 2400
    || height !== undefined && (!Number.isInteger(height) || height < 1 || height > 2400)) throw invalid()
  let builder = createImageUrlBuilder(configuration).image({ asset: { _ref: image.asset._ref },
    ...(image.crop ? { crop: image.crop } : {}), ...(image.hotspot ? { hotspot: image.hotspot } : {}),
  }).width(width).auto('format')
  if (height !== undefined) builder = builder.height(height)
  const url = new URL(builder.url()), original = new URL(image.asset.url)
  const parameters = new Set(['w', 'h', 'auto', 'rect', 'fit', 'crop', 'fp-x', 'fp-y'])
  if (url.origin !== original.origin || url.pathname !== original.pathname || url.username || url.password || url.hash
    || [...url.searchParams.keys()].some(key => !parameters.has(key) || url.searchParams.getAll(key).length !== 1)) throw invalid()
  return url.href
}
