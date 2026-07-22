import { Heart, Home, MessageCircle, Search, ShoppingBag } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCartStore } from '../../store/cartStore'

interface MobileBottomBarProps {
  onSearchOpen: () => void
}

export function MobileBottomBar({ onSearchOpen }: MobileBottomBarProps) {
  const openCart = useCartStore((state) => state.openCart)
  const itemCount = useCartStore((state) =>
    state.items.reduce((total, item) => total + item.quantity, 0),
  )

  return (
    <nav
      aria-label="Mobile quick actions"
      className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 rounded-full border border-champagne/35 bg-ivory/92 px-2 py-2 shadow-2xl shadow-brownroyal/16 backdrop-blur-xl md:hidden"
    >
      <Link className="grid place-items-center gap-1 text-[10px] font-bold text-brownroyal" to="/">
        <Home className="h-5 w-5" aria-hidden="true" />
        Home
      </Link>
      <Link className="grid place-items-center gap-1 text-[10px] font-bold text-brownroyal" to="/shop">
        <ShoppingBag className="h-5 w-5" aria-hidden="true" />
        Shop
      </Link>
      <button
        className="grid place-items-center gap-1 text-[10px] font-bold text-brownroyal"
        onClick={onSearchOpen}
        type="button"
      >
        <Search className="h-5 w-5" aria-hidden="true" />
        Search
      </button>
      <Link className="grid place-items-center gap-1 text-[10px] font-bold text-brownroyal" to="/wishlist">
        <Heart className="h-5 w-5" aria-hidden="true" />
        Wishlist
      </Link>
      <button
        className="relative grid place-items-center gap-1 text-[10px] font-bold text-brownroyal"
        onClick={openCart}
        type="button"
      >
        <ShoppingBag className="h-5 w-5" aria-hidden="true" />
        Cart
        {itemCount > 0 && (
          <span className="absolute right-3 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-burgundy px-1 text-[9px] text-ivory">
            {itemCount}
          </span>
        )}
      </button>
      <a className="sr-only" href="https://wa.me/923000000000">
        <MessageCircle className="h-5 w-5" aria-hidden="true" />
        WhatsApp
      </a>
    </nav>
  )
}
