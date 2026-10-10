import { CalendarDays } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { BlogCard, PublicBlogCard } from '../components/blog/BlogCard'
import { EmptyState } from '../components/common/EmptyState'
import { PageHeader } from '../components/common/PageHeader'
import { ProductBottle } from '../components/products/ProductBottle'
import { useStorefront } from '../storefront/StorefrontProvider'
import { buttonClasses } from '../utils/buttonClasses'
import { usePublicBlogArticle, usePublicBlogIntegration, usePublicBlogList } from '../blog/PublicBlogProvider'
import { BlogImage } from '../components/blog/BlogImage'
import { BlogBody } from '../components/blog/BlogBody'
import { BlogState } from '../components/blog/BlogState'

export function BlogDetailsPage() {
  const integration = usePublicBlogIntegration()
  return integration.enabled ? <PublicBlogDetailsPage /> : <LegacyBlogDetailsPage />
}

function MoreReads({ articleId }: { articleId: string }) {
  const { state, revalidate } = usePublicBlogList({ pageSize: 4 }, 'related')
  return <aside><h2 className="mb-4 font-serif text-3xl text-burgundy">More Reads</h2>
    {state.status === 'ready' ? <div className="grid gap-4">{state.data?.data.filter(item => item.id !== articleId).slice(0, 3).map(item => <PublicBlogCard blog={item} key={item.id} />)}</div>
      : <BlogState status={state.status} retry={revalidate} />}
  </aside>
}
function PublicBlogDetailsPage() {
  const { slug = '' } = useParams(), { state, revalidate } = usePublicBlogArticle(slug)
  const blog = state.data
  if (state.status !== 'ready' || !blog) return <section className="container-lux py-16"><BlogState status={state.status} retry={revalidate} /></section>
  return <>
    <PageHeader description={blog.excerpt} eyebrow={blog.category.title} title={blog.title}>
      <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-brownroyal/65">
        <span className="inline-flex items-center gap-2"><CalendarDays aria-hidden="true" className="h-4 w-4" /><time dateTime={blog.publishedAt}>{new Date(blog.publishedAt).toLocaleDateString('en-PK', { month: 'long', day: 'numeric', year: 'numeric' })}</time></span>
        <span>By {blog.author.name}</span>
      </div>
    </PageHeader>
    <article className="container-lux grid gap-10 py-12 md:py-16 lg:grid-cols-[1fr_320px]">
      <div className="max-w-3xl">
        <div className="mb-8"><BlogImage image={blog.featuredImage} caption loading="eager" /></div>
        <BlogBody body={blog.body} key={blog.id} />
        {blog.author.bio && <p className="mt-8 text-sm text-brownroyal/65">{blog.author.bio}</p>}
        <div className="mt-8 flex flex-wrap gap-3">
          <Link className={buttonClasses({ variant: 'outline' })} to="/blogs">Back to Journal</Link>
          <button className="font-semibold text-burgundy underline" onClick={revalidate} type="button">Refresh article</button>
        </div>
      </div><MoreReads articleId={blog.id} />
    </article>
  </>
}

function LegacyBlogDetailsPage() {
  const { blogs } = useStorefront()
  const { slug } = useParams()
  const blog = blogs.find((item) => item.slug === slug)

  if (!blog) {
    return (
      <section className="container-lux py-16">
        <EmptyState
          actionLabel="Read Blogs"
          actionTo="/blogs"
          description="This fragrance article is not available in the local content library."
          title="Journal entry not found"
        />
      </section>
    )
  }

  const related = blogs.filter((item) => item.id !== blog.id).slice(0, 3)

  return (
    <>
      <PageHeader description={blog.excerpt} eyebrow={blog.category} title={blog.title}>
        <div className="mt-6 flex flex-wrap items-center gap-4 text-sm font-semibold text-brownroyal/65">
          <span className="inline-flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-oldgold" aria-hidden="true" />
            {new Date(blog.publishedAt).toLocaleDateString('en-PK', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
          <span>{blog.readTime}</span>
        </div>
      </PageHeader>
      <article className="container-lux grid gap-10 py-12 md:py-16 lg:grid-cols-[1fr_320px]">
        <div className="max-w-3xl">
          <div className="mb-8 rounded-lg bg-gradient-to-br from-cream to-marble py-8">
            <ProductBottle floating name={blog.title} tone={blog.image} />
          </div>
          <div className="space-y-6 text-lg leading-9 text-brownroyal/76">
            {blog.content.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <Link className={buttonClasses({ className: 'mt-10', variant: 'outline' })} to="/blogs">
            Back to Journal
          </Link>
        </div>
        <aside>
          <h2 className="mb-4 font-serif text-3xl font-semibold text-burgundy">More Reads</h2>
          <div className="grid gap-4">
            {related.map((item) => (
              <BlogCard blog={item} key={item.id} />
            ))}
          </div>
        </aside>
      </article>
    </>
  )
}
