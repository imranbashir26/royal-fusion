import type { ReactNode } from 'react'
import { useState } from 'react'
import { AccountModal } from '../account/AccountModal'
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
  const [isAccountOpen, setIsAccountOpen] = useState(false)

  return (
    <div className="min-h-screen overflow-x-hidden pb-20 text-brownroyal md:pb-0">
      <Navbar
        onAccountOpen={() => setIsAccountOpen(true)}
        onSearchOpen={() => setIsSearchOpen(true)}
      />
      {children}
      <Footer />
      <SearchOverlay isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      <AccountModal isOpen={isAccountOpen} onClose={() => setIsAccountOpen(false)} />
      <CartDrawer />
      <FloatingWhatsApp />
      <MobileBottomBar onSearchOpen={() => setIsSearchOpen(true)} />
    </div>
  )
}
