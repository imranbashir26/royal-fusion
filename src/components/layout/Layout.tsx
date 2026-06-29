import type { ReactNode } from 'react'
import { useState } from 'react'
import { CartDrawer } from './CartDrawer'
import { FloatingWhatsApp } from './FloatingWhatsApp'
import { Footer } from './Footer'
import { MobileBottomBar } from './MobileBottomBar'
import { Navbar } from './Navbar'
import { SearchOverlay } from './SearchOverlay'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(false)

  return (
    <div className="min-h-screen overflow-x-hidden pb-20 text-brownroyal md:pb-0">
      <Navbar onSearchOpen={() => setIsSearchOpen(true)} />
      {children}
      <Footer />
      <SearchOverlay isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      <CartDrawer />
      <FloatingWhatsApp />
      <MobileBottomBar onSearchOpen={() => setIsSearchOpen(true)} />
    </div>
  )
}
