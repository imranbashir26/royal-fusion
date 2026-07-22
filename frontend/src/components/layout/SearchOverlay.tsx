import { AnimatePresence, motion } from 'framer-motion'
import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStorefront } from '../../storefront/StorefrontProvider'
import { cn } from '../../utils/cn'
import { formatCurrency } from '../../utils/format'
import { ProductBottle } from '../products/ProductBottle'

interface SearchOverlayProps {
  isOpen: boolean
  onClose: () => void
}

export function SearchOverlay({ isOpen, onClose }: SearchOverlayProps) {
  const { products } = useStorefront()
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return products.slice(0, 4)
    return products.filter((product) =>
      [product.name, product.scentFamily, product.category, product.gender, product.collection]
        .join(' ')
        .toLowerCase()
        .includes(normalized),
    )
  }, [products, query])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 bg-brownroyal/45 p-4 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="mx-auto mt-8 max-h-[86svh] max-w-3xl overflow-hidden rounded-lg border border-champagne/35 bg-ivory shadow-2xl"
            initial={{ y: 24, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 18, scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.28 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-champagne/25 px-4 py-3">
              <Search className="h-5 w-5 text-oldgold" aria-hidden="true" />
              <input
                autoFocus
                className="h-12 flex-1 bg-transparent text-lg font-semibold text-burgundy outline-none placeholder:text-brownroyal/45"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search perfumes, attars, notes..."
                value={query}
              />
              <button
                aria-label="Close search"
                className="grid h-10 w-10 place-items-center rounded-full bg-champagne/12 text-brownroyal"
                onClick={onClose}
                type="button"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="luxury-scrollbar max-h-[66svh] overflow-y-auto p-4">
              <div className={cn('grid gap-3', results.length > 0 && 'sm:grid-cols-2')}>
                {results.map((product) => (
                  <Link
                    className="flex gap-4 rounded-lg border border-champagne/20 bg-marble/70 p-3 transition hover:border-champagne/55 hover:bg-cream/80"
                    key={product.id}
                    onClick={onClose}
                    to={`/product/${product.slug}`}
                  >
                    <div className="w-24 shrink-0 rounded-lg bg-gradient-to-br from-cream to-ivory">
                      <ProductBottle compact className="h-28 w-24" name={product.name} tone={product.image} />
                    </div>
                    <div className="min-w-0 py-1">
                      <p className="font-serif text-xl font-semibold text-burgundy">{product.name}</p>
                      <p className="mt-1 text-sm text-brownroyal/65">{product.shortDescription}</p>
                      <p className="mt-2 text-sm font-extrabold text-brownroyal">
                        {formatCurrency(product.price)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
              {results.length === 0 && (
                <div className="py-12 text-center">
                  <p className="font-serif text-3xl font-semibold text-burgundy">No fragrance found</p>
                  <p className="mt-2 text-brownroyal/65">Try oud, floral, citrus, woody, or attar.</p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
