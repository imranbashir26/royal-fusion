import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  ChevronDown,
  ExternalLink,
  Heart,
  HelpCircle,
  Menu,
  MessageCircle,
  Package,
  RotateCcw,
  Search,
  ShoppingBag,
  User,
  X,
} from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import logo from '../../assets/brand/logo.png'
import { useCartStore } from '../../store/cartStore'
import { useWishlistStore } from '../../store/wishlistStore'
import { useStorefront } from '../../storefront/StorefrontProvider'
import { cn } from '../../utils/cn'
import { publicPhone, whatsappUrl } from '../../utils/contactDetails'

interface NavbarProps {
  onAccountOpen: () => void
  onSearchOpen: () => void
}

type DropdownKey = 'shop' | 'help' | null

export function Navbar({ onAccountOpen, onSearchOpen }: NavbarProps) {
  const { settings } = useStorefront()
  const location = useLocation()
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [openMenu, setOpenMenu] = useState<DropdownKey>(null)
  const [mobileShopOpen, setMobileShopOpen] = useState(false)
  const [mobileHelpOpen, setMobileHelpOpen] = useState(false)

  const navRef = useRef<HTMLElement>(null)
  const mobileNavRef = useRef<HTMLElement>(null)
  const mobileCloseRef = useRef<HTMLButtonElement>(null)
  const menuToggleRef = useRef<HTMLButtonElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openCart = useCartStore((state) => state.openCart)
  const itemCount = useCartStore((state) =>
    state.items.reduce((total, item) => total + item.quantity, 0),
  )
  const wishlistCount = useWishlistStore((state) => state.productIds.length)

  // Scroll detection for sticky navbar background
  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 18)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Lock body scroll on mobile drawer open
  useEffect(() => {
    document.body.style.overflow = isMenuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [isMenuOpen])

  useEffect(() => {
    if (!isMenuOpen) return
    mobileCloseRef.current?.focus()

    const handleMobileKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false)
        menuToggleRef.current?.focus()
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(mobileNavRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleMobileKeys)
    return () => document.removeEventListener('keydown', handleMobileKeys)
  }, [isMenuOpen])

  // Close desktop dropdowns on escape or outside click
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenu(null)
      }
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenMenu(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Close menus on route change
  useEffect(() => {
    setOpenMenu(null)
    setIsMenuOpen(false)
  }, [location.pathname, location.search])

  const handleMouseEnter = (key: DropdownKey) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setOpenMenu(key)
  }

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setOpenMenu(null)
    }, 160)
  }

  const toggleDropdown = (key: DropdownKey) => {
    setOpenMenu((current) => (current === key ? null : key))
  }

  // Active state helpers
  const isBestSellersActive =
    location.pathname === '/shop' && location.search.includes('best=true')
  const isShopActive =
    (location.pathname === '/shop' && !location.search.includes('best=true')) ||
    location.pathname === '/attars'
  const isCollectionsActive = location.pathname === '/collections'
  const isJournalActive = location.pathname.startsWith('/blogs')
  const isAboutActive = location.pathname === '/about'
  const isHelpActive = location.pathname === '/contact'

  const mapsUrl = settings.googleMapsUrl?.trim().startsWith('https://') ? settings.googleMapsUrl.trim() : ''
  const whatsappLink = whatsappUrl(settings.whatsappNumber)
  const phone = publicPhone(settings.phoneNumber)

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full transition-colors duration-300',
        isScrolled
          ? 'border-b border-soft-border/70 bg-warm-ivory/95 shadow-xs backdrop-blur-md'
          : 'border-b border-soft-border/40 bg-warm-ivory/80 backdrop-blur-xs',
      )}
      ref={navRef}
    >
      <div className="container-lux flex h-20 items-center justify-between gap-4">
        {/* Brand Logo */}
        <Link className="flex items-center gap-3" to="/" aria-label="Royal Fusion Home">
          <img
            className="h-11 w-11 rounded-full object-contain"
            src={logo}
            alt="Royal Fusion logo"
          />
          <span className="hidden sm:block">
            <span className="block font-serif text-2xl font-bold leading-none text-royal-burgundy">
              Royal Fusion
            </span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.24em] text-champagne">
              Luxury Fragrances
            </span>
          </span>
        </Link>

        {/* Desktop Primary Navigation */}
        <nav
          aria-label="Primary navigation"
          className="hidden items-center gap-1 xl:flex xl:gap-2"
        >
          {/* 1. Shop Mega-Menu Trigger */}
          <div
            className="relative inline-flex items-center font-sans text-[14px] font-medium leading-5 tracking-[0.015em]"
            onMouseEnter={() => handleMouseEnter('shop')}
            onMouseLeave={handleMouseLeave}
          >
            <button
              aria-expanded={openMenu === 'shop'}
              aria-haspopup="true"
              className={primaryNavItemClass(isShopActive, openMenu === 'shop')}
              onClick={() => toggleDropdown('shop')}
              type="button"
            >
              <NavItemContent
                hasChevron
                isActive={isShopActive}
                isOpen={openMenu === 'shop'}
                label="Shop"
              />
            </button>

            {/* Shop Mega-Menu Panel */}
            <AnimatePresence>
              {openMenu === 'shop' && (
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute left-0 top-full pt-3 z-50 w-[720px]"
                  exit={{ opacity: 0, y: 6 }}
                  initial={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="rounded-2xl border border-soft-border/90 bg-pure-white p-7 shadow-[0_16px_48px_rgba(48,35,30,0.08)]">
                    <div className="grid grid-cols-[1fr_1fr_1fr_1.3fr] gap-6">
                      {/* Column 1: Shop */}
                      <div className="space-y-3">
                        <p className="eyebrow-label text-[11px]">Shop</p>
                        <ul className="space-y-2 text-sm">
                          <li>
                            <MenuLink to="/shop">Shop All</MenuLink>
                          </li>
                          <li>
                            <MenuLink to="/shop?sort=New+Arrivals">New Arrivals</MenuLink>
                          </li>
                          <li>
                            <MenuLink to="/shop?best=true">Best Sellers</MenuLink>
                          </li>
                        </ul>
                      </div>

                      {/* Column 2: For You */}
                      <div className="space-y-3">
                        <p className="eyebrow-label text-[11px]">For You</p>
                        <ul className="space-y-2 text-sm">
                          <li>
                            <MenuLink to="/shop?gender=Men">Men</MenuLink>
                          </li>
                          <li>
                            <MenuLink to="/shop?gender=Women">Women</MenuLink>
                          </li>
                          <li>
                            <MenuLink to="/shop?gender=Unisex">Unisex</MenuLink>
                          </li>
                        </ul>
                      </div>

                      {/* Column 3: Fragrance */}
                      <div className="space-y-3">
                        <p className="eyebrow-label text-[11px]">Fragrance</p>
                        <ul className="space-y-2 text-sm">
                          <li>
                            <MenuLink to="/attars">Attars</MenuLink>
                          </li>
                          <li>
                            <MenuLink to="/shop?category=Gift+Sets">Gift Sets</MenuLink>
                          </li>
                          <li>
                            <MenuLink to="/shop">Shop by Scent</MenuLink>
                          </li>
                        </ul>
                      </div>

                      {/* Column 4: Featured Boutique Visual */}
                      <div className="flex flex-col justify-between rounded-xl border border-soft-border/80 bg-gradient-to-br from-soft-cream/80 to-warm-ivory p-5 shadow-xs">
                        <div>
                          <p className="eyebrow-label text-[10px]">The Royal Collection</p>
                          <h4 className="mt-2 font-serif text-xl font-semibold leading-snug text-royal-burgundy">
                            Discover the signature edit
                          </h4>
                          <p className="mt-1.5 text-xs leading-relaxed text-muted-taupe">
                            Handcrafted fragrance compositions created for elegance and distinction.
                          </p>
                        </div>
                        <Link
                          className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-royal-burgundy transition hover:text-champagne"
                          onClick={() => setOpenMenu(null)}
                          to="/collections"
                        >
                          <span>Explore Collection</span>
                          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 2. Collections */}
          <Link
            className={primaryNavItemClass(isCollectionsActive)}
            to="/collections"
          >
            <NavItemContent
              isActive={isCollectionsActive}
              label="Collections"
            />
          </Link>

          {/* 3. Best Sellers */}
          <Link
            className={primaryNavItemClass(isBestSellersActive)}
            to="/shop?best=true"
          >
            <NavItemContent
              isActive={isBestSellersActive}
              label="Best Sellers"
            />
          </Link>

          {/* 4. Journal */}
          <Link
            className={primaryNavItemClass(isJournalActive)}
            to="/blogs"
          >
            <NavItemContent
              isActive={isJournalActive}
              label="Journal"
            />
          </Link>

          {/* 5. About */}
          <Link
            className={primaryNavItemClass(isAboutActive)}
            to="/about"
          >
            <NavItemContent
              isActive={isAboutActive}
              label="About"
            />
          </Link>

          {/* 6. Help & Contact Dropdown Trigger */}
          <div
            className="relative inline-flex items-center font-sans text-[14px] font-medium leading-5 tracking-[0.015em]"
            onMouseEnter={() => handleMouseEnter('help')}
            onMouseLeave={handleMouseLeave}
          >
            <button
              aria-expanded={openMenu === 'help'}
              aria-haspopup="true"
              className={primaryNavItemClass(isHelpActive, openMenu === 'help')}
              onClick={() => toggleDropdown('help')}
              type="button"
            >
              <NavItemContent
                hasChevron
                isActive={isHelpActive}
                isOpen={openMenu === 'help'}
                label="Help & Contact"
              />
            </button>

            {/* Help & Contact Dropdown Panel */}
            <AnimatePresence>
              {openMenu === 'help' && (
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute right-0 top-full pt-3 z-50 w-72"
                  exit={{ opacity: 0, y: 6 }}
                  initial={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="rounded-2xl border border-soft-border/90 bg-pure-white p-3.5 shadow-[0_16px_44px_rgba(48,35,30,0.08)]">
                    <ul className="space-y-1 text-sm">
                      <li>
                        <DropdownItem
                          icon={<MessageCircle className="h-4 w-4" />}
                          label="Contact Us"
                          to="/contact"
                        />
                      </li>
                      <li>
                        <DropdownItem
                          icon={<Package className="h-4 w-4" />}
                          label="Track Your Order"
                          subtitle="Concierge tracking"
                          to="/contact?topic=order-tracking"
                        />
                      </li>
                      <li>
                        <DropdownItem
                          icon={<RotateCcw className="h-4 w-4" />}
                          label="Returns & Exchanges"
                          to="/contact?topic=returns"
                        />
                      </li>
                      <li>
                        <DropdownItem
                          icon={<HelpCircle className="h-4 w-4" />}
                          label="FAQs"
                          to="/about#faqs"
                        />
                      </li>
                      {(mapsUrl || whatsappLink) && <li className="my-1.5 border-t border-soft-border/60" />}
                      {mapsUrl && <li>
                        <DropdownExternalItem
                          href={mapsUrl}
                          icon={<ExternalLink className="h-4 w-4" />}
                          label="Google Maps"
                        />
                      </li>}
                      {whatsappLink && <li>
                        <DropdownExternalItem
                          href={whatsappLink}
                          icon={<MessageCircle className="h-4 w-4" />}
                          label="Join Our WhatsApp Community"
                        />
                      </li>}
                    </ul>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </nav>

        {/* Right-Side Controls: Search, Wishlist, Cart, Account, Mobile Menu Toggle */}
        <div className="flex items-center gap-1.5">
          <IconButton ariaLabel="Search" onClick={onSearchOpen}>
            <Search className="h-4.5 w-4.5" aria-hidden="true" />
          </IconButton>
          <Link
            aria-label="Wishlist"
            className="relative grid h-9.5 w-9.5 place-items-center rounded-full border border-soft-border bg-warm-ivory/60 text-espresso transition hover:border-champagne/70 hover:bg-champagne/10 hover:text-royal-burgundy"
            to="/wishlist"
          >
            <Heart className="h-4.5 w-4.5" aria-hidden="true" />
            {wishlistCount > 0 && <CounterBadge value={wishlistCount} />}
          </Link>
          <IconButton ariaLabel="Cart" onClick={openCart}>
            <ShoppingBag className="h-4.5 w-4.5" aria-hidden="true" />
            {itemCount > 0 && <CounterBadge value={itemCount} />}
          </IconButton>
          <IconButton ariaLabel="Account" onClick={onAccountOpen}>
            <User className="h-4.5 w-4.5" aria-hidden="true" />
          </IconButton>
          <IconButton
            ariaLabel={isMenuOpen ? 'Close menu' : 'Open menu'}
            buttonRef={menuToggleRef}
            className="xl:hidden"
            onClick={() => setIsMenuOpen((value) => !value)}
          >
            {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </IconButton>
        </div>
      </div>

      {/* Mobile Drawer with Accordion Navigation */}
      {createPortal(<AnimatePresence>
        {isMenuOpen && (
          <motion.div
            aria-label="Mobile menu"
            aria-modal="true"
            className="fixed inset-0 z-[60] bg-espresso/40 backdrop-blur-xs xl:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setIsMenuOpen(false)
              menuToggleRef.current?.focus()
            }}
            role="dialog"
          >
            <motion.nav
              aria-label="Mobile navigation"
              className="ml-auto flex h-dvh w-full max-w-sm flex-col overflow-hidden border-l border-soft-border bg-warm-ivory p-5 shadow-2xl"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              ref={mobileNavRef}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => {
                event.stopPropagation()
                if ((event.target as HTMLElement).closest('a')) setIsMenuOpen(false)
              }}
            >
              {/* Mobile Drawer Header */}
              <div className="mb-4 flex shrink-0 items-center justify-between border-b border-soft-border/60 pb-4">
                <div className="flex items-center gap-2.5">
                  <img className="h-8 w-8 rounded-full object-contain" src={logo} alt="Royal Fusion logo" />
                  <span className="font-serif text-xl font-bold text-royal-burgundy">Royal Fusion</span>
                </div>
                <button
                  aria-label="Close menu"
                  className="grid h-9 w-9 place-items-center rounded-full bg-soft-cream text-espresso transition hover:text-royal-burgundy"
                  onClick={() => {
                    setIsMenuOpen(false)
                    menuToggleRef.current?.focus()
                  }}
                  ref={mobileCloseRef}
                  type="button"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {/* Accordion List */}
                <div className="space-y-1 text-sm font-medium">
                {/* Shop Accordion */}
                <div className="border-b border-soft-border/40 pb-1">
                  <button
                    aria-expanded={mobileShopOpen}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-espresso transition hover:bg-champagne/10"
                    onClick={() => setMobileShopOpen((prev) => !prev)}
                    type="button"
                  >
                    <span className="font-semibold text-royal-burgundy">Shop</span>
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        'h-4 w-4 transition-transform duration-200 text-champagne',
                        mobileShopOpen && 'rotate-180',
                      )}
                    />
                  </button>
                  <AnimatePresence>
                    {mobileShopOpen && (
                      <motion.div
                        animate={{ opacity: 1, height: 'auto' }}
                        className="overflow-hidden pl-4 pr-2 space-y-1"
                        exit={{ opacity: 0, height: 0 }}
                        initial={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <p className="eyebrow-label text-[10px] pt-1">Collections & Edits</p>
                        <MobileLink to="/shop">Shop All</MobileLink>
                        <MobileLink to="/shop?sort=New+Arrivals">New Arrivals</MobileLink>
                        <MobileLink to="/shop?best=true">Best Sellers</MobileLink>
                        <p className="eyebrow-label text-[10px] pt-2">By Recipient</p>
                        <MobileLink to="/shop?gender=Men">Men</MobileLink>
                        <MobileLink to="/shop?gender=Women">Women</MobileLink>
                        <MobileLink to="/shop?gender=Unisex">Unisex</MobileLink>
                        <p className="eyebrow-label text-[10px] pt-2">Fragrance Formats</p>
                        <MobileLink to="/attars">Attars</MobileLink>
                        <MobileLink to="/shop?category=Gift+Sets">Gift Sets</MobileLink>
                        <MobileLink to="/shop">Shop by Scent</MobileLink>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Direct Links */}
                <MobileLink className="block font-medium" to="/collections">
                  Collections
                </MobileLink>
                <MobileLink className="block font-medium" to="/shop?best=true">
                  Best Sellers
                </MobileLink>
                <MobileLink className="block font-medium" to="/blogs">
                  Journal
                </MobileLink>
                <MobileLink className="block font-medium" to="/about">
                  About
                </MobileLink>

                {/* Help & Contact Accordion */}
                <div className="border-t border-soft-border/40 pt-1">
                  <button
                    aria-expanded={mobileHelpOpen}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-espresso transition hover:bg-champagne/10"
                    onClick={() => setMobileHelpOpen((prev) => !prev)}
                    type="button"
                  >
                    <span className="font-semibold text-royal-burgundy">Help & Contact</span>
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        'h-4 w-4 transition-transform duration-200 text-champagne',
                        mobileHelpOpen && 'rotate-180',
                      )}
                    />
                  </button>
                  <AnimatePresence>
                    {mobileHelpOpen && (
                      <motion.div
                        animate={{ opacity: 1, height: 'auto' }}
                        className="overflow-hidden pl-4 pr-2 space-y-1"
                        exit={{ opacity: 0, height: 0 }}
                        initial={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <MobileLink to="/contact">Contact Us</MobileLink>
                        <MobileLink to="/contact?topic=order-tracking">Track Your Order</MobileLink>
                        <MobileLink to="/contact?topic=returns">Returns & Exchanges</MobileLink>
                        <MobileLink to="/about#faqs">FAQs</MobileLink>
                        {mapsUrl && <a
                          className="block rounded-md px-3 py-2 text-sm text-espresso/80 transition hover:bg-champagne/12 hover:text-royal-burgundy"
                          href={mapsUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Google Maps
                        </a>}
                        {whatsappLink && <a
                          className="block rounded-md px-3 py-2 text-sm text-espresso/80 transition hover:bg-champagne/12 hover:text-royal-burgundy"
                          href={whatsappLink}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Join Our WhatsApp Community
                        </a>}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                </div>

                {/* Mobile Drawer Footer */}
                <div className="mt-5 border-t border-soft-border/60 pt-4 text-xs text-muted-taupe">
                  <p className="font-medium text-espresso">{settings.brandName || 'Royal Fusion'}</p>
                  {phone && <p className="mt-0.5">{phone}</p>}
                </div>
              </div>
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </header>
  )
}

function MenuLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      className="block rounded-md py-1 text-espresso/80 transition hover:text-royal-burgundy hover:translate-x-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-champagne"
      to={to}
    >
      {children}
    </Link>
  )
}

function primaryNavItemClass(isActive?: boolean, isOpen?: boolean) {
  return cn(
    'group relative inline-flex items-center gap-[5px] rounded-xs px-2.5 py-2 text-[14px] font-medium tracking-[0.015em] leading-5 transition-colors duration-200 cursor-pointer select-none focus-visible:outline-none focus-visible:text-royal-burgundy',
    'appearance-none bg-transparent border-0 font-inherit outline-none font-sans',
    isActive || isOpen ? 'text-royal-burgundy' : 'text-espresso hover:text-royal-burgundy',
  )
}

function NavItemContent({
  label,
  isActive,
  isOpen,
  hasChevron,
}: {
  label: string
  isActive?: boolean
  isOpen?: boolean
  hasChevron?: boolean
}) {
  return (
    <>
      <span className="relative font-sans text-[14px] font-medium leading-5 tracking-[0.015em] text-inherit">
        <span>{label}</span>
        <span
          aria-hidden="true"
          className={cn(
            'absolute -bottom-1 left-0 right-0 h-[1.5px] rounded-full transition-all duration-200 ease-out',
            isActive || isOpen
              ? 'bg-champagne opacity-100 scale-x-100'
              : 'bg-champagne opacity-0 scale-x-0 group-hover:opacity-75 group-hover:scale-x-100',
          )}
        />
      </span>
      {hasChevron && (
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'h-[14px] w-[14px] shrink-0 transition-transform duration-200 ease-out',
            isOpen && 'rotate-180',
          )}
        />
      )}
    </>
  )
}

function DropdownItem({
  icon,
  label,
  subtitle,
  to,
}: {
  icon: ReactNode
  label: string
  subtitle?: string
  to: string
}) {
  return (
    <Link
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-espresso transition hover:bg-soft-cream/70 hover:text-royal-burgundy focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-champagne"
      to={to}
    >
      <span className="text-champagne shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="font-medium leading-tight">{label}</p>
        {subtitle && <p className="text-[11px] text-muted-taupe truncate">{subtitle}</p>}
      </div>
    </Link>
  )
}

function DropdownExternalItem({
  icon,
  label,
  href,
}: {
  icon: ReactNode
  label: string
  href: string
}) {
  return (
    <a
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-espresso transition hover:bg-soft-cream/70 hover:text-royal-burgundy focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-champagne"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      <span className="text-champagne shrink-0">{icon}</span>
      <p className="font-medium leading-tight">{label}</p>
    </a>
  )
}

function MobileLink({
  to,
  children,
  className,
}: {
  to: string
  children: ReactNode
  className?: string
}) {
  return (
    <Link
      className={cn(
        'block rounded-md px-3 py-2 text-sm text-espresso/85 transition hover:bg-champagne/12 hover:text-royal-burgundy',
        className,
      )}
      to={to}
    >
      {children}
    </Link>
  )
}

function IconButton({
  ariaLabel,
  buttonRef,
  children,
  className,
  onClick,
}: {
  ariaLabel: string
  buttonRef?: Ref<HTMLButtonElement>
  children: ReactNode
  className?: string
  onClick?: () => void
}) {
  return (
    <button
      aria-label={ariaLabel}
      ref={buttonRef}
      className={cn(
        'relative grid h-9.5 w-9.5 place-items-center rounded-full text-espresso transition cursor-pointer',
        'border border-soft-border bg-warm-ivory/60 hover:border-champagne/70 hover:bg-champagne/10 hover:text-royal-burgundy',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne focus-visible:ring-offset-1 focus-visible:ring-offset-warm-ivory',
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
    <span className="absolute -right-1 -top-1 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-royal-burgundy px-1 text-[10px] font-bold text-white shadow-xs">
      {value}
    </span>
  )
}
