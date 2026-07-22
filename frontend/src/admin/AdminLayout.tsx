import { LogOut, Menu, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import logo from '../assets/brand/logo.png'
import { Button } from '../components/common/Button'
import { adminNav } from './adminConfig'
import { useAdminAuth } from './AdminAuthProvider'
import { cn } from '../utils/cn'

export function AdminLayout() {
  const [isOpen, setIsOpen] = useState(false)
  const navigate = useNavigate()
  const { user, logout, can } = useAdminAuth()

  const allowedNav = adminNav.filter((item) => can(item.permission))

  const handleLogout = () => {
    logout()
    navigate('/admin/login')
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
        <nav className="h-[calc(100svh-5rem)] overflow-y-auto p-4" aria-label="Admin navigation">
          <div className="space-y-1">
            {allowedNav.map((item) => (
              <NavLink
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-bold text-ivory/78 transition hover:bg-ivory/10 hover:text-ivory',
                    isActive && 'bg-champagne text-brownroyal hover:bg-champagne hover:text-brownroyal',
                  )
                }
                key={item.to}
                onClick={() => setIsOpen(false)}
                to={item.to}
              >
                <item.icon className="h-5 w-5" aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
          </div>
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
            <Button onClick={handleLogout} size="sm" variant="outline">
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
