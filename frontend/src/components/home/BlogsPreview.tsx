import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, BookOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { BlogPost } from '../../types'
import { useStorefront } from '../../storefront/StorefrontProvider'

function sanityImageUrl(source: string, width: number) {
  try {
    const url = new URL(source)
    if (url.hostname !== 'cdn.sanity.io') return source
    url.searchParams.set('w', String(width))
    url.searchParams.set('auto', 'format')
    return url.toString()
  } catch {
    return source
  }
}

function JournalCard({ blog, index }: { blog: BlogPost; index: number }) {
  const reduceMotion = useReducedMotion()
  const articleUrl = `/blogs/${blog.slug}`
  const hasSanityImage = blog.image.includes('cdn.sanity.io/images/')

  return (
    <motion.article
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-soft-border/70 bg-white shadow-[0_8px_26px_rgba(48,35,30,0.04)]"
      initial={reduceMotion ? false : { opacity: 0, y: 14 }}
      transition={{ duration: reduceMotion ? 0 : 0.5, delay: reduceMotion ? 0 : index * 0.07 }}
      viewport={{ once: true, amount: 0.1 }}
      whileInView={{ opacity: 1, y: 0 }}
    >
      <Link
        aria-label={`Read ${blog.title}`}
        className="group block overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-royal-burgundy"
        to={articleUrl}
      >
        {blog.image ? (
          <img
            alt={blog.imageAlt || `Featured image for ${blog.title}`}
            className="aspect-[8/5] w-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.02] motion-reduce:transition-none"
            decoding="async"
            height={500}
            loading="lazy"
            sizes="(min-width: 1280px) 400px, (min-width: 768px) 50vw, 100vw"
            src={sanityImageUrl(blog.image, 800)}
            srcSet={hasSanityImage ? [480, 800, 1200].map((width) => `${sanityImageUrl(blog.image, width)} ${width}w`).join(', ') : undefined}
            width={800}
          />
        ) : (
          <span aria-hidden="true" className="grid aspect-[8/5] place-items-center bg-soft-cream text-champagne">
            <BookOpen className="h-9 w-9" strokeWidth={1.25} />
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col p-6 sm:p-7">
        {blog.category && (
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#805b1e]">
            {blog.category}
          </p>
        )}
        <h3 className="font-serif text-[clamp(1.625rem,2.2vw,1.9375rem)] font-semibold leading-[1.12] text-royal-burgundy">
          <Link
            className="rounded-sm hover:text-deep-wine focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-royal-burgundy"
            to={articleUrl}
          >
            {blog.title}
          </Link>
        </h3>
        {blog.excerpt && (
          <p className="mt-3 line-clamp-4 text-[15px] leading-[1.6] text-muted-taupe">{blog.excerpt}</p>
        )}
        <Link
          className="group mt-6 inline-flex min-h-11 items-center gap-2 self-start rounded-sm border-b border-champagne/70 text-sm font-semibold text-royal-burgundy hover:text-deep-wine focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-royal-burgundy"
          to={articleUrl}
        >
          Read Article
          <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform duration-300 motion-safe:group-hover:translate-x-1 motion-reduce:transition-none" />
        </Link>
      </div>
    </motion.article>
  )
}

export function BlogsPreview() {
  const { blogs, isLoading } = useStorefront()
  const articles = blogs.filter((blog) => blog.title && blog.slug).slice(0, 3)

  return (
    <section aria-labelledby="fragrance-journal-heading" className="section-spacing bg-soft-cream">
      <div className="container-lux">
        <div className="mx-auto mb-10 max-w-[760px] text-center md:mb-12">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-[#805b1e] sm:text-[13px]">
            FRAGRANCE JOURNAL
          </p>
          <h2 id="fragrance-journal-heading" className="font-serif text-[clamp(2.625rem,4vw,3.5rem)] font-semibold leading-[1.08] text-royal-burgundy">
            Stories, Inspiration &amp; Fragrance Insights
          </h2>
          <p className="mx-auto mt-5 max-w-[680px] text-[15px] leading-[1.7] text-[#75645a] sm:text-base">
            Explore the world of fragrance through curated stories, guides, and inspiration designed to help you discover new scent perspectives.
          </p>
        </div>

        {isLoading ? (
          <p aria-live="polite" className="py-12 text-center text-[#75645a]" role="status">
            Loading fragrance stories…
          </p>
        ) : articles.length ? (
          <>
            <div className={`mx-auto grid gap-6 md:grid-cols-2 xl:grid-cols-3 ${articles.length === 1 ? 'max-w-[430px]' : articles.length === 2 ? 'xl:max-w-[880px] xl:grid-cols-2' : ''}`}>
              {articles.map((blog, index) => (
                <JournalCard blog={blog} index={index} key={blog.id} />
              ))}
            </div>
            <div className="mt-10 flex justify-center md:mt-12">
              <Link
                className="group inline-flex min-h-12 items-center justify-center gap-3 rounded-[10px] bg-royal-burgundy px-7 py-3 text-sm font-semibold text-warm-ivory transition-colors duration-300 hover:bg-deep-wine focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-royal-burgundy motion-reduce:transition-none"
                to="/blogs"
              >
                Explore All Articles
                <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform duration-300 motion-safe:group-hover:translate-x-1 motion-reduce:transition-none" />
              </Link>
            </div>
          </>
        ) : (
          <p className="py-12 text-center text-base text-[#75645a]">New fragrance stories are coming soon.</p>
        )}
      </div>
    </section>
  )
}
