import type { BlogArticle, BlogBody, BlogDetailResponse, BlogImage, BlogListInput, BlogListResponse, BlogSummary } from '../../../shared/contracts/blogV1'
import { API_BASE_URL } from './apiClient'
import { projectBlogImage, validateBlogMediaConfiguration, type BlogMediaConfiguration } from './blogImages'

export type BlogFailure = 'invalid' | 'not-found' | 'rate-limited' | 'unavailable'
export class PublicBlogError extends Error {
  readonly kind: BlogFailure
  readonly status: number
  constructor(kind: BlogFailure, status = 0) {
    super({ invalid: 'Blog request is invalid.', 'not-found': 'Article not found.',
      'rate-limited': 'Too many article requests. Please try again shortly.', unavailable: 'Articles are temporarily unavailable.' }[kind])
    this.kind = kind; this.status = status
  }
}
export interface PublicBlogConfiguration extends BlogMediaConfiguration { canonicalOrigin: string }
export interface PublicBlogClient {
  readonly configuration: Readonly<PublicBlogConfiguration>
  list(input?: BlogListInput, signal?: AbortSignal): Promise<BlogListResponse>
  getBySlug(slug: string, signal?: AbortSignal): Promise<BlogDetailResponse>
}
export const isPublicBlogSlug = (value: unknown): value is string => typeof value === 'string' && value.length <= 96 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
export function validatePublicBlogConfiguration(configuration: PublicBlogConfiguration): Readonly<PublicBlogConfiguration> {
  validateBlogMediaConfiguration(configuration)
  const origin = new URL(configuration.canonicalOrigin)
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || /[<>\s]/.test(configuration.canonicalOrigin)) throw new TypeError('Blog configuration is invalid.')
  return Object.freeze({ canonicalOrigin: origin.origin, projectId: configuration.projectId, dataset: configuration.dataset })
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PublicBlogError('unavailable')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number, blank = false): string {
  if (typeof value !== 'string' || value.length > max || !blank && !value.trim()) throw new PublicBlogError('unavailable')
  return value
}
const nullableText = (value: unknown, max: number) => value === null ? null : text(value, max, true)
const identity = (value: unknown) => { const id = text(value, 128); if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new PublicBlogError('unavailable'); return id }
const key = (value: unknown) => text(value, 128)
function date(value: unknown): string {
  const result = text(value, 40)
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) throw new PublicBlogError('unavailable')
  return result
}
function safeLink(value: unknown): string {
  const href = text(value, 2048)
  if (/[\s<>\\]/.test(href)) throw new PublicBlogError('unavailable')
  if (href.startsWith('/') && !href.startsWith('//')) return href
  const url = new URL(href)
  if (url.protocol !== 'https:' || url.username || url.password) throw new PublicBlogError('unavailable')
  return href
}
function canonical(value: unknown, slug: string, configuration: PublicBlogConfiguration) {
  const raw = text(value, 2048), url = new URL(raw)
  if (/[<>\s]/.test(raw) || url.origin !== configuration.canonicalOrigin || url.pathname !== `/blogs/${slug}`
    || url.username || url.password || url.search || url.hash) throw new PublicBlogError('unavailable')
  return url.href
}
function summary(value: unknown, configuration: PublicBlogConfiguration): BlogSummary {
  const row = record(value), author = record(row.author), category = record(row.category), seo = record(row.seo)
  const readTime = row.readTime == null ? undefined : text(row.readTime, 80, true).trim()
  if (!isPublicBlogSlug(row.slug) || !isPublicBlogSlug(category.slug) || typeof seo.noIndex !== 'boolean'
    || !Array.isArray(row.tags) || row.tags.length > 30) throw new PublicBlogError('unavailable')
  return {
    id: identity(row.id), slug: row.slug, title: text(row.title, 120), excerpt: text(row.excerpt, 240),
    publishedAt: date(row.publishedAt), updatedAt: date(row.updatedAt),
    ...(readTime ? { readTime } : {}),
    author: { id: identity(author.id), name: text(author.name, 100), bio: nullableText(author.bio, 1000) },
    category: { id: identity(category.id), title: text(category.title, 80), slug: category.slug, description: nullableText(category.description, 1000) },
    featuredImage: projectBlogImage(row.featuredImage, configuration), tags: row.tags.map(tag => text(tag, 80)),
    seo: { title: nullableText(seo.title, 70), description: nullableText(seo.description, 160), canonicalUrl: canonical(seo.canonicalUrl, row.slug, configuration),
      noIndex: seo.noIndex, ogImage: seo.ogImage === null ? null : projectBlogImage(seo.ogImage, configuration) },
  }
}
function body(value: unknown, configuration: PublicBlogConfiguration): BlogBody {
  if (!Array.isArray(value) || !value.length || value.length > 1000) throw new PublicBlogError('unavailable')
  const decorators = ['strong', 'em', 'code', 'underline', 'strike-through']
  const result: BlogBody = value.map(raw => {
    const node = record(raw), nodeKey = key(node._key)
    if (node._type === 'image') return { _type: 'image', _key: nodeKey, ...projectBlogImage(node, configuration) }
    if (node._type !== 'block' || !['normal', 'h2', 'h3', 'blockquote'].includes(String(node.style))
      || !Array.isArray(node.children) || !node.children.length || node.children.length > 1000
      || !Array.isArray(node.markDefs) || node.markDefs.length > 100) throw new PublicBlogError('unavailable')
    const markDefs = node.markDefs.map(rawMark => {
      const mark = record(rawMark)
      if (mark._type !== 'link') throw new PublicBlogError('unavailable')
      return { _type: 'link' as const, _key: key(mark._key), href: safeLink(mark.href) }
    })
    const children = node.children.map(rawChild => {
      const child = record(rawChild)
      if (child._type !== 'span' || !Array.isArray(child.marks) || child.marks.length > 30) throw new PublicBlogError('unavailable')
      const marks = child.marks.map(mark => key(mark))
      if (marks.some(mark => !decorators.includes(mark) && !markDefs.some(definition => definition._key === mark))) throw new PublicBlogError('unavailable')
      return { _type: 'span' as const, _key: key(child._key), text: text(child.text, 10000, true), marks }
    })
    if (new Set(markDefs.map(mark => mark._key)).size !== markDefs.length || new Set(children.map(child => child._key)).size !== children.length
      || node.listItem !== undefined && !['bullet', 'number'].includes(String(node.listItem))
      || node.level !== undefined && (node.listItem === undefined || typeof node.level !== 'number' || !Number.isInteger(node.level) || node.level < 1 || node.level > 10)) throw new PublicBlogError('unavailable')
    return { _type: 'block', _key: nodeKey, style: node.style as 'normal' | 'h2' | 'h3' | 'blockquote', children, markDefs,
      ...(node.listItem !== undefined ? { listItem: node.listItem as 'bullet' | 'number' } : {}),
      ...(node.level !== undefined ? { level: node.level as number } : {}),
    }
  })
  if (new Set(result.map(node => node._key)).size !== result.length) throw new PublicBlogError('unavailable')
  return result
}
function integer(value: unknown, max: number) {
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) value = Number(value)
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw new PublicBlogError('invalid', 400)
  return value
}
export function publicBlogListInput(value: unknown = {}): Required<BlogListInput> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PublicBlogError('invalid', 400)
  const input = record(value)
  if (Object.keys(input).some(name => !['page', 'pageSize'].includes(name))) throw new PublicBlogError('invalid', 400)
  return { page: integer(input.page === undefined ? 1 : input.page, 1000), pageSize: integer(input.pageSize === undefined ? 20 : input.pageSize, 50) }
}
export function publicBlogSearchInput(search: URLSearchParams): Required<BlogListInput> {
  if ([...search.keys()].some(name => search.getAll(name).length !== 1)) throw new PublicBlogError('invalid', 400)
  return publicBlogListInput(Object.fromEntries(search))
}
function listing(value: unknown, input: Required<BlogListInput>, configuration: PublicBlogConfiguration): BlogListResponse {
  const envelope = record(value), pagination = record(envelope.pagination)
  if (!Array.isArray(envelope.data) || envelope.data.length > input.pageSize || pagination.page !== input.page || pagination.pageSize !== input.pageSize
    || typeof pagination.total !== 'number' || !Number.isSafeInteger(pagination.total) || pagination.total < 0
    || pagination.totalPages !== Math.ceil(pagination.total / input.pageSize)
    || envelope.data.length !== Math.min(input.pageSize, Math.max(0, pagination.total - (input.page - 1) * input.pageSize))) throw new PublicBlogError('unavailable')
  const data = envelope.data.map(row => summary(row, configuration))
  if (new Set(data.map(row => row.id)).size !== data.length || new Set(data.map(row => row.slug)).size !== data.length
    || data.some((row, index) => index > 0 && (Date.parse(data[index - 1].publishedAt) < Date.parse(row.publishedAt)
      || data[index - 1].publishedAt === row.publishedAt && data[index - 1].id > row.id))) throw new PublicBlogError('unavailable')
  return { data, pagination: { page: input.page, pageSize: input.pageSize, total: pagination.total, totalPages: pagination.totalPages as number } }
}

