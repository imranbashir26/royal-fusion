import { Link, type LinkProps } from 'react-router-dom'
import { usePublicBlogIntegration } from '../../blog/PublicBlogProvider'

/** Document delivery is injected by fixtures, never selected by URL or storage. */
export function BlogNavigationLink({ to, ...props }: Omit<LinkProps, 'reloadDocument'>) {
  const { documentMode } = usePublicBlogIntegration()
  const pathname = typeof to === 'string' ? to.split(/[?#]/, 1)[0] : to.pathname ?? ''
  return <Link {...props} to={to} reloadDocument={documentMode && /^\/blogs(?:\/|$)/.test(pathname)} />
}
