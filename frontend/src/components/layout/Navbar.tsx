import { AnimatePresence, motion } from 'framer-motion'
import { Heart, Menu, Search, ShoppingBag, User, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import logo from '../../assets/brand/logo.png'
import { useCartStore } from '../../store/cartStore'
import { useWishlistStore } from '../../store/wishlistStore'
import { cn } from '../../utils/cn'

const navLinks = [
  { label: 'Shop', to: '/shop' },
  { label: 'Attars', to: '/attars' },
  { label: 'Collections', to: '/collections' },
  { label: 'Best Sellers', to: '/shop?best=true' },
  { label: 'Blogs', to: '/blogs' },
  { label: 'About Us', to: '/about' },
  { label: 'Contact Us', to: '/contact' },
]

interface NavbarProps {
  onAccountOpen: () => void
  onSearchOpen: () => void
}

export function Navbar({ onAccountOpen, onSearchOpen }: NavbarProps) {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const openCart = useCartStore((state) => state.openCart)
  const itemCount = useCartStore((state) =>
    state.items.reduce((total, item) => total + item.quantity, 0),
  )
  const wishlistCount = useWishlistStore((state) => state.productIds.length)

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 18)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = isMenuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [isMenuOpen])

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b transition duration-300',
        isScrolled
          ? 'border-champagne/30 bg-ivory/88 shadow-lg shadow-brownroyal/8 backdrop-blur-xl'
          : 'border-transparent bg-ivory/55 backdrop-blur-sm',
      )}
    >
      <div className="container-lux flex h-20 items-center justify-between gap-4">
        <Link className="flex items-center gap-3" to="/" aria-label="Royal Fusion home">
          <img className="h-12 w-12 rounded-full object-contain" src={logo} alt="Royal Fusion logo" />
          <span className="hidden sm:block">
            <span className="block font-serif text-2xl font-bold leading-none text-burgundy">
              Royal Fusion
            </span>
            <span className="block text-[10px] font-bold uppercase tracking-[0.24em] text-oldgold">
              Luxury Fragrances
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
          {navLinks.map((link) => (
            <NavLink
              className={({ isActive }) =>
                cn(
                  'rounded-full px-3.5 py-2 text-sm font-semibold text-brownroyal/78 transition hover:bg-champagne/12 hover:text-burgundy',
                  isActive && 'bg-champagne/16 text-burgundy',
                )
              }
              key={link.label}
              to={link.to}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-1">
          <IconButton ariaLabel="Search" onClick={onSearchOpen}>
            <Search className="h-5 w-5" aria-hidden="true" />
          </IconButton>
          <Link
            aria-label="Wishlist"
            className="relative grid h-10 w-10 place-items-center rounded-full border border-champagne/35 bg-ivory/45 text-brownroyal transition hover:border-champagne/70 hover:bg-champagne/12 hover:text-burgundy"
            to="/wishlist"
          >
            <Heart className="h-5 w-5" aria-hidden="true" />
            {wishlistCount > 0 && <CounterBadge value={wishlistCount} />}
          </Link>
          <IconButton ariaLabel="Cart" onClick={openCart}>
            <ShoppingBag className="h-5 w-5" aria-hidden="true" />
            {itemCount > 0 && <CounterBadge value={itemCount} />}
          </IconButton>
          <IconButton ariaLabel="Account" onClick={onAccountOpen}>
            <User className="h-5 w-5" aria-hidden="true" />
          </IconButton>
          <IconButton
            ariaLabel={isMenuOpen ? 'Close menu' : 'Open menu'}
            className="lg:hidden"
            onClick={() => setIsMenuOpen((value) => !value)}
          >
            {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </IconButton>
        </div>
      </div>

      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            className="fixed inset-0 top-20 z-50 bg-brownroyal/35 backdrop-blur-sm lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsMenuOpen(false)}
          >
            <motion.nav
              aria-label="Mobile navigation"
              className="ml-auto h-[calc(100svh-5rem)] w-full max-w-sm border-l border-champagne/30 bg-ivory p-5 shadow-2xl"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-5 flex items-center justify-between">
                <p className="font-serif text-2xl font-semibold text-burgundy">Royal Menu</p>
                <button
                  aria-label="Close menu"
                  className="grid h-10 w-10 place-items-center rounded-full bg-champagne/15 text-brownroyal"
                  onClick={() => setIsMenuOpen(false)}
                  type="button"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <div className="grid gap-2">
                {navLinks.map((link) => (
                  <NavLink
                    className={({ isActive }) =>
                      cn(
                        'rounded-lg px-4 py-3 text-base font-semibold text-brownroyal transition hover:bg-champagne/14',
                        isActive && 'bg-burgundy text-ivory',
                      )
                    }
                    key={link.label}
                    onClick={() => setIsMenuOpen(false)}
                    to={link.to}
                  >
                    {link.label}
                  </NavLink>
                ))}
              </div>
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}

function IconButton({
  ariaLabel,
  children,
  className,
  onClick,
}: {
  ariaLabel: string
  children: ReactNode
  className?: string
  onClick?: () => void
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={cn(
        'relative grid h-10 w-10 place-items-center rounded-full text-brownroyal transition hover:bg-champagne/12 hover:text-burgundy',
        'border border-champagne/35 bg-ivory/45 hover:border-champagne/70',
        className,
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

function CounterBadge({ value }: { value: number }) {
  return (
    <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-burgundy px-1 text-[10px] font-bold text-ivory">
      {value}
    </span>
  )
}
