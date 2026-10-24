import { EmptyState } from '../common/EmptyState'
import type { BlogLoadState } from '../../blog/PublicBlogProvider'

export function BlogState({ status, retry }: { status: BlogLoadState<unknown>['status']; retry: () => void }) {
  if (status === 'idle' || status === 'loading') return <p className="py-12 text-center" role="status">Loading fragrance stories…</p>
  const missing = status === 'not-found', invalid = status === 'invalid', empty = status === 'empty'
  const title = missing ? 'Journal entry not found' : invalid ? 'Invalid journal address' : empty ? 'New fragrance stories are coming soon' : 'Journal temporarily unavailable'
  const description = missing ? 'This article is not published or is no longer available.' : invalid ? 'Please use a valid journal link or page number.'
    : empty ? 'No published articles are available on this page.' : status === 'rate-limited' ? 'Too many article requests. Please try again shortly.' : 'Articles are temporarily unavailable.'
  return <div role={empty || missing ? 'status' : 'alert'}><EmptyState title={title} description={description} actionLabel="Read Blogs" actionTo="/blogs">
    {!invalid && <button className="mt-5 block w-full font-semibold text-burgundy underline" onClick={retry} type="button">Try again</button>}
  </EmptyState></div>
}
