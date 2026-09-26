import { LogOut, Menu, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import logo from '../assets/brand/logo.png'
import { Button } from '../components/common/Button'
import { adminNav, adminNavGroups } from './adminConfig'
import { useAdminAuth } from './AdminAuthProvider'
import { cn } from '../utils/cn'

export function AdminLayout() {
  const [isOpen, setIsOpen] = useState(false)
  const navigate = useNavigate()
  const { user, logout, can } = useAdminAuth()

  const allowedNav = adminNav.filter((item) => can(item.permission))

  const handleLogout = async () => {
    try {
      await logout()
      navigate('/admin/login', { replace: true })
    } catch {
      // Keep the authenticated UI until server-side revocation succeeds.
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f1e7] text-brownroyal">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-72 border-r border-champagne/30 bg-burgundy text-ivory shadow-2xl transition-transform lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-20 items-center justify-between border-b border-ivory/10 px-5">
          <Link className="flex items-center gap-3" to="/admin/dashboard">
            <img className="h-11 w-11 rounded-full bg-ivory object-contain" src={logo} alt="Royal Fusion logo" />
            <span>
              <span className="block font-serif text-2xl font-bold leading-none">Royal Admin</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-champagne">
                Management
              </span>
            </span>
          </Link>
          <button className="lg:hidden" onClick={() => setIsOpen(false)} type="button" aria-label="Close admin menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="h-[calc(100svh-5rem)] overflow-y-auto p-4 space-y-5" aria-label="Admin navigation">
          {adminNavGroups.map((groupName) => {
            const groupItems = allowedNav.filter((item) => item.group === groupName)
            if (groupItems.length === 0) return null
            return (
              <div key={groupName} className="space-y-1">
                <p className="px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-champagne/60">
                  {groupName}
                </p>
                {groupItems.map((item) => (
                  <NavLink
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-bold text-ivory/80 transition hover:bg-ivory/10 hover:text-ivory',
                        isActive && 'bg-champagne text-brownroyal hover:bg-champagne hover:text-brownroyal',
                      )
                    }
                    key={item.to}
                    onClick={() => setIsOpen(false)}
                    to={item.to}
                  >
                    <item.icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-champagne/25 bg-ivory/90 px-4 shadow-sm backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <button
              className="grid h-10 w-10 place-items-center rounded-full bg-champagne/15 text-brownroyal lg:hidden"
              onClick={() => setIsOpen(true)}
              type="button"
              aria-label="Open admin menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <p className="font-serif text-2xl font-semibold text-burgundy">Royal Fusion Admin</p>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-oldgold">
                Secure dashboard
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-bold text-burgundy">{user?.name}</p>
              <p className="text-xs text-brownroyal/60">{user?.role}</p>
            </div>
            <div className="hidden h-10 w-10 place-items-center rounded-full bg-champagne/18 text-oldgold sm:grid">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <Button onClick={() => void handleLogout()} size="sm" variant="outline">
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </div>
        </header>
        <main className="p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
