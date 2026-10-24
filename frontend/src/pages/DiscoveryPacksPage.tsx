import { Droplets, Sparkles, SlidersHorizontal, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState } from '../components/common/EmptyState'
import { PageHeader } from '../components/common/PageHeader'
import { TesterPackCard } from '../components/testerPacks/TesterPackCard'
import { publicTesterPacksApi, type PublicTesterPack } from '../services/publicTesterPacksApi'
import { cn } from '../utils/cn'

type PackFilter = 'all' | 'fixed' | 'configurable'

export function DiscoveryPacksPage() {
  const [packs, setPacks] = useState<PublicTesterPack[]>([])
  const [filter, setFilter] = useState<PackFilter>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadPacks = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const packs = await publicTesterPacksApi.listAll()
      setPacks(packs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load discovery packs')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadPacks()
  }, [])

  const filteredPacks = packs.filter((pack) => {
    if (filter === 'fixed') return pack.mode === 'fixed'
    if (filter === 'configurable') return pack.mode === 'configurable'
    return true
  })

  return (
    <>
      <PageHeader
        eyebrow="Discovery Sets & Testers"
        title="Discovery Tester Packs"
        description="Experience Royal Fusion's artisanal fragrance collection at home. Choose pre-curated discovery sets or craft your own bespoke pack of 5 ml spray atomizers."
      />

      <section className="container-lux py-10 md:py-14">
        {/* Filter Pills */}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-soft-border/70 pb-5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={filter === 'all'}
              onClick={() => setFilter('all')}
              className={cn(
                'rounded-full px-4 py-2 text-xs font-semibold tracking-wide transition',
                filter === 'all'
                  ? 'bg-royal-burgundy text-warm-ivory shadow-xs'
                  : 'bg-warm-ivory/80 text-espresso hover:bg-champagne/15',
              )}
            >
              All Packs ({packs.length})
            </button>
            <button
              type="button"
              aria-pressed={filter === 'fixed'}
              onClick={() => setFilter('fixed')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold tracking-wide transition',
                filter === 'fixed'
                  ? 'bg-royal-burgundy text-warm-ivory shadow-xs'
                  : 'bg-warm-ivory/80 text-espresso hover:bg-champagne/15',
              )}
            >
              <Sparkles className="h-3.5 w-3.5 text-champagne" />
              Curated Sets ({packs.filter((p) => p.mode === 'fixed').length})
            </button>
            <button
              type="button"
              aria-pressed={filter === 'configurable'}
              onClick={() => setFilter('configurable')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold tracking-wide transition',
                filter === 'configurable'
                  ? 'bg-royal-burgundy text-warm-ivory shadow-xs'
                  : 'bg-warm-ivory/80 text-espresso hover:bg-champagne/15',
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-champagne" />
              Build Your Own ({packs.filter((p) => p.mode === 'configurable').length})
            </button>
          </div>

          <p className="text-xs text-muted-taupe">
            Showing {filteredPacks.length} discovery pack{filteredPacks.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3" role="status">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-2xl border border-soft-border/60 bg-pure-white p-5 shadow-xs"
              >
                <div className="mb-4 h-6 w-24 rounded-full bg-soft-border/50" />
                <div className="mb-5 aspect-[4/3] rounded-xl bg-soft-border/40" />
                <div className="mb-2 h-4 w-1/3 rounded bg-soft-border/50" />
                <div className="mb-3 h-6 w-3/4 rounded bg-soft-border/60" />
                <div className="mb-4 h-12 w-full rounded bg-soft-border/40" />
                <div className="flex justify-between border-t border-soft-border/50 pt-4">
                  <div className="h-6 w-20 rounded bg-soft-border/50" />
                  <div className="h-8 w-24 rounded bg-soft-border/60" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {!isLoading && error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
            <p className="font-serif text-xl font-semibold text-rose-900">{error}</p>
            <p className="mt-2 text-sm text-rose-800">
              We encountered an issue loading our discovery collection.
            </p>
            <button
              type="button"
              onClick={() => void loadPacks()}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-royal-burgundy px-5 py-2 text-xs font-semibold text-warm-ivory transition hover:bg-royal-burgundy/90"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && filteredPacks.length === 0 && (
          <EmptyState
            title="No discovery packs available"
            description="Our perfumers are preparing new seasonal discovery sets. Please check back soon or browse our full fragrance catalog."
          />
        )}

        {/* Product Cards Grid */}
        {!isLoading && !error && filteredPacks.length > 0 && (
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {filteredPacks.map((pack) => (
              <TesterPackCard key={pack.id} pack={pack} />
            ))}
          </div>
        )}

        {/* Informational Editorial Highlights */}
        <div className="mt-16 rounded-3xl border border-soft-border/80 bg-gradient-to-br from-warm-ivory via-soft-cream/40 to-warm-ivory p-8 md:p-12">
          <div className="max-w-2xl">
            <span className="eyebrow-label text-xs">The Royal Fusion Experience</span>
            <h2 className="mt-2 font-serif text-2xl font-bold text-royal-burgundy md:text-3xl">
              Why Explore Our Discovery Testers?
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-taupe">
              Fragrance reveals its genuine character over hours on the skin. Our discovery tester
              packs allow you to immerse yourself in Royal Fusion's artisanal extraits and eau de
              parfums at your own pace before selecting a full flacon.
            </p>
          </div>

          <div className="mt-8 grid gap-6 sm:grid-cols-3 border-t border-soft-border/70 pt-8">
            <div className="space-y-2">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-champagne/15 text-royal-burgundy">
                <Droplets className="h-5 w-5 text-champagne" />
              </div>
              <h3 className="font-serif text-base font-semibold text-royal-burgundy">
                Authentic 5 ml Formats
              </h3>
              <p className="text-xs leading-relaxed text-muted-taupe">
                Filled directly from master batches with precision glass spray atomizers offering
                approx. 70 luxurious sprays per tester.
              </p>
            </div>

            <div className="space-y-2">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-champagne/15 text-royal-burgundy">
                <SlidersHorizontal className="h-5 w-5 text-champagne" />
              </div>
              <h3 className="font-serif text-base font-semibold text-royal-burgundy">
                Bespoke Selection
              </h3>
              <p className="text-xs leading-relaxed text-muted-taupe">
                Mix and match any notes — from rare Cambodian Oud to Taif Rose and Parisian Amber —
                tailored to your unique aesthetic.
              </p>
            </div>

            <div className="space-y-2">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-champagne/15 text-royal-burgundy">
                <Sparkles className="h-5 w-5 text-champagne" />
              </div>
              <h3 className="font-serif text-base font-semibold text-royal-burgundy">
                Luxury Presentation
              </h3>
              <p className="text-xs leading-relaxed text-muted-taupe">
                Encased in velvet-lined gift boxes designed for journeys, desk-side elegance, or an
                exquisite gift for someone special.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
