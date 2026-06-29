import { BlogCard } from '../components/blog/BlogCard'
import { PageHeader } from '../components/common/PageHeader'
import { blogs } from '../data/blogs'

export function BlogsPage() {
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
