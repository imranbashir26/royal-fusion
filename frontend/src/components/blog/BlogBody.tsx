import { Component, type ReactNode } from 'react'
import { PortableText, type PortableTextComponents } from '@portabletext/react'
import { Link } from 'react-router-dom'
import type { BlogBody as ArticleBody, BlogImageBlock } from '../../../../shared/contracts/blogV1'
import { BlogImage } from './BlogImage'

const components: PortableTextComponents = {
  block: {
    normal: ({ children }) => <p>{children}</p>, h2: ({ children }) => <h2 className="font-serif text-3xl text-burgundy">{children}</h2>,
    h3: ({ children }) => <h3 className="font-serif text-2xl text-burgundy">{children}</h3>,
    blockquote: ({ children }) => <blockquote className="border-l-4 border-oldgold pl-5 italic">{children}</blockquote>,
  },
  marks: {
    strong: ({ children }) => <strong>{children}</strong>, em: ({ children }) => <em>{children}</em>,
    code: ({ children }) => <code>{children}</code>, underline: ({ children }) => <u>{children}</u>,
    'strike-through': ({ children }) => <del>{children}</del>,
    link: ({ children, value }) => {
      const href: unknown = value?.href
      if (typeof href !== 'string' || /[\s<>\\]/.test(href)) throw new TypeError('Article content is invalid.')
      if (href.startsWith('/') && !href.startsWith('//')) return <Link className="underline text-burgundy" to={href}>{children}</Link>
      const url = new URL(href)
      if (url.protocol !== 'https:' || url.username || url.password) throw new TypeError('Article content is invalid.')
      return <a className="underline text-burgundy" href={url.href} rel="noopener noreferrer">{children}</a>
    },
  },
  list: { bullet: ({ children }) => <ul className="list-disc pl-6">{children}</ul>, number: ({ children }) => <ol className="list-decimal pl-6">{children}</ol> },
  listItem: { bullet: ({ children }) => <li>{children}</li>, number: ({ children }) => <li>{children}</li> },
  types: { image: ({ value }) => <BlogImage image={value as BlogImageBlock} caption /> },
}
class BodyBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p role="alert">Article content is temporarily unavailable.</p> : this.props.children }
}
export function BlogBody({ body }: { body: ArticleBody }) {
  return <BodyBoundary><div className="space-y-6 text-lg leading-9 text-brownroyal/76">
    <PortableText value={body} components={components} onMissingComponent={() => { throw new TypeError('Article content is invalid.') }} />
  </div></BodyBoundary>
}
