import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { blogs } from '../../data/blogs'
import { BlogCard } from '../blog/BlogCard'
import { AnimatedSection } from '../common/AnimatedSection'
import { SectionHeading } from '../common/SectionHeading'
import { buttonClasses } from '../../utils/buttonClasses'

export function BlogsPreview() {
  return (
    <AnimatedSection>
      <div className="container-lux">
        <SectionHeading
          action={
            <Link className={buttonClasses({ variant: 'outline' })} to="/blogs">
              Read All
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          }
          align="left"
          description="SEO-friendly fragrance education around perfumes in Pakistan, notes, and daily wear."
          eyebrow="Fragrance Journal"
          title="Learn the Language of Scent"
        />
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {blogs.map((blog) => (
            <BlogCard blog={blog} key={blog.id} />
          ))}
        </div>
      </div>
    </AnimatedSection>
  )
}