export function createPublicBlogClient({ configuration, fetcher = fetch, baseUrl = API_BASE_URL, timeoutMs = 12000 }: {
  configuration: PublicBlogConfiguration; fetcher?: typeof fetch; baseUrl?: string; timeoutMs?: number
}): PublicBlogClient {
  const approved = validatePublicBlogConfiguration(configuration)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 15000) throw new TypeError('Blog configuration is invalid.')
  const base = baseUrl.replace(/\/+$/, '')
  if (!base.startsWith('/') || base.startsWith('//')) {
    const url = new URL(base)
    if (url.username || url.password || url.search || url.hash || /[<>\s]/.test(base)
      || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new TypeError('Blog configuration is invalid.')
  }
  if (!base.endsWith('/api') || /[?#<>\s\\]/.test(base)) throw new TypeError('Blog configuration is invalid.')
  async function request<T>(path: string, project: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) controller.abort()
    const timer = setTimeout(abort, timeoutMs)
    let onAbort: () => void = () => {}
    const interrupted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal?.aborted ? new DOMException('Request cancelled.', 'AbortError') : new PublicBlogError('unavailable'))
      controller.signal.addEventListener('abort', onAbort, { once: true })
      if (controller.signal.aborted) onAbort()
    })
    try {
      return await Promise.race([interrupted, (async () => {
        if (controller.signal.aborted) throw new DOMException('Request cancelled.', 'AbortError')
        const response = await fetcher(`${base}${path}`, { method: 'GET', credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal })
        const value: unknown = await response.json().catch(() => null)
        if (controller.signal.aborted) throw new DOMException('Request cancelled.', 'AbortError')
        if (!response.ok) {
          const code = value && typeof value === 'object' && 'error' in value && value.error && typeof value.error === 'object' && 'code' in value.error ? value.error.code : undefined
          if (response.status === 400 && code === 'INVALID_BLOG_REQUEST') throw new PublicBlogError('invalid', 400)
          if (response.status === 404 && code === 'BLOG_NOT_FOUND') throw new PublicBlogError('not-found', 404)
          throw new PublicBlogError(response.status === 429 ? 'rate-limited' : 'unavailable', response.status)
        }
        return project(value)
      })()])
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError')
      throw error instanceof PublicBlogError ? error : new PublicBlogError('unavailable')
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', onAbort)
    }
  }
  return Object.freeze({ configuration: approved,
    async list(input: BlogListInput = {}, signal?: AbortSignal) {
      const parsed = publicBlogListInput(input)
      return request(`/v1/public/blogs?page=${parsed.page}&pageSize=${parsed.pageSize}`, value => listing(value, parsed, approved), signal)
    },
    async getBySlug(slug: string, signal?: AbortSignal): Promise<BlogDetailResponse> {
      if (!isPublicBlogSlug(slug)) throw new PublicBlogError('invalid', 400)
      return request(`/v1/public/blogs/${encodeURIComponent(slug)}`, value => {
        const row = record(record(value).data), data: BlogArticle = { ...summary(row, approved), body: body(row.body, approved) }
        if (data.slug !== slug) throw new PublicBlogError('unavailable')
        return { data }
      }, signal)
    },
  })
}

export type { BlogArticle, BlogImage }
