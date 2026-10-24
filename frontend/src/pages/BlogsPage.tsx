import { BlogNavigationLink } from '../components/blog/BlogNavigationLink'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BlogCard, PublicBlogCard } from '../components/blog/BlogCard'
import { PageHeader } from '../components/common/PageHeader'
import { useStorefront } from '../storefront/StorefrontProvider'
import { usePublicBlogIntegration, usePublicBlogList } from '../blog/PublicBlogProvider'
import { publicBlogSearchInput } from '../services/publicBlogsApi'
import { BlogState } from '../components/blog/BlogState'

export function BlogsPage() {
  const integration = usePublicBlogIntegration()
  return integration.enabled ? <PublicBlogsPage /> : <LegacyBlogsPage />
}

function PublicBlogsPage() {
  const [search] = useSearchParams()
  const input = useMemo(() => {
    try { return publicBlogSearchInput(search) } catch { return { page: Number.NaN, pageSize: 20 } }
  }, [search])
  const { state, revalidate } = usePublicBlogList(input)
  const pagination = state.data?.pagination
  return <>
    <PageHeader description="Stories, education and fragrance insights from Royal Fusion." eyebrow="Blogs" title="Royal Fusion Journal" />
    <section className="container-lux py-12 md:py-16">
      {state.status === 'ready' ? <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        {state.data?.data.map(blog => <PublicBlogCard blog={blog} key={blog.id} />)}
      </div> : <BlogState status={state.status} retry={revalidate} />}
      {pagination && pagination.totalPages > 0 && <nav aria-label="Journal pagination" className="mt-8 flex items-center justify-center gap-5">
        {pagination.page > 1 && <BlogNavigationLink to={`/blogs?page=${Math.min(pagination.page - 1, pagination.totalPages)}&pageSize=${pagination.pageSize}`}>Previous page</BlogNavigationLink>}
        <span>Page {pagination.page} of {pagination.totalPages}</span>
        {pagination.page < pagination.totalPages && <BlogNavigationLink to={`/blogs?page=${pagination.page + 1}&pageSize=${pagination.pageSize}`}>Next page</BlogNavigationLink>}
      </nav>}
      {state.status === 'ready' && <button className="mt-6 font-semibold text-burgundy underline" onClick={revalidate} type="button">Refresh articles</button>}
    </section>
  </>
}

function LegacyBlogsPage() {
  const { blogs } = useStorefront()

  return (
    <>
      <PageHeader
        description="SEO-ready fragrance education for luxury perfumes, oud, attars, daily notes, and choosing a signature scent."
        eyebrow="Blogs"
        title="Royal Fusion Journal"
      />
      <section className="container-lux py-12 md:py-16">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {blogs.map((blog) => (
            <BlogCard blog={blog} key={blog.id} />
          ))}
        </div>
      </section>
    </>
  )
}
