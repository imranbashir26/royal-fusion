import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '../components/common/Button'
import { EmptyState } from '../components/common/EmptyState'
import { PageHeader } from '../components/common/PageHeader'
import { ProductGrid } from '../components/products/ProductGrid'
import { categories } from '../data/categories'
import { products } from '../data/products'
import { scentNotes } from '../data/scentNotes'
import { cn } from '../utils/cn'
import { formatCurrency } from '../utils/format'

const sortOptions = [
  'Featured',
  'Best Selling',
  'Price Low to High',
  'Price High to Low',
  'New Arrivals',
]

const genders = ['Men', 'Women', 'Unisex']
const scentFamilies = ['All', ...scentNotes.map((note) => note.name), 'Oud', 'Fresh', 'Spicy', 'Sweet']

export function ShopPage() {
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(searchParams.get('category') ?? 'All')
  const [gender, setGender] = useState(searchParams.get('gender') ?? 'All')
  const [scent, setScent] = useState(searchParams.get('scent') ?? 'All')
  const [maxPrice, setMaxPrice] = useState(7000)
  const [minRating, setMinRating] = useState(false)
  const [bestOnly, setBestOnly] = useState(searchParams.get('best') === 'true')
  const [attarsOnly, setAttarsOnly] = useState(searchParams.get('category') === 'Attars')
  const [sort, setSort] = useState(searchParams.get('best') === 'true' ? 'Best Selling' : 'Featured')
  const [isFilterOpen, setIsFilterOpen] = useState(false)

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const result = products.filter((product) => {
      const matchesSearch =
        !normalized ||
        [product.name, product.category, product.collection, product.scentFamily, product.shortDescription]
          .join(' ')
          .toLowerCase()
          .includes(normalized)

      return (
        matchesSearch &&
        (category === 'All' || product.category === category) &&
        (gender === 'All' || product.gender === gender) &&
        (scent === 'All' || product.scentFamily === scent) &&
        product.price <= maxPrice &&
        (!minRating || product.rating >= 4.8) &&
        (!bestOnly || product.isBestSeller) &&
        (!attarsOnly || product.isAttar)
      )
    })

    return result.sort((a, b) => {
      if (sort === 'Best Selling') return Number(b.isBestSeller) - Number(a.isBestSeller)
      if (sort === 'Price Low to High') return a.price - b.price
      if (sort === 'Price High to Low') return b.price - a.price
      if (sort === 'New Arrivals') return b.id.localeCompare(a.id)
      return Number(b.isFeatured) - Number(a.isFeatured)
    })
  }, [attarsOnly, bestOnly, category, gender, maxPrice, minRating, query, scent, sort])

  const resetFilters = () => {
    setCategory('All')
    setGender('All')
    setScent('All')
    setMaxPrice(7000)
    setMinRating(false)
    setBestOnly(false)
    setAttarsOnly(false)
    setQuery('')
    setSort('Featured')
  }

  const filterPanel = (
    <FilterPanel
      attarsOnly={attarsOnly}
      bestOnly={bestOnly}
      category={category}
      gender={gender}
      maxPrice={maxPrice}
      minRating={minRating}
      onAttarsOnlyChange={setAttarsOnly}
      onBestOnlyChange={setBestOnly}
      onCategoryChange={setCategory}
      onGenderChange={setGender}
      onMaxPriceChange={setMaxPrice}
      onMinRatingChange={setMinRating}
      onReset={resetFilters}
      onScentChange={setScent}
      scent={scent}
    />
  )

  return (
    <>
      <PageHeader
        description="Browse luxury perfumes, attars, best sellers, and gift-ready fragrance impressions with boutique-grade filters."
        eyebrow="Shop"
        title="Royal Perfume Boutique"
      />

      <section className="container-lux py-10 md:py-14">
        <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_auto_auto] lg:items-center">
          <label className="flex h-12 items-center gap-3 rounded-full border border-champagne/35 bg-ivory px-4 shadow-sm">
            <Search className="h-5 w-5 text-oldgold" aria-hidden="true" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-brownroyal outline-none placeholder:text-brownroyal/45"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search perfumes, attars, oud, floral..."
              value={query}
            />
          </label>

          <button
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-champagne/35 bg-ivory px-5 text-sm font-bold text-brownroyal shadow-sm lg:hidden"
            onClick={() => setIsFilterOpen(true)}
            type="button"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Filters
          </button>

          <label className="relative">
            <select
              className="h-12 w-full appearance-none rounded-full border border-champagne/35 bg-ivory px-5 pr-11 text-sm font-bold text-brownroyal shadow-sm outline-none lg:w-56"
              onChange={(event) => setSort(event.target.value)}
              value={sort}
            >
              {sortOptions.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-oldgold" aria-hidden="true" />
          </label>
        </div>

        <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
          <aside className="hidden lg:block">{filterPanel}</aside>
          <div>
            <div className="mb-5 flex items-center justify-between gap-4">
              <p className="text-sm font-semibold text-brownroyal/65">
                Showing {filteredProducts.length} luxury fragrance
                {filteredProducts.length === 1 ? '' : 's'}
              </p>
              <span className="hidden rounded-full bg-champagne/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-oldgold sm:inline-flex">
                Premium Prototype
              </span>
            </div>
            {filteredProducts.length > 0 ? (
              <ProductGrid products={filteredProducts} />
            ) : (
              <EmptyState
                actionLabel="Reset Filters"
                actionTo="/shop"
                description="No products match the current filter combination. Try broadening notes, price, or rating."
                title="No fragrance matched"
              >
                <Button className="mt-6" onClick={resetFilters} variant="outline">
                  Clear Current Filters
                </Button>
              </EmptyState>
            )}
          </div>
        </div>
      </section>

      <AnimatePresence>
        {isFilterOpen && (
          <motion.div
            className="fixed inset-0 z-50 bg-brownroyal/45 backdrop-blur-sm lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsFilterOpen(false)}
          >
            <motion.aside
              className="ml-auto h-full w-full max-w-sm overflow-y-auto bg-ivory p-5 shadow-2xl"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-5 flex items-center justify-between">
                <p className="font-serif text-3xl font-semibold text-burgundy">Filters</p>
                <button
                  aria-label="Close filters"
                  className="grid h-10 w-10 place-items-center rounded-full bg-champagne/15 text-brownroyal"
                  onClick={() => setIsFilterOpen(false)}
                  type="button"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              {filterPanel}
              <Button className="mt-5 w-full" onClick={() => setIsFilterOpen(false)}>
                Apply Filters
              </Button>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function FilterPanel({
  category,
  gender,
  scent,
  maxPrice,
  minRating,
  bestOnly,
  attarsOnly,
  onCategoryChange,
  onGenderChange,
  onScentChange,
  onMaxPriceChange,
  onMinRatingChange,
  onBestOnlyChange,
  onAttarsOnlyChange,
  onReset,
}: {
  category: string
  gender: string
  scent: string
  maxPrice: number
  minRating: boolean
  bestOnly: boolean
  attarsOnly: boolean
  onCategoryChange: (value: string) => void
  onGenderChange: (value: string) => void
  onScentChange: (value: string) => void
  onMaxPriceChange: (value: number) => void
  onMinRatingChange: (value: boolean) => void
  onBestOnlyChange: (value: boolean) => void
  onAttarsOnlyChange: (value: boolean) => void
  onReset: () => void
}) {
  return (
    <div className="rounded-lg border border-champagne/25 bg-ivory/88 p-5 shadow-sm">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-serif text-2xl font-semibold text-burgundy">Refine</h2>
        <button className="text-sm font-bold text-oldgold" onClick={onReset} type="button">
          Reset
        </button>
      </div>
      <FilterGroup title="Category">
        {['All', ...categories.map((item) => item.name)].map((item) => (
          <FilterChip active={category === item} key={item} onClick={() => onCategoryChange(item)}>
            {item}
          </FilterChip>
        ))}
      </FilterGroup>
      <FilterGroup title="Gender">
        {['All', ...genders].map((item) => (
          <FilterChip active={gender === item} key={item} onClick={() => onGenderChange(item)}>
            {item}
          </FilterChip>
        ))}
      </FilterGroup>
      <FilterGroup title="Scent Family">
        {scentFamilies.map((item) => (
          <FilterChip active={scent === item} key={item} onClick={() => onScentChange(item)}>
            {item}
          </FilterChip>
        ))}
      </FilterGroup>
      <FilterGroup title={`Price Range ${formatCurrency(maxPrice)}`}>
        <input
          className="w-full accent-burgundy"
          max={7000}
          min={1500}
          onChange={(event) => onMaxPriceChange(Number(event.target.value))}
          step={250}
          type="range"
          value={maxPrice}
        />
      </FilterGroup>
      <div className="space-y-3">
        <ToggleRow checked={minRating} label="Rating 4.8+" onChange={onMinRatingChange} />
        <ToggleRow checked={bestOnly} label="Best sellers only" onChange={onBestOnlyChange} />
        <ToggleRow checked={attarsOnly} label="Attars only" onChange={onAttarsOnlyChange} />
      </div>
    </div>
  )
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-oldgold">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        'rounded-full border px-3 py-2 text-xs font-bold transition',
        active
          ? 'border-burgundy bg-burgundy text-ivory'
          : 'border-champagne/35 bg-marble text-brownroyal hover:border-oldgold',
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

function ToggleRow({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-champagne/25 bg-marble/70 px-4 py-3 text-sm font-semibold text-brownroyal">
      {label}
      <input
        checked={checked}
        className="h-4 w-4 accent-burgundy"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  )
}
