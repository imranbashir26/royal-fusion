/** Public blog DTOs. No SDK, credentials, custom publication status or commerce fields. */
export interface BlogIdentity {
  id: string
  slug: string
  title: string
  excerpt: string
  publishedAt: string
}

export interface BlogAuthor { id: string; name: string; bio: string | null }
export interface BlogCategory { id: string; title: string; slug: string; description: string | null }
export interface BlogImage {
  asset: { _type: 'reference'; _ref: string; url: string; width: number; height: number }
  alt: string
  crop: { top: number; bottom: number; left: number; right: number } | null
  hotspot: { x: number; y: number; width: number; height: number } | null
  caption: string | null
}

export interface BlogTextBlock {
  _type: 'block'
  _key: string
  style: 'normal' | 'h2' | 'h3' | 'blockquote'
  children: Array<{ _type: 'span'; _key: string; text: string; marks: string[] }>
  markDefs: Array<{ _type: 'link'; _key: string; href: string }>
  listItem?: 'bullet' | 'number'
  level?: number
}
export interface BlogImageBlock extends BlogImage { _type: 'image'; _key: string }
export type BlogBody = Array<BlogTextBlock | BlogImageBlock>

export interface BlogSeo {
  title: string | null
  description: string | null
  canonicalUrl: string
  noIndex: boolean
  ogImage: BlogImage | null
}
export interface BlogSummary extends BlogIdentity {
  updatedAt: string
  /** Optional editorial text; never an estimated duration. */
  readTime?: string
  author: BlogAuthor
  category: BlogCategory
  featuredImage: BlogImage
  tags: string[]
  seo: BlogSeo
}
export interface BlogArticle extends BlogSummary { body: BlogBody }
export interface BlogListInput { page?: number; pageSize?: number }
export interface BlogPagination { page: number; pageSize: number; total: number; totalPages: number }
export interface BlogListResult { items: BlogSummary[]; pagination: BlogPagination }
export interface BlogRepository {
  list(input?: BlogListInput): Promise<BlogListResult>
  getBySlug(slug: string): Promise<BlogArticle | null>
  /** Complete bounded published read; absence means sitemap enumeration is unavailable. */
  snapshotArticles?(): Promise<BlogArticle[]>
}
/** An eventual published-perspective adapter must page and count before returning results. */
export interface BlogSource {
  listPublished(input: { offset: number; limit: number; order: readonly ['publishedAt desc', '_id asc'] }): Promise<{ documents: unknown[]; total: number }>
  getPublishedBySlug(slug: string): Promise<unknown | null>
  /** Count and full documents from one query, never a stitched set of mutable pages. */
  snapshotPublished?(): Promise<{ documents: unknown[]; total: number }>
}
export interface BlogListResponse { data: BlogSummary[]; pagination: BlogPagination }
export interface BlogDetailResponse { data: BlogArticle }
export type BlogErrorCode = 'INVALID_BLOG_REQUEST' | 'BLOG_NOT_FOUND' | 'BLOGS_UNAVAILABLE'
export interface BlogErrorResponse { error: { code: BlogErrorCode; message: string; requestId?: string } }
