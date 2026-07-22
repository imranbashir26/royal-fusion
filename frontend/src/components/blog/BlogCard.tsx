import { ArrowRight, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { BlogPost } from '../../types'
import { ProductBottle } from '../products/ProductBottle'

interface BlogCardProps {
  blog: BlogPost
}

export function BlogCard({ blog }: BlogCardProps) {
  return (
    <article className="overflow-hidden rounded-lg border border-champagne/25 bg-ivory/84 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-champagne/55 hover:shadow-xl hover:shadow-brownroyal/10">
      <Link className="block bg-gradient-to-br from-cream to-marble py-6" to={`/blogs/${blog.slug}`}>
        <ProductBottle compact name={blog.title} tone={blog.image} />
      </Link>
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-[0.16em] text-oldgold">
          <span>{blog.category}</span>
          <span className="inline-flex items-center gap-1 normal-case tracking-[0.02em] text-brownroyal/55">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {blog.readTime}
          </span>
        </div>
        <Link to={`/blogs/${blog.slug}`}>
          <h3 className="font-serif text-2xl font-semibold leading-tight text-burgundy">
            {blog.title}
          </h3>
        </Link>
        <p className="mt-3 line-clamp-3 text-sm leading-6 text-brownroyal/72">{blog.excerpt}</p>
        <Link
          className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-burgundy hover:text-velvet"
          to={`/blogs/${blog.slug}`}
        >
          Read Journal
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </article>
  )
}
