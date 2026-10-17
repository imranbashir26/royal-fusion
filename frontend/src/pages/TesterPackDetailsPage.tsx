import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/common/EmptyState'
import { ConfigurablePackBuilder } from '../components/testerPacks/ConfigurablePackBuilder'
import { FixedPackView } from '../components/testerPacks/FixedPackView'
import { publicTesterPacksApi, type PublicTesterPack } from '../services/publicTesterPacksApi'

export function TesterPackDetailsPage() {
  const { slugOrId } = useParams<{ slugOrId: string }>()
  const [pack, setPack] = useState<PublicTesterPack | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadPack = async () => {
    if (!slugOrId) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await publicTesterPacksApi.getBySlugOrId(slugOrId)
      setPack(data)
      if (!data) {
        setError('The requested discovery pack could not be found.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load discovery pack details')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadPack()
  }, [slugOrId])

  return (
    <div className="container-lux py-10 md:py-14">
      {/* Back Link */}
      <div className="mb-6">
        <Link
          to="/discovery-packs"
          className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-taupe transition hover:text-royal-burgundy"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to All Discovery Packs</span>
        </Link>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="animate-pulse space-y-8" role="status">
          <div className="h-10 w-1/3 rounded-lg bg-soft-border/50" />
          <div className="grid gap-12 lg:grid-cols-2">
            <div className="aspect-square rounded-2xl bg-soft-border/40" />
            <div className="space-y-4">
              <div className="h-8 w-3/4 rounded bg-soft-border/50" />
              <div className="h-6 w-1/4 rounded bg-soft-border/50" />
              <div className="h-24 w-full rounded bg-soft-border/40" />
              <div className="h-12 w-full rounded bg-soft-border/50" />
            </div>
          </div>
        </div>
      )}

      {/* Error or Not Found State */}
      {!isLoading && (error || !pack) && (
        <div className="rounded-2xl border border-soft-border/80 bg-warm-ivory/50 p-12 text-center">
          <EmptyState
            title="Discovery Pack Not Found"
            description={
              error ||
              'The discovery pack you are looking for is either unavailable or has been archived.'
            }
          />
          <div className="mt-6 flex justify-center gap-4">
            <button
              type="button"
              onClick={() => void loadPack()}
              className="inline-flex items-center gap-2 rounded-full border border-champagne/40 bg-pure-white px-5 py-2 text-xs font-semibold text-royal-burgundy transition hover:bg-champagne/10"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Retry</span>
            </button>
            <Link
              to="/discovery-packs"
              className="inline-flex items-center gap-2 rounded-full bg-royal-burgundy px-5 py-2 text-xs font-semibold text-warm-ivory transition hover:bg-royal-burgundy/90"
            >
              <span>Explore All Discovery Packs</span>
            </Link>
          </div>
        </div>
      )}

      {/* Main Mode View */}
      {!isLoading && pack && (
        <>
          {pack.mode === 'fixed' ? (
            <FixedPackView pack={pack} />
          ) : (
            <ConfigurablePackBuilder pack={pack} />
          )}
        </>
      )}
    </div>
  )
}
